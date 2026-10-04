import unittest
from unittest.mock import MagicMock

from bridge.keymap import CODE_TO_VK, FLAG_ALT, FLAG_CTRL
from tools import autotype


class AutotypeTest(unittest.TestCase):
    def test_plan_deterministik_dan_dalam_batas(self):
        a = autotype.plan_keys(200, seed=1)
        self.assertEqual(a, autotype.plan_keys(200, seed=1))
        self.assertNotEqual(a, autotype.plan_keys(200, seed=2))
        self.assertEqual(len(a), 200)
        self.assertTrue(all(code in autotype.DEFAULT_CODES for code, _ in a))
        self.assertTrue(all(delay >= 1 / 15 - 1e-9 for _, delay in a))
        self.assertTrue(any(abs(delay - 1 / 15) < 1e-9 for _, delay in a), 'harus ada burst 15 tombol/detik')
        self.assertTrue(all(code in CODE_TO_VK for code, _ in a))

    def test_plan_dengan_kode_sendiri(self):
        plan = autotype.plan_keys(20, seed=3, codes=['KeyA', 'KeyB'])
        self.assertTrue(all(code in ('KeyA', 'KeyB') for code, _ in plan))

    def test_parse_chord(self):
        self.assertEqual(autotype.parse_chord('ctrl+alt+KeyP'), (['ctrl', 'alt'], 'KeyP'))
        self.assertEqual(autotype.parse_chord('KeyA'), ([], 'KeyA'))
        with self.assertRaises(ValueError):
            autotype.parse_chord('ctrl+nope+KeyP')
        with self.assertRaises(ValueError):
            autotype.parse_chord('ctrl+alt+Bogus')

    def test_type_keys_menembak_down_dan_up_per_tombol(self):
        q = MagicMock()
        slept = []
        n = autotype.type_keys([('KeyA', 0.1), ('Space', 0.2)], quartz=q, sleep=slept.append)
        self.assertEqual(n, 2)
        calls = q.CGEventCreateKeyboardEvent.call_args_list
        self.assertEqual([(c[0][1], c[0][2]) for c in calls], [(0x00, True), (0x00, False), (0x31, True), (0x31, False)])
        self.assertEqual(q.CGEventPost.call_count, 4)
        self.assertEqual(slept, [0.012, 0.1, 0.012, 0.2])

    def test_chord_memasang_flag_modifier_pada_tombol(self):
        q = MagicMock()
        autotype.press_chord(q, ['ctrl', 'alt'], 'KeyP', sleep=lambda s: None)
        q.CGEventSetFlags.assert_called()
        self.assertEqual(q.CGEventSetFlags.call_args_list[0][0][1], FLAG_CTRL | FLAG_ALT)
        self.assertEqual(q.CGEventCreateKeyboardEvent.call_args_list[0][0][1], 0x23)


if __name__ == '__main__':
    unittest.main()
