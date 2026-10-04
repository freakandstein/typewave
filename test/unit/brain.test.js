import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { BRAIN } from '../../src/data/brain.js';
import { createGeom } from '../../src/render/scene.js';
import { createBrain, brainRect, brainMotion, sparkBrain, stepBrain, drawBrain, brainStats, assignFamilies, pickFamily } from '../../src/render/brain.js';

const SP = CONFIG.brain.spark;
const drive = (o = {}) => ({ pos: 0.5, density: 0, noSig: 0, ...o });
const key = (code, o = {}) => ({ code, rep: false, cls: 'char', modifier: false, ...o });
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

function fakeCtx(W, H) {
  const rec = { strokes: 0, fills: 0, alphas: [], widths: [], bad: [] };
  const chk = (...n) => { for (const v of n) if (!Number.isFinite(v) || v < -60 || v > Math.max(W, H) + 60) rec.bad.push(v); };
  const ctx = {
    globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '', lineJoin: '', lineCap: '',
    beginPath() {}, closePath() {},
    moveTo: (x, y) => chk(x, y), lineTo: (x, y) => chk(x, y),
    quadraticCurveTo: (a, b, x, y) => chk(a, b, x, y),
    arc: (x, y, r) => { chk(x, y); if (!(r >= 0)) rec.bad.push(r); },
    stroke() { rec.strokes++; rec.alphas.push(ctx.globalAlpha); rec.widths.push(ctx.lineWidth); },
    fill() { rec.fills++; rec.alphas.push(ctx.globalAlpha); },
  };
  return { ctx, rec };
}

// --- geometri ----------------------------------------------------------------------------
test('brainRect wide: di atas tengah, tinggi mengikuti skala, di dalam kanvas', () => {
  const g = createGeom(1920, 1080, 'wide');
  const R = brainRect(g);
  assert.ok(Math.abs(R.x0 + R.w / 2 - 960) < 0.5, 'tengah horizontal');
  assert.ok(R.y0 >= 0 && R.y0 + R.h < g.spawnC + 20, `atas ${R.y0}..${R.y0 + R.h}, spawn ${g.spawnC}`);
  assert.ok(Math.abs(R.h - g.brain.h) < 1e-6);
  assert.ok(Math.abs(R.w - (BRAIN.w / BRAIN.h) * R.h) < 1e-6);
});

test('brainRect wide: tidak menyentuh kolom HUD kiri dan kanan di 1080p dan 720p', () => {
  for (const [W, H] of [[1920, 1080], [1280, 720]]) {
    const g = createGeom(W, H, 'wide');
    const R = brainRect(g);
    assert.ok(R.x0 >= 0.04 * W + 500 * g.k, `kiri ${R.x0} (${W}x${H})`);
    assert.ok(R.x0 + R.w <= W - 0.04 * W - 400 * g.k, `kanan ${R.x0 + R.w} (${W}x${H})`);
  }
});

test('brainRect tall: di dalam safe zone (atas >= 10%, kanan <= 85%), di kanan kolom HUD', () => {
  for (const [W, H] of [[1080, 1920], [720, 1280]]) {
    const g = createGeom(W, H, 'tall');
    const R = brainRect(g);
    assert.ok(R.y0 >= 0.1 * H, `atas ${R.y0}`);
    assert.ok(R.x0 + R.w <= 0.85 * W, `kanan ${R.x0 + R.w}`);
    assert.ok(R.x0 >= 0.06 * W + 330 * g.k, `kiri ${R.x0}`);
  }
});

test('brainRect dengan keyboard visual: lebih kecil dan tetap di atas titik jatuh bead', () => {
  const a = brainRect(createGeom(1920, 1080, 'wide'));
  const gk = createGeom(1920, 1080, 'wide', undefined, true);
  const b = brainRect(gk);
  assert.ok(b.h < a.h);
  assert.ok(b.y0 + b.h <= gk.spawnC + 20, `bawah ${b.y0 + b.h} spawn ${gk.spawnC}`);
});

// --- pemetaan gerak ------------------------------------------------------------------------
test('brainMotion: tenang lebih pelan, halus, dan kecil daripada tegang; tanpa sinyal diam', () => {
  const calm = brainMotion(0.1, 0);
  const tense = brainMotion(0.95, 0);
  assert.ok(calm.amp < tense.amp && calm.speed < tense.speed);
  assert.equal(calm.rough, 0);
  assert.ok(tense.rough > 0.5);
  const dead = brainMotion(0.95, 1);
  assert.deepEqual([dead.amp, dead.speed, dead.rough], [0, 0, 0]);
});

// --- data ke struktur kerja ------------------------------------------------------------------
test('createBrain: bobot gerak nol di kontur dan di tepi, 1 di bagian dalam', () => {
  const b = createBrain();
  const foldStart = b.start[b.foldFrom];
  for (let i = 0; i < foldStart; i++) assert.equal(b.weight[i], 0, 'kontur diam');
  let lo = 1; let hi = 0;
  for (let i = foldStart; i < b.n; i++) { lo = Math.min(lo, b.weight[i]); hi = Math.max(hi, b.weight[i]); }
  assert.ok(lo < 0.4, `tepi ${lo}`);
  assert.equal(hi, 1);
});

// --- percikan ---------------------------------------------------------------------------------
test('sparkBrain exact: tombol kiri memulai di sisi kiri otak, tombol kanan di sisi kanan', () => {
  const b = createBrain();
  const startX = (code) => {
    const s = sparkBrain(b, key(code), 'exact', 1000, seq(0.5));
    assert.ok(s >= 0);
    return b.px[b.start[b.spark.line[s]] + b.spark.seg[s]];
  };
  assert.ok(startX('KeyQ') < startX('KeyP'), 'Q kiri dari P');
  assert.ok(startX('KeyQ') < 0.5 * BRAIN.w && startX('KeyP') > 0.5 * BRAIN.w);
});

test('sparkBrain: percikan menyalakan lipatan di dekatnya', () => {
  const b = createBrain();
  assert.equal(brainStats(b).lit, 0);
  sparkBrain(b, key('KeyF'), 'exact', 1000, seq(0.5));
  assert.ok(brainStats(b).lit >= 1);
  assert.equal(brainStats(b).sparks, 1);
});

test('sparkBrain: Backspace bergerak mundur, Enter menyalakan semua lipatan (kecuali ditahan)', () => {
  const b = createBrain();
  const s = sparkBrain(b, key('Backspace', { cls: 'backspace' }), 'zone', 1000, seq(0.5));
  assert.equal(b.spark.dir[s], -1);
  const c = createBrain();
  assert.equal(sparkBrain(c, key('Enter', { cls: 'enter' }), 'zone', 1000), -1);
  assert.ok(brainStats(c).lit >= c.lines - c.foldFrom - 12, `lit ${brainStats(c).lit}`);
  const d = createBrain();
  sparkBrain(d, key('Enter', { cls: 'enter', rep: true }), 'zone', 1000);
  assert.equal(brainStats(d).lit, 0, 'Enter ditahan tidak membuat otak berkedip');
});

test('sparkBrain: repeat dibatasi 12 per detik; banjir tombol tidak melebihi kapasitas pool', () => {
  const b = createBrain();
  let made = 0;
  for (let i = 0; i < 40; i++) if (sparkBrain(b, key('KeyA', { rep: true }), 'zone', 5000 + i * 10) >= 0) made++;
  assert.equal(made, CONFIG.beads.rep.perSec);
  const c = createBrain();
  for (let i = 0; i < 600; i++) sparkBrain(c, key('KeyS'), 'zone', 9000 + i);
  assert.ok(brainStats(c).sparks <= SP.cap, `percikan ${brainStats(c).sparks}`);
});

test('stepBrain: percikan melaju lalu habis; nyala lipatan memudar ke nol', () => {
  const b = createBrain();
  sparkBrain(b, key('KeyD'), 'exact', 1000, seq(0.5));
  const s = 0;
  const before = [b.spark.seg[s], b.spark.t[s]];
  stepBrain(b, 0.05, drive());
  assert.ok(b.spark.seg[s] !== before[0] || b.spark.t[s] !== before[1], 'bergerak');
  for (let i = 0; i < 400; i++) stepBrain(b, 0.016, drive());
  assert.equal(brainStats(b).sparks, 0);
  assert.equal(brainStats(b).lit, 0);
});

test('stepBrain: tanpa sinyal lipatan diam (tanpa pergeseran); tegang bergeser lebih jauh daripada tenang', () => {
  const g = createGeom(1920, 1080, 'wide');
  const shift = (d) => {
    const b = createBrain();
    for (let i = 0; i < 120; i++) stepBrain(b, 0.016, d);
    const { ctx } = fakeCtx(1920, 1080);
    drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
    const R = brainRect(g);
    let m = 0;
    for (let i = b.start[b.foldFrom]; i < b.n; i++) {
      const bx = R.x0 + b.px[i] * R.s;
      const by = R.y0 + b.py[i] * R.s;
      m = Math.max(m, Math.hypot(b.sx[i] - bx, b.sy[i] - by));
    }
    return m;
  };
  const dead = shift(drive({ pos: 0.95, noSig: 1 }));
  assert.ok(dead < 1e-3, `diam ${dead}`);
  assert.ok(shift(drive({ pos: 0.95 })) > shift(drive({ pos: 0.05 })) * 1.5);
});

// --- gambar ------------------------------------------------------------------------------------
test('drawBrain: semua koordinat berhingga di dalam kanvas, alpha 0..1, ada garis dan percikan', () => {
  for (const layout of ['wide', 'tall']) {
    const [W, H] = layout === 'wide' ? [1920, 1080] : [1080, 1920];
    const g = createGeom(W, H, layout);
    const b = createBrain();
    for (const c of ['KeyA', 'KeyK', 'Space', 'ShiftLeft']) sparkBrain(b, key(c, c === 'ShiftLeft' ? { cls: 'other', modifier: true } : {}), 'zone', 1000);
    const { ctx, rec } = fakeCtx(W, H);
    stepBrain(b, 0.016, drive({ pos: 0.9, density: 6 }));
    drawBrain(ctx, b, g, 'rgb(142,216,208)', drive({ pos: 0.9, density: 6 }));
    assert.deepEqual(rec.bad, [], layout);
    assert.ok(rec.strokes >= 3, `garis ${rec.strokes}`);
    assert.ok(rec.alphas.every((a) => a >= 0 && a <= 1), String(rec.alphas));
    assert.ok(rec.widths.every((w) => w > 0), String(rec.widths));
  }
});

test('drawBrain: tanpa sinyal lebih redup dari bersinyal', () => {
  const g = createGeom(1920, 1080, 'wide');
  const maxAlpha = (d) => {
    const b = createBrain();
    const { ctx, rec } = fakeCtx(1920, 1080);
    drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
    return Math.max(...rec.alphas);
  };
  assert.ok(maxAlpha(drive({ noSig: 1 })) < maxAlpha(drive({ noSig: 0 })));
});

test('drawBrain: otak tidak berdenyut: kontur dan alpha sama dari frame ke frame saat masukan tetap', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  const d = drive({ pos: 0.5, density: 3 });
  const snap = () => {
    const { ctx, rec } = fakeCtx(1920, 1080);
    drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
    return { x: Array.from(b.sx.subarray(0, b.start[b.foldFrom])), y: Array.from(b.sy.subarray(0, b.start[b.foldFrom])), alphas: rec.alphas.slice(0, 2) };
  };
  const first = snap();
  for (let i = 0; i < 60; i++) stepBrain(b, 0.016, d);
  const later = snap();
  assert.deepEqual(later.x, first.x);
  assert.deepEqual(later.y, first.y);
  assert.deepEqual(later.alphas, first.alphas);
});

// --- tiga kelompok garis <-> theta, alpha, beta -----------------------------------------------------
const LENS = [610, 607, 563, 508, 504, 452, 433, 425, 408, 393, 388, 379, 357, 338, 329, 324, 318, 291, 260, 253, 249, 247, 244, 236, 229, 207, 200, 168, 166, 106, 97, 88, 72, 62, 61];

test('assignFamilies: tiap kelompok membawa sekitar sepertiga panjang total; terpanjang = theta, terpendek = beta', () => {
  const fam = assignFamilies(LENS);
  const total = LENS.reduce((a, c) => a + c, 0);
  const share = [0, 0, 0];
  LENS.forEach((l, i) => { share[fam[i]] += l; });
  for (const x of share) assert.ok(x / total > 0.25 && x / total < 0.42, `porsi ${share.map((v) => (v / total).toFixed(2))}`);
  const lensOf = (f) => LENS.filter((_, i) => fam[i] === f);
  assert.ok(Math.min(...lensOf(0)) >= Math.max(...lensOf(1)) && Math.min(...lensOf(1)) >= Math.max(...lensOf(2)), 'urut menurut panjang');
  const n = [0, 1, 2].map((f) => lensOf(f).length);
  assert.ok(n[0] < n[1] && n[1] < n[2], `garis panjang lebih sedikit: ${n}`);
});

test('createBrain: kelompok tiap lipatan korteks sesuai panjangnya; kontur tanpa kelompok; otak kecil di luar kelompok', () => {
  const b = createBrain();
  for (let li = 0; li < b.foldFrom; li++) assert.equal(b.family[li], 255);
  const len = (li) => { let t = 0; const s0 = b.start[li]; const m = b.len[li]; for (let i = 0; i < m; i++) t += b.segLen[s0 + i]; return t; };
  const by = [[], [], []];
  let cb = 0;
  for (let li = b.foldFrom; li < b.lines; li++) { if (b.family[li] === 3) cb++; else by[b.family[li]].push(len(li)); }
  assert.ok(cb >= 5, `folia otak kecil harus kelompok 3 (netral): ${cb}`);
  assert.equal(cb, BRAIN.folds.filter((l) => l.tag === 'cb').length);
  assert.ok(by.every((a) => a.length > 0), 'tiap kelompok punya garis');
  assert.ok(Math.min(...by[0]) >= Math.max(...by[1]) - 1e-6 && Math.min(...by[1]) >= Math.max(...by[2]) - 1e-6);
});

test('pickFamily: bobot = lantai + level; level tinggi lebih sering terpilih, kelompok lain tetap mungkin', () => {
  assert.equal(pickFamily([1, 0, 0], 0.5), 0);
  assert.equal(pickFamily([0, 1, 0], 0.5), 1);
  assert.equal(pickFamily([0, 0, 1], 0.5), 2);
  assert.equal(pickFamily([0.5, 0.5, 0.5], 0.1), 0);
  assert.equal(pickFamily([0.5, 0.5, 0.5], 0.5), 1);
  assert.equal(pickFamily([0.5, 0.5, 0.5], 0.9), 2);
  assert.equal(pickFamily([1, 0, 0], 0.999), 2, 'kelompok berlevel 0 tetap bisa terpilih (lantai)');
  const FL = CONFIG.brain.bands.floor;
  let theta = 0;
  for (let r = 0; r < 1; r += 0.001) if (pickFamily([1, 0, 0], r) === 0) theta++;
  assert.ok(Math.abs(theta / 1000 - (1 + FL) / (1 + 3 * FL)) < 0.01, `theta ${theta / 1000}`);
});

test('stepBrain: level gelombang mengejar target dengan halus (tanpa kedip) dan kembali netral bila data hilang', () => {
  const b = createBrain();
  assert.deepEqual(brainStats(b).levels, [0.5, 0.5, 0.5]);
  const d = { pos: 0.5, density: 0, noSig: 0, theta: 1, alpha: 0, beta: 0.5 };
  let prev = 0.5; let maxStep = 0;
  for (let i = 0; i < 400; i++) {
    stepBrain(b, 0.016, d);
    const l = brainStats(b).levels[0];
    maxStep = Math.max(maxStep, Math.abs(l - prev));
    prev = l;
  }
  const lv = brainStats(b).levels;
  assert.ok(Math.abs(lv[0] - 1) < 0.02 && Math.abs(lv[1]) < 0.02 && Math.abs(lv[2] - 0.5) < 0.02, String(lv));
  assert.ok(maxStep < 0.02, `lompatan ${maxStep}`);
  const gone = { pos: 0.5, density: 0, noSig: 0, theta: null, alpha: undefined, beta: null };
  for (let i = 0; i < 600; i++) stepBrain(b, 0.016, gone);
  assert.ok(brainStats(b).levels.every((x) => Math.abs(x - 0.5) < 0.02), String(brainStats(b).levels));
});

test('drawBrain: terang dasar tiap kelompok mengikuti levelnya; tanpa data semua sama (netral)', () => {
  const g = createGeom(1920, 1080, 'wide');
  const alphasFor = (d) => {
    const b = createBrain();
    for (let i = 0; i < 600; i++) stepBrain(b, 0.016, d);
    const { ctx, rec } = fakeCtx(1920, 1080);
    drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
    return rec.alphas.slice(1, 4); // kontur lalu theta, alpha, beta
  };
  const [t, a, bt] = alphasFor(drive({ theta: 1, alpha: 0.5, beta: 0 }));
  assert.ok(t > a && a > bt, `${t} ${a} ${bt}`);
  const neutral = alphasFor(drive({}));
  assert.ok(neutral.every((x) => Math.abs(x - neutral[0]) < 1e-9), String(neutral));
  assert.deepEqual(alphasFor(drive({ theta: 0.5, alpha: 0.5, beta: 0.5 })), neutral);
});

test('drawBrain: otak kecil tidak ikut level gelombang (terangnya tetap)', () => {
  const g = createGeom(1920, 1080, 'wide');
  const cbAlpha = (d) => {
    const b = createBrain();
    for (let i = 0; i < 600; i++) stepBrain(b, 0.016, d);
    const { ctx, rec } = fakeCtx(1920, 1080);
    drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
    assert.ok(Number.isFinite(rec.alphas[4]), 'harus ada goresan kelima (otak kecil)');
    return rec.alphas[4]; // kontur, theta, alpha, beta, lalu otak kecil
  };
  assert.equal(cbAlpha(drive({ theta: 1, alpha: 0, beta: 0 })), cbAlpha(drive({ theta: 0, alpha: 0, beta: 1 })));
  assert.equal(cbAlpha(drive({ theta: 1, alpha: 1, beta: 1 })), cbAlpha(drive({})));
});

test('sparkBrain: kelompok dipilih menurut level, jadi theta dominan saat theta tinggi dan beta dominan saat beta tinggi', () => {
  const run = (levels) => {
    const b = createBrain();
    const d = drive(levels);
    for (let i = 0; i < 600; i++) stepBrain(b, 0.016, d);
    const counts = [0, 0, 0];
    let r = 0.123;
    const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
    for (let i = 0; i < 300; i++) {
      const s = sparkBrain(b, key('KeyA'), 'zone', 1000 + i * 2000, rnd);
      counts[b.spark.fam[s]]++;
      b.spark.active.fill(0); b.spark.count = 0; b.energy.fill(0);
    }
    return counts;
  };
  const th = run({ theta: 1, alpha: 0, beta: 0 });
  assert.ok(th[0] > th[1] + th[2], `theta dominan: ${th}`);
  const be = run({ theta: 0, alpha: 0, beta: 1 });
  assert.ok(be[2] > be[0] + be[1], `beta dominan: ${be}`);
  assert.ok(run({}).every((c) => c > 60), 'netral: merata');
});

test('sparkBrain: lipatan yang menyala berada di kelompok terpilih; theta lebih lambat dan berekor lebih panjang daripada beta', () => {
  const speeds = []; const trails = [];
  for (const [levels, fam] of [[{ theta: 1, alpha: 0, beta: 0 }, 0], [{ theta: 0, alpha: 1, beta: 0 }, 1], [{ theta: 0, alpha: 0, beta: 1 }, 2]]) {
    const b = createBrain();
    const d = drive(levels);
    for (let i = 0; i < 600; i++) stepBrain(b, 0.016, d);
    const s = sparkBrain(b, key('KeyF'), 'exact', 1000, seq(0.5));
    assert.equal(b.spark.fam[s], fam);
    assert.equal(b.family[b.spark.line[s]], fam, 'percikan berjalan di garis kelompoknya');
    let lit = 0;
    for (let li = b.foldFrom; li < b.lines; li++) if (b.energy[li] > 0) { lit++; assert.equal(b.family[li], fam, `garis ${li} menyala di luar kelompok`); }
    assert.ok(lit >= 1);
    speeds.push(b.spark.speed[s]); trails.push(b.spark.trailLen[s]);
  }
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2], `kecepatan ${speeds}`);
  assert.ok(trails[0] > trails[1] && trails[1] > trails[2], `ekor ${trails}`);
});
