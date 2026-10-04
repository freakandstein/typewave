"""Decoder murni event Quartz -> KeyEvent. Tidak mengimpor Quartz supaya bisa dites di mana saja."""
from __future__ import annotations

from dataclasses import dataclass, field

from .keymap import MODIFIER_MASK, VK_CAPS, code_for_vk, mods_from_flags

KEY_DOWN = 10       # kCGEventKeyDown
FLAGS_CHANGED = 12  # kCGEventFlagsChanged


@dataclass
class KeyEvent:
    code: str
    at: int
    rep: bool = False
    mods: list[str] = field(default_factory=list)


def decode(event_type: int, vk: int, flags: int, autorepeat: bool, at: int) -> KeyEvent | None:
    if event_type == KEY_DOWN:
        return KeyEvent(code_for_vk(vk), at, bool(autorepeat), mods_from_flags(flags))
    if event_type == FLAGS_CHANGED:
        mask = MODIFIER_MASK.get(vk)
        if mask is None:
            return None
        # Modifier hanya dihitung saat ditekan; CapsLock mengirim satu event per penekanan, selalu dihitung.
        if vk == VK_CAPS or flags & mask:
            return KeyEvent(code_for_vk(vk), at, False, mods_from_flags(flags))
    return None
