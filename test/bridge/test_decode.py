import unittest

from bridge.decode import FLAGS_CHANGED, KEY_DOWN, KeyEvent, decode
from bridge.keymap import FLAG_ALT, FLAG_CMD, FLAG_CTRL, FLAG_SHIFT

KEY_UP = 11


class DecodeTest(unittest.TestCase):
    def test_key_down_biasa(self):
        self.assertEqual(decode(KEY_DOWN, 0x00, 0, False, 123), KeyEvent('KeyA', 123, False, []))

    def test_auto_repeat_ditandai(self):
        self.assertTrue(decode(KEY_DOWN, 0x33, 0, True, 1).rep)
        self.assertFalse(decode(KEY_DOWN, 0x33, 0, False, 1).rep)

    def test_modifier_yang_ditahan_ikut_di_mods(self):
        ev = decode(KEY_DOWN, 0x23, FLAG_CTRL | FLAG_ALT, False, 1)
        self.assertEqual((ev.code, ev.mods), ('KeyP', ['ctrl', 'alt']))
        ev = decode(KEY_DOWN, 0x08, FLAG_CMD | FLAG_SHIFT, False, 1)
        self.assertEqual(ev.mods, ['shift', 'cmd'])

    def test_modifier_hanya_saat_ditekan(self):
        press = decode(FLAGS_CHANGED, 0x38, FLAG_SHIFT | 0x2, False, 5)  # Shift kiri ditekan
        self.assertEqual((press.code, press.rep), ('ShiftLeft', False))
        self.assertIsNone(decode(FLAGS_CHANGED, 0x38, 0, False, 6))       # dilepas
        self.assertEqual(decode(FLAGS_CHANGED, 0x36, FLAG_CMD | 0x10, False, 7).code, 'MetaRight')
        self.assertEqual(decode(FLAGS_CHANGED, 0x3B, FLAG_CTRL | 0x1, False, 8).code, 'ControlLeft')

    def test_capslock_selalu_dianggap_key_down(self):
        self.assertEqual(decode(FLAGS_CHANGED, 0x39, 0, False, 1).code, 'CapsLock')
        self.assertEqual(decode(FLAGS_CHANGED, 0x39, 0x10000, False, 2).code, 'CapsLock')

    def test_kode_tak_dikenal_tetap_diteruskan(self):
        self.assertEqual(decode(KEY_DOWN, 0xFE, 0, False, 1).code, 'VkFE')

    def test_event_lain_diabaikan(self):
        self.assertIsNone(decode(KEY_UP, 0x00, 0, False, 1))
        self.assertIsNone(decode(FLAGS_CHANGED, 0x00, 0, False, 1))  # flagsChanged untuk vk non-modifier
        self.assertIsNone(decode(99, 0x00, 0, False, 1))


if __name__ == '__main__':
    unittest.main()
