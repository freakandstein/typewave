// Klasifikasi tombol (spec 5.1). Hanya kode fisik KeyboardEvent.code; tidak pernah karakter.
const CHAR_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|NumpadDecimal|NumpadEqual|Minus|Equal|BracketLeft|BracketRight|Backslash|IntlBackslash|Semicolon|Quote|Backquote|Comma|Period|Slash|Space)$/;
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Fn']);

export function classify(code) {
  if (code === 'Backspace') return 'backspace';
  if (code === 'Enter' || code === 'NumpadEnter') return 'enter';
  if (CHAR_RE.test(code)) return 'char';
  return 'other';
}

export const isModifier = (code) => MODIFIERS.has(code);

export function hasShortcutMod(mods) {
  return Array.isArray(mods) && (mods.includes('ctrl') || mods.includes('cmd'));
}

// Dihitung untuk IKI, WPM, density: bukan auto-repeat dan bukan shortcut ctrl/cmd.
export const counts = (ev) => !ev.rep && !hasShortcutMod(ev.mods);
