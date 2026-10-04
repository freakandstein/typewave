import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from argparse import Namespace
from pathlib import Path

from test.bridge.test_eeg_bridge_link import free_port
from tools.start import Launcher, Spec, build_specs

ROOT = Path(__file__).resolve().parents[2]


def py(code):
    return [sys.executable, '-u', '-c', code]


def run_in_thread(launcher):
    t = threading.Thread(target=launcher.run, daemon=True)
    t.start()
    return t


def wait_for(cond, timeout=10.0):
    t = time.monotonic()
    while time.monotonic() - t < timeout:
        if cond():
            return True
        time.sleep(0.05)
    return False


class LauncherTest(unittest.TestCase):
    def test_menjalankan_ulang_proses_yang_mati_dengan_jeda(self):
        d = Path(tempfile.mkdtemp())
        counter = d / 'n'
        code = f"import pathlib; p = pathlib.Path({str(counter)!r}); p.write_text(str(int(p.read_text() or 0) + 1) if p.exists() else '1'); raise SystemExit(3)"
        logs = []
        launcher = Launcher([Spec('anak', py(code))], log=logs.append, backoff=(0.1, 0.2), stable_s=30.0)
        t = run_in_thread(launcher)
        self.assertTrue(wait_for(lambda: counter.exists() and int(counter.read_text() or 0) >= 3, 10), 'harus dijalankan ulang berkali-kali')
        launcher.stop()
        t.join(5)
        self.assertFalse(t.is_alive())
        self.assertTrue(any('berhenti' in m and 'anak' in m for m in logs), logs)

    def test_proses_sehat_tidak_dijalankan_ulang_dan_stop_mematikannya(self):
        d = Path(tempfile.mkdtemp())
        started = d / 'started'
        code = f"import pathlib, time; pathlib.Path({str(started)!r}).open('a').write('x'); time.sleep(60)"
        launcher = Launcher([Spec('sehat', py(code))], log=lambda m: None, backoff=(0.1,))
        t = run_in_thread(launcher)
        self.assertTrue(wait_for(started.exists, 10))
        time.sleep(1.0)
        self.assertEqual(started.read_text(), 'x', 'tidak boleh dijalankan ulang')
        proc = launcher.procs['sehat']
        launcher.stop()
        t.join(8)
        self.assertFalse(t.is_alive())
        self.assertIsNotNone(proc.poll(), 'anak harus mati saat stop')

    def test_beberapa_anak_berjalan_bersama_dan_keluarannya_diberi_awalan(self):
        logs = []
        specs = [Spec('satu', py("print('halo dari satu'); import time; time.sleep(30)")),
                 Spec('dua', py("print('halo dari dua'); import time; time.sleep(30)"))]
        launcher = Launcher(specs, log=logs.append, backoff=(0.1,))
        t = run_in_thread(launcher)
        self.assertTrue(wait_for(lambda: any('[satu] halo dari satu' in m for m in logs) and any('[dua] halo dari dua' in m for m in logs), 10), logs)
        launcher.stop()
        t.join(8)

    def test_berhenti_mematikan_yang_dijalankan_belakangan_lebih_dulu(self):
        d = Path(tempfile.mkdtemp())
        order, ready = d / 'urutan', d / 'siap'
        # tiap anak mencatat saat menerima SIGTERM; 'dua' (EEG) lambat 0,5 detik, jadi bila dimatikan bersamaan 'satu' (bridge) akan lebih dulu
        template = ("import pathlib, signal, sys, time; o = pathlib.Path({o!r}); r = pathlib.Path({r!r})\n"
                    "def h(*_):\n    o.open('a').write('{n}-mulai\\n'); time.sleep({delay}); o.open('a').write('{n}-selesai\\n'); sys.exit(0)\n"
                    "signal.signal(signal.SIGTERM, h); r.open('a').write('{n}'); time.sleep(60)")
        specs = [Spec('satu', py(template.format(o=str(order), r=str(ready), n='satu', delay=0.0))),
                 Spec('dua', py(template.format(o=str(order), r=str(ready), n='dua', delay=0.5)))]
        launcher = Launcher(specs, log=lambda m: None, backoff=(0.1,))
        t = run_in_thread(launcher)
        self.assertTrue(wait_for(lambda: ready.exists() and 'satu' in ready.read_text() and 'dua' in ready.read_text(), 10))
        launcher.stop()
        t.join(15)
        self.assertFalse(t.is_alive())
        self.assertEqual(order.read_text().split(), ['dua-mulai', 'dua-selesai', 'satu-mulai', 'satu-selesai'])

    def test_berhenti_saat_anak_belakang_menunggu_jeda_restart_tidak_menahan_yang_lain(self):
        d = Path(tempfile.mkdtemp())
        started = d / 'started'
        specs = [Spec('sehat', py(f"import pathlib, time; pathlib.Path({str(started)!r}).write_text('x'); time.sleep(60)")),
                 Spec('rusak', py("raise SystemExit(1)"))]
        launcher = Launcher(specs, log=lambda m: None, backoff=(30.0,))  # 'rusak' mati lalu menunggu 30 detik sebelum dijalankan ulang
        t = run_in_thread(launcher)
        self.assertTrue(wait_for(started.exists, 10))
        self.assertTrue(wait_for(lambda: launcher.procs.get('rusak') is not None and launcher.procs['rusak'].poll() is not None, 10))
        proc = launcher.procs['sehat']
        t0 = time.monotonic()
        launcher.stop()
        t.join(8)
        self.assertFalse(t.is_alive())
        self.assertLess(time.monotonic() - t0, 6.0, 'tidak boleh menunggu anak yang sudah berhenti sampai batas 20 detik')
        self.assertIsNotNone(proc.poll())

    def test_pipa_keluaran_anak_ditutup_setelah_anak_mati(self):
        launcher = Launcher([Spec('anak', py("print('sampai jumpa')"))], log=lambda m: None, backoff=(30.0,))
        t = run_in_thread(launcher)
        self.assertTrue(wait_for(lambda: launcher.procs.get('anak') is not None and launcher.procs['anak'].poll() is not None, 10))
        proc = launcher.procs['anak']
        self.assertTrue(wait_for(lambda: proc.stdout.closed, 5), 'pipa keluaran harus ditutup, bukan dibiarkan bocor sampai GC (tiap restart menambah satu)')
        launcher.stop()
        t.join(5)

    def test_setelah_hidup_stabil_jeda_direset(self):
        d = Path(tempfile.mkdtemp())
        counter = d / 'n'
        # anak hidup 0,3 detik lalu mati; stable_s 0,2 membuat tiap hidup dianggap stabil, jadi jeda selalu backoff[0]
        code = f"import pathlib, time; p = pathlib.Path({str(counter)!r}); p.open('a').write('x'); time.sleep(0.3); raise SystemExit(1)"
        launcher = Launcher([Spec('anak', py(code))], log=lambda m: None, backoff=(0.1, 5.0), stable_s=0.2)
        t = run_in_thread(launcher)
        self.assertTrue(wait_for(lambda: counter.exists() and len(counter.read_text()) >= 4, 8), 'jeda 5 detik berarti reset gagal')
        launcher.stop()
        t.join(5)


class BuildSpecsTest(unittest.TestCase):
    def args(self, **kw):
        base = dict(port=8999, no_listener=True, no_eeg=False, fake='relaxed', address=None, name=None, python=None, state_dir=None)
        base.update(kw)
        return Namespace(**base)

    def test_state_dir_diteruskan_ke_sumber_eeg(self):
        eeg = build_specs(self.args(state_dir='/tmp/x'))[1].command
        self.assertEqual(eeg[eeg.index('--state-dir') + 1], '/tmp/x')

    def test_tanpa_state_dir_opsinya_tidak_dikirim(self):
        self.assertNotIn('--state-dir', build_specs(self.args())[1].command)


class LauncherProcessTest(unittest.TestCase):
    def test_sighup_saat_jendela_terminal_ditutup_menghentikan_peluncur_dan_semua_anaknya(self):
        port, state = free_port(), Path(tempfile.mkdtemp())
        env = {**{k: v for k, v in os.environ.items() if k != 'LSLAPICFG'}, 'PYTHONUNBUFFERED': '1', 'HOME': str(state)}
        p = subprocess.Popen([sys.executable, '-m', 'tools.start', '--fake', 'relaxed', '--no-listener', '--port', str(port), '--state-dir', str(state)],
                             cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, start_new_session=True)
        lines = []

        def pump():
            for l in p.stdout:
                lines.append(l.rstrip())
            p.stdout.close()

        threading.Thread(target=pump, daemon=True).start()

        def pids(pattern):
            out = subprocess.run(['pgrep', '-f', '--', pattern], capture_output=True, text=True).stdout  # '--': pola tidak boleh dibaca sebagai opsi
            return [int(x) for x in out.split() if int(x) != p.pid]

        def alive(pid):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return False
            return True

        children = []
        try:
            self.assertTrue(wait_for(lambda: any('headset tersambung' in l for l in lines), 40), '\n'.join(lines))
            streamer = int((state / '.streamer.pid').read_text())
            children = pids(f'bridge.bridge --port {port}') + pids(f'eeg --bridge ws://127.0.0.1:{port}/ws') + [streamer]
            self.assertEqual(len(children), 3, children)
            os.kill(p.pid, signal.SIGHUP)  # Terminal ditutup: SIGHUP ke peluncur, tetapi anak-anaknya di sesi sendiri tidak ikut menerimanya
            self.assertEqual(p.wait(30), 0, '\n'.join(lines))
            for pid in children:
                self.assertTrue(wait_for(lambda: not alive(pid), 10), f'proses {pid} masih hidup: jadi yatim')
        finally:
            if p.poll() is None:
                os.killpg(p.pid, signal.SIGKILL)
            for pid in children:  # bila tes gagal di tengah jalan, jangan meninggalkan yatim
                if alive(pid):
                    os.kill(pid, signal.SIGKILL)


if __name__ == '__main__':
    unittest.main()
