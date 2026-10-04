// ANSI 75% (16u lebar x 6 baris). Satuan = lebar tombol 1u. Dipakai untuk siluet footprint dan posisi bead;
// sesuaikan dengan keyboard asli bila perlu (urutan dan lebar di bawah).
const ROW_SRC = [
  'Escape F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 Delete',
  'Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace PageUp',
  'Tab KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Backslash PageDown',
  'CapsLock KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Enter Home',
  'ShiftLeft KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash ShiftRight ArrowUp End',
  'ControlLeft AltLeft MetaLeft Space MetaRight AltRight Fn ArrowLeft ArrowDown ArrowRight',
];
const WIDTH = {
  Backspace: 2, Tab: 1.5, Backslash: 1.5, CapsLock: 1.75, Enter: 2.25, ShiftLeft: 2.25, ShiftRight: 1.75,
  ControlLeft: 1.25, AltLeft: 1.25, MetaLeft: 1.25, Space: 6.25,
};
const LEFT = new Set([
  'Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
  'Tab', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'CapsLock', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG',
  'ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'ControlLeft', 'AltLeft', 'MetaLeft',
]);
const ZONE_ROW = [0, 0, 1, 2, 3, 3]; // baris fisik -> baris zona (F dan angka = 0, ..., shift dan bawah = 3)

export const LAYOUT_W = 16;
export const LAYOUT_H = 6;
export const ZONES = ['L0', 'L1', 'L2', 'L3', 'R0', 'R1', 'R2', 'R3'];

export const KEYS = [];
ROW_SRC.forEach((src, y) => {
  let x = 0;
  for (const code of src.split(' ')) {
    const w = WIDTH[code] ?? 1;
    const hand = code === 'Space' ? 'B' : LEFT.has(code) ? 'L' : 'R';
    KEYS.push({ code, x, y, w, row: ZONE_ROW[y], hand, u: (x + w / 2) / LAYOUT_W });
    x += w;
  }
});

const INDEX = new Map(KEYS.map((k, i) => [k.code, i]));
export const keyIndex = (code) => (INDEX.has(code) ? INDEX.get(code) : -1);
export const keyInfo = (code) => KEYS[keyIndex(code)] ?? null;

export function zonesFor(code) {
  const k = keyInfo(code);
  if (!k) return [];
  return k.hand === 'B' ? ['L' + k.row, 'R' + k.row] : [k.hand + k.row];
}
