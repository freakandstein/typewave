import unittest
from dataclasses import replace

from eeg.config import DEFAULT
from eeg.dsp import Bands
from eeg.state import MindState, normalize

TICK = DEFAULT.tick_s


def bands(alpha=10.0, beta=5.0, theta=4.0, q=(1.0, 1.0, 1.0, 1.0), emg=False):
    return Bands(alpha=[alpha] * 4, beta=[] if emg else [beta] * 4, theta=[theta] * 4,
                 f_alpha=[] if emg else [alpha] * 2, f_beta=[] if emg else [beta] * 2, f_theta=[] if emg else [theta] * 2,
                 frontal_emg=emg, quality=list(q))


def run(state, seconds, make, t0=0.0):
    """Suapkan state tiap tick; make(i, t) menghasilkan Bands. Mengembalikan waktu terakhir."""
    t = t0
    for i in range(int(seconds / TICK)):
        t = t0 + (i + 1) * TICK
        state.update(make(i, t), t)
    return t


class NormalizeTest(unittest.TestCase):
    def test_riwayat_pendek_netral_lalu_persentil_10_90(self):
        hist = []
        self.assertEqual([normalize(hist, v, 120) for v in (1, 2, 3, 4)], [0.5] * 4, 'kurang dari 5 data')
        for v in range(5, 101):
            normalize(hist, v, 120)
        self.assertEqual(normalize(hist, 100, 120), 1.0)
        self.assertEqual(normalize(hist, 1, 120), 0.0)
        mid = normalize(hist, 50, 120)
        self.assertTrue(0.3 < mid < 0.7, mid)

    def test_kebal_terhadap_pencilan(self):
        hist = []
        for v in list(range(1, 101)) + [10000]:
            normalize(hist, float(v), 120)
        mid = normalize(hist, 50.0, 120)
        self.assertTrue(0.3 < mid < 0.7, f'persentil mengabaikan pencilan, min-maks tidak: {mid}')

    def test_riwayat_datar_netral_dan_panjang_dibatasi(self):
        hist = []
        for _ in range(30):
            self.assertEqual(normalize(hist, 7.0, 120), 0.5)
        for v in range(500):
            normalize(hist, float(v), 120)
        self.assertEqual(len(hist), 120)


class MindStateTest(unittest.TestCase):
    def test_tidak_mengirim_selama_warmup_lalu_mengirim_dengan_field_lengkap(self):
        st = MindState()
        t = run(st, DEFAULT.warmup_s - 1.0, lambda i, t: bands())
        self.assertIsNone(st.snapshot(t), 'masih warm-up')
        t = run(st, 2.0, lambda i, t: bands(), t0=t)
        m = st.snapshot(t)
        self.assertEqual(m['t'], 'mind')
        for k in ('pos', 'theta', 'alpha', 'beta', 'q'):
            self.assertTrue(0.0 <= m[k] <= 1.0, (k, m[k]))
        self.assertNotIn('hr', m)
        st.set_heart_rate(71.0)
        self.assertEqual(st.snapshot(t)['hr'], 71.0)

    def test_emg_frontal_menahan_beta_tetapi_alpha_dan_theta_tetap_bergerak(self):
        import math
        st = MindState()
        t = run(st, 25.0, lambda i, t: bands(alpha=10 + (i % 5), beta=5 + (i % 6), theta=4 + (i % 3)))
        held = st.levels()[2]
        t = run(st, 5.0, lambda i, t: bands(alpha=30 + i, theta=2.0 + (i % 4), emg=True), t0=t)
        theta, alpha, beta = st.levels()
        self.assertEqual(beta, held, 'beta tidak dipercaya saat ada EMG: nilai lama dipertahankan')
        self.assertTrue(all(math.isfinite(x) for x in (theta, alpha, beta)))
        m = st.snapshot(t)
        self.assertTrue(all(math.isfinite(m[k]) for k in ('pos', 'theta', 'alpha', 'beta', 'q')))

    def test_q_adalah_rata_rata_kualitas_kanal(self):
        st = MindState()
        t = run(st, DEFAULT.warmup_s + 1.0, lambda i, t: bands(q=(1.0, 0.5, 0.0, 0.5)))
        self.assertAlmostEqual(st.snapshot(t)['q'], 0.5, places=2)

    def test_basi_bila_tidak_ada_pembaruan_dan_kanal_buruk_tidak_menyegarkan(self):
        st = MindState()
        t = run(st, DEFAULT.warmup_s + 1.0, lambda i, t: bands())
        self.assertIsNotNone(st.snapshot(t))
        self.assertIsNone(st.snapshot(t + DEFAULT.stale_s + 0.1), 'tidak ada pembaruan')
        st.update(Bands(quality=[0.0] * 4), t + 0.5)  # semua kanal buruk
        self.assertIsNone(st.snapshot(t + DEFAULT.stale_s + 0.1), 'kanal buruk tidak boleh menyegarkan data')

    def test_beta_naik_menaikkan_level_beta_dan_pos_turun_saat_beta_turun(self):
        st = MindState()
        base = lambda i, t: bands(alpha=10 + (i % 5), beta=5 + (i % 7) * 0.2, theta=4 + (i % 3) * 0.3)
        t = run(st, 45.0, base)
        calm = st.snapshot(t)
        t = run(st, 12.0, lambda i, t: bands(alpha=8.0, beta=14.0 + (i % 4), theta=3.0), t0=t)
        tense = st.snapshot(t)
        self.assertGreater(tense['beta'], calm['beta'] + 0.3)
        self.assertGreater(tense['pos'], calm['pos'] + 0.1)
        self.assertLess(tense['alpha'], calm['alpha'] + 0.2)
        t = run(st, 14.0, lambda i, t: bands(alpha=12.0, beta=2.0 + (i % 3) * 0.1, theta=6.0), t0=t)
        self.assertLess(st.snapshot(t)['beta'], tense['beta'] - 0.3)
        self.assertLess(st.snapshot(t)['pos'], tense['pos'])

    def test_ambang_adaptif_diperbarui_di_akhir_warmup_lalu_berkala(self):
        st = MindState()
        self.assertEqual(st.threshold, DEFAULT.threshold_init)
        t = run(st, DEFAULT.warmup_s - 1.0, lambda i, t: bands())
        self.assertEqual(st.threshold, DEFAULT.threshold_init)
        t = run(st, 2.0, lambda i, t: bands(), t0=t)
        first = st.threshold
        self.assertNotEqual(first, DEFAULT.threshold_init, 'diperbarui saat warm-up selesai')
        arousal = 0.70 * 0.5 - 0.10 * 0.5 - 0.05 * 0.5  # masukan konstan -> semua level netral 0,5
        self.assertAlmostEqual(first, arousal + DEFAULT.threshold_margin, places=3)
        t = run(st, DEFAULT.threshold_every_s - 5.0, lambda i, t: bands(beta=5.0 + i * 0.5), t0=t)  # beta terus naik: selalu di ujung atas riwayat
        self.assertEqual(st.threshold, first, 'belum waktunya diperbarui lagi')
        t = run(st, 8.0, lambda i, t: bands(beta=60.0 + i * 0.5), t0=t)
        self.assertGreater(st.threshold, first + 0.05, 'diperbarui lagi tiap 30 detik mengikuti median arousal yang naik')

    def test_lost_membersihkan_hr_dan_kekinian_tetapi_riwayat_dan_warmup_dipertahankan(self):
        st = MindState()
        t = run(st, DEFAULT.warmup_s + 20.0, lambda i, t: bands(beta=5 + (i % 6)))
        st.set_heart_rate(70.0)
        before = st.snapshot(t)
        st.lost()
        self.assertIsNone(st.snapshot(t), 'tidak ada data sejak koneksi hilang')
        t += 20.0  # jeda panjang sampai tersambung lagi
        st.update(bands(beta=5), t)
        after = st.snapshot(t)
        self.assertIsNotNone(after, 'tidak perlu warm-up ulang')
        self.assertNotIn('hr', after, 'HR lama dibuang')
        self.assertLess(abs(after['pos'] - before['pos']), 0.5)

    def test_ema_menghitung_waktu_nyata(self):
        mk = lambda i, t: bands(alpha=5 + (i % 4), beta=5 + (i % 5), theta=4 + (i % 3))
        a, b = MindState(), MindState()
        ta = run(a, 10.0, mk)
        tb = run(b, 10.0, mk)
        spike = bands(alpha=50, beta=50, theta=50)
        a.update(spike, ta + TICK)
        a.update(spike, ta + 2 * TICK)  # dua langkah kecil
        b.update(spike, tb + 4 * TICK)  # satu langkah besar (jeda lebih lama)
        self.assertGreater(b.levels()[2], a.levels()[2], 'selang waktu lebih lama menggeser lebih jauh')

    def test_pengaturan_bisa_diganti_untuk_tes_cepat(self):
        fast = replace(DEFAULT, warmup_s=1.0, stale_s=0.5)
        st = MindState(fast)
        t = run(st, 1.5, lambda i, t: bands())
        self.assertIsNotNone(st.snapshot(t))
        self.assertIsNone(st.snapshot(t + 0.6))


class ContactTest(unittest.TestCase):
    """Kontak sensor: kualitas per kanal (TP9, AF7, AF8, TP10) untuk titik di halaman, terpisah dari mind."""

    def test_tersedia_walau_semua_kanal_buruk_dan_masih_warmup(self):
        st = MindState()
        st.update(Bands(quality=[0.0, 1.0, 0.5, 1.0]), 1.0)  # tidak ada kanal valid: mind tidak diperbarui
        self.assertIsNone(st.snapshot(1.0))
        self.assertEqual(st.contact(1.0), [0.0, 1.0, 0.5, 1.0], 'justru saat headset baru dipasang titik sensor paling dibutuhkan')

    def test_basi_bila_tidak_ada_pembaruan_dan_hilang_saat_koneksi_putus(self):
        st = MindState()
        st.update(Bands(quality=[1.0] * 4), 1.0)
        self.assertIsNotNone(st.contact(1.0 + DEFAULT.stale_s - 0.1))
        self.assertIsNone(st.contact(1.0 + DEFAULT.stale_s + 0.1), 'tanpa pembaruan: itu bukan kondisi sensor yang sekarang')
        st.update(Bands(quality=[1.0] * 4), 5.0)
        st.lost()
        self.assertIsNone(st.contact(5.0))

    def test_dihaluskan_satu_tick_buruk_tidak_membalik_tetapi_yang_berlanjut_membalik_hanya_kanal_itu(self):
        st = MindState()
        t = run(st, 5.0, lambda i, t: Bands(quality=[1.0] * 4))
        t += TICK
        st.update(Bands(quality=[1.0, 0.0, 1.0, 1.0]), t)  # satu tick buruk, mis. kedip
        self.assertGreater(st.contact(t)[1], 0.65, 'kedip sesaat tidak boleh mengubah warna titik')
        t = run(st, 5.0, lambda i, t: Bands(quality=[1.0, 0.0, 1.0, 1.0]), t0=t)
        c = st.contact(t)
        self.assertLess(c[1], 0.25, 'sensor yang terus buruk harus akhirnya terbaca buruk')
        self.assertEqual([c[0], c[2], c[3]], [1.0, 1.0, 1.0], 'kanal lain tidak ikut')

    def test_kualitas_yang_tidak_lengkap_diabaikan_dan_nilai_dibulatkan(self):
        st = MindState()
        st.update(Bands(quality=[0.123456, 1.0, 1.0, 1.0]), 1.0)
        self.assertEqual(st.contact(1.0)[0], 0.12)
        st.update(Bands(quality=[0.0]), 1.2)  # bukan empat kanal: tidak dipercaya
        self.assertEqual(st.contact(1.2)[1], 1.0)


if __name__ == '__main__':
    unittest.main()
