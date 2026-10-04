// Keyboard footprint (spec 6.2): siluet ANSI 75% pada alpha 25%; tombol (exact) atau zona (zone) menyala lalu memudar.
import { CONFIG } from '../config.js';
import { KEYS, LAYOUT_W, LAYOUT_H, ZONES, keyIndex, zonesFor } from '../data/layout-ansi75.js';

export function createFootprint() {
  return { lit: new Float32Array(KEYS.length), zlit: new Float32Array(ZONES.length) };
}

export function lightKey(fp, code, privacy) {
  if (privacy === 'zone') {
    for (const z of zonesFor(code)) fp.zlit[ZONES.indexOf(z)] = 1;
    return;
  }
  const i = keyIndex(code);
  if (i >= 0) fp.lit[i] = 1;
}

export function decayFootprint(fp, dt) {
  const d = (dt * 1000) / CONFIG.footprint.litMs;
  for (let i = 0; i < fp.lit.length; i++) if (fp.lit[i] > 0) fp.lit[i] = Math.max(0, fp.lit[i] - d);
  for (let i = 0; i < fp.zlit.length; i++) if (fp.zlit[i] > 0) fp.zlit[i] = Math.max(0, fp.zlit[i] - d);
}

export function footprintRect(g) {
  const f = CONFIG.footprint[g.layout];
  const x0 = f.x[0] * g.W;
  const w = (f.x[1] - f.x[0]) * g.W;
  const unit = w / LAYOUT_W;
  const uh = unit * CONFIG.footprint.aspect;
  const h = uh * LAYOUT_H;
  return { x0, y0: f.bottom * g.H - h, w, h, unit, uh };
}

// Indeks zona per tombol (Space = dua zona).
const KEY_ZONES = KEYS.map((k) => (k.hand === 'B' ? [ZONES.indexOf('L' + k.row), ZONES.indexOf('R' + k.row)] : [ZONES.indexOf(k.hand + k.row)]));

function addRect(ctx, R, k, gapPx, radius) {
  const x = R.x0 + k.x * R.unit + gapPx / 2;
  const y = R.y0 + k.y * R.uh + gapPx / 2;
  const w = k.w * R.unit - gapPx;
  const h = R.uh - gapPx;
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius); else ctx.rect(x, y, w, h);
}

export function drawFootprint(ctx, fp, g, privacy, inkCss) {
  const R = footprintRect(g);
  const gapPx = CONFIG.footprint.gap * R.unit;
  const radius = 0.18 * R.uh;
  const base = CONFIG.footprint.alpha;
  ctx.fillStyle = inkCss;
  ctx.globalAlpha = base;
  ctx.beginPath();
  for (const k of KEYS) addRect(ctx, R, k, gapPx, radius);
  ctx.fill();
  for (let i = 0; i < KEYS.length; i++) {
    let lit = 0;
    if (privacy === 'zone') for (const z of KEY_ZONES[i]) lit = Math.max(lit, fp.zlit[z]);
    else lit = fp.lit[i];
    if (lit <= 0.01) continue;
    ctx.globalAlpha = base + (1 - base) * lit;
    ctx.beginPath();
    addRect(ctx, R, KEYS[i], gapPx, radius);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
