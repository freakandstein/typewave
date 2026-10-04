import unittest

import numpy as np

from eeg import dsp
from eeg.config import PPG_SR, SAMPLE_RATE

SR = SAMPLE_RATE
N = SR * 2  # jendela 2 detik, sama seperti pemrosesan asli


def sine(f, amp, n=N, phase=0.0):
    t = np.arange(n) / SR
    return amp * np.sin(2 * np.pi * f * t + phase)


def noise(seed, rms=3.0, n=N):
    """Latar mirip EEG: spektrum 1/f^1,5 (noise putih membuat rasio beta tinggi/rendah terbaca sebagai otot)."""
    rng = np.random.default_rng(seed)
    spec = np.fft.rfft(rng.normal(0.0, 1.0, n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    f[0] = 1.0
    x = np.fft.irfft(spec / f ** 0.75, n)
    return x / np.std(x) * rms


def window(fn):
    """Jendela 4 kanal (TP9, AF7, AF8, TP10); fn(ch) mengembalikan sinyal satu kanal."""
    return np.vstack([fn(ch) for ch in range(4)]).astype(float)


class ChannelQualityTest(unittest.TestCase):
    def test_ambang_std(self):
        win = np.vstack([np.zeros(N), sine(10, 7.07), sine(10, 28.3), sine(10, 500)])  # std 0, 5, 20, 354
        q = dsp.channel_quality(win)
        self.assertEqual(q[0], 0.0, 'datar: tidak ada sinyal')
        self.assertAlmostEqual(q[1], 0.375, delta=0.01)  # std 5 -> 5/8*0.6
        self.assertEqual(q[2], 1.0)
        self.assertEqual(q[3], 0.25, 'sangat berisik tapi masih ada sinyal (std > 300)')
        self.assertEqual(dsp.channel_quality(np.vstack([sine(10, 700)] * 4)), [0.0] * 4, 'std > 400')
        self.assertEqual(dsp.channel_quality(np.vstack([sine(10, 2.83)] * 4)), [0.0] * 4, 'std 2 (< 3) = hampir datar')


class BandPowersTest(unittest.TestCase):
    def powers(self, f, amp=20.0):
        win = window(lambda ch: sine(f, amp, phase=ch) + noise(ch))
        q = dsp.channel_quality(win)
        return dsp.band_powers(win, q)

    def test_alpha_10hz_mendominasi(self):
        b = self.powers(10)
        self.assertEqual(len(b.alpha), 4)
        self.assertGreater(np.mean(b.alpha), 20 * np.mean(b.beta))
        self.assertGreater(np.mean(b.alpha), 5 * np.mean(b.theta), 'kebocoran jendela ke tepi theta sekitar 14%')
        self.assertEqual((len(b.f_alpha), len(b.f_theta), len(b.f_beta)), (2, 2, 2), 'hanya AF7 dan AF8')
        self.assertFalse(b.frontal_emg)

    def test_theta_6hz_dan_beta_20hz(self):
        t = self.powers(6)
        self.assertGreater(np.mean(t.theta), 10 * np.mean(t.alpha))
        self.assertGreater(np.mean(t.theta), 10 * np.mean(t.beta))
        b = self.powers(20)
        self.assertGreater(np.mean(b.beta), 10 * np.mean(b.alpha))
        self.assertGreater(np.mean(b.beta), 10 * np.mean(b.theta))
        self.assertFalse(t.frontal_emg or b.frontal_emg)

    def test_kanal_buruk_dikecualikan(self):
        win = window(lambda ch: np.zeros(N) if ch == 0 else sine(10, 20) + noise(ch))
        b = dsp.band_powers(win, dsp.channel_quality(win))
        self.assertEqual((len(b.alpha), len(b.theta), len(b.beta)), (3, 3, 3))
        self.assertEqual(b.quality[0], 0.0)

    def test_kanal_marjinal_di_bawah_065_dikecualikan(self):
        win = window(lambda ch: (sine(10, 8.5) if ch == 0 else sine(10, 20)) + noise(ch, 0.3))  # TP9: std ~6 -> kualitas ~0,45
        q = dsp.channel_quality(win)
        self.assertTrue(0.25 < q[0] < 0.65, q)
        self.assertEqual(len(dsp.band_powers(win, q).alpha), 3)

    def test_semua_kanal_buruk_menghasilkan_daftar_kosong(self):
        win = window(lambda ch: np.zeros(N))
        b = dsp.band_powers(win, dsp.channel_quality(win))
        self.assertEqual((b.alpha, b.beta, b.theta, b.f_alpha), ([], [], [], []))

    def test_emg_frontal_membuang_beta_tapi_alpha_theta_tetap(self):
        def fn(ch):
            base = sine(10, 20) + noise(ch)
            return base + (sine(35, 120) if ch == 1 else 0.0)  # AF7: otot (beta tinggi, puncak ke puncak > 150)
        win = window(fn)
        b = dsp.band_powers(win, dsp.channel_quality(win))
        self.assertTrue(b.frontal_emg)
        self.assertEqual(b.beta, [], 'beta tidak dipercaya saat ada EMG frontal')
        self.assertEqual(len(b.alpha), 4)
        self.assertEqual((b.f_alpha, b.f_beta, b.f_theta), ([], [], []))

    def test_emg_frontal_terdeteksi_dari_amplitudo_saja_atau_rasio_saja(self):
        def make(extra):
            return window(lambda ch: sine(10, 14) + noise(ch) + (extra if ch == 1 else 0.0))
        slow = make(sine(3, 90))  # artefak lambat: puncak ke puncak > 150, rasio beta tinggi/rendah kecil
        self.assertTrue(dsp.band_powers(slow, dsp.channel_quality(slow)).frontal_emg)
        ratio = make(sine(35, 20))  # puncak ke puncak kecil, tetapi energi 25-40 Hz tinggi
        self.assertTrue(dsp.band_powers(ratio, dsp.channel_quality(ratio)).frontal_emg)
        clean = make(0.0)
        self.assertFalse(dsp.band_powers(clean, dsp.channel_quality(clean)).frontal_emg)

    def test_listrik_pln_50hz_di_frontal_dilewati(self):
        def fn(ch):
            base = sine(10, 14) + noise(ch)
            return base + (sine(50, 60) if ch == 1 else 0.0)
        win = window(fn)
        b = dsp.band_powers(win, dsp.channel_quality(win))
        self.assertEqual(len(b.alpha), 3, 'AF7 yang terkontaminasi 50 Hz dilewati')
        self.assertEqual(len(b.f_alpha), 1)

    def test_artefak_lambat_di_atas_300_uv_dibuang(self):
        def fn(ch):
            x = sine(10, 14) + noise(ch)
            if ch == 3:
                x[200:226] += 400.0  # gerakan/kedip ~0,1 detik: lolos filter 0,5-40 Hz dengan puncak ke puncak > 300
            return x
        win = window(fn)
        q = dsp.channel_quality(win)
        self.assertEqual(q[3], 1.0, 'std masih di bawah 300: lolos gerbang kualitas')
        b = dsp.band_powers(win, q)
        self.assertEqual(len(b.alpha), 3, 'TP10 dengan artefak dibuang')

    def test_masukan_tidak_diubah(self):
        win = window(lambda ch: sine(10, 20) + noise(ch))
        before = win.copy()
        dsp.band_powers(win, dsp.channel_quality(win))
        np.testing.assert_array_equal(win, before)


class HeartRateTest(unittest.TestCase):
    def test_72_bpm(self):
        t = np.arange(PPG_SR * 10) / PPG_SR
        ppg = np.sin(2 * np.pi * 1.2 * t) + 0.3 * np.sin(2 * np.pi * 2.4 * t)
        self.assertAlmostEqual(dsp.heart_rate(ppg), 72, delta=3)

    def test_terlalu_pendek_atau_datar_atau_acak_tanpa_denyut(self):
        self.assertIsNone(dsp.heart_rate(np.sin(np.arange(PPG_SR * 3) / 5.0)), 'kurang dari 4 detik')
        self.assertIsNone(dsp.heart_rate(np.ones(PPG_SR * 10)), 'datar')


if __name__ == '__main__':
    unittest.main()
