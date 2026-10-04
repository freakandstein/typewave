// Pita (spec 6): ring buffer satu sampel per `spacing` px, digambar sebagai satu poligon dengan gradient
// alpha dari ekor ke kepala. Satu objek gradient dan beberapa string warna per frame diterima.
import { CONFIG } from '../config.js';

export function createRibbon(L, spacing = CONFIG.ribbon.spacing) {
  const n = Math.ceil(L / spacing) + 2;
  return {
    n, spacing, head: 0, headId: 0, count: 0, acc: 0, phase: 0,
    c: new Float32Array(n), t: new Float32Array(n), r: new Float32Array(n),
    na: new Float32Array(n), nb: new Float32Array(n), col: new Float32Array(n * 3),
  };
}

// Indeks sampel dengan id tertentu, atau -1 bila belum ada / sudah tertimpa.
export function ribbonIndex(rb, id) {
  const age = rb.headId - id;
  if (age < 0 || age >= rb.count) return -1;
  return (((rb.head - age) % rb.n) + rb.n) % rb.n;
}

// Offset melintang pita pada posisi s (0 bila di luar buffer).
export function ribbonCAt(rb, s) {
  const a = Math.round((s - rb.acc) / rb.spacing);
  if (a < 0 || a >= rb.count) return 0;
  return rb.c[(((rb.head - a) % rb.n) + rb.n) % rb.n];
}

export function advanceRibbon(rb, dist, p) {
  rb.acc += dist;
  const h = p.harm === undefined ? 0.3 : p.harm; // bobot harmonik: 0 = sinus mulus, makin besar makin patah
  while (rb.acc >= rb.spacing) {
    rb.acc -= rb.spacing;
    rb.phase += (2 * Math.PI * rb.spacing) / p.wavelength;
    const i = (rb.head + 1) % rb.n;
    rb.head = i;
    rb.headId++;
    if (rb.count < rb.n) rb.count++;
    rb.c[i] = p.amp * ((1 - h) * Math.sin(rb.phase) + h * Math.sin(rb.phase * 2.3 + 1.1));
    rb.t[i] = p.thick;
    rb.r[i] = p.rough;
    rb.na[i] = Math.random() * 2 - 1;
    rb.nb[i] = Math.random() * 2 - 1;
    rb.col[i * 3] = p.cr;
    rb.col[i * 3 + 1] = p.cg;
    rb.col[i * 3 + 2] = p.cb;
  }
}

export function prefillRibbon(rb, p) {
  for (let i = 0; i < rb.n; i++) advanceRibbon(rb, rb.spacing, p);
}

const q = (v) => (v < 0 ? 0 : v > 255 ? 255 : v) | 0;
const rgba = (r, g, b, a) => `rgba(${q(r)},${q(g)},${q(b)},${a.toFixed(3)})`;
const STOPS = 12;

export function drawRibbon(ctx, rb, g) {
  const n = rb.count;
  if (n < 2) return;
  const sp = rb.spacing;
  const rough = CONFIG.ribbon.roughMax * g.k;
  const at = (a) => (((rb.head - a) % rb.n) + rb.n) % rb.n;
  let first = true;
  let aTail = 0;
  ctx.beginPath();
  for (let a = n - 1; a >= 0; a--) { // ekor (tertua) -> kepala: tepi pertama
    const s = rb.acc + a * sp;
    if (s > g.L + sp) continue;
    if (first) { aTail = a; }
    const i = at(a);
    const c = g.center + rb.c[i] - rb.t[i] * 0.5 + rb.na[i] * rb.r[i] * rough;
    if (first) { ctx.moveTo(g.x(s, c), g.y(s, c)); first = false; } else ctx.lineTo(g.x(s, c), g.y(s, c));
  }
  for (let a = 0; a <= aTail; a++) { // kepala -> ekor: tepi kedua
    const s = rb.acc + a * sp;
    const i = at(a);
    const c = g.center + rb.c[i] + rb.t[i] * 0.5 + rb.nb[i] * rb.r[i] * rough;
    ctx.lineTo(g.x(s, c), g.y(s, c));
  }
  ctx.closePath();
  const sTail = rb.acc + aTail * sp;
  const grad = ctx.createLinearGradient(g.x(sTail, g.center), g.y(sTail, g.center), g.x(rb.acc, g.center), g.y(rb.acc, g.center));
  const tailA = CONFIG.ribbon.tailAlpha;
  for (let j = 0; j <= STOPS; j++) {
    const f = j / STOPS;
    const i = at(Math.round((1 - f) * aTail));
    grad.addColorStop(f, rgba(rb.col[i * 3], rb.col[i * 3 + 1], rb.col[i * 3 + 2], tailA + (1 - tailA) * f));
  }
  ctx.fillStyle = grad;
  ctx.fill();
}
