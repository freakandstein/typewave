// Warna: OKLab (Ottosson), grade per pos (spec 3.1), kata state dengan hysteresis.
import { CONFIG } from '../config.js';

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLin = (c) => { c = clamp(c); return (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255; };

export function rgbToOklab([r, g, b]) {
  const lr = toLin(r), lg = toLin(g), lb = toLin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function labToRgbInto(dst, L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  dst[0] = fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  dst[1] = fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  dst[2] = fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return dst;
}
export const oklabToRgb = ([L, a, b]) => labToRgbInto([0, 0, 0], L, a, b);

const PAL = {};
for (const key of ['calm', 'flow', 'tense', 'noSignal']) {
  PAL[key] = { g: rgbToOklab(hexToRgb(CONFIG.colors[key].ground)), i: rgbToOklab(hexToRgb(CONFIG.colors[key].ink)) };
}
const _g = [0, 0, 0];
const _i = [0, 0, 0];
function mixInto(dst, a, b, t) {
  dst[0] = a[0] + (b[0] - a[0]) * t;
  dst[1] = a[1] + (b[1] - a[1]) * t;
  dst[2] = a[2] + (b[2] - a[2]) * t;
}

// out = { ground:[r,g,b], ink:[r,g,b] } (float 0..255). q: kualitas sinyal 0..1; k: 0..1 menuju grade "tanpa sinyal".
export function gradeInto(out, p, q, k) {
  const z = CONFIG.zone;
  let A, B, t;
  if (p <= z.calmMax) { A = PAL.calm; B = PAL.flow; t = smoothstep(z.calmFlow[0], z.calmFlow[1], p); }
  else if (p < z.tenseMin) { A = B = PAL.flow; t = 0; }
  else { A = PAL.flow; B = PAL.tense; t = smoothstep(z.flowTense[0], z.flowTense[1], p); }
  mixInto(_g, A.g, B.g, t);
  mixInto(_i, A.i, B.i, t);
  const sat = lerp(CONFIG.sat[0], CONFIG.sat[1], clamp(q));
  _i[1] *= sat;
  _i[2] *= sat;
  if (k > 0) { mixInto(_g, _g, PAL.noSignal.g, k); mixInto(_i, _i, PAL.noSignal.i, k); }
  labToRgbInto(out.ground, _g[0], _g[1], _g[2]);
  labToRgbInto(out.ink, _i[0], _i[1], _i[2]);
  return out;
}

// Kata state dengan hysteresis: kandidat baru harus bertahan dwellMs sebelum kata berganti.
export function createStateWord(dwellMs = CONFIG.zone.dwellMs) {
  let cur = 'calm', cand = null, since = 0, init = false;
  return {
    update(p, now) {
      const z = CONFIG.zone;
      const want = p < z.calmMax ? 'calm' : p > z.tenseMin ? 'tense' : 'flow';
      if (!init) { cur = want; init = true; return cur; }
      if (want === cur) { cand = null; return cur; }
      if (want !== cand) { cand = want; since = now; }
      else if (now - since >= dwellMs) { cur = want; cand = null; }
      return cur;
    },
    get word() { return cur; },
  };
}
