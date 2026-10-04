import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path

import numpy as np

from eeg.config import DEFAULT, SAMPLE_RATE
from eeg.stream import MuseSession, kill_stale, streamer_command
from eeg.supervisor import StreamLost

ROOT = Path(__file__).resolve().parents[2]
FAKE = str(ROOT / 'tools' / 'fake_muse_lsl.py')
FAST = replace(DEFAULT, lsl_wait_s=15.0, stall_s=1.5)


def addr(name):
    return f'T{os.getpid()}{name}'


def make(address, *extra, settings=FAST, **kw):
    return MuseSession([sys.executable, FAKE, '--address', address, *extra], address, settings, log=lambda m: None, **kw)


def power_at(x, f):
    x = np.asarray(x, dtype=float)
    x = x - x.mean()
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1.0 / SAMPLE_RATE)
    return float(spec[int(np.argmin(np.abs(freqs - f)))])


class MuseSessionTest(unittest.TestCase):
    def setUp(self):
        self.sessions = []

    def tearDown(self):
        for s in self.sessions:
            s.close()

    def session(self, name, *extra, **kw):
        s = make(addr(name), *extra, **kw)
        self.sessions.append(s)
        return s

    def test_start_lalu_sampel_eeg_dan_ppg_mengalir(self):
        s = self.session('aliran')
        s.start(threading.Event())
        time.sleep(1.2)
        eeg, ppg = s.pull()
        self.assertEqual(eeg.shape[1], 4, 'hanya TP9, AF7, AF8, TP10')
        self.assertGreater(len(eeg), 150)
        self.assertGreater(len(ppg), 40)
        s.check()

    def test_proses_streamer_berhenti_terdeteksi(self):
        s = self.session('berhenti', '--exit-after', '1.0')
        s.start(threading.Event())
        time.sleep(1.8)
        with self.assertRaises(StreamLost) as cm:
            s.check()
        self.assertIn('berhenti', str(cm.exception))
        self.assertIn('Disconnected', str(cm.exception), 'muselsl asli mencetak sebabnya ke stdout, bukan stderr')

    def test_crash_menyertakan_pesan_error_dari_streamer(self):
        s = self.session('crash', '--crash-after', '0.5')
        s.start(threading.Event())
        time.sleep(1.5)
        with self.assertRaises(StreamLost) as cm:
            s.check()
        self.assertIn('fake muse crashed', str(cm.exception))

    def test_keluaran_streamer_tidak_hilang_saat_mati_mendadak_tanpa_flush(self):
        # crash di lapisan native (Bluetooth) mematikan proses tanpa flush: tanpa PYTHONUNBUFFERED print terakhir hilang di buffer
        code = "import os, sys, time; print('sempat tersambung'); sys.stderr.write('galat bluetooth\\n'); time.sleep(0.3); os._exit(7)"
        s = MuseSession([sys.executable, '-c', code], addr('mendadak'), FAST, log=lambda m: None)
        self.sessions.append(s)
        with self.assertRaises(StreamLost) as cm:
            s.start(threading.Event())
        self.assertIn('kode 7', str(cm.exception))
        self.assertIn('sempat tersambung', str(cm.exception))
        self.assertIn('galat bluetooth', str(cm.exception))

    def test_stall_diam_diam_terdeteksi_walau_proses_hidup(self):
        s = self.session('stall', '--stall-after', '0.8')
        s.start(threading.Event())
        t0 = time.monotonic()
        lost = None
        while time.monotonic() - t0 < 6.0 and lost is None:
            s.pull()
            try:
                s.check()
            except StreamLost as exc:
                lost = exc
            time.sleep(0.1)
        self.assertIsNotNone(lost, 'stall harus terdeteksi')
        self.assertIn('tidak ada sampel', str(lost))
        self.assertIsNone(s._proc.poll(), 'proses masih hidup: ini stall, bukan proses mati')
        self.assertGreater(time.monotonic() - t0, 1.5, 'tidak boleh terlalu cepat menuduh stall')

    def test_gagal_mulai_menyertakan_pesan_streamer(self):
        s = self.session('gagal', '--fail-start')
        t0 = time.monotonic()
        with self.assertRaises(StreamLost) as cm:
            s.start(threading.Event())
        self.assertIn('Failed to connect', str(cm.exception))
        self.assertLess(time.monotonic() - t0, 8.0)

    def test_stream_tidak_muncul_dalam_batas_waktu(self):
        s = self.session('lambat', '--start-delay', '30', settings=replace(FAST, lsl_wait_s=2.0))
        t0 = time.monotonic()
        with self.assertRaises(StreamLost) as cm:
            s.start(threading.Event())
        self.assertIn('tidak muncul', str(cm.exception))
        self.assertLess(time.monotonic() - t0, 8.0)

    def test_stream_tidak_muncul_menyertakan_keluaran_streamer_untuk_diagnosis(self):
        # muselsl asli bisa menghabiskan 2 x 30 detik untuk gagal tersambung, jadi batas 25 detik kita biasanya lebih dulu: sebabnya harus ikut tampil
        cmd = [sys.executable, '-c', "print('[0.0s] Connecting to AA:BB...'); import time; time.sleep(30)"]
        s = MuseSession(cmd, addr('diam'), replace(FAST, lsl_wait_s=2.0), log=lambda m: None)
        self.sessions.append(s)
        with self.assertRaises(StreamLost) as cm:
            s.start(threading.Event())
        self.assertIn('tidak muncul', str(cm.exception))
        self.assertIn('Connecting to AA:BB', str(cm.exception))

    def test_close_menghapus_pidfile_milik_sendiri(self):
        pidfile = Path(tempfile.mkdtemp()) / 'streamer.pid'
        s = self.session('sendiri', pidfile=pidfile)
        s.start(threading.Event())
        self.assertEqual(pidfile.read_text().strip(), str(s._proc.pid))
        s.close()
        self.assertFalse(pidfile.exists())

    def test_close_tidak_menghapus_pidfile_yang_sudah_milik_instance_lain(self):
        pidfile = Path(tempfile.mkdtemp()) / 'streamer.pid'
        s = self.session('terganti', pidfile=pidfile)
        s.start(threading.Event())
        pidfile.write_text('999999')  # instance lain menimpa pidfile dengan streamer-nya
        s.close()
        self.assertEqual(pidfile.read_text(), '999999', 'jejak streamer milik orang lain tidak boleh dihapus')

    def test_dibatalkan_saat_menunggu_stream(self):
        s = self.session('batal', '--start-delay', '30')
        cancel = threading.Event()
        threading.Timer(0.5, cancel.set).start()
        t0 = time.monotonic()
        with self.assertRaises(StreamLost) as cm:
            s.start(cancel)
        self.assertIn('dibatalkan', str(cm.exception))
        self.assertLess(time.monotonic() - t0, 4.0)

    def test_close_mematikan_proses_dan_idempoten(self):
        s = self.session('tutup')
        s.start(threading.Event())
        proc = s._proc
        self.assertIsNone(proc.poll())
        s.close()
        self.assertIsNotNone(proc.poll(), 'proses harus mati')
        s.close()

    def test_hanya_memakai_stream_dengan_alamat_sendiri(self):
        other = subprocess.Popen([sys.executable, FAKE, '--address', addr('lain'), '--profile', 'tense'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            s = self.session('milikku', '--profile', 'relaxed')
            s.start(threading.Event())
            time.sleep(2.2)
            eeg, _ = s.pull()
            self.assertGreater(len(eeg), 400)
            x = eeg[-512:, 0]
            self.assertGreater(power_at(x, 10), 5 * power_at(x, 20), 'harus data relaxed (alpha), bukan tense (beta) dari headset lain')
        finally:
            other.terminate()
            other.wait(3)


class KillStaleTest(unittest.TestCase):
    def test_membunuh_streamer_yatim_berdasarkan_pidfile(self):
        proc = subprocess.Popen([sys.executable, FAKE, '--address', addr('yatim')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        pidfile = Path(tempfile.mkdtemp()) / 'streamer.pid'
        pidfile.write_text(str(proc.pid))
        try:
            time.sleep(0.8)
            self.assertTrue(kill_stale(pidfile, marker='fake_muse_lsl', log=lambda m: None))
            proc.wait(5)
            self.assertFalse(pidfile.exists())
        finally:
            if proc.poll() is None:
                proc.kill()

    def test_tidak_membunuh_proses_lain_yang_memakai_pid_sama(self):
        other = subprocess.Popen(['sleep', '30'], start_new_session=True)
        pidfile = Path(tempfile.mkdtemp()) / 'streamer.pid'
        pidfile.write_text(str(other.pid))
        try:
            self.assertFalse(kill_stale(pidfile, marker='fake_muse_lsl', log=lambda m: None))
            self.assertIsNone(other.poll(), 'proses lain tidak boleh disentuh')
        finally:
            other.kill()
            other.wait(3)

    def test_pidfile_tidak_ada_atau_rusak(self):
        d = Path(tempfile.mkdtemp())
        self.assertFalse(kill_stale(d / 'tidak-ada.pid', log=lambda m: None))
        (d / 'rusak.pid').write_text('bukan angka')
        self.assertFalse(kill_stale(d / 'rusak.pid', log=lambda m: None))


class CommandTest(unittest.TestCase):
    def test_perintah_streamer_menjalankan_berkas_muse_streamer_dengan_alamat(self):
        cmd = streamer_command('AA:BB', python='/x/python')
        self.assertEqual(cmd[0], '/x/python')
        self.assertTrue(Path(cmd[1]).is_file(), cmd[1])
        self.assertEqual(Path(cmd[1]).name, 'muse_streamer.py', 'berkas dijalankan langsung: --python tidak perlu memasang paket eeg')
        self.assertEqual(cmd[2:], ['AA:BB'])

    def test_perintah_streamer_memakai_interpreter_ini_bila_tidak_ditentukan(self):
        self.assertEqual(streamer_command('AA:BB')[0], sys.executable)


if __name__ == '__main__':
    unittest.main()
