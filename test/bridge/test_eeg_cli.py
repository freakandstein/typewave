import asyncio
import contextlib
import io
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from argparse import Namespace
from dataclasses import replace
from pathlib import Path
from unittest import mock

import aiohttp

from eeg import __main__ as cli
from eeg.config import DEFAULT
from eeg.stream import streamer_command
from test.bridge.test_eeg_bridge_link import free_port, start_bridge

ROOT = Path(__file__).resolve().parents[2]


def run_main(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            rc = cli.main(list(argv))
        except SystemExit as exc:
            rc = exc.code
    return rc, out.getvalue(), err.getvalue()


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class ArgumentsTest(unittest.TestCase):
    def test_help_lewat_python_m_eeg_menyebut_semua_opsi(self):
        r = subprocess.run([sys.executable, '-m', 'eeg', '--help'], capture_output=True, text=True, cwd=ROOT, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        for flag in ('--bridge', '--address', '--name', '--python', '--fake', '--fake-degrade', '--warmup', '--scan', '--state-dir'):
            self.assertIn(flag, r.stdout)

    def test_profil_fake_tidak_dikenal_ditolak(self):
        rc, _, err = run_main('--fake', 'bogus')
        self.assertEqual(rc, 2)
        self.assertIn('invalid choice', err)

    def test_degrade_yang_salah_ditolak_dengan_pesan_jelas_dan_hanya_berlaku_bersama_fake(self):
        state = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, state, ignore_errors=True)
        with mock.patch.object(cli.asyncio, 'run', side_effect=lambda coro: coro.close()):
            rc, _, err = run_main('--fake', '--fake-degrade', 'AF7:bogus@1', '--state-dir', state)
            self.assertEqual(rc, 2)
            self.assertIn('degrade tidak valid', err)
            rc, _, err = run_main('--fake-degrade', 'AF7:flat@1', '--state-dir', state)
            self.assertEqual(rc, 2)
            self.assertIn('--fake', err)
            rc, _, err = run_main('--fake', '--fake-degrade', 'AF7:flat@1-5', '--fake-degrade', 'TP9:noisy@2', '--state-dir', state)
            self.assertEqual(rc, 0, err)

    def test_muselsl_belum_terpasang_memberi_petunjuk_pemasangan(self):
        with mock.patch.dict(sys.modules, {'muselsl': None}):
            rc, _, err = run_main('--address', 'AA:BB')
        self.assertEqual(rc, 2)
        self.assertIn('pip install -r eeg/requirements.txt', err)

    def test_mode_fake_tidak_butuh_muselsl(self):
        state = tempfile.mkdtemp()  # bukan eeg/ yang nyata: tes tidak boleh meninggalkan kunci di folder status pemakai
        self.addCleanup(shutil.rmtree, state, ignore_errors=True)
        with mock.patch.dict(sys.modules, {'muselsl': None}), mock.patch.object(cli.asyncio, 'run', side_effect=lambda coro: coro.close()):
            rc, _, err = run_main('--fake', '--state-dir', state)
        self.assertEqual(rc, 0, err)

    def test_scan_menampilkan_nama_dan_alamat_headset(self):
        with mock.patch('eeg.scan.scan_muse_devices', return_value=[('Muse-1A2B', 'AA:BB:CC'), ('Muse-9Z', 'DD:EE')]):
            rc, out, _ = run_main('--scan')
        self.assertEqual(rc, 0)
        self.assertEqual(out.splitlines(), ['Muse-1A2B\tAA:BB:CC', 'Muse-9Z\tDD:EE'])

    def test_scan_tanpa_headset_keluar_1_dengan_petunjuk(self):
        with mock.patch('eeg.scan.scan_muse_devices', return_value=[]):
            rc, out, err = run_main('--scan')
        self.assertEqual(rc, 1)
        self.assertEqual(out, '')
        self.assertIn('tidak ada headset Muse', err)

    def test_scan_gagal_menyebut_penyebab_dan_izin_bluetooth(self):
        with mock.patch('eeg.scan.scan_muse_devices', side_effect=RuntimeError('BLE mati')):
            rc, _, err = run_main('--scan')
        self.assertEqual(rc, 1)
        self.assertIn('BLE mati', err)
        self.assertIn('izin Bluetooth', err)


class LslLogTest(unittest.TestCase):
    """liblsl mencetak banner INFO dan "ERR Stream transmission broke off" ke terminal; sambung ulang sebenarnya dicatat pengawas kita."""

    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.cwd = Path(tempfile.mkdtemp())
        for d in (self.home, self.cwd):
            self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        env = patcher = mock.patch.dict(os.environ, {k: v for k, v in os.environ.items() if k != 'LSLAPICFG'}, clear=True)
        env.start()
        self.addCleanup(patcher.stop)
        for name, value in (('home', self.home), ('cwd', self.cwd)):
            q = mock.patch.object(cli.Path, name, return_value=value)
            q.start()
            self.addCleanup(q.stop)

    @unittest.skipIf(Path('/etc/lsl_api/lsl_api.cfg').exists(), 'mesin ini punya konfigurasi LSL tingkat sistem')
    def test_senyap_bila_pengguna_tidak_punya_konfigurasi_lsl(self):
        cli.quiet_lsl()
        cfg = Path(os.environ['LSLAPICFG'])
        self.assertTrue(cfg.is_file())
        self.assertIn('level = -3', cfg.read_text())

    def test_tidak_menimpa_LSLAPICFG_milik_pengguna(self):
        os.environ['LSLAPICFG'] = '/punya/saya.cfg'
        cli.quiet_lsl()
        self.assertEqual(os.environ['LSLAPICFG'], '/punya/saya.cfg')

    def test_tidak_menimpa_lsl_api_cfg_di_home(self):
        (self.home / 'lsl_api').mkdir()
        (self.home / 'lsl_api' / 'lsl_api.cfg').write_text('[multicast]\nResolveScope = link\n')
        cli.quiet_lsl()
        self.assertIsNone(os.environ.get('LSLAPICFG'), 'pengaturan jaringan LSL milik pengguna tidak boleh tertimpa')  # bukan assertNotIn: gagalnya mencetak seluruh environment

    def test_tidak_menimpa_lsl_api_cfg_di_folder_kerja(self):
        (self.cwd / 'lsl_api.cfg').write_text('[multicast]\nResolveScope = link\n')
        cli.quiet_lsl()
        self.assertIsNone(os.environ.get('LSLAPICFG'))


class FactoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def args(self, **kw):
        base = dict(fake=None, fake_degrade=None, address=None, name=None, python=None, state_dir=self.tmp, warmup=15.0, bridge='ws://x/ws', scan=False)
        base.update(kw)
        return Namespace(**base)

    def book_class(self, calls, inits):
        class Book:
            def __init__(self, address, name, cache_path, scan=None, log=print):
                inits.append((address, name, cache_path))

            def resolve(self, force_scan=False):
                calls.append(force_scan)
                return 'AA:BB'

        return Book

    def test_mode_fake_memakai_streamer_palsu_dengan_alamat_profil_dan_penanda_sendiri(self):
        s = cli.make_factory(self.args(fake='relaxed'), DEFAULT, lambda m: None)(0, None)
        self.assertEqual(s.address, 'FAKE-MUSE')
        self.assertEqual(s.source_id, 'MuseFAKE-MUSE')
        self.assertIn('fake_muse_lsl.py', ' '.join(s.command))
        self.assertEqual(s.command[s.command.index('--profile') + 1], 'relaxed')
        self.assertEqual(s.marker, 'fake_muse_lsl')
        self.assertEqual(s.pidfile, self.tmp / '.streamer.pid')

    def test_mode_fake_meneruskan_degrade_ke_streamer_palsu_dan_tanpa_degrade_tidak_menambah_apa_pun(self):
        cmd = cli.make_factory(self.args(fake='relaxed', fake_degrade=['AF7:flat@5-9', 'TP9:noisy@2']), DEFAULT, lambda m: None)(0, None).command
        pairs = [(cmd[i], cmd[i + 1]) for i in range(len(cmd) - 1) if cmd[i] == '--degrade']
        self.assertEqual(pairs, [('--degrade', 'AF7:flat@5-9'), ('--degrade', 'TP9:noisy@2')])
        self.assertNotIn('--degrade', cli.make_factory(self.args(fake='relaxed'), DEFAULT, lambda m: None)(0, None).command)

    def test_headset_asli_alamat_dari_buku_alamat_dan_perintah_muselsl(self):
        calls, inits = [], []
        with mock.patch('eeg.scan.DeviceBook', self.book_class(calls, inits)):
            factory = cli.make_factory(self.args(name='Muse-1A2B', python='/x/py'), DEFAULT, lambda m: None)
            s = factory(0, None)
        self.assertEqual(inits, [(None, 'Muse-1A2B', self.tmp / '.device.json')])
        self.assertEqual(s.address, 'AA:BB')
        self.assertEqual(s.command, streamer_command('AA:BB', '/x/py'))
        self.assertEqual(s.marker, 'muse_streamer', 'penanda untuk membersihkan streamer yatim: ada di perintah streamer asli, tidak di streamer palsu')
        self.assertEqual(s.pidfile, self.tmp / '.streamer.pid')

    def test_alamat_eksplisit_diteruskan_ke_buku_alamat(self):
        calls, inits = [], []
        with mock.patch('eeg.scan.DeviceBook', self.book_class(calls, inits)):
            cli.make_factory(self.args(address='11:22'), DEFAULT, lambda m: None)
        self.assertEqual(inits[0][0], '11:22')

    def test_pindai_ulang_tiap_tiga_kegagalan_beruntun_bukan_di_percobaan_pertama(self):
        calls, inits = [], []
        with mock.patch('eeg.scan.DeviceBook', self.book_class(calls, inits)):
            factory = cli.make_factory(self.args(), DEFAULT, lambda m: None)
            for failures in range(8):
                factory(failures, 'x')
        self.assertEqual(calls, [False, False, False, True, False, False, True, False])
        self.assertEqual(len(inits), 1, 'satu buku alamat (cache) untuk semua percobaan')

    def test_jumlah_kegagalan_untuk_pindai_ulang_mengikuti_pengaturan(self):
        calls, inits = [], []
        with mock.patch('eeg.scan.DeviceBook', self.book_class(calls, inits)):
            factory = cli.make_factory(self.args(), replace(DEFAULT, rescan_every=2), lambda m: None)
            for failures in range(5):
                factory(failures, 'x')
        self.assertEqual(calls, [False, False, True, False, True])


class CliEndToEndTest(unittest.IsolatedAsyncioTestCase):
    """Proses `python -m eeg` sungguhan terhadap bridge sungguhan."""

    async def asyncSetUp(self):
        self.port = free_port()
        self.url = f'ws://127.0.0.1:{self.port}/ws'
        self.bridge = await start_bridge(self.port)
        self.http = aiohttp.ClientSession()
        self.rx = await self.http.ws_connect(self.url)
        self.msgs = []  # (waktu, pesan mind) yang diterima klien lain dari bridge
        self.rx_task = asyncio.create_task(self._collect())
        self.state = Path(tempfile.mkdtemp())
        self.proc = None
        self.lines = []

    async def asyncTearDown(self):
        pid = self.streamer_pid()
        if self.proc is not None and self.proc.poll() is None:
            with contextlib.suppress(OSError):
                os.killpg(self.proc.pid, signal.SIGKILL)
            self.proc.wait(5)
        if pid and alive(pid):
            with contextlib.suppress(OSError):
                os.kill(pid, signal.SIGKILL)
        self.rx_task.cancel()
        await asyncio.gather(self.rx_task, return_exceptions=True)
        await self.rx.close()
        await self.http.close()
        await self.bridge.cleanup()
        shutil.rmtree(self.state, ignore_errors=True)

    async def _collect(self):
        async for m in self.rx:
            if m.type == aiohttp.WSMsgType.TEXT:
                d = json.loads(m.data)
                if d.get('t') == 'mind':
                    self.msgs.append((time.monotonic(), d))

    def _pump(self, proc):
        try:
            for line in proc.stdout:
                self.lines.append(line.rstrip())
        finally:
            proc.stdout.close()

    def spawn(self, *args):
        self.started = time.monotonic()
        self.proc = subprocess.Popen([sys.executable, '-m', 'eeg', '--bridge', self.url, '--state-dir', str(self.state), *args], cwd=ROOT,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=self.clean_env(), start_new_session=True)
        threading.Thread(target=self._pump, args=(self.proc,), daemon=True).start()

    def clean_env(self):
        # HOME sementara dan tanpa LSLAPICFG: hasil tidak bergantung pada konfigurasi LSL milik pemakai mesin ini
        return {**{k: v for k, v in os.environ.items() if k != 'LSLAPICFG'}, 'PYTHONUNBUFFERED': '1', 'HOME': str(self.state)}

    def output(self):
        return '\n'.join(self.lines)

    def streamer_pid(self):
        try:
            return int((self.state / '.streamer.pid').read_text().strip())
        except (OSError, ValueError):
            return None

    async def until(self, cond, timeout):
        t = time.monotonic()
        while time.monotonic() - t < timeout:
            if cond():
                return True
            await asyncio.sleep(0.05)
        return False

    async def wait_exit(self, timeout):
        t = time.monotonic()
        while time.monotonic() - t < timeout:
            rc = self.proc.poll()
            if rc is not None:
                return rc
            await asyncio.sleep(0.05)
        return None

    async def flows_then_stops_on(self, sig):
        self.spawn('--fake', 'relaxed', '--warmup', '1.0')
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 5, 25), self.output())
        self.assertLess(self.msgs[0][0] - self.started, 14.0, '--warmup 1 harus diterapkan (bawaan 15 detik)')
        m = self.msgs[-1][1]
        for k in ('pos', 'theta', 'alpha', 'beta', 'q'):
            self.assertTrue(0.0 <= m[k] <= 1.0, (k, m[k]))
        pid = self.streamer_pid()
        self.assertIsNotNone(pid, 'pidfile streamer ditulis di --state-dir')
        os.kill(self.proc.pid, sig)
        rc = await self.wait_exit(15)
        self.assertEqual(rc, 0, self.output())
        self.assertFalse(alive(pid), 'streamer tidak boleh jadi yatim')
        self.assertFalse((self.state / '.streamer.pid').exists())
        self.assertIn('berhenti', self.lines, 'baris penutup "berhenti" tercetak')

    async def test_fake_mengalir_ke_bridge_dan_sigint_menghentikan_bersih(self):
        await self.flows_then_stops_on(signal.SIGINT)

    async def test_sigterm_menghentikan_bersih_tanpa_streamer_yatim(self):
        await self.flows_then_stops_on(signal.SIGTERM)

    async def test_sighup_saat_jendela_terminal_ditutup_menghentikan_bersih_tanpa_streamer_yatim(self):
        await self.flows_then_stops_on(signal.SIGHUP)

    async def test_instance_kedua_dengan_state_dir_sama_ditolak_tanpa_mengganggu_yang_pertama(self):
        self.spawn('--fake', 'relaxed', '--warmup', '1.0')
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 5, 25), self.output())
        pid = self.streamer_pid()
        second = await asyncio.to_thread(subprocess.run, [sys.executable, '-m', 'eeg', '--fake', 'relaxed', '--bridge', self.url, '--state-dir', str(self.state)],
                                         cwd=ROOT, capture_output=True, text=True, timeout=30, env=self.clean_env())
        self.assertEqual(second.returncode, 3, second.stderr)
        self.assertIn('sudah berjalan', second.stderr)
        n = len(self.msgs)
        self.assertTrue(await self.until(lambda: len(self.msgs) >= n + 5, 15), 'instance pertama tetap mengalir')
        self.assertEqual(self.streamer_pid(), pid, 'streamer milik instance pertama tidak boleh dibunuh oleh yang kedua')
        self.assertIsNone(self.proc.poll())
        os.kill(self.proc.pid, signal.SIGINT)
        self.assertEqual(await self.wait_exit(15), 0, self.output())

    async def test_kunci_dilepas_walau_instance_mati_keras_dan_streamer_yatimnya_dibersihkan(self):
        self.spawn('--fake', 'relaxed', '--warmup', '1.0')
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 3, 25), self.output())
        orphan = self.streamer_pid()
        os.kill(self.proc.pid, signal.SIGKILL)  # mati keras: tanpa pembersihan; kunci dilepas kernel, streamer-nya tertinggal
        self.proc.wait(5)
        self.assertTrue(alive(orphan), 'streamer palsu tidak punya pengawas induk, jadi tertinggal')
        n = len(self.msgs)
        self.spawn('--fake', 'relaxed', '--warmup', '1.0')  # instance baru dengan state-dir yang sama
        self.assertTrue(await self.until(lambda: len(self.msgs) >= n + 5, 30), self.output())
        self.assertIn('streamer yatim', self.output())
        self.assertFalse(alive(orphan), 'streamer yatim dari instance yang mati keras dimatikan saat start berikutnya')
        os.kill(self.proc.pid, signal.SIGINT)
        self.assertEqual(await self.wait_exit(15), 0, self.output())

    async def test_streamer_dibunuh_dari_luar_cli_menyambung_ulang_sendiri(self):
        self.spawn('--fake', 'relaxed', '--warmup', '1.0')
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 5, 25), self.output())
        pid1 = self.streamer_pid()
        os.kill(pid1, signal.SIGKILL)  # proses BLE mati mendadak seperti headset terlepas
        n = len(self.msgs)
        self.assertTrue(await self.until(lambda: 'koneksi headset putus' in self.output(), 10), self.output())
        self.assertTrue(await self.until(lambda: self.output().count('headset tersambung') >= 2, 30), self.output())
        pid2 = self.streamer_pid()
        self.assertNotEqual(pid1, pid2, 'streamer baru, bukan yang lama')
        self.assertTrue(await self.until(lambda: len(self.msgs) >= n + 8, 20), 'mind mengalir lagi setelah sambung ulang\n' + self.output())
        gap = max(b[0] - a[0] for a, b in zip(self.msgs, self.msgs[1:]))
        self.assertGreater(gap, 3.0, 'selama putus tidak ada data basi yang dikirim')
        os.kill(self.proc.pid, signal.SIGINT)
        self.assertEqual(await self.wait_exit(15), 0, self.output())
        self.assertFalse(alive(pid2), 'streamer hasil sambung ulang juga dimatikan')
        for noise in ('INFO|', 'ERR|', 'data_receiver.cpp'):
            self.assertNotIn(noise, self.output(), 'log native liblsl harus senyap; yang tercatat hanya log pengawas')

    async def test_headset_asli_diemulasikan_muselsl_asli_mengalir_lalu_pulih_saat_streamer_dibunuh(self):
        # python -m eeg --address ... --python <shim>: eeg/muse_streamer.py -> muselsl ASLI -> klien BLE palsu bergaya CoreBluetooth -> LSL -> DSP -> bridge
        shim = self.state / 'python-ble-emulator.sh'
        shim.write_text(f'#!/bin/sh\nexec {sys.executable} {ROOT / "test" / "bridge" / "fake_ble.py"} "$2"\n')  # $1 = muse_streamer.py, $2 = alamat
        shim.chmod(0o755)
        self.spawn('--address', 'EMU:BLE:01', '--python', str(shim), '--warmup', '1.0')
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 5 and any('hr' in m for _, m in self.msgs), 40), self.output())
        m = self.msgs[-1][1]
        for k in ('pos', 'theta', 'alpha', 'beta', 'q'):
            self.assertTrue(0.0 <= m[k] <= 1.0, (k, m[k]))
        self.assertGreater(m['q'], 0.9)
        self.assertTrue(all(60 <= x['hr'] <= 85 for _, x in self.msgs if 'hr' in x), [x.get('hr') for _, x in self.msgs])
        pid1 = self.streamer_pid()
        os.kill(pid1, signal.SIGKILL)
        n = len(self.msgs)
        self.assertTrue(await self.until(lambda: self.output().count('headset tersambung') >= 2, 40), self.output())
        self.assertTrue(await self.until(lambda: len(self.msgs) >= n + 8, 30), self.output())
        self.assertNotEqual(pid1, self.streamer_pid())
        os.kill(self.proc.pid, signal.SIGINT)
        self.assertEqual(await self.wait_exit(15), 0, self.output())

    async def test_headset_asli_gagal_mulai_dicoba_lagi_tanpa_batas_dan_ctrl_c_langsung_berhenti(self):
        stub = self.state / 'python-stub.sh'  # pengganti interpreter streamer: langsung gagal seperti headset yang tidak ketemu
        stub.write_text('#!/bin/sh\necho "stub: gagal tersambung ke Muse" >&2\nexit 3\n')
        stub.chmod(0o755)
        self.spawn('--address', 'AA:BB:CC:DD:EE:FF', '--python', str(stub))
        self.assertTrue(await self.until(lambda: 'percobaan 2' in self.output(), 20), self.output())
        out = self.output()
        self.assertIn('stub: gagal tersambung ke Muse', out, 'pesan error dari streamer ditampilkan')
        self.assertIn('kode 3', out)
        self.assertIn('mencoba lagi dalam 3 detik', out)
        self.assertIn('mencoba lagi dalam 5 detik', out)
        t0 = time.monotonic()
        os.kill(self.proc.pid, signal.SIGINT)  # sedang menunggu jeda 10 detik: pembatalan harus seketika
        self.assertEqual(await self.wait_exit(8), 0, self.output())
        self.assertLess(time.monotonic() - t0, 6.0)


if __name__ == '__main__':
    unittest.main()
