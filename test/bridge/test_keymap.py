import unittest

from bridge import keymap

# Tabel referensi spec 5.1 (nama macOS -> KeyboardEvent.code), ditulis ulang terpisah dari keymap.py.
SPEC = {
    0x00: 'KeyA', 0x01: 'KeyS', 0x02: 'KeyD', 0x03: 'KeyF', 0x04: 'KeyH', 0x05: 'KeyG', 0x06: 'KeyZ', 0x07: 'KeyX',
    0x08: 'KeyC', 0x09: 'KeyV', 0x0B: 'KeyB', 0x0C: 'KeyQ', 0x0D: 'KeyW', 0x0E: 'KeyE', 0x0F: 'KeyR', 0x10: 'KeyY',
    0x11: 'KeyT', 0x12: 'Digit1', 0x13: 'Digit2', 0x14: 'Digit3', 0x15: 'Digit4', 0x16: 'Digit6', 0x17: 'Digit5',
    0x18: 'Equal', 0x19: 'Digit9', 0x1A: 'Digit7', 0x1B: 'Minus', 0x1C: 'Digit8', 0x1D: 'Digit0', 0x1E: 'BracketRight',
    0x1F: 'KeyO', 0x20: 'KeyU', 0x21: 'BracketLeft', 0x22: 'KeyI', 0x23: 'KeyP', 0x24: 'Enter', 0x25: 'KeyL',
    0x26: 'KeyJ', 0x27: 'Quote', 0x28: 'KeyK', 0x29: 'Semicolon', 0x2A: 'Backslash', 0x2B: 'Comma', 0x2C: 'Slash',
    0x2D: 'KeyN', 0x2E: 'KeyM', 0x2F: 'Period', 0x30: 'Tab', 0x31: 'Space', 0x32: 'Backquote', 0x33: 'Backspace',
    0x35: 'Escape',
}


class KeymapTest(unittest.TestCase):
    def test_semua_entri_spec_terpetakan(self):
        for vk, code in SPEC.items():
            self.assertEqual(keymap.code_for_vk(vk), code, hex(vk))

    def test_tambahan_wajib(self):
        extra = {
            0x37: 'MetaLeft', 0x36: 'MetaRight', 0x38: 'ShiftLeft', 0x3C: 'ShiftRight', 0x3A: 'AltLeft', 0x3D: 'AltRight',
            0x3B: 'ControlLeft', 0x3E: 'ControlRight', 0x39: 'CapsLock', 0x3F: 'Fn',
            0x7A: 'F1', 0x78: 'F2', 0x63: 'F3', 0x76: 'F4', 0x60: 'F5', 0x61: 'F6', 0x62: 'F7', 0x64: 'F8', 0x65: 'F9',
            0x6D: 'F10', 0x67: 'F11', 0x6F: 'F12', 0x69: 'F13', 0x6B: 'F14', 0x71: 'F15', 0x6A: 'F16', 0x40: 'F17',
            0x4F: 'F18', 0x50: 'F19', 0x5A: 'F20',
            0x7B: 'ArrowLeft', 0x7C: 'ArrowRight', 0x7D: 'ArrowDown', 0x7E: 'ArrowUp',
            0x73: 'Home', 0x77: 'End', 0x74: 'PageUp', 0x79: 'PageDown', 0x75: 'Delete', 0x72: 'Insert',
        }
        for vk, code in extra.items():
            self.assertEqual(keymap.code_for_vk(vk), code, hex(vk))

    def test_kode_unik_dan_roundtrip(self):
        codes = list(keymap.VK_TO_CODE.values())
        self.assertEqual(len(codes), len(set(codes)))
        for vk, code in keymap.VK_TO_CODE.items():
            self.assertEqual(keymap.CODE_TO_VK[code], vk)

    def test_vk_tak_dikenal_diteruskan_sebagai_vk_hex(self):
        self.assertEqual(keymap.code_for_vk(0xFE), 'VkFE')
        self.assertEqual(keymap.code_for_vk(0x01FF), 'Vk1FF')

    def test_mods_from_flags(self):
        self.assertEqual(keymap.mods_from_flags(0), [])
        self.assertEqual(keymap.mods_from_flags(keymap.FLAG_SHIFT | keymap.FLAG_CMD), ['shift', 'cmd'])
        self.assertEqual(keymap.mods_from_flags(keymap.FLAG_CTRL | keymap.FLAG_ALT), ['ctrl', 'alt'])
        self.assertEqual(
            keymap.mods_from_flags(keymap.FLAG_SHIFT | keymap.FLAG_CTRL | keymap.FLAG_ALT | keymap.FLAG_CMD),
            ['shift', 'ctrl', 'alt', 'cmd'])


if __name__ == '__main__':
    unittest.main()
