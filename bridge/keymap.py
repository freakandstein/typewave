"""Virtual key macOS -> KeyboardEvent.code. Hanya keycode fisik; tidak pernah karakter."""
from __future__ import annotations

VK_TO_CODE: dict[int, str] = {
    # huruf, angka, simbol (tabel referensi spec 5.1; nama macOS dipetakan ke KeyboardEvent.code)
    0x00: 'KeyA', 0x01: 'KeyS', 0x02: 'KeyD', 0x03: 'KeyF', 0x04: 'KeyH', 0x05: 'KeyG', 0x06: 'KeyZ', 0x07: 'KeyX',
    0x08: 'KeyC', 0x09: 'KeyV', 0x0A: 'IntlBackslash', 0x0B: 'KeyB', 0x0C: 'KeyQ', 0x0D: 'KeyW', 0x0E: 'KeyE',
    0x0F: 'KeyR', 0x10: 'KeyY', 0x11: 'KeyT', 0x12: 'Digit1', 0x13: 'Digit2', 0x14: 'Digit3', 0x15: 'Digit4',
    0x16: 'Digit6', 0x17: 'Digit5', 0x18: 'Equal', 0x19: 'Digit9', 0x1A: 'Digit7', 0x1B: 'Minus', 0x1C: 'Digit8',
    0x1D: 'Digit0', 0x1E: 'BracketRight', 0x1F: 'KeyO', 0x20: 'KeyU', 0x21: 'BracketLeft', 0x22: 'KeyI',
    0x23: 'KeyP', 0x24: 'Enter', 0x25: 'KeyL', 0x26: 'KeyJ', 0x27: 'Quote', 0x28: 'KeyK', 0x29: 'Semicolon',
    0x2A: 'Backslash', 0x2B: 'Comma', 0x2C: 'Slash', 0x2D: 'KeyN', 0x2E: 'KeyM', 0x2F: 'Period', 0x30: 'Tab',
    0x31: 'Space', 0x32: 'Backquote', 0x33: 'Backspace', 0x35: 'Escape',
    # modifier
    0x36: 'MetaRight', 0x37: 'MetaLeft', 0x38: 'ShiftLeft', 0x39: 'CapsLock', 0x3A: 'AltLeft', 0x3B: 'ControlLeft',
    0x3C: 'ShiftRight', 0x3D: 'AltRight', 0x3E: 'ControlRight', 0x3F: 'Fn',
    # F-key
    0x7A: 'F1', 0x78: 'F2', 0x63: 'F3', 0x76: 'F4', 0x60: 'F5', 0x61: 'F6', 0x62: 'F7', 0x64: 'F8', 0x65: 'F9',
    0x6D: 'F10', 0x67: 'F11', 0x6F: 'F12', 0x69: 'F13', 0x6B: 'F14', 0x71: 'F15', 0x6A: 'F16', 0x40: 'F17',
    0x4F: 'F18', 0x50: 'F19', 0x5A: 'F20',
    # panah dan navigasi
    0x7B: 'ArrowLeft', 0x7C: 'ArrowRight', 0x7D: 'ArrowDown', 0x7E: 'ArrowUp',
    0x73: 'Home', 0x77: 'End', 0x74: 'PageUp', 0x79: 'PageDown', 0x75: 'Delete', 0x72: 'Insert',
    # numpad
    0x52: 'Numpad0', 0x53: 'Numpad1', 0x54: 'Numpad2', 0x55: 'Numpad3', 0x56: 'Numpad4', 0x57: 'Numpad5',
    0x58: 'Numpad6', 0x59: 'Numpad7', 0x5B: 'Numpad8', 0x5C: 'Numpad9', 0x41: 'NumpadDecimal',
    0x43: 'NumpadMultiply', 0x45: 'NumpadAdd', 0x47: 'NumLock', 0x4B: 'NumpadDivide', 0x4C: 'NumpadEnter',
    0x4E: 'NumpadSubtract', 0x51: 'NumpadEqual',
}

CODE_TO_VK: dict[str, int] = {code: vk for vk, code in VK_TO_CODE.items()}

# Flag modifier CGEventFlags (kCGEventFlagMask*).
FLAG_SHIFT = 0x00020000
FLAG_CTRL = 0x00040000
FLAG_ALT = 0x00080000
FLAG_CMD = 0x00100000

# Bit device-dependent "tombol modifier ini sedang ditekan" untuk event flagsChanged.
VK_CAPS = 0x39
MODIFIER_MASK: dict[int, int] = {
    0x38: 0x00000002,  # Shift kiri
    0x3C: 0x00000004,  # Shift kanan
    0x37: 0x00000008,  # Command kiri
    0x36: 0x00000010,  # Command kanan
    0x3A: 0x00000020,  # Option kiri
    0x3D: 0x00000040,  # Option kanan
    0x3B: 0x00000001,  # Control kiri
    0x3E: 0x00002000,  # Control kanan
    VK_CAPS: 0x00010000,  # CapsLock (kCGEventFlagMaskAlphaShift)
    0x3F: 0x00800000,  # Fn (kCGEventFlagMaskSecondaryFn)
}


def code_for_vk(vk: int) -> str:
    return VK_TO_CODE.get(vk, 'Vk%02X' % vk)


def mods_from_flags(flags: int) -> list[str]:
    mods = []
    if flags & FLAG_SHIFT:
        mods.append('shift')
    if flags & FLAG_CTRL:
        mods.append('ctrl')
    if flags & FLAG_ALT:
        mods.append('alt')
    if flags & FLAG_CMD:
        mods.append('cmd')
    return mods
