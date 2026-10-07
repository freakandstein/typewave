import unittest

from eeg import dsp
from tools import fake_eeg_server, fake_muse_lsl, inject


class InjectTest(unittest.TestCase):
    def test_delays_deterministik_dan_dalam_batas(self):
        a = inject.delays(50, 10, seed=1)
        self.assertEqual(a, inject.delays(50, 10, seed=1))
        self.assertNotEqual(a, inject.delays(50, 10, seed=2))
        self.assertTrue(all(1 / 10 <= d <= 3 / 10 for d in a))
        self.assertEqual(len(a), 50)

    def test_mind_message_memuat_band_hanya_bila_diberikan(self):
        from argparse import Namespace
        base = Namespace(pos=0.3, hr=70.0, q=1.0, alpha=None, beta=None, theta=None)
        self.assertEqual(inject.mind_message(base), {'t': 'mind', 'pos': 0.3, 'hr': 70.0, 'q': 1.0})
        withb = Namespace(pos=0.3, hr=70.0, q=1.0, alpha=0.8, beta=None, theta=0.1)
        self.assertEqual(inject.mind_message(withb), {'t': 'mind', 'pos': 0.3, 'hr': 70.0, 'q': 1.0, 'alpha': 0.8, 'theta': 0.1})


class FakeEEGWanderTest(unittest.TestCase):
    def test_wander_menggerakkan_level_gelombang_bersama_pos(self):
        relaxed = fake_eeg_server.wander_state(8 * 3 * 3.14159265 / 2 * 1.0)  # sin(t/8) mendekati -1
        tense = fake_eeg_server.wander_state(8 * 3.14159265 / 2)  # sin(t/8) mendekati +1
        self.assertLess(relaxed['spectrum_pos'], 0.15)
        self.assertGreater(relaxed['theta'], 0.6)
        self.assertGreater(relaxed['alpha'], 0.6)
        self.assertLess(relaxed['beta'], 0.35)
        self.assertGreater(tense['spectrum_pos'], 0.85)
        self.assertGreater(tense['beta'], 0.7)
        self.assertLess(tense['theta'], 0.35)

    def test_semua_level_selalu_0_sampai_1(self):
        for t in range(0, 400):
            s = fake_eeg_server.wander_state(t * 0.37)
            for k in ('spectrum_pos', 'theta', 'alpha', 'beta'):
                self.assertTrue(0.0 <= s[k] <= 1.0, (t, k, s[k]))


class FakeMuseDegradeTest(unittest.TestCase):
    """Streamer Muse palsu bisa merusak satu sensor pada waktu tertentu: untuk menguji dan mendemokan titik sensor tanpa headset."""

    def quality(self, synth, t0, seconds=2.0):
        n0, n = int(t0 * fake_muse_lsl.EEG_RATE), int(seconds * fake_muse_lsl.EEG_RATE)
        return dsp.channel_quality(synth.eeg(n0, n)[:, :4].T)  # (4, n) seperti jendela DSP

    def test_spesifikasi_dibaca_dan_yang_salah_ditolak(self):
        parse = fake_muse_lsl.parse_degrade
        self.assertEqual(parse('AF7:flat@10-25'), (1, 'flat', 10.0, 25.0))
        self.assertEqual(parse('TP10:noisy@5'), (3, 'noisy', 5.0, float('inf')))
        self.assertEqual(parse('TP9:wild@0.5-2.5'), (0, 'wild', 0.5, 2.5))
        for bad in ('', 'AF7', 'AF7:flat', 'AF9:flat@1', 'AF7:melted@1', 'AF7:flat@x', 'AF7:flat@5-3', 'AF7:flat@5-5', 'AF7:flat@-1', 'Right AUX:flat@1'):
            with self.assertRaises(ValueError, msg=bad):
                parse(bad)

    def test_flat_noisy_wild_merusak_hanya_kanal_dan_jendela_waktunya_lalu_pulih(self):
        for kind, expect in (('flat', 0.0), ('noisy', 0.25), ('wild', 0.0)):
            synth = fake_muse_lsl.Synth('relaxed', 72.0, degrade=[fake_muse_lsl.parse_degrade(f'AF7:{kind}@10-20')])
            self.assertEqual(self.quality(synth, 4.0), [1.0] * 4, f'{kind}: sebelum waktunya semua sensor bagus')
            q = self.quality(synth, 12.0)
            self.assertEqual(q[1], expect, kind)
            self.assertEqual([q[0], q[2], q[3]], [1.0] * 3, f'{kind}: kanal lain tidak ikut')
            self.assertEqual(self.quality(synth, 22.0), [1.0] * 4, f'{kind}: setelah berakhir pulih')

    def test_beberapa_kanal_dan_tanpa_akhir_berlaku_seterusnya(self):
        specs = [fake_muse_lsl.parse_degrade(s) for s in ('TP9:flat@5', 'TP10:wild@5-9')]
        synth = fake_muse_lsl.Synth('relaxed', 72.0, degrade=specs)
        self.assertEqual(self.quality(synth, 6.0), [0.0, 1.0, 1.0, 0.0])
        self.assertEqual(self.quality(synth, 30.0), [0.0, 1.0, 1.0, 1.0])

    def test_tanpa_degrade_sinyalnya_persis_sama_seperti_sebelumnya(self):
        a = fake_muse_lsl.Synth('mixed', 72.0).eeg(1000, 64)
        b = fake_muse_lsl.Synth('mixed', 72.0, degrade=()).eeg(1000, 64)
        self.assertTrue((a == b).all())


if __name__ == '__main__':
    unittest.main()
