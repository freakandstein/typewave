#!/usr/bin/env node
// Membuat src/data/brain.js: siluet otak (tampak samping, menghadap kiri) dan lipatan korteks dari pola
// reaksi-difusi Gray-Scott yang dibatasi siluet. Deterministik untuk seed yang sama.
// Pakai: node tools/gen_brain.mjs [--seed 7] [--out src/data/brain.js] [--svg pratinjau.svg]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = Number(opt('seed', 7));
const OUT = path.resolve(opt('out', path.join(ROOT, 'src/data/brain.js')));
const SVG = opt('svg', null);

// Kotak desain (satuan bebas; digambar dengan skala pada waktu render).
const W = 1000;
const H = 660;
const CELL = Number(opt('cell', 6)); // satuan desain per sel simulasi
const NX = Math.ceil(W / CELL);
const NY = Math.ceil(H / CELL);
const STEPS = Number(opt('steps', 9000));
const GS = { Du: 0.16, Dv: 0.08, F: Number(opt('F', 0.029)), K: Number(opt('K', 0.057)) };
const LEVEL = Number(opt('level', 0.5));
const MARGIN = Number(opt('margin', 3)); // jarak lipatan dari kontur luar
const DILATE = CELL * 1.2; // domain simulasi sedikit lebih lebar dari siluet, lalu garis dipotong tepat di kontur
const WALL_SYL = 8;
const WALL_CEN = 6;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);

// --- geometri dasar -----------------------------------------------------------
function spline(pts, closed, per = 14) {
  const n = pts.length;
  const out = [];
  const get = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1); const p1 = get(i); const p2 = get(i + 1); const p3 = get(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per; const t2 = t * t; const t3 = t2 * t;
      const f = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  if (!closed) out.push([...pts[n - 1]]);
  return out;
}

function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distPoly(poly, x, y, closed) {
  let m = Infinity;
  const n = poly.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = poly[i]; const b = poly[(i + 1) % n];
    m = Math.min(m, distSeg(x, y, a[0], a[1], b[0], b[1]));
  }
  return m;
}

// --- bentuk: cerebrum, cerebellum, batang otak, dua celah utama -------------------
const CEREBRUM = spline([
  [45, 300], [70, 205], [140, 125], [250, 70], [390, 40], [540, 32], [690, 48], [820, 100], [910, 185], [955, 285],
  [935, 370], [880, 420], [790, 440], [700, 452], [630, 470], [560, 492], [470, 500], [375, 506], [290, 490],
  [225, 450], [185, 400], [120, 375],
], true);
const CEREBELLUM = spline([
  [655, 520], [700, 462], [790, 448], [885, 462], [940, 505], [925, 560], [850, 600], [760, 607], [690, 585],
], true);
const STEM = spline([
  [575, 486], [640, 474], [660, 535], [650, 590], [632, 640], [588, 642], [584, 590], [568, 540],
], true);
const SYLVIAN = spline([[212, 428], [300, 398], [400, 384], [500, 352], [590, 312], [660, 268]], false);
const CENTRAL = spline([[566, 34], [548, 110], [522, 190], [504, 256], [496, 322], [500, 350]], false);

// --- reaksi-difusi di dalam cerebrum --------------------------------------------------
const inside = new Uint8Array(NX * NY);
for (let j = 0; j < NY; j++) {
  for (let i = 0; i < NX; i++) {
    const x = (i + 0.5) * CELL;
    const y = (j + 0.5) * CELL;
    const near = inPoly(CEREBRUM, x, y) || distPoly(CEREBRUM, x, y, true) <= DILATE;
    inside[j * NX + i] = near
      && distPoly(SYLVIAN, x, y, false) >= WALL_SYL
      && distPoly(CENTRAL, x, y, false) >= WALL_CEN ? 1 : 0;
  }
}
const cellOf = new Int32Array(NX * NY).fill(-1);
const cells = [];
for (let k = 0; k < inside.length; k++) if (inside[k]) { cellOf[k] = cells.length; cells.push(k); }
const nb = new Int32Array(cells.length * 4);
cells.forEach((k, c) => {
  const i = k % NX; const j = (k - i) / NX;
  [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].forEach(([a, b], d) => {
    const ok = a >= 0 && a < NX && b >= 0 && b < NY && inside[b * NX + a];
    nb[c * 4 + d] = ok ? cellOf[b * NX + a] : c; // tanpa fluks lewat dinding
  });
});

let U = new Float32Array(cells.length).fill(1);
let V = new Float32Array(cells.length);
let U2 = new Float32Array(cells.length);
let V2 = new Float32Array(cells.length);
for (let s = 0; s < 34; s++) {
  const c = Math.floor(rand() * cells.length);
  for (const q of [c, nb[c * 4], nb[c * 4 + 1], nb[c * 4 + 2], nb[c * 4 + 3]]) { U[q] = 0.5; V[q] = 0.25; }
}
for (let c = 0; c < cells.length; c++) V[c] += rand() * 0.01;
for (let step = 0; step < STEPS; step++) {
  for (let c = 0; c < cells.length; c++) {
    const u = U[c]; const v = V[c];
    const b = c * 4;
    const lu = U[nb[b]] + U[nb[b + 1]] + U[nb[b + 2]] + U[nb[b + 3]] - 4 * u;
    const lv = V[nb[b]] + V[nb[b + 1]] + V[nb[b + 2]] + V[nb[b + 3]] - 4 * v;
    const r = u * v * v;
    U2[c] = u + GS.Du * lu - r + GS.F * (1 - u);
    V2[c] = v + GS.Dv * lv + r - (GS.F + GS.K) * v;
  }
  [U, U2] = [U2, U];
  [V, V2] = [V2, V];
}

// --- kontur (marching squares) -> garis --------------------------------------------------
let vmin = Infinity; let vmax = -Infinity;
for (const v of V) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
const level = vmin + LEVEL * (vmax - vmin);
const val = (i, j) => { const c = cellOf[j * NX + i]; return c < 0 ? NaN : V[c]; };
const px = (i) => (i + 0.5) * CELL;

const nodes = new Map(); // id sisi -> [x, y]
const adj = new Map(); // id sisi -> [id sisi]
const hId = (i, j) => (j * NX + i) * 2; // sisi mendatar (i,j)-(i+1,j)
const vId = (i, j) => (j * NX + i) * 2 + 1; // sisi tegak (i,j)-(i,j+1)
const lerpAt = (a, b) => (level - a) / (b - a);
function node(id, x, y) { if (!nodes.has(id)) nodes.set(id, [x, y]); return id; }
function link(a, b) {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push(b);
  adj.get(b).push(a);
}
for (let j = 0; j < NY - 1; j++) {
  for (let i = 0; i < NX - 1; i++) {
    const tl = val(i, j); const tr = val(i + 1, j); const br = val(i + 1, j + 1); const bl = val(i, j + 1);
    if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(br) || Number.isNaN(bl)) continue;
    const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const T = () => node(hId(i, j), px(i) + lerpAt(tl, tr) * CELL, px(j));
    const B = () => node(hId(i, j + 1), px(i) + lerpAt(bl, br) * CELL, px(j + 1));
    const L = () => node(vId(i, j), px(i), px(j) + lerpAt(tl, bl) * CELL);
    const R = () => node(vId(i + 1, j), px(i + 1), px(j) + lerpAt(tr, br) * CELL);
    const centerHigh = (tl + tr + br + bl) / 4 > level;
    switch (code) {
      case 1: case 14: link(L(), B()); break;
      case 2: case 13: link(B(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(T(), R()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), T()); break;
      case 5: if (centerHigh) { link(L(), T()); link(B(), R()); } else { link(L(), B()); link(T(), R()); } break;
      case 10: if (centerHigh) { link(T(), R()); link(L(), B()); } else { link(L(), T()); link(B(), R()); } break;
      default: break;
    }
  }
}

function trace() {
  const seen = new Set();
  const lines = [];
  const walk = (start, closedHint) => {
    const pts = [];
    let prev = -1;
    let cur = start;
    for (;;) {
      seen.add(cur);
      pts.push(nodes.get(cur));
      const next = adj.get(cur).find((n) => n !== prev && !seen.has(n));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    lines.push({ closed: closedHint && adj.get(cur).includes(start) && pts.length > 2, pts });
  };
  for (const [id, ns] of adj) if (ns.length === 1 && !seen.has(id)) walk(id, false);
  for (const id of adj.keys()) if (!seen.has(id)) walk(id, true);
  return lines;
}

function chaikin(pts, closed, rounds) {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const out = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i]; const b = p[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0]; const [bx, by] = pts[pts.length - 1];
  let m = -1; let mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distSeg(pts[i][0], pts[i][1], ax, ay, bx, by);
    if (d > m) { m = d; mi = i; }
  }
  if (m <= eps) return [pts[0], pts[pts.length - 1]];
  return [...dp(pts.slice(0, mi + 1), eps).slice(0, -1), ...dp(pts.slice(mi), eps)];
}
function simplify(pts, closed, eps) {
  if (!closed) return dp(pts, eps);
  let far = 1; let m = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > m) { m = d; far = i; } }
  const a = dp(pts.slice(0, far + 1), eps);
  const b = dp([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const length = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const clampXY = (p) => [Math.max(0, Math.min(W, Math.round(p[0]))), Math.max(0, Math.min(H, Math.round(p[1])))];
function pack(pts, closed, tag) {
  const q = [];
  for (const p of pts.map(clampXY)) if (!q.length || q[q.length - 1][0] !== p[0] || q[q.length - 1][1] !== p[1]) q.push(p);
  if (closed && q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop();
  return tag ? { closed, tag, pts: q.flat() } : { closed, pts: q.flat() };
}

// Titik sah: di dalam siluet dengan margin kecil dan di luar dinding celah.
const valid = (p) => inPoly(CEREBRUM, p[0], p[1]) && distPoly(CEREBRUM, p[0], p[1], true) >= MARGIN
  && distPoly(SYLVIAN, p[0], p[1], false) >= WALL_SYL - 1 && distPoly(CENTRAL, p[0], p[1], false) >= WALL_CEN - 1;
function cross(a, b) { // a sah, b tidak: cari titik batas dengan bagi dua
  let lo = 0; let hi = 1;
  for (let k = 0; k < 14; k++) {
    const t = (lo + hi) / 2;
    if (valid([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) lo = t; else hi = t;
  }
  return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
}
function clipRuns(pts, closed) {
  const flags = pts.map(valid);
  if (flags.every(Boolean)) return [{ closed, pts }];
  let seq = pts; let f = flags;
  if (closed) { // putar sampai titik pertama tidak sah, lalu tutup supaya run terakhir ikut
    const k = flags.indexOf(false);
    seq = [...pts.slice(k), ...pts.slice(0, k), pts[k]];
    f = seq.map(valid);
  }
  const runs = [];
  let cur = null;
  for (let i = 0; i < seq.length; i++) {
    if (f[i]) {
      if (!cur) { cur = []; if (i > 0) cur.push(cross(seq[i], seq[i - 1])); }
      cur.push(seq[i]);
    } else if (cur) {
      cur.push(cross(seq[i - 1], seq[i]));
      runs.push({ closed: false, pts: cur });
      cur = null;
    }
  }
  if (cur) runs.push({ closed: false, pts: cur });
  return runs;
}

const folds = [];
for (const l of trace()) {
  const smooth = chaikin(l.pts, l.closed, 2);
  for (const run of clipRuns(smooth, l.closed)) {
    const s = simplify(run.pts, run.closed, 0.6);
    if (length(s) < 36 || s.length < (run.closed ? 3 : 2)) continue;
    folds.push(pack(s, run.closed));
  }
}

// folia cerebellum: busur sejajar yang melengkung ke bawah
{
  const cx = 795; const cy = 530; const rx = 140; const ry = 72;
  for (let s = -0.62; s <= 0.7; s += 0.2) {
    const hx = rx * Math.sqrt(1 - s * s) * 0.9;
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const x = cx - hx + 2 * hx * t;
      pts.push([x, cy + s * ry + 11 * Math.sin(Math.PI * t) - 4]);
    }
    folds.push(pack(pts, false, 'cb')); // 'cb' = otak kecil: tidak ikut kelompok gelombang
  }
}

const outline = [
  pack(CEREBRUM.filter((_, i) => i % 2 === 0), true),
  pack(CEREBELLUM.filter((_, i) => i % 2 === 0), true),
  pack(STEM.filter((_, i) => i % 2 === 0), true),
  pack(SYLVIAN.filter((_, i) => i % 2 === 0), false),
  pack(CENTRAL.filter((_, i) => i % 2 === 0), false),
];

if (folds.length < 30) { // pola mati untuk seed ini: jangan menulis aset kosong
  console.error(`pola lipatan tidak terbentuk (${folds.length} garis). Coba seed lain: --seed <n>`);
  process.exit(1);
}

// --- keluaran ---------------------------------------------------------------------------------
const line = (l) => `    { closed: ${l.closed}, ${l.tag ? `tag: '${l.tag}', ` : ''}pts: [${l.pts.join(',')}] },`;
const js = `// Dihasilkan oleh tools/gen_brain.mjs (seed ${SEED}, F ${GS.F}, K ${GS.K}). Jangan diedit tangan: jalankan ulang generatornya.
// Siluet otak tampak samping (menghadap kiri) dan lipatan korteks, dalam kotak desain ${W}x${H}.
export const BRAIN = {
  w: ${W},
  h: ${H},
  outline: [
${outline.map(line).join('\n')}
  ],
  folds: [
${folds.map(line).join('\n')}
  ],
};
`;
fs.writeFileSync(OUT, js);
const total = [...outline, ...folds].reduce((n, l) => n + l.pts.length / 2, 0);
console.log(`ditulis ${path.relative(ROOT, OUT)}: ${outline.length} kontur, ${folds.length} lipatan, ${total} titik, ${(js.length / 1024).toFixed(0)} KB`);

if (SVG) {
  const poly = (l, w, o) => {
    const p = [];
    for (let i = 0; i < l.pts.length; i += 2) p.push(`${l.pts[i]},${l.pts[i + 1]}`);
    return `<polyline points="${p.join(' ')}${l.closed ? ` ${l.pts[0]},${l.pts[1]}` : ''}" fill="none" stroke="#8ED8D0" stroke-width="${w}" stroke-opacity="${o}" stroke-linejoin="round" stroke-linecap="round"/>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 ${W + 40} ${H + 40}" width="${W + 40}" height="${H + 40}"><rect x="-20" y="-20" width="${W + 40}" height="${H + 40}" fill="#0F2B33"/>${folds.map((l) => poly(l, 2.4, 0.7)).join('')}${outline.map((l) => poly(l, 3.2, 0.95)).join('')}</svg>`;
  fs.writeFileSync(path.resolve(SVG), svg);
  console.log(`pratinjau SVG: ${SVG}`);
}
