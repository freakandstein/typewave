// Ilustrasi otak (spec 6.4): siluet dan lipatan korteks dari data/brain.js, hanya garis dengan alpha dan lebar (tanpa glow, spec 6.1).
// pos mengatur agitasi lipatan, density mengatur terang dasar, tiap ketikan menjalarkan satu percikan, tanpa sinyal otak redup
// dan diam. Ukuran dan terang garis tetap (tidak berdenyut mengikuti detak jantung). Level theta/alpha/beta dari EEG mengatur tiga
// kelompok lipatan (panjang = lambat, pendek = cepat). Ini hiasan, bukan peta aktivitas otak: server EEG tidak mengirim data per area.
// Semua buffer dialokasikan sekali; per frame tidak ada alokasi.
import { CONFIG } from '../config.js';
import { BRAIN } from '../data/brain.js';
import { clamp, lerp, smoothstep } from '../core/color.js';
import { beadU } from '../core/placement.js';
import { allowRep } from './beads.js';

const GX = 10; // kisi gerak: simpul pergeseran, diinterpolasi bilinear ke tiap titik
const GY = 7;
const FADE = 45; // jarak (satuan desain) dari kontur sampai gerak penuh
const TRAIL_MAX = 24;
const SP = CONFIG.brain.spark;
const BND = CONFIG.brain.bands;

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Kelompok menurut panjang: tiap kelompok membawa sepertiga dari panjang total garis. 0 = terpanjang (theta), 1 = sedang (alpha),
// 2 = terpendek (beta). Garis panjang jadi lebih sedikit, garis pendek lebih banyak.
export function assignFamilies(lengths) {
  const n = lengths.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, c) => lengths[c] - lengths[a] || a - c);
  const total = lengths.reduce((s, x) => s + x, 0);
  const out = new Array(n).fill(0);
  let cum = 0;
  for (const i of order) {
    out[i] = total > 0 ? Math.min(2, Math.floor(((cum + lengths[i] / 2) / total) * 3)) : 0;
    cum += lengths[i];
  }
  return out;
}

// Kelompok untuk satu percikan: bobot = lantai + level, jadi kelompok berlevel tinggi lebih sering dipilih dan yang rendah tetap mungkin.
export function pickFamily(levels, r) {
  const w0 = BND.floor + levels[0];
  const w1 = BND.floor + levels[1];
  const x = r * (w0 + w1 + BND.floor + levels[2]);
  return x < w0 ? 0 : x < w0 + w1 ? 1 : 2;
}

export function createBrain(data = BRAIN) {
  const all = [...data.outline, ...data.folds];
  let n = 0;
  for (const l of all) n += l.pts.length / 2;
  const cap = SP.cap;
  const b = {
    data, n, lines: all.length, foldFrom: data.outline.length,
    px: new Float32Array(n), py: new Float32Array(n), sx: new Float32Array(n), sy: new Float32Array(n),
    weight: new Float32Array(n), segLen: new Float32Array(n), lineOf: new Uint16Array(n),
    start: new Uint16Array(all.length), len: new Uint16Array(all.length), closed: new Uint8Array(all.length),
    energy: new Float32Array(all.length), lineMin: new Float32Array(all.length),
    family: new Uint8Array(all.length).fill(255), level: new Float32Array(3).fill(0.5), famAlpha: new Float32Array(4),
    lat: new Float32Array((GX + 1) * (GY + 1) * 2), ph: new Float64Array(6), mot: { amp: 0, speed: 0, rough: 0 },
    repTimes: new Float64Array(CONFIG.beads.rep.perSec).fill(-Infinity), repIdx: 0,
    trail: new Float32Array(TRAIL_MAX * 2),
    spark: {
      cap, count: 0, active: new Uint8Array(cap), line: new Uint16Array(cap), seg: new Uint16Array(cap),
      t: new Float32Array(cap), dir: new Int8Array(cap), age: new Float32Array(cap), life: new Float32Array(cap),
      a: new Float32Array(cap), e: new Float32Array(cap), trailLen: new Float32Array(cap), speed: new Float32Array(cap), fam: new Uint8Array(cap),
    },
  };
  let o = 0;
  all.forEach((l, li) => {
    b.start[li] = o;
    b.len[li] = l.pts.length / 2;
    b.closed[li] = l.closed ? 1 : 0;
    for (let i = 0; i < l.pts.length; i += 2) { b.px[o] = l.pts[i]; b.py[o] = l.pts[i + 1]; b.lineOf[o] = li; o++; }
  });
  for (let li = 0; li < all.length; li++) {
    const s0 = b.start[li];
    const m = b.len[li];
    for (let i = 0; i < m; i++) {
      const j = i + 1 < m ? i + 1 : b.closed[li] ? 0 : i;
      b.segLen[s0 + i] = Math.hypot(b.px[s0 + j] - b.px[s0 + i], b.py[s0 + j] - b.py[s0 + i]);
    }
  }
  // Kelompok tiap lipatan korteks menurut panjangnya; otak kecil (tag 'cb') di luar kelompok (3 = terang tetap).
  if (b.foldFrom < all.length) {
    const idx = [];
    const lens = [];
    for (let li = b.foldFrom; li < all.length; li++) {
      if (all[li].tag === 'cb') { b.family[li] = 3; continue; }
      let t = 0;
      for (let i = 0; i < b.len[li]; i++) t += b.segLen[b.start[li] + i];
      idx.push(li);
      lens.push(t);
    }
    assignFamilies(lens).forEach((f, k) => { b.family[idx[k]] = f; });
  }
  // Bobot gerak: kontur diam; lipatan makin diam makin dekat ke kontur dan celah, supaya bentuk otak tetap utuh.
  const foldStart = b.foldFrom < all.length ? b.start[b.foldFrom] : n;
  for (let i = foldStart; i < n; i++) {
    let d = Infinity;
    for (let li = 0; li < b.foldFrom; li++) {
      const s0 = b.start[li];
      const m = b.len[li];
      for (let k = 0; k < (b.closed[li] ? m : m - 1); k++) {
        const a = s0 + k;
        const c = s0 + ((k + 1) % m);
        d = Math.min(d, distSeg(b.px[i], b.py[i], b.px[a], b.py[a], b.px[c], b.py[c]));
      }
    }
    b.weight[i] = clamp(d / FADE);
  }
  return b;
}

export function brainRect(g) {
  const h = g.brain.h;
  const s = h / BRAIN.h;
  const w = BRAIN.w * s;
  return { x0: g.brain.cx - w / 2, y0: g.brain.cy - h / 2, w, h, s };
}

// Pos 0..1 (tenang ke tegang) -> agitasi lipatan; tanpa sinyal semuanya diam.
export function brainMotion(pos, noSig, out = { amp: 0, speed: 0, rough: 0 }) {
  const M = CONFIG.brain.motion;
  const p = clamp(pos);
  const live = 1 - clamp(noSig);
  out.amp = lerp(M.amp[0], M.amp[1], p) * live;
  out.speed = lerp(M.speed[0], M.speed[1], p) * live;
  out.rough = smoothstep(M.roughFrom, 1, p) * live;
  return out;
}

export function brainStats(b) {
  let lit = 0;
  for (let i = b.foldFrom; i < b.lines; i++) if (b.energy[i] > 0.02) lit++;
  return { sparks: b.spark.count, lit, levels: [b.level[0], b.level[1], b.level[2]] };
}

// --- percikan -------------------------------------------------------------------------------------
export function sparkBrain(b, ann, privacy, now, rand = Math.random) {
  if (ann.cls === 'enter') { // Enter: seluruh lipatan menyala sebentar; Enter ditahan tidak membuatnya berkedip
    if (!ann.rep) for (let i = b.foldFrom; i < b.lines; i++) b.energy[i] = Math.max(b.energy[i], SP.enter);
    return -1;
  }
  let cls;
  if (ann.rep) { if (!allowRep(b, now)) return -1; cls = SP.rep; }
  else if (ann.cls === 'backspace') cls = SP.back;
  else if (ann.code === 'Space') cls = SP.space;
  else if (ann.modifier || ann.cls === 'other') cls = SP.neutral;
  else cls = SP.char;

  // Posisi horizontal mengikuti kolom tombol (aturan privasi sama dengan bead); vertikal acak di dalam otak.
  const tx = (0.07 + 0.86 * beadU(ann.code, privacy, rand)) * b.data.w;
  const ty = (0.1 + 0.62 * rand()) * b.data.h;
  const foldStart = b.foldFrom < b.lines ? b.start[b.foldFrom] : b.n;
  const want = pickFamily(b.level, rand()); // kelompok garis (theta/alpha/beta) menurut level EEG saat ini
  let best = -1;
  let bd = Infinity;
  for (let pass = 0; pass < 2 && best < 0; pass++) { // pass 2 hanya bila kelompok itu tidak punya garis (data khusus)
    for (let i = foldStart; i < b.n; i++) {
      if (pass === 0 && b.family[b.lineOf[i]] !== want) continue;
      const d = (b.px[i] - tx) * (b.px[i] - tx) + (b.py[i] - ty) * (b.py[i] - ty);
      if (d < bd) { bd = d; best = i; }
    }
  }
  if (best < 0) return -1;
  const li = b.lineOf[best];
  const fam = b.family[li];

  // Nyalakan lipatan terdekat dari titik awal, hanya di kelompok yang sama.
  for (let i = b.foldFrom; i < b.lines; i++) b.lineMin[i] = Infinity;
  for (let i = foldStart; i < b.n; i++) {
    if (b.family[b.lineOf[i]] !== fam) continue;
    const d = (b.px[i] - b.px[best]) * (b.px[i] - b.px[best]) + (b.py[i] - b.py[best]) * (b.py[i] - b.py[best]);
    if (d < b.lineMin[b.lineOf[i]]) b.lineMin[b.lineOf[i]] = d;
  }
  for (let k = 0; k < cls.near; k++) {
    let pick = -1;
    let pd = Infinity;
    for (let i = b.foldFrom; i < b.lines; i++) if (b.lineMin[i] < pd) { pd = b.lineMin[i]; pick = i; }
    if (pick < 0) break;
    b.energy[pick] = Math.max(b.energy[pick], cls.e);
    b.lineMin[pick] = Infinity;
  }

  const S = b.spark;
  let slot = -1;
  let oldest = 0;
  let oa = -1;
  for (let i = 0; i < S.cap; i++) {
    if (!S.active[i]) { slot = i; break; }
    if (S.age[i] > oa) { oa = S.age[i]; oldest = i; }
  }
  if (slot < 0) slot = oldest; else S.count++;
  const segs = b.closed[li] ? b.len[li] : b.len[li] - 1;
  const seg = Math.min(best - b.start[li], segs - 1);
  let dir = ann.cls === 'backspace' ? -1 : rand() < 0.5 ? 1 : -1;
  if (dir < 0 && !b.closed[li] && seg === 0) dir = 1; // garis terbuka tidak bisa mundur dari titik pertama
  S.active[slot] = 1; S.line[slot] = li; S.seg[slot] = seg; S.t[slot] = 0; S.dir[slot] = dir;
  S.age[slot] = 0; S.life[slot] = cls.ms / 1000; S.a[slot] = cls.a; S.e[slot] = cls.e;
  S.trailLen[slot] = cls.trail * BND.trail[fam]; S.speed[slot] = cls.speed * BND.speed[fam]; S.fam[slot] = fam;
  return slot;
}

// Maju sejauh dist (satuan desain) di sepanjang garis; false bila mencapai ujung garis terbuka.
function travel(b, i, dist) {
  const S = b.spark;
  const li = S.line[i];
  const s0 = b.start[li];
  const m = b.len[li];
  const closed = b.closed[li];
  const segs = closed ? m : m - 1;
  const dir = S.dir[i];
  let seg = S.seg[i];
  let t = S.t[i];
  for (let guard = 0; dist > 0 && guard < 256; guard++) {
    const L = b.segLen[s0 + seg];
    if (dir > 0) {
      const rem = (1 - t) * L;
      if (dist < rem) { t += dist / L; dist = 0; } else {
        dist -= rem; seg++; t = 0;
        if (seg >= segs) { if (!closed) { S.seg[i] = segs - 1; S.t[i] = 1; return false; } seg = 0; }
      }
    } else {
      const rem = t * L;
      if (dist < rem) { t -= dist / L; dist = 0; } else {
        dist -= rem; seg--; t = 1;
        if (seg < 0) { if (!closed) { S.seg[i] = 0; S.t[i] = 0; return false; } seg = segs - 1; }
      }
    }
  }
  S.seg[i] = seg;
  S.t[i] = t;
  return true;
}

// --- per frame --------------------------------------------------------------------------------------
export function stepBrain(b, dt, d) {
  const M = brainMotion(d.pos, d.noSig, b.mot);
  const kL = 1 - Math.exp((-dt * 1000) / BND.tauMs); // level theta/alpha/beta dihaluskan supaya tidak berkedip
  b.level[0] += (clamp(d.theta ?? 0.5) - b.level[0]) * kL;
  b.level[1] += (clamp(d.alpha ?? 0.5) - b.level[1]) * kL;
  b.level[2] += (clamp(d.beta ?? 0.5) - b.level[2]) * kL;
  const ph = b.ph;
  ph[0] += M.speed * dt; ph[1] += M.speed * 0.83 * dt; ph[2] += M.speed * 1.21 * dt;
  ph[3] += M.speed * 0.67 * dt; ph[4] += M.speed * 2.6 * dt; ph[5] += M.speed * 3.1 * dt;
  const A = M.amp;
  const R = M.rough * CONFIG.brain.motion.rough;
  for (let gy = 0; gy <= GY; gy++) {
    for (let gx = 0; gx <= GX; gx++) {
      const X = (gx / GX) * b.data.w;
      const Y = (gy / GY) * b.data.h;
      const k = (gy * (GX + 1) + gx) * 2;
      b.lat[k] = A * (Math.sin(Y * 0.011 + ph[0]) + 0.7 * Math.sin(X * 0.017 + ph[1]) + R * Math.sin(X * 0.043 + Y * 0.031 + ph[4]));
      b.lat[k + 1] = A * (Math.sin(X * 0.012 + ph[2]) + 0.7 * Math.sin(Y * 0.019 + ph[3]) + R * Math.sin(Y * 0.047 - X * 0.029 + ph[5]));
    }
  }
  const de = (dt * 1000) / CONFIG.brain.energyMs;
  for (let i = b.foldFrom; i < b.lines; i++) if (b.energy[i] > 0) b.energy[i] = Math.max(0, b.energy[i] - de);
  const S = b.spark;
  for (let i = 0; i < S.cap; i++) {
    if (!S.active[i]) continue;
    S.age[i] += dt;
    if (S.age[i] >= S.life[i] || !travel(b, i, S.speed[i] * dt)) { S.active[i] = 0; S.count--; continue; }
    if (b.energy[S.line[i]] < S.e[i]) b.energy[S.line[i]] = S.e[i]; // lipatan yang dilalui tetap menyala
  }
}

function tracePath(ctx, b, li) {
  const s0 = b.start[li];
  const m = b.len[li];
  const X = b.sx;
  const Y = b.sy;
  if (b.closed[li]) {
    ctx.moveTo((X[s0 + m - 1] + X[s0]) / 2, (Y[s0 + m - 1] + Y[s0]) / 2);
    for (let i = 0; i < m; i++) {
      const j = i + 1 < m ? i + 1 : 0;
      ctx.quadraticCurveTo(X[s0 + i], Y[s0 + i], (X[s0 + i] + X[s0 + j]) / 2, (Y[s0 + i] + Y[s0 + j]) / 2);
    }
  } else {
    ctx.moveTo(X[s0], Y[s0]);
    for (let i = 1; i < m - 1; i++) ctx.quadraticCurveTo(X[s0 + i], Y[s0 + i], (X[s0 + i] + X[s0 + i + 1]) / 2, (Y[s0 + i] + Y[s0 + i + 1]) / 2);
    ctx.lineTo(X[s0 + m - 1], Y[s0 + m - 1]);
  }
}

// Titik jejak percikan (koordinat layar) dari kepala mundur sejauh trailLen; mengisi b.trail, mengembalikan jumlah titik.
function trailPoints(b, i) {
  const S = b.spark;
  const li = S.line[i];
  const s0 = b.start[li];
  const m = b.len[li];
  const closed = b.closed[li];
  const segs = closed ? m : m - 1;
  const dir = S.dir[i];
  const T = b.trail;
  const X = b.sx;
  const Y = b.sy;
  const at = (v) => s0 + (v % m);
  let seg = S.seg[i];
  let t = S.t[i];
  let rem = S.trailLen[i];
  const a = at(seg);
  const c = at(seg + 1);
  T[0] = X[a] + (X[c] - X[a]) * t;
  T[1] = Y[a] + (Y[c] - Y[a]) * t;
  let n = 1;
  for (let guard = 0; guard < TRAIL_MAX - 1; guard++) {
    const L = b.segLen[s0 + seg];
    const avail = dir > 0 ? t * L : (1 - t) * L;
    if (rem <= avail && L > 0) {
      t = dir > 0 ? t - rem / L : t + rem / L;
      const p = at(seg);
      const q = at(seg + 1);
      T[n * 2] = X[p] + (X[q] - X[p]) * t;
      T[n * 2 + 1] = Y[p] + (Y[q] - Y[p]) * t;
      n++;
      break;
    }
    rem -= avail;
    const v = at(dir > 0 ? seg : seg + 1);
    T[n * 2] = X[v];
    T[n * 2 + 1] = Y[v];
    n++;
    if (dir > 0) { seg--; t = 1; if (seg < 0) { if (!closed) break; seg = segs - 1; } } else { seg++; t = 0; if (seg >= segs) { if (!closed) break; seg = 0; } }
  }
  return n;
}

export function drawBrain(ctx, b, g, inkCss, d) {
  const C = CONFIG.brain;
  const R = brainRect(g);
  const sc = R.s;
  const cx = R.x0 + R.w / 2;
  const cy = R.y0 + R.h / 2;
  const hw = b.data.w / 2;
  const hh = b.data.h / 2;
  const BW = b.data.w;
  const BH = b.data.h;
  const lat = b.lat;
  for (let i = 0; i < b.n; i++) {
    let x = b.px[i];
    let y = b.py[i];
    const w = b.weight[i];
    if (w > 0) {
      let fx = (x / BW) * GX;
      let fy = (y / BH) * GY;
      fx = fx < 0 ? 0 : fx > GX - 1e-4 ? GX - 1e-4 : fx;
      fy = fy < 0 ? 0 : fy > GY - 1e-4 ? GY - 1e-4 : fy;
      const ix = fx | 0;
      const iy = fy | 0;
      const tx = fx - ix;
      const ty = fy - iy;
      const k00 = (iy * (GX + 1) + ix) * 2;
      const k10 = k00 + 2;
      const k01 = k00 + (GX + 1) * 2;
      const k11 = k01 + 2;
      const ux = (lat[k00] * (1 - tx) + lat[k10] * tx) * (1 - ty) + (lat[k01] * (1 - tx) + lat[k11] * tx) * ty;
      const uy = (lat[k00 + 1] * (1 - tx) + lat[k10 + 1] * tx) * (1 - ty) + (lat[k01 + 1] * (1 - tx) + lat[k11 + 1] * tx) * ty;
      x += w * ux;
      y += w * uy;
    }
    b.sx[i] = cx + (x - hw) * sc;
    b.sy[i] = cy + (y - hh) * sc;
  }

  const dens = lerp(C.alpha.base[0], C.alpha.base[1], clamp(d.density / CONFIG.ribbon.densityAmpMax));
  const live = lerp(1, C.alpha.noSignal, clamp(d.noSig));
  const mul = dens * live;
  const k = g.k;
  for (let f = 0; f < 3; f++) b.famAlpha[f] = clamp(lerp(BND.fold[0], BND.fold[1], b.level[f]) * mul);
  b.famAlpha[3] = clamp(lerp(BND.fold[0], BND.fold[1], 0.5) * mul); // otak kecil: tetap
  ctx.strokeStyle = inkCss;
  ctx.fillStyle = inkCss;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  for (let li = 0; li < b.foldFrom; li++) tracePath(ctx, b, li);
  ctx.globalAlpha = clamp(C.alpha.outline * mul);
  ctx.lineWidth = Math.max(1, C.line.outline * k);
  ctx.stroke();

  for (let f = 0; f < 4; f++) { // lipatan digambar per kelompok: theta, alpha, beta, lalu otak kecil
    ctx.beginPath();
    for (let li = b.foldFrom; li < b.lines; li++) if (b.family[li] === f) tracePath(ctx, b, li);
    ctx.globalAlpha = b.famAlpha[f];
    ctx.lineWidth = Math.max(1, C.line.fold * k);
    ctx.stroke();
  }

  for (let li = b.foldFrom; li < b.lines; li++) {
    const e = b.energy[li];
    if (e <= 0.02) continue;
    ctx.beginPath();
    tracePath(ctx, b, li);
    ctx.globalAlpha = clamp(b.famAlpha[b.family[li]] + e * C.alpha.lit * mul);
    ctx.lineWidth = Math.max(1, (C.line.fold + C.line.lit * e) * k);
    ctx.stroke();
  }

  const S = b.spark;
  const T = b.trail;
  for (let i = 0; i < S.cap; i++) {
    if (!S.active[i]) continue;
    const f = S.age[i] / S.life[i];
    const a = clamp(S.a[i] * (1 - f * f) * mul);
    const n = trailPoints(b, i);
    ctx.lineWidth = Math.max(1, C.line.spark * k);
    ctx.beginPath();
    ctx.moveTo(T[0], T[1]);
    for (let p = 1; p < n; p++) ctx.lineTo(T[p * 2], T[p * 2 + 1]);
    ctx.globalAlpha = a * 0.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(T[0], T[1]);
    for (let p = 1; p < (n + 1) >> 1; p++) ctx.lineTo(T[p * 2], T[p * 2 + 1]);
    ctx.globalAlpha = a * 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(T[0], T[1], Math.max(1.5, C.line.head * k), 0, Math.PI * 2);
    ctx.globalAlpha = a;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
