"""muselsl ASLI di bawah klien BLE palsu bergaya CoreBluetooth (test/bridge/fake_ble.py).

Tes dengan streamer LSL palsu tidak bisa menangkap perilaku muselsl sendiri. Dua kelakuan muselsl 2.5.0 yang dibuktikan di sini
(dan dikerjakan oleh eeg/muse_streamer.py): langganan kanal kontrol ganda yang ditolak CoreBluetooth, dan watchdog 3 detiknya yang
tertipu jam PPG nominal saat paket PPG hilang.
"""
import os
import signal
import subprocess
import sys
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path

import numpy as np

from eeg import dsp
from eeg.config import DEFAULT, SAMPLE_RATE
from eeg.stream import MuseSession
from eeg.supervisor import StreamLost

ROOT = Path(__file__).resolve().parents[2]
HARNESS = str(ROOT / 'test' / 'bridge' / 'fake_ble.py')
FAST = replace(DEFAULT, lsl_wait_s=20.0, stall_s=2.5)


def addr(name):
    return f'B{os.getpid()}{name}'


def run_harness(*args, limit):
    """Jalankan harness sampai keluar atau batas waktu. Mengembalikan (kode keluar atau None bila masih hidup, keluaran, durasi)."""
    t0 = time.monotonic()
    p = subprocess.Popen([sys.executable, HARNESS, *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         env={**os.environ, 'PYTHONUNBUFFERED': '1'}, start_new_session=True)
    try:
        out, _ = p.communicate(timeout=limit)
        return p.returncode, out, time.monotonic() - t0
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, _ = p.communicate()
        return None, out, time.monotonic() - t0


def power_at(x, f):
    x = np.asarray(x, dtype=float)
    x = x - x.mean()
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1.0 / SAMPLE_RATE)
    return float(spec[int(np.argmin(np.abs(freqs - f)))])


class MuselslAsliTest(unittest.TestCase):
    """Karakterisasi muselsl 2.5.0 apa adanya. Gagal setelah muselsl diganti versi berarti penyesuaian di eeg/muse_streamer.py perlu ditinjau."""

    def test_polos_mati_di_corebluetooth_karena_langganan_kontrol_ganda(self):
        rc, out, took = run_harness(addr('polos'), '--plain', limit=40)
        self.assertEqual(rc, 1, out)
        self.assertIn('Characteristic notifications already started', out)
        self.assertLess(took, 20.0)

    def test_polos_bisa_mengalir_bila_langganan_ganda_diterima(self):
        rc, out, _ = run_harness(addr('longgar'), '--plain', '--lenient', limit=8)
        self.assertIsNone(rc, 'tanpa penolakan CoreBluetooth muselsl mengalir terus: ' + out)
        self.assertIn('Streaming EEG PPG', out)

    def test_polos_keluar_sendiri_saat_ppg_kehilangan_paket_padahal_eeg_sehat(self):
        rc, out, took = run_harness(addr('ppg'), '--plain', '--lenient', '--ppg-loss', '0.5', limit=45)
        self.assertEqual(rc, 0, out)
        self.assertIn('Disconnected.', out)
        self.assertLess(took, 40.0)


class StreamerTypeWaveTest(unittest.TestCase):
    def setUp(self):
        self.sessions = []

    def tearDown(self):
        for s in self.sessions:
            s.close()

    def session(self, name, *flags):
        a = addr(name)
        s = MuseSession([sys.executable, HARNESS, a, *flags], a, FAST, log=lambda m: None)
        self.sessions.append(s)
        return s

    def collect(self, s, seconds):
        eeg, ppg = [], []
        t0 = time.monotonic()
        while time.monotonic() - t0 < seconds:
            s.check()
            e, p = s.pull()
            eeg.append(e)
            ppg.append(p)
            time.sleep(0.1)
        return np.vstack(eeg), np.concatenate(ppg)

    def test_selamat_dari_langganan_ganda_dan_data_muselsl_asli_sampai_ke_typewave(self):
        s = self.session('rantai', '--ppg-loss', '0')
        s.start(threading.Event())
        eeg, ppg = self.collect(s, 6.0)
        self.assertEqual(eeg.shape[1], 4, 'TP9, AF7, AF8, TP10 (kanal AUX dibuang)')
        self.assertGreater(len(eeg), SAMPLE_RATE * 6 * 0.7, 'sekitar 256 sampel per detik')
        x = eeg[-512:, 1]
        self.assertGreater(power_at(x, 10), 20 * power_at(x, 20), 'irama 10 Hz yang dipancarkan emulator harus terbaca di 10 Hz')
        self.assertTrue(10.0 < float(np.std(eeg[:, 0])) < 20.0, 'skala mikrovolt: 20 uV pada 10 Hz + 8 uV pada 6 Hz = sekitar 15 uV rms')
        self.assertGreater(len(ppg), 64 * 6 * 0.7)
        self.assertTrue(19000 < float(np.mean(ppg)) < 21000, 'kolom PPG yang diambil adalah inframerah (kanal ke-2), bukan ambient atau merah')
        hr = dsp.heart_rate(ppg)
        self.assertIsNotNone(hr)
        self.assertAlmostEqual(hr, 72, delta=4)

    def test_hanya_penolakan_langganan_ganda_yang_diabaikan_kesalahan_lain_tetap_gagal(self):
        rc, out, took = run_harness(addr('lain'), '--subscribe-error', 'boom: bukan langganan ganda', limit=40)
        self.assertEqual(rc, 1, out)
        self.assertIn('boom: bukan langganan ganda', out, 'kegagalan yang sebenarnya harus sampai ke log (dan ke pesan putus), bukan ditelan')
        self.assertLess(took, 30.0)

    def test_streamer_keluar_sendiri_saat_proses_induknya_mati_keras(self):
        # eeg di-SIGKILL (mis. peluncur kehabisan batas): streamer tidak boleh jadi yatim yang menahan koneksi BLE dan terus memancar
        a = addr('yatim')
        code = ("import subprocess, sys, time\n"
                f"p = subprocess.Popen([sys.executable, {HARNESS!r}, {a!r}, '--ppg-loss', '0'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
                "print(p.pid, flush=True)\ntime.sleep(120)\n")
        parent = subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE, text=True, start_new_session=True)

        def alive(pid):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return False
            return True

        child = int(parent.stdout.readline())
        try:
            time.sleep(3.0)
            self.assertTrue(alive(child), 'streamer hidup selama induknya hidup')
            os.kill(parent.pid, signal.SIGKILL)
            parent.wait(5)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and alive(child):
                time.sleep(0.1)
            self.assertFalse(alive(child), 'streamer harus keluar sendiri setelah induknya mati')
        finally:
            if alive(child):
                os.kill(child, signal.SIGKILL)
            if parent.poll() is None:
                parent.kill()
            parent.wait(5)
            parent.stdout.close()

    def test_tidak_keluar_sendiri_saat_ppg_kehilangan_paket_dan_eeg_terus_mengalir(self):
        s = self.session('hilang', '--ppg-loss', '0.5')
        s.start(threading.Event())
        try:
            eeg, _ = self.collect(s, 16.0)  # muselsl polos keluar sendiri sekitar detik ke-9 pada kondisi yang sama
        except StreamLost as exc:
            self.fail(f'streamer tidak boleh berhenti sendiri selama EEG sehat: {exc}')
        self.assertGreater(len(eeg), SAMPLE_RATE * 16 * 0.7)
        self.assertIsNone(s._proc.poll())


if __name__ == '__main__':
    unittest.main()
