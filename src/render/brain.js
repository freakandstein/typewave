// Ilustrasi otak 3D (spec 6.4): garis tipis otak yang selalu berputar perlahan, digambar tembus pandang (garis di belakang tetap tampak,
// hanya lebih redup dan tipis). Data dari data/brain.js; hanya garis dengan alpha dan lebar (tanpa glow, spec 6.1).
// pos mengatur agitasi lipatan, density mengatur terang dasar, tiap ketikan menjalarkan satu percikan, tanpa sinyal otak redup dan
// lipatannya diam (putarannya tetap jalan). Ukuran dan terang garis tetap (tidak berdenyut mengikuti detak jantung) dan putarannya
// berkecepatan tetap. Level theta/alpha/beta dari EEG mengatur tiga kelompok lipatan (panjang = lambat, pendek = cepat). Ini hiasan,
// bukan peta aktivitas otak: server EEG tidak mengirim data per area.
// Semua buffer dialokasikan sekali; per frame tidak ada alokasi.
import { CONFIG } from '../config.js';
import { BRAIN } from '../data/brain.js';
import { decodeBrain } from '../data/brain-decode.js';
import { PITCH, viewOf, perspK, projectInto } from '../core/orbit.js';
import { clamp, lerp, smoothstep } from '../core/color.js';
import { beadU } from '../core/placement.js';
import { allowRep } from './beads.js';

const TAU = Math.PI * 2;
const GX = 5; // kisi agitasi: simpul pergeseran 3D, diinterpolasi trilinear ke tiap titik lipatan
const GY = 7;
const GZ = 5;
const NODES = (GX + 1) * (GY + 1) * (GZ + 1);
const NSY = GX + 1; // selisih indeks simpul antar baris dan antar lapisan
const NSZ = (GX + 1) * (GY + 1);
const TRAIL_MAX = 64;
const NA = 24; // goresan dikelompokkan menurut tingkat alpha (0..NA, berskala akar: alpha = (tingkat / NA)^2, halus di bagian redup) dan kelas lebar
const WC = 4;
const NBK = (NA + 1) * WC;
// Menghadap kamera berubah halus dari belakang (0) ke depan (1) di sekitar tepi otak, supaya garis yang berputar melewati tepi tidak melompat terang.
const FACE_LO = -0.12;
const FACE_HI = 0.06;
const SPARK_FLOOR = 0.3; // percikan di sisi belakang tetap terlihat: terang minimal relatif terhadap yang di depan
const SP = CONFIG.brain.spark;
const BND = CONFIG.brain.bands;
const DP = CONFIG.brain.depth;

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

// Terang relatif menurut kedalaman: t 0 (terjauh) .. 1 (terdekat); face 0 (menghadap menjauh dari kamera) .. 1 (menghadap kamera), boleh true/false.
// Sisi belakang lebih redup (DP.back) tetapi tetap tampak.
export function depthShade(t, face) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const v = 1 - (1 - Math.pow(u, DP.curve)) * (1 - DP.far);
  return v * (DP.back + (1 - DP.back) * face);
}

// Alpha dan kelas lebar sebuah ember goresan (ember = tingkat alpha * WC + kelas lebar).
export const bucketAlpha = (bk) => { const l = Math.floor(bk / WC) / NA; return l * l; };

// Bagian data yang tidak berubah (dibuka dari data/brain.js sekali, dipakai bersama semua instans).
const STATIC = new WeakMap();
function staticOf(data) {
  let s = STATIC.get(data);
  if (s) return s;
  const D = decodeBrain(data);
  const { n, lines } = D;
  const lineOf = new Uint16Array(n);
  const segLen = new Float32Array(n); // panjang segmen titik i ke i+1 (satuan desain); 0 pada titik terakhir tiap garis
  const closed = new Uint8Array(lines); // 1 bila garis menyambung ke dirinya (titik pertama = terakhir)
  const mobile = new Uint8Array(lines); // lipatan korteks dan otak kecil bergerak oleh agitasi; celah utama dan batang otak diam
  const lit = new Uint8Array(lines); // lipatan yang bisa menyala oleh percikan dan Enter
  const family = new Uint8Array(lines).fill(255);
  let foldEnd = 0;
  for (let li = 0; li < lines; li++) {
    const s0 = D.start[li];
    const m = D.len[li];
    for (let i = 0; i < m; i++) {
      lineOf[s0 + i] = li;
      if (i + 1 < m) segLen[s0 + i] = Math.hypot(D.x[s0 + i + 1] - D.x[s0 + i], D.y[s0 + i + 1] - D.y[s0 + i], D.z[s0 + i + 1] - D.z[s0 + i]);
    }
    closed[li] = Math.hypot(D.x[s0] - D.x[s0 + m - 1], D.y[s0] - D.y[s0 + m - 1], D.z[s0] - D.z[s0 + m - 1]) < 0.25 ? 1 : 0;
    mobile[li] = D.kind[li] === 0 || D.kind[li] === 2 ? 1 : 0;
    lit[li] = mobile[li];
    if (D.kind[li] === 0) foldEnd = s0 + m;
  }
  // Kelompok menurut panjang garis labirin utuh (rantai): bagian-bagian satu rantai selalu sekelompok. Otak kecil (jenis 2) di luar kelompok (3 = terang tetap).
  const chains = [];
  const lens = [];
  const slot = new Map();
  for (let li = 0; li < lines; li++) {
    if (D.kind[li] === 2) { family[li] = 3; continue; }
    if (D.kind[li] !== 0) continue;
    let t = 0;
    for (let i = 0; i < D.len[li] - 1; i++) t += segLen[D.start[li] + i];
    if (!slot.has(D.chain[li])) { slot.set(D.chain[li], chains.length); chains.push(D.chain[li]); lens.push(0); }
    lens[slot.get(D.chain[li])] += t;
  }
  const famOfChain = assignFamilies(lens);
  for (let li = 0; li < lines; li++) if (D.kind[li] === 0) family[li] = famOfChain[slot.get(D.chain[li])];
  // Segmen: titik i ke i+1 pada garis yang sama; segCont = 1 bila segmen sebelumnya (s-1) satu garis, supaya jalur disambung tanpa moveTo.
  const nSeg = n - lines;
  const segA = new Int32Array(nSeg);
  const segLine = new Uint16Array(nSeg);
  const segCont = new Uint8Array(nSeg);
  let q = 0;
  for (let li = 0; li < lines; li++) {
    for (let i = 0; i < D.len[li] - 1; i++) { segA[q] = D.start[li] + i; segLine[q] = li; segCont[q] = i > 0 ? 1 : 0; q++; }
  }
  // Kisi agitasi: tiap titik lipatan tahu simpul asalnya dan pecahan di dalam sel (tetap, karena posisi istirahat tidak berubah).
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, D.x[i]); x1 = Math.max(x1, D.x[i]); y0 = Math.min(y0, D.y[i]); y1 = Math.max(y1, D.y[i]); z0 = Math.min(z0, D.z[i]); z1 = Math.max(z1, D.z[i]);
  }
  const span = [Math.max(1, x1 - x0), Math.max(1, y1 - y0), Math.max(1, z1 - z0)];
  const nodePos = new Float32Array(NODES * 3);
  for (let iz = 0; iz <= GZ; iz++) for (let iy = 0; iy <= GY; iy++) for (let ix = 0; ix <= GX; ix++) {
    const o = (iz * NSZ + iy * NSY + ix) * 3;
    nodePos[o] = x0 + (ix / GX) * span[0]; nodePos[o + 1] = y0 + (iy / GY) * span[1]; nodePos[o + 2] = z0 + (iz / GZ) * span[2];
  }
  const cell = new Uint16Array(n);
  const fx = new Float32Array(n); const fy = new Float32Array(n); const fz = new Float32Array(n);
  const cellOf = (v, lo, sp, g) => { const f = clamp(((v - lo) / sp) * g, 0, g - 1e-4); const i = Math.floor(f); return [i, f - i]; };
  for (let i = 0; i < n; i++) {
    const [ix, tx] = cellOf(D.x[i], x0, span[0], GX);
    const [iy, ty] = cellOf(D.y[i], y0, span[1], GY);
    const [iz, tz] = cellOf(D.z[i], z0, span[2], GZ);
    cell[i] = iz * NSZ + iy * NSY + ix; fx[i] = tx; fy[i] = ty; fz[i] = tz;
  }
  s = { D, lineOf, segLen, closed, mobile, lit, family, foldEnd, nSeg, segA, segLine, segCont, nodePos, cell, fx, fy, fz };
  STATIC.set(data, s);
  return s;
}

export function createBrain(data = BRAIN, yaw = CONFIG.brain.yaw0) {
  const st = staticOf(data);
  const { D } = st;
  const { n, lines } = D;
  const cap = SP.cap;
  const b = {
    data, st, n, lines, nSeg: st.nSeg, foldEnd: st.foldEnd,
    kind: D.kind, chain: D.chain, start: D.start, len: D.len, x: D.x, y: D.y, z: D.z, nx: D.nx, ny: D.ny, nz: D.nz,
    lineOf: st.lineOf, segLen: st.segLen, closed: st.closed, mobile: st.mobile, lit: st.lit, family: st.family,
    yaw, view: viewOf(yaw, PITCH), kp: perspK(data.unit), agitate: false,
    dx: new Float32Array(n), dy: new Float32Array(n), dd: new Float32Array(n), df: new Float32Array(n), // kotak desain, kedalaman, menghadap
    sx: new Float32Array(n), sy: new Float32Array(n), // piksel
    energy: new Float32Array(lines), lineMin: new Float32Array(lines),
    level: new Float32Array(3).fill(0.5), famAlpha: new Float32Array(4),
    lat: new Float32Array(NODES * 3), ph: new Float64Array(6), mot: { amp: 0, speed: 0, rough: 0 },
    repTimes: new Float64Array(CONFIG.beads.rep.perSec).fill(-Infinity), repIdx: 0,
    trail: new Float32Array(TRAIL_MAX * 2),
    bucketOf: new Uint8Array(st.nSeg), cnt: new Int32Array(NBK + 1), at: new Int32Array(NBK), order: new Int32Array(st.nSeg), drawn: 0, drawnBack: 0,
    spark: {
      cap, count: 0, active: new Uint8Array(cap), line: new Uint16Array(cap), seg: new Uint16Array(cap),
      t: new Float32Array(cap), dir: new Int8Array(cap), age: new Float32Array(cap), life: new Float32Array(cap),
      a: new Float32Array(cap), e: new Float32Array(cap), trailLen: new Float32Array(cap), speed: new Float32Array(cap), fam: new Uint8Array(cap),
    },
  };
  project(b);
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
  for (let i = 0; i < b.lines; i++) if (b.lit[i] && b.energy[i] > 0.02) lit++;
  return { sparks: b.spark.count, lit, levels: [b.level[0], b.level[1], b.level[2]], yaw: b.yaw, drawn: b.drawn, drawnBack: b.drawnBack };
}

// --- proyeksi: titik model (dengan agitasi pada lipatan) -> kotak desain, kedalaman, dan menghadap kamera ---------------------
function project(b) {
  const v = viewOf(b.yaw, PITCH, b.view);
  const { st, dx, dy, dd, df } = b;
  const cx = b.data.w / 2;
  const cy = b.data.h / 2;
  const ag = b.agitate;
  const lat = b.lat;
  const { cell, fx, fy, fz } = st;
  const mobile = b.mobile;
  const lineOf = b.lineOf;
  for (let i = 0; i < b.n; i++) {
    let x = b.x[i];
    let y = b.y[i];
    let z = b.z[i];
    if (ag && mobile[lineOf[i]]) {
      const o = cell[i] * 3;
      const tx = fx[i];
      const ty = fy[i];
      const tz = fz[i];
      const oy = o + NSY * 3;
      const oz = o + NSZ * 3;
      const oyz = oz + NSY * 3;
      for (let c = 0; c < 3; c++) {
        const a0 = lat[o + c] + (lat[o + 3 + c] - lat[o + c]) * tx;
        const a1 = lat[oy + c] + (lat[oy + 3 + c] - lat[oy + c]) * tx;
        const b0 = lat[oz + c] + (lat[oz + 3 + c] - lat[oz + c]) * tx;
        const b1 = lat[oyz + c] + (lat[oyz + 3 + c] - lat[oyz + c]) * tx;
        const u = (a0 + (a1 - a0) * ty) * (1 - tz) + (b0 + (b1 - b0) * ty) * tz;
        if (c === 0) x += u; else if (c === 1) y += u; else z += u;
      }
    }
    projectInto(v, b.kp, x, y, z, dx, dy, dd, i);
    dx[i] = cx + dx[i];
    dy[i] = cy - dy[i];
    df[i] = -(b.nx[i] * v.cy - b.ny[i] * v.sy) * v.cp + b.nz[i] * v.sp;
  }
}

// --- percikan -------------------------------------------------------------------------------------
export function sparkBrain(b, ann, privacy, now, rand = Math.random) {
  if (ann.cls === 'enter') { // Enter: seluruh lipatan menyala sebentar; Enter ditahan tidak membuatnya berkedip
    if (!ann.rep) for (let i = 0; i < b.lines; i++) if (b.lit[i]) b.energy[i] = Math.max(b.energy[i], SP.enter);
    return -1;
  }
  let cls;
  if (ann.rep) { if (!allowRep(b, now)) return -1; cls = SP.rep; }
  else if (ann.cls === 'backspace') cls = SP.back;
  else if (ann.code === 'Space') cls = SP.space;
  else if (ann.modifier || ann.cls === 'other') cls = SP.neutral;
  else cls = SP.char;

  // Posisi horizontal di layar mengikuti kolom tombol (aturan privasi sama dengan bead); vertikal acak di dalam otak. Titik awalnya
  // lipatan terdekat dari posisi itu pada gambar saat ini, di sisi yang menghadap kamera.
  const tx = (0.07 + 0.86 * beadU(ann.code, privacy, rand)) * b.data.w;
  const ty = (0.1 + 0.62 * rand()) * b.data.h;
  const want = pickFamily(b.level, rand()); // kelompok garis (theta/alpha/beta) menurut level EEG saat ini
  let best = -1;
  let bd = Infinity;
  for (let pass = 0; pass < 3 && best < 0; pass++) { // 0: kelompok itu dan menghadap kamera; 1: kelompok itu di sisi mana pun; 2: lipatan apa pun
    bd = Infinity;
    for (let i = 0; i < b.foldEnd; i++) {
      if (pass < 2 && b.family[b.lineOf[i]] !== want) continue;
      if (pass === 0 && b.df[i] <= 0) continue;
      const d = (b.dx[i] - tx) * (b.dx[i] - tx) + (b.dy[i] - ty) * (b.dy[i] - ty);
      if (d < bd) { bd = d; best = i; }
    }
  }
  if (best < 0) return -1;
  const li = b.lineOf[best];
  const fam = b.family[li];

  // Nyalakan lipatan terdekat dari titik awal (jarak di ruang model, jadi tidak bergantung sudut putar), hanya di kelompok yang sama.
  for (let i = 0; i < b.lines; i++) b.lineMin[i] = Infinity;
  for (let i = 0; i < b.foldEnd; i++) {
    if (b.family[b.lineOf[i]] !== fam) continue;
    const d = (b.x[i] - b.x[best]) ** 2 + (b.y[i] - b.y[best]) ** 2 + (b.z[i] - b.z[best]) ** 2;
    if (d < b.lineMin[b.lineOf[i]]) b.lineMin[b.lineOf[i]] = d;
  }
  for (let k = 0; k < cls.near; k++) {
    let pick = -1;
    let pd = Infinity;
    for (let i = 0; i < b.lines; i++) if (b.lineMin[i] < pd) { pd = b.lineMin[i]; pick = i; }
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
  const segs = b.len[li] - 1;
  const seg = Math.min(best - b.start[li], segs - 1);
  let dir = ann.cls === 'backspace' ? -1 : rand() < 0.5 ? 1 : -1;
  if (dir < 0 && !b.closed[li] && seg === 0) dir = 1; // garis terbuka tidak bisa mundur dari titik pertama
  S.active[slot] = 1; S.line[slot] = li; S.seg[slot] = seg; S.t[slot] = 0; S.dir[slot] = dir;
  S.age[slot] = 0; S.life[slot] = cls.ms / 1000; S.a[slot] = cls.a; S.e[slot] = cls.e;
  S.trailLen[slot] = cls.trail * BND.trail[fam]; S.speed[slot] = cls.speed * BND.speed[fam]; S.fam[slot] = fam;
  return slot;
}

// Maju sejauh dist (satuan desain, sepanjang garis di ruang model); false bila mencapai ujung garis terbuka.
function travel(b, i, dist) {
  const S = b.spark;
  const li = S.line[i];
  const s0 = b.start[li];
  const segs = b.len[li] - 1;
  const closed = b.closed[li];
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
// d: { pos, density, noSig, theta, alpha, beta, spin }; spin = pengali kecepatan putar (bawaan 1; 0 menghentikan, untuk tes).
export function stepBrain(b, dt, d) {
  const M = brainMotion(d.pos, d.noSig, b.mot);
  b.yaw = (b.yaw + CONFIG.brain.spin * (d.spin ?? 1) * dt) % TAU; // putaran selalu berkecepatan tetap, tidak mengikuti data
  const kL = 1 - Math.exp((-dt * 1000) / BND.tauMs); // level theta/alpha/beta dihaluskan supaya tidak berkedip
  b.level[0] += (clamp(d.theta ?? 0.5) - b.level[0]) * kL;
  b.level[1] += (clamp(d.alpha ?? 0.5) - b.level[1]) * kL;
  b.level[2] += (clamp(d.beta ?? 0.5) - b.level[2]) * kL;
  const ph = b.ph;
  ph[0] += M.speed * dt; ph[1] += M.speed * 0.83 * dt; ph[2] += M.speed * 1.21 * dt;
  ph[3] += M.speed * 0.67 * dt; ph[4] += M.speed * 2.6 * dt; ph[5] += M.speed * 3.1 * dt;
  b.agitate = M.amp > 0;
  if (b.agitate) {
    const A = M.amp;
    const R = M.rough * CONFIG.brain.motion.rough;
    const P = b.st.nodePos;
    const lat = b.lat;
    for (let k = 0; k < NODES; k++) {
      const X = P[k * 3];
      const Y = P[k * 3 + 1];
      const Z = P[k * 3 + 2];
      lat[k * 3] = A * (Math.sin(Y * 0.011 + ph[0]) + 0.7 * Math.sin(Z * 0.017 + ph[1]) + R * Math.sin(X * 0.043 + Y * 0.031 + ph[4]));
      lat[k * 3 + 1] = A * (Math.sin(Z * 0.012 + ph[2]) + 0.7 * Math.sin(X * 0.019 + ph[3]) + R * Math.sin(Y * 0.047 - Z * 0.029 + ph[5]));
      lat[k * 3 + 2] = A * (Math.sin(X * 0.013 + ph[3]) + 0.7 * Math.sin(Y * 0.021 + ph[0]) + R * Math.sin(Z * 0.041 + X * 0.027 + ph[5]));
    }
  }
  project(b);
  const de = (dt * 1000) / CONFIG.brain.energyMs;
  for (let i = 0; i < b.lines; i++) if (b.energy[i] > 0) b.energy[i] = Math.max(0, b.energy[i] - de);
  const S = b.spark;
  for (let i = 0; i < S.cap; i++) {
    if (!S.active[i]) continue;
    S.age[i] += dt;
    if (S.age[i] >= S.life[i] || !travel(b, i, S.speed[i] * dt)) { S.active[i] = 0; S.count--; continue; }
    if (b.energy[S.line[i]] < S.e[i]) b.energy[S.line[i]] = S.e[i]; // lipatan yang dilalui tetap menyala
  }
}

// Titik jejak percikan (koordinat layar, dari gambar terakhir) dari kepala mundur sejauh trailLen; mengisi b.trail, mengembalikan jumlah titik.
export function trailPoints(b, i) {
  const S = b.spark;
  const li = S.line[i];
  const s0 = b.start[li];
  const segs = b.len[li] - 1;
  const closed = b.closed[li];
  const dir = S.dir[i];
  const T = b.trail;
  const X = b.sx;
  const Y = b.sy;
  let seg = S.seg[i];
  let t = S.t[i];
  let rem = S.trailLen[i];
  const a = s0 + seg;
  T[0] = X[a] + (X[a + 1] - X[a]) * t;
  T[1] = Y[a] + (Y[a + 1] - Y[a]) * t;
  let n = 1;
  for (let guard = 0; guard < TRAIL_MAX - 1; guard++) {
    const L = b.segLen[s0 + seg];
    const avail = dir > 0 ? t * L : (1 - t) * L;
    if (rem <= avail && L > 0) {
      t = dir > 0 ? t - rem / L : t + rem / L;
      const p = s0 + seg;
      T[n * 2] = X[p] + (X[p + 1] - X[p]) * t;
      T[n * 2 + 1] = Y[p] + (Y[p + 1] - Y[p]) * t;
      n++;
      break;
    }
    rem -= avail;
    const v = s0 + (dir > 0 ? seg : seg + 1);
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
  const k = g.k;
  for (let i = 0; i < b.n; i++) { b.sx[i] = R.x0 + b.dx[i] * sc; b.sy[i] = R.y0 + b.dy[i] * sc; }

  const dens = lerp(C.alpha.base[0], C.alpha.base[1], clamp(d.density / CONFIG.ribbon.densityAmpMax));
  const live = lerp(1, C.alpha.noSignal, clamp(d.noSig));
  const mul = dens * live;
  for (let f = 0; f < 3; f++) b.famAlpha[f] = clamp(lerp(BND.fold[0], BND.fold[1], b.level[f]) * mul);
  b.famAlpha[3] = clamp(lerp(BND.fold[0], BND.fold[1], 0.5) * mul); // otak kecil: tetap
  const fixedA = clamp(C.alpha.fixed * mul); // celah utama dan batang otak: terang tetap
  const litA = C.alpha.lit * mul;

  // Tiap segmen: tingkat alpha dari kelompoknya, nyala, dan kedalamannya; kelas lebar dari sisi dan kedalaman. Lalu diurutkan ke goresan.
  const { segA, segLine, segCont } = b.st;
  const dd = b.dd;
  const df = b.df;
  const unit = b.data.unit;
  const half = DP.range * unit;
  const inv = 1 / (2 * half);
  const cnt = b.cnt;
  const bucketOf = b.bucketOf;
  cnt.fill(0);
  for (let s = 0; s < b.nSeg; s++) {
    const a = segA[s];
    const li = segLine[s];
    const face = smoothstep(FACE_LO, FACE_HI, (df[a] + df[a + 1]) * 0.5);
    const front = face >= 0.5;
    const t = clamp(((dd[a] + dd[a + 1]) * 0.5 + half) * inv);
    const fam = b.family[li];
    const e = b.energy[li];
    const base = fam < 4 ? b.famAlpha[fam] : fixedA;
    const level = Math.round(Math.sqrt(clamp((base + (b.lit[li] ? e * litA : 0)) * DP.gain * depthShade(t, face))) * NA);
    if (level === 0) { bucketOf[s] = 255; continue; }
    let wc = !front ? 0 : b.kind[li] === 1 ? 3 : t >= 0.7 ? 2 : 1;
    if (e > 0.4 && wc === 1) wc = 2; // lipatan yang menyala lebih tebal
    const bk = level * WC + wc;
    bucketOf[s] = bk;
    cnt[bk + 1]++;
  }
  for (let q = 0; q < NBK; q++) cnt[q + 1] += cnt[q];
  const order = b.order;
  const at = b.at;
  for (let q = 0; q < NBK; q++) at[q] = cnt[q];
  for (let s = 0; s < b.nSeg; s++) { const bk = bucketOf[s]; if (bk !== 255) order[at[bk]++] = s; }

  ctx.strokeStyle = inkCss;
  ctx.fillStyle = inkCss;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const sx = b.sx;
  const sy = b.sy;
  let drawn = 0;
  let drawnBack = 0;
  for (let bk = 0; bk < NBK; bk++) { // dari yang paling redup ke yang paling terang, supaya yang terang menimpa
    const from = cnt[bk];
    const to = cnt[bk + 1];
    if (to === from) continue;
    ctx.beginPath();
    let prev = -2;
    for (let q = from; q < to; q++) {
      const s = order[q];
      const a = segA[s];
      if (prev === s - 1 && segCont[s]) ctx.lineTo(sx[a + 1], sy[a + 1]);
      else { ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[a + 1], sy[a + 1]); }
      prev = s;
    }
    const wc = bk % WC;
    ctx.globalAlpha = bucketAlpha(bk);
    ctx.lineWidth = Math.max(1, C.width[wc] * k);
    ctx.stroke();
    drawn += to - from;
    if (wc === 0) drawnBack += to - from;
  }
  b.drawn = drawn;
  b.drawnBack = drawnBack;

  const S = b.spark;
  const T = b.trail;
  for (let i = 0; i < S.cap; i++) {
    if (!S.active[i]) continue;
    const f = S.age[i] / S.life[i];
    const p = b.start[S.line[i]] + S.seg[i];
    const tt = S.t[i];
    const hd = dd[p] + (dd[p + 1] - dd[p]) * tt;
    const hf = df[p] + (df[p + 1] - df[p]) * tt;
    const shade = SPARK_FLOOR + (1 - SPARK_FLOOR) * depthShade(clamp((hd + half) * inv), smoothstep(FACE_LO, FACE_HI, hf));
    const a = clamp(S.a[i] * (1 - f * f) * mul * shade);
    const n = trailPoints(b, i);
    ctx.lineWidth = Math.max(1, C.line.spark * k);
    ctx.beginPath();
    ctx.moveTo(T[0], T[1]);
    for (let q = 1; q < n; q++) ctx.lineTo(T[q * 2], T[q * 2 + 1]);
    ctx.globalAlpha = a * 0.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(T[0], T[1]);
    for (let q = 1; q < (n + 1) >> 1; q++) ctx.lineTo(T[q * 2], T[q * 2 + 1]);
    ctx.globalAlpha = a * 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(T[0], T[1], Math.max(1.5, C.line.head * k), 0, Math.PI * 2);
    ctx.globalAlpha = a;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
