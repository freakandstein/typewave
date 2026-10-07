#!/usr/bin/env node
// Membuat src/data/brain.js: otak 3D dari garis tipis (spec 6.4). Lipatan korteks = garis batas pola labirin reaksi-difusi Gray-Scott
// yang dijalankan pada jaring bola (icosphere), lalu jaringnya dibentuk menjadi dua belahan otak dan garis batasnya diambil dengan
// marching triangles. Ditambah dua celah utama per belahan, otak kecil (irisan elipsoid), dan batang otak (cincin dan garis memanjang).
// Deterministik untuk seed dan versi Node yang sama. Memakan sekitar 30 detik pada level 7.
// Pakai: node tools/gen_brain.mjs [--seed 7] [--level 7] [--tol 0.003] [--max-len 0.9] [--out src/data/brain.js]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PITCH, viewOf, perspK, projectInto } from '../src/core/orbit.js';
import { POS_Q, NRM_Q } from '../src/data/brain-decode.js';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = Number(opt('seed', 7));
const OUT = path.resolve(opt('out', path.join(ROOT, 'src/data/brain.js')));

// Satuan model: panjang otak (depan-belakang) = 2. Sumbu: x kiri-kanan, y depan (+) ke belakang (-), z atas.
const P = {
  level: Number(opt('level', 7)), // subdivisi icosphere: 163.842 simpul per belahan pada level 7
  steps: Number(opt('steps', 6500)), // langkah reaksi-difusi Gray-Scott pada permukaan bola
  f: 0.029, k: 0.057, Du: 0.2097, Dv: 0.105, // "mazes" (Karl Sims): labirin bergelombang seperti lipatan korteks
  boxy: 2.7, // eksponen superelipsoid: makin besar makin membulat-kotak (otak, bukan telur)
  tol: Number(opt('tol', 0.003)), // toleransi penyederhanaan garis (satuan model)
  minLen: 0.11, // buang garis lebih pendek daripada ini
  maxLen: Number(opt('max-len', 0.9)), // pecah lipatan yang lebih panjang menjadi bagian sama panjang (0,9 satuan model = sekitar 400 satuan desain)
  medialCut: -0.80, // buang garis di sisi medial yang rata (celah antar belahan)
  stemBottom: Number(opt('stem-bottom', -0.70)), // ujung bawah batang otak (z)
};
const BOX_W = 1000; // lebar kotak desain; tingginya dihitung dari rentang proyeksi
const FILL = 0.96; // otak memakai paling banyak segini dari kotak di sudut putar mana pun

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(SEED * 7919 + 13);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rng(); return (s - 3) / Math.sqrt(0.5); };
const randDir = () => { for (;;) { const v = [gauss(), gauss(), gauss()]; const l = Math.hypot(...v); if (l > 1e-6) return [v[0] / l, v[1] / l, v[2] / l]; } };

// --- icosphere
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  const base = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const V = base.map((v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map();
    const NF = [];
    const mid = (a, b) => {
      const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      let m = cache.get(k);
      if (m === undefined) {
        const p = [(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2];
        const len = Math.hypot(...p);
        m = V.push([p[0] / len, p[1] / len, p[2] / len]) - 1;
        cache.set(k, m);
      }
      return m;
    };
    for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); NF.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = NF;
  }
  return { V, F };
}

// --- bentuk satu belahan otak dari arah satuan u (s = +1 kanan, -1 kiri)
const CENTER = (s) => [s * 0.195, 0, 0.30];
function shapeHemi(u0, s) {
  const pw = P.boxy;
  const mm = Math.pow(Math.abs(u0[0]) ** pw + Math.abs(u0[1]) ** pw + Math.abs(u0[2]) ** pw, 1 / pw) || 1;
  const [ux, uy, uz] = [u0[0] / mm, u0[1] / mm, u0[2] / mm];
  const lat = s * ux; // + lateral, - medial
  const latS = lat < 0 ? lat * 0.28 : lat; // sisi medial dipipihkan
  const front = Math.max(0, uy), back = Math.max(0, -uy);
  const wScale = 1 - 0.17 * front * front - 0.04 * back * back; // kutub frontal lebih sempit
  const hScale = 1 - 0.10 * front * front;
  const zz = uz < 0 ? uz * 0.86 : uz; // sisi bawah lebih datar
  let x = s * (0.195 + latS * 0.625 * wScale);
  const y = uy * 1.0;
  let z = 0.29 + zz * 0.64 * hScale;
  // lobus temporal: tonjolan ke bawah dan ke luar di bagian bawah-lateral tengah
  const tb = Math.max(0, lat) * Math.max(0, -uz) * Math.exp(-(((uy - 0.08) / 0.5) ** 2));
  z -= 0.21 * tb;
  x += s * 0.06 * tb;
  // sisi bawah belakang diangkat supaya ada tempat untuk otak kecil
  const bl = Math.max(0, -uy - 0.30) / 0.70;
  if (uz < 0) z += 0.22 * bl * (-uz) * (0.6 + 0.4 * Math.max(0, 1 - Math.abs(lat)));
  // lobus frontal sedikit menjorok ke bawah di depan
  if (uz < 0 && uy > 0.4) z -= 0.05 * (uy - 0.4) * (-uz);
  return [x, y, z];
}

// --- reaksi-difusi Gray-Scott pada jaring bola satuan (graf Laplacian seragam; segitiga: Laplacian = (2/3) * jumlah selisih tetangga)
function adjacency(F, nV) {
  const seen = new Set();
  const nb = Array.from({ length: nV }, () => []);
  for (const [a, b, c] of F) for (const [x, y] of [[a, b], [b, c], [c, a]]) {
    const key = x < y ? x * nV + y : y * nV + x;
    if (seen.has(key)) continue;
    seen.add(key); nb[x].push(y); nb[y].push(x);
  }
  const off = new Int32Array(nV + 1);
  for (let i = 0; i < nV; i++) off[i + 1] = off[i] + nb[i].length;
  const idx = new Int32Array(off[nV]);
  for (let i = 0; i < nV; i++) idx.set(nb[i], off[i]);
  return { off, idx };
}
function grayScott(adj, nV) {
  const { off, idx } = adj;
  let u = new Float32Array(nV).fill(1), v = new Float32Array(nV);
  let u2 = new Float32Array(nV), v2 = new Float32Array(nV);
  for (let i = 0; i < nV; i++) if (rng() < 0.04) { v[i] = 0.25 + 0.25 * rng(); u[i] = 0.5; }
  const { f, k, Du, Dv } = P, c = 2 / 3;
  for (let step = 0; step < P.steps; step++) {
    for (let i = 0; i < nV; i++) {
      let su = 0, sv = 0;
      const e0 = off[i], e1 = off[i + 1];
      for (let e = e0; e < e1; e++) { const j = idx[e]; su += u[j]; sv += v[j]; }
      const deg = e1 - e0, ui = u[i], vi = v[i], uvv = ui * vi * vi;
      u2[i] = ui + Du * c * (su - deg * ui) - uvv + f * (1 - ui);
      v2[i] = vi + Dv * c * (sv - deg * vi) + uvv - (f + k) * vi;
    }
    [u, u2] = [u2, u]; [v, v2] = [v2, v];
  }
  return v;
}

// --- satu belahan: jaring, normal, garis batas pola (kontur di titik tengah nilai v)
const ico = icosphere(P.level);
const adj = adjacency(ico.F, ico.V.length);
function buildHemisphere(s) {
  const nV = ico.V.length;
  const t0 = Date.now();
  const rdv = grayScott(adj, nV);
  let vmin = Infinity, vmax = -Infinity;
  for (let i = 0; i < nV; i++) { if (rdv[i] < vmin) vmin = rdv[i]; if (rdv[i] > vmax) vmax = rdv[i]; }
  const thr = 0.5 * (vmin + vmax);
  console.log(`  reaksi-difusi ${((Date.now() - t0) / 1000).toFixed(1)} s, v ${vmin.toFixed(3)}..${vmax.toFixed(3)}`);
  const pos = new Float64Array(nV * 3), lat = new Float64Array(nV), val = new Float64Array(nV);
  for (let i = 0; i < nV; i++) {
    const q = shapeHemi(ico.V[i], s);
    pos[3 * i] = q[0]; pos[3 * i + 1] = q[1]; pos[3 * i + 2] = q[2];
    lat[i] = s * ico.V[i][0];
  }
  // sedikit ketidakteraturan organik pada permukaan (sepanjang arah dari pusat)
  const c = CENTER(s);
  const bumps = Array.from({ length: 10 }, () => ({ d: randDir(), ph: rng() * 6.283 }));
  for (let i = 0; i < nV; i++) {
    let n = 0;
    for (const b of bumps) n += Math.cos(3.2 * (b.d[0] * pos[3 * i] + b.d[1] * pos[3 * i + 1] + b.d[2] * pos[3 * i + 2]) * Math.PI + b.ph);
    n /= bumps.length;
    const dx = pos[3 * i] - c[0], dy = pos[3 * i + 1] - c[1], dz = pos[3 * i + 2] - c[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    const amp = 0.022 * n * (lat[i] > -0.3 ? 1 : 0.2);
    pos[3 * i] += (dx / l) * amp; pos[3 * i + 1] += (dy / l) * amp; pos[3 * i + 2] += (dz / l) * amp;
  }
  const nrm = new Float64Array(nV * 3);
  for (const [a, b, cc] of ico.F) {
    const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
    const ux = pos[3 * b] - ax, uy = pos[3 * b + 1] - ay, uz = pos[3 * b + 2] - az;
    const vx = pos[3 * cc] - ax, vy = pos[3 * cc + 1] - ay, vz = pos[3 * cc + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, cc]) { nrm[3 * i] += nx; nrm[3 * i + 1] += ny; nrm[3 * i + 2] += nz; }
  }
  for (let i = 0; i < nV; i++) {
    const l = Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]) || 1;
    let nx = nrm[3 * i] / l, ny = nrm[3 * i + 1] / l, nz = nrm[3 * i + 2] / l;
    const dot = nx * (pos[3 * i] - c[0]) + ny * (pos[3 * i + 1] - c[1]) + nz * (pos[3 * i + 2] - c[2]);
    if (dot < 0) { nx = -nx; ny = -ny; nz = -nz; } // normal selalu menghadap ke luar
    nrm[3 * i] = nx; nrm[3 * i + 1] = ny; nrm[3 * i + 2] = nz;
  }
  for (let i = 0; i < nV; i++) val[i] = rdv[i] - thr;

  // titik potong pada sisi jaring
  const edgePt = new Map();
  const pts = []; // [x, y, z, nx, ny, nz, lat]
  const crossing = (a, b) => {
    const key = a < b ? a * nV + b : b * nV + a;
    let id = edgePt.get(key);
    if (id !== undefined) return id;
    const t = val[a] / (val[a] - val[b]);
    const m = (k) => pos[3 * a + k] + t * (pos[3 * b + k] - pos[3 * a + k]);
    const mn = (k) => nrm[3 * a + k] + t * (nrm[3 * b + k] - nrm[3 * a + k]);
    const nx = mn(0), ny = mn(1), nz = mn(2);
    const l = Math.hypot(nx, ny, nz) || 1;
    id = pts.length;
    pts.push([m(0), m(1), m(2), nx / l, ny / l, nz / l, lat[a] + t * (lat[b] - lat[a])]);
    edgePt.set(key, id);
    return id;
  };
  const adjA = [], adjB = [];
  const link = (e1, e2) => {
    if (pts[e1][6] < P.medialCut || pts[e2][6] < P.medialCut) return;
    while (adjA.length < pts.length) { adjA.push(-1); adjB.push(-1); }
    if (adjA[e1] < 0) adjA[e1] = e2; else adjB[e1] = e2;
    if (adjA[e2] < 0) adjA[e2] = e1; else adjB[e2] = e1;
  };
  for (const [a, b, cc] of ico.F) {
    const sa = val[a] > 0, sb = val[b] > 0, sc = val[cc] > 0;
    if (sa === sb && sb === sc) continue;
    let p, q, r;
    if (sa !== sb && sa !== sc) { p = a; q = b; r = cc; } else if (sb !== sa && sb !== sc) { p = b; q = cc; r = a; } else { p = cc; q = a; r = b; }
    link(crossing(p, q), crossing(p, r));
  }
  while (adjA.length < pts.length) { adjA.push(-1); adjB.push(-1); }

  // rangkai segmen menjadi garis
  const visited = new Uint8Array(pts.length);
  const deg = (i) => (adjA[i] >= 0 ? 1 : 0) + (adjB[i] >= 0 ? 1 : 0);
  const walk = (start, loop) => {
    const out = [start];
    visited[start] = 1;
    let prev = -1, cur = start;
    for (;;) {
      let next = -1;
      for (const x of [adjA[cur], adjB[cur]]) if (x >= 0 && x !== prev && !visited[x]) { next = x; break; }
      if (next < 0) { if (loop) out.push(start); break; }
      out.push(next); visited[next] = 1; prev = cur; cur = next;
    }
    return out;
  };
  const chains = [];
  for (let i = 0; i < pts.length; i++) if (!visited[i] && deg(i) === 1) chains.push(walk(i, false));
  for (let i = 0; i < pts.length; i++) if (!visited[i] && deg(i) === 2) chains.push(walk(i, true));
  return { pts, chains };
}

// --- penyederhanaan Douglas-Peucker dan panjang
function distSeg(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz || 1e-12;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / l2));
  return Math.hypot(apx - t * abx, apy - t * aby, apz - t * abz);
}
function simplify(idx, pts, tol) {
  const n = idx.length;
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [i, j] = st.pop();
    let md = 0, mk = -1;
    for (let k = i + 1; k < j; k++) { const d = distSeg(pts[idx[k]], pts[idx[i]], pts[idx[j]]); if (d > md) { md = d; mk = k; } }
    if (md > tol && mk > 0) { keep[mk] = 1; st.push([i, mk], [mk, j]); }
  }
  return idx.filter((_, k) => keep[k]);
}
// Memecah garis panjang menjadi bagian sama panjang (paling banyak maxLen). Garis labirin di permukaan otak bisa sepanjang belasan kali panjang
// otak; dibiarkan utuh, satu garis theta saja menutupi seluruh belahan dan "lipatan di dekatnya" tidak lagi lokal. Geometrinya tidak berubah:
// titik potong diinterpolasi (posisi dan normal) dan dipakai bersama oleh dua bagian yang bersebelahan.
function splitLine(pts, maxLen) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.ceil(total / maxLen));
  if (n === 1) return [pts];
  const at = (arc) => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < arc) k++;
    const t = (arc - cum[k - 1]) / Math.max(1e-12, cum[k] - cum[k - 1]);
    const q = pts[k - 1].map((v, c) => v + (pts[k][c] - v) * t);
    const l = Math.hypot(q[3], q[4], q[5]) || 1;
    q[3] /= l; q[4] /= l; q[5] /= l;
    return q;
  };
  const out = [];
  for (let part = 0; part < n; part++) {
    const s0 = (part / n) * total;
    const s1 = ((part + 1) / n) * total;
    const piece = [part === 0 ? pts[0] : at(s0)];
    for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 + 1e-9 && cum[i] < s1 - 1e-9) piece.push(pts[i]);
    piece.push(part === n - 1 ? pts[pts.length - 1] : at(s1));
    out.push(piece);
  }
  return out;
}
const plen = (idx, pts) => { let L = 0; for (let k = 1; k < idx.length; k++) L += Math.hypot(pts[idx[k]][0] - pts[idx[k - 1]][0], pts[idx[k]][1] - pts[idx[k - 1]][1], pts[idx[k]][2] - pts[idx[k - 1]][2]); return L; };

// --- semua garis, dalam satuan model: {k, p: [[x,y,z]...], n: [[nx,ny,nz]...]}; k 0 lipatan, 1 celah utama, 2 otak kecil, 3 batang otak
const lines = [];   // {k, p: [[x,y,z]...], n: [[nx,ny,nz]...], chain}: k 0 lipatan, 1 celah utama, 2 otak kecil, 3 batang otak; chain = garis utuh asal
let nextChain = 0;
const pushLine = (k, p, n, chain = nextChain++) => lines.push({ k, p, n, chain });

for (const s of [1, -1]) {
  const h = buildHemisphere(s);
  let kept = 0;
  for (const ch of h.chains) {
    const idx = simplify(ch, h.pts, P.tol);
    if (idx.length < 2 || plen(idx, h.pts) < P.minLen) continue;
    const chain = nextChain++;
    for (const piece of splitLine(idx.map((i) => h.pts[i]), P.maxLen)) pushLine(0, piece.map((q) => q.slice(0, 3)), piece.map((q) => q.slice(3, 6)), chain);
    kept++;
  }
  console.log(`belahan ${s > 0 ? 'kanan' : 'kiri'}: simpul ${ico.V.length}, rangkaian ${h.chains.length}, dipakai ${kept}`);

  // celah utama: Sylvian (lateral) dan sentral, dipetakan lewat bentuk belahan lalu digeser sedikit ke luar
  const place = (u) => {
    const q = shapeHemi(u, s);
    const c = CENTER(s);
    const d = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    const l = Math.hypot(...d) || 1;
    const n = [d[0] / l, d[1] / l, d[2] / l];
    return { p: [q[0] + n[0] * 0.006, q[1] + n[1] * 0.006, q[2] + n[2] * 0.006], n };
  };
  const dirOf = (lat, y, z) => { const l = Math.hypot(lat, y, z); return [s * lat / l, y / l, z / l]; };
  const sylv = [], cent = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    sylv.push(place(dirOf(0.92 - 0.10 * t, 0.66 - 1.08 * t, -0.46 + 0.62 * t + 0.16 * Math.sin(t * Math.PI * 2) + 0.18 * t * t)));
    cent.push(place(dirOf(0.10 + 0.85 * t, 0.16 - 0.20 * t + 0.16 * Math.sin(t * Math.PI * 2), 0.98 - 0.66 * t)));
  }
  for (const L of [sylv, cent]) pushLine(1, L.map((q) => q.p), L.map((q) => q.n));
}

// otak kecil: irisan datar elipsoid (garis sejajar)
{
  const C = [0, -0.66, -0.27], A = [0.47, 0.33, 0.26];
  const M = 15;
  for (let k = 0; k < M; k++) {
    const zf = -0.88 + (1.76 * k) / (M - 1);
    const r = Math.sqrt(1 - zf * zf);
    const pts = [], nrm = [];
    for (let i = 0; i <= 72; i++) {
      const th = (i / 72) * Math.PI * 2;
      const wob = 1 + 0.035 * Math.sin(5 * th + k * 1.7) + 0.02 * Math.sin(11 * th + k);
      const ex = r * Math.cos(th) * wob, ey = r * Math.sin(th) * wob;
      pts.push([C[0] + A[0] * ex, C[1] + A[1] * ey, C[2] + A[2] * zf]);
      const nx = ex / A[0], ny = ey / A[1], nz = zf / A[2], l = Math.hypot(nx, ny, nz) || 1;
      nrm.push([nx / l, ny / l, nz / l]);
    }
    pushLine(2, pts, nrm);
  }
}
// batang otak: cincin dan garis memanjang
{
  const top = [0, -0.22, -0.02], bot = [0, -0.40, P.stemBottom];
  const ringsN = 6, segs = 48;
  const centerAt = (t) => [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t];
  const radAt = (t) => 0.135 - 0.04 * t + 0.01 * Math.sin(t * 3);
  for (let k = 0; k < ringsN; k++) {
    const t = k / (ringsN - 1), c = centerAt(t), r = radAt(t);
    const pts = [], nrm = [];
    for (let i = 0; i <= segs; i++) { const th = (i / segs) * Math.PI * 2; pts.push([c[0] + r * Math.cos(th), c[1] + r * 0.9 * Math.sin(th), c[2]]); nrm.push([Math.cos(th), Math.sin(th), 0]); }
    pushLine(3, pts, nrm);
  }
  for (let j = 0; j < 3; j++) {
    const th = (j / 3) * Math.PI * 2 + 0.5, pts = [], nrm = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12, c = centerAt(t), r = radAt(t); pts.push([c[0] + r * Math.cos(th), c[1] + r * 0.9 * Math.sin(th), c[2]]); nrm.push([Math.cos(th), Math.sin(th), 0]); }
    pushLine(3, pts, nrm);
  }
}

const folds = lines.filter((l) => l.k === 0).length;
if (folds < 60) { // pola mati untuk seed ini: jangan menulis aset yang tidak terbaca sebagai otak
  console.error(`pola lipatan tidak terbentuk (${folds} garis). Coba seed lain: --seed <n>`);
  process.exit(1);
}
lines.sort((a, b) => a.k - b.k); // stabil: tiap jenis menempati satu rentang

// --- kotak desain: rentang proyeksi di semua sudut putar (dalam satuan model; perspektif tidak bergantung pada skala)
const all = lines.flatMap((l) => l.p);
function extents(zShift) {
  const X = new Float64Array(1), Y = new Float64Array(1), D = new Float64Array(1);
  const kp = perspK(1);
  let half = 0, upMin = Infinity, upMax = -Infinity;
  for (let a = 0; a < 360; a++) {
    const v = viewOf((a / 360) * 2 * Math.PI, PITCH);
    for (const q of all) {
      projectInto(v, kp, q[0], q[1], q[2] - zShift, X, Y, D, 0);
      half = Math.max(half, Math.abs(X[0]));
      upMin = Math.min(upMin, Y[0]); upMax = Math.max(upMax, Y[0]);
    }
  }
  return { half, upMin, upMax };
}
let zShift = 0;
let ext = extents(zShift);
for (let i = 0; i < 6; i++) { // pusatkan secara vertikal: sumbu putar di tengah rentang atas-bawah
  zShift += (ext.upMax + ext.upMin) / 2 / Math.cos(PITCH);
  ext = extents(zShift);
}
const unit = (BOX_W / 2 * FILL) / ext.half; // satuan desain per satuan model
const boxH = Math.ceil(((ext.upMax - ext.upMin) * unit) / FILL);

// --- keluaran: posisi Int16 (1/32 satuan desain), normal Int8 (1/100)
const n = lines.reduce((s, l) => s + l.p.length, 0);
const pos = new DataView(new ArrayBuffer(n * 6));
const nrmB = new Int8Array(n * 3);
let o = 0;
for (const l of lines) {
  for (let i = 0; i < l.p.length; i++, o++) {
    const q = l.p[i];
    const xyz = [q[0] * unit, q[1] * unit, (q[2] - zShift) * unit];
    xyz.forEach((v, c) => {
      const iv = Math.round(v * POS_Q);
      if (iv < -32768 || iv > 32767) throw new Error(`koordinat di luar Int16: ${v}`);
      pos.setInt16(o * 6 + c * 2, iv, true);
    });
    l.n[i].forEach((v, c) => { nrmB[o * 3 + c] = Math.max(-127, Math.min(127, Math.round(v * NRM_Q))); });
  }
}
const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
const chunks = (s, w = 150) => { const a = []; for (let i = 0; i < s.length; i += w) a.push(`    '${s.slice(i, i + w)}',`); return a.join('\n'); };
const js = `// Dihasilkan oleh tools/gen_brain.mjs (seed ${SEED}, level ${P.level}, F ${P.f}, K ${P.k}). Jangan diedit tangan: jalankan ulang generatornya.
// Otak 3D dari garis tipis (spec 6.4). Satuan: desain; pusat putar di (0, 0, 0); sumbu x kiri-kanan, y depan (+) ke belakang (-), z atas.
// Kotak desain w x h memuat otak di setiap sudut putar. Jenis garis: 0 lipatan korteks, 1 celah utama, 2 otak kecil, 3 batang otak.
// chains: nomor garis labirin utuh tiap garis (lipatan yang panjang dipecah jadi beberapa garis berurutan yang berbagi nomor).
// pos: Int16 little-endian per 1/${POS_Q} satuan desain (x, y, z per titik); nrm: Int8 per 1/${NRM_Q} (normal permukaan). Dibuka oleh data/brain-decode.js.
export const BRAIN = {
  w: ${BOX_W},
  h: ${boxH},
  unit: ${unit.toFixed(3)},
  kinds: [${lines.map((l) => l.k).join(',')}],
  counts: [${lines.map((l) => l.p.length).join(',')}],
  chains: [${lines.map((l) => l.chain).join(',')}],
  pos: [
${chunks(b64(new Uint8Array(pos.buffer)))}
  ].join(''),
  nrm: [
${chunks(b64(nrmB))}
  ].join(''),
};
`;
fs.writeFileSync(OUT, js);
let foldSegs = 0;
for (const l of lines) if (l.k === 0) foldSegs += l.p.length - 1;
console.log(`ditulis ${path.relative(ROOT, OUT)}: ${lines.length} garis (${folds} lipatan), ${n} titik, ${foldSegs} segmen lipatan, kotak ${BOX_W}x${boxH}, unit ${unit.toFixed(1)}, ${(js.length / 1024).toFixed(0)} KB`);
