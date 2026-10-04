import unittest

from tools import fake_eeg_server, inject


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


if __name__ == '__main__':
    unittest.main()
