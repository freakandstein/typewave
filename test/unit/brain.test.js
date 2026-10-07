import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { BRAIN } from '../../src/data/brain.js';
import { viewOf, perspK, projectInto, PITCH } from '../../src/core/orbit.js';
import { createGeom } from '../../src/render/scene.js';
import { createBrain, brainRect, brainMotion, sparkBrain, stepBrain, drawBrain, brainStats, assignFamilies, pickFamily, depthShade, trailPoints, bucketAlpha } from '../../src/render/brain.js';

const SP = CONFIG.brain.spark;
const TAU = 2 * Math.PI;
const drive = (o = {}) => ({ pos: 0.5, density: 0, noSig: 0, ...o });
const still = (o = {}) => drive({ spin: 0, ...o }); // putaran dihentikan (pengali 0), supaya sudut tetap
const key = (code, o = {}) => ({ code, rep: false, cls: 'char', modifier: false, ...o });
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const linesOfKind = (k) => BRAIN.kinds.map((x, i) => (x === k ? i : -1)).filter((i) => i >= 0);

function fakeCtx(W, H, { log = false } = {}) {
  const rec = { strokes: 0, fills: 0, alphas: [], fillAlphas: [], widths: [], strokeCalls: [], pathCalls: 0, bad: [], calls: 0, ops: [], arcs: [], fillStyles: [], strokeStyles: [] };
  const chk = (...n) => { for (const v of n) if (!Number.isFinite(v) || v < -60 || v > Math.max(W, H) + 60) rec.bad.push(v); };
  const ctx = {
    globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '', lineJoin: '', lineCap: '',
    beginPath() { rec.pathCalls = 0; if (log) rec.ops.push('b'); }, closePath() {},
    moveTo: (x, y) => { chk(x, y); rec.calls++; rec.pathCalls++; if (log) rec.ops.push(`m${x.toFixed(3)},${y.toFixed(3)}`); },
    lineTo: (x, y) => { chk(x, y); rec.calls++; rec.pathCalls++; if (log) rec.ops.push(`l${x.toFixed(3)},${y.toFixed(3)}`); },
    arc: (x, y, r) => { chk(x, y); if (!(r >= 0)) rec.bad.push(r); rec.arcs.push({ x, y, r, alpha: ctx.globalAlpha }); },
    stroke() { rec.strokeStyles.push(ctx.strokeStyle); rec.strokes++; rec.alphas.push(ctx.globalAlpha); rec.widths.push(ctx.lineWidth); rec.strokeCalls.push(rec.pathCalls); if (log) rec.ops.push(`s${ctx.globalAlpha.toFixed(4)},${ctx.lineWidth.toFixed(3)}`); },
    fill() { rec.fillStyles.push(ctx.fillStyle); rec.fills++; rec.alphas.push(ctx.globalAlpha); rec.fillAlphas.push(ctx.globalAlpha); },
  };
  return { ctx, rec };
}

// Titik istirahat (tanpa agitasi) diproyeksikan pada sudut b.yaw, ke koordinat kotak desain.
function restPosition(b, i) {
  const X = new Float64Array(1); const Y = new Float64Array(1); const D = new Float64Array(1);
  projectInto(viewOf(b.yaw, PITCH), perspK(BRAIN.unit), b.x[i], b.y[i], b.z[i], X, Y, D, 0);
  return [BRAIN.w / 2 + X[0], BRAIN.h / 2 - Y[0], D[0]];
}

// --- geometri kotak ----------------------------------------------------------------------------
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
test('createBrain: jenis garis menentukan peran: lipatan berkelompok, otak kecil tetap, celah dan batang otak diam', () => {
  const b = createBrain();
  assert.equal(b.lines, BRAIN.kinds.length);
  for (let li = 0; li < b.lines; li++) {
    const k = BRAIN.kinds[li];
    if (k === 0) assert.ok(b.family[li] <= 2, `lipatan ${li} kelompok ${b.family[li]}`);
    else if (k === 2) assert.equal(b.family[li], 3, 'otak kecil di luar kelompok');
    else assert.equal(b.family[li], 255, 'celah utama dan batang otak tanpa kelompok');
    assert.equal(b.mobile[li], k === 0 || k === 2 ? 1 : 0, `gerak garis ${li}`);
    assert.equal(b.lit[li], k === 0 || k === 2 ? 1 : 0, `nyala garis ${li}`);
  }
});

test('createBrain: kelompok tiap lipatan mengikuti panjang garis labirin utuhnya (semua bagian satu rantai sekelompok); tiap kelompok sepertiga panjang total', () => {
  const b = createBrain();
  const len = (li) => { let t = 0; for (let i = 0; i < b.len[li] - 1; i++) t += b.segLen[b.start[li] + i]; return t; };
  const chainLen = new Map();
  const chainFam = new Map();
  for (const li of linesOfKind(0)) {
    chainLen.set(b.chain[li], (chainLen.get(b.chain[li]) ?? 0) + len(li));
    if (chainFam.has(b.chain[li])) assert.equal(b.family[li], chainFam.get(b.chain[li]), `rantai ${b.chain[li]} terbagi ke dua kelompok`);
    chainFam.set(b.chain[li], b.family[li]);
  }
  const by = [[], [], []];
  for (const [c, l] of chainLen) by[chainFam.get(c)].push(l);
  assert.ok(by.every((a) => a.length > 0), 'tiap kelompok punya garis');
  assert.ok(Math.min(...by[0]) >= Math.max(...by[1]) - 1e-6 && Math.min(...by[1]) >= Math.max(...by[2]) - 1e-6, 'terpanjang = theta, terpendek = beta');
  const total = by.flat().reduce((a, c) => a + c, 0);
  for (const a of by) { const s = a.reduce((x, y) => x + y, 0) / total; assert.ok(s > 0.25 && s < 0.42, `porsi ${s}`); }
  assert.ok(by[0].length < by[1].length && by[1].length < by[2].length, `garis panjang lebih sedikit: ${by.map((a) => a.length)}`);
  const pieces = [0, 1, 2].map((f) => linesOfKind(0).filter((li) => b.family[li] === f).length);
  assert.ok(pieces.every((n) => n >= 40), `tiap kelompok punya cukup bagian agar nyala percikan lokal: ${pieces}`);
});

test('createBrain: dua instans tidak berbagi keadaan (data tetap dipakai bersama, keadaan kerja milik masing-masing)', () => {
  const a = createBrain();
  const b = createBrain();
  sparkBrain(a, key('KeyF'), 'exact', 1000, seq(0.5));
  stepBrain(a, 0.1, drive({ theta: 1 }));
  assert.equal(brainStats(a).sparks, 1);
  assert.equal(brainStats(b).sparks, 0);
  assert.equal(brainStats(b).lit, 0);
  assert.deepEqual(brainStats(b).levels, [0.5, 0.5, 0.5]);
});

// --- proyeksi dan putaran ------------------------------------------------------------------------
test('createBrain memproyeksikan otak pada sudut awal; stepBrain memakai proyeksi bersama (orbit) ke koordinat kotak desain', () => {
  const b = createBrain(BRAIN, 0.9);
  assert.equal(b.yaw, 0.9);
  stepBrain(b, 0, still({ noSig: 1 }));
  for (const i of [0, 7, 400, 2500, b.n - 1]) {
    const [x, y, d] = restPosition(b, i);
    assert.ok(Math.abs(b.dx[i] - x) < 0.02 && Math.abs(b.dy[i] - y) < 0.02, `titik ${i}: ${b.dx[i]},${b.dy[i]} vs ${x},${y}`);
    assert.ok(Math.abs(b.dd[i] - d) < 0.02, 'kedalaman');
  }
  for (let i = 0; i < b.n; i++) assert.ok(b.dx[i] >= 0 && b.dx[i] <= BRAIN.w && b.dy[i] >= 0 && b.dy[i] <= BRAIN.h, `titik ${i} di luar kotak`);
});

test('putaran: kecepatan tetap CONFIG.brain.spin, apa pun masukannya (pos, tanpa sinyal, density, level, ketikan)', () => {
  const run = (d, typing = false) => {
    const b = createBrain(BRAIN, 0);
    for (let i = 0; i < 100; i++) {
      if (typing && i % 10 === 0) sparkBrain(b, key('KeyA'), 'zone', 1000 + i * 100);
      stepBrain(b, 0.016, d);
    }
    return b.yaw;
  };
  const expected = (CONFIG.brain.spin * 1.6) % TAU;
  assert.ok(CONFIG.brain.spin > 0 && CONFIG.brain.spin < 1, 'perlahan');
  for (const [d, typing] of [[drive(), false], [drive({ pos: 0.05 }), false], [drive({ pos: 0.95, density: 8 }), true], [drive({ noSig: 1 }), false], [drive({ theta: 1, alpha: 0, beta: 0.2 }), true]]) {
    assert.ok(Math.abs(run(d, typing) - expected) < 1e-6, `yaw ${run(d, typing)} vs ${expected}`);
  }
});

test('putaran: pengali spin 0 menghentikan, sudut selalu di dalam 0..2π, dan dt besar tidak melompat', () => {
  const b = createBrain(BRAIN, 1.2);
  for (let i = 0; i < 50; i++) stepBrain(b, 0.016, still());
  assert.equal(b.yaw, 1.2);
  const c = createBrain(BRAIN, TAU - 0.01);
  stepBrain(c, 0.5, drive());
  assert.ok(c.yaw >= 0 && c.yaw < TAU, `yaw ${c.yaw}`);
  assert.ok(Math.abs(c.yaw - ((TAU - 0.01 + CONFIG.brain.spin * 0.5) % TAU)) < 1e-9);
  const d = createBrain();
  assert.equal(d.yaw, CONFIG.brain.yaw0);
});

test('putaran: tiap titik bergeser di layar saat otak berputar (bukan hanya sudutnya yang berubah)', () => {
  const b = createBrain(BRAIN, 0.3);
  const before = Array.from(b.dx.subarray(0, 50));
  for (let i = 0; i < 30; i++) stepBrain(b, 0.016, drive({ noSig: 1 }));
  assert.ok(Array.from(b.dx.subarray(0, 50)).some((x, i) => Math.abs(x - before[i]) > 1));
});

// --- agitasi lipatan ------------------------------------------------------------------------------
test('stepBrain: tanpa sinyal tidak ada pergeseran; tegang menggeser lipatan lebih jauh daripada tenang; celah utama dan batang otak tetap diam', () => {
  const shift = (d, kinds) => {
    const b = createBrain();
    for (let i = 0; i < 120; i++) stepBrain(b, 0.016, d);
    let m = 0;
    for (const k of kinds) for (const li of linesOfKind(k)) {
      for (let i = b.start[li]; i < b.start[li] + b.len[li]; i++) { const [x, y] = restPosition(b, i); m = Math.max(m, Math.hypot(b.dx[i] - x, b.dy[i] - y)); }
    }
    return m;
  };
  assert.ok(shift(still({ pos: 0.95, noSig: 1 }), [0, 2]) < 0.02, 'tanpa sinyal diam');
  const tense = shift(still({ pos: 0.95 }), [0, 2]);
  const calm = shift(still({ pos: 0.05 }), [0, 2]);
  assert.ok(tense > 1 && tense > calm * 1.5, `tegang ${tense} tenang ${calm}`);
  assert.ok(shift(still({ pos: 0.95 }), [1, 3]) < 0.02, 'celah utama dan batang otak diam');
});

// --- percikan ---------------------------------------------------------------------------------
test('sparkBrain exact: tombol kiri memulai di sisi kiri otak di layar, tombol kanan di sisi kanan, pada permukaan yang menghadap kamera', () => {
  const b = createBrain();
  const start = (code) => {
    const s = sparkBrain(b, key(code), 'exact', 1000, seq(0.5));
    assert.ok(s >= 0);
    return b.start[b.spark.line[s]] + b.spark.seg[s];
  };
  const q = start('KeyQ');
  const p = start('KeyP');
  assert.ok(b.dx[q] < b.dx[p], 'Q kiri dari P');
  assert.ok(b.dx[q] < 0.5 * BRAIN.w && b.dx[p] > 0.5 * BRAIN.w, `Q ${b.dx[q]} P ${b.dx[p]}`);
  assert.ok(b.df[q] > 0 && b.df[p] > 0, 'dimulai di sisi yang terlihat');
  assert.equal(BRAIN.kinds[b.lineOf[q]], 0, 'percikan berjalan di lipatan korteks');
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
  assert.ok(brainStats(c).lit >= linesOfKind(0).length, `lit ${brainStats(c).lit}`);
  for (const li of [...linesOfKind(1), ...linesOfKind(3)]) assert.equal(c.energy[li], 0, 'celah dan batang otak tidak ikut menyala');
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

test('sparkBrain: garis yang tertutup (kontur yang menyambung ke dirinya) dilalui terus; garis terbuka berhenti di ujungnya', () => {
  const b = createBrain();
  let closed = -1; let open = -1;
  for (const li of linesOfKind(0)) { if (b.closed[li] && closed < 0) closed = li; if (!b.closed[li] && b.len[li] > 6 && open < 0) open = li; }
  assert.ok(closed >= 0 && open >= 0, `garis tertutup ${closed}, terbuka ${open}`);
  const run = (li) => {
    const c = createBrain();
    const S = c.spark;
    S.active[0] = 1; S.count = 1; S.line[0] = li; S.seg[0] = 0; S.t[0] = 0.5; S.dir[0] = 1; S.age[0] = 0; S.life[0] = 60; S.a[0] = 1; S.e[0] = 1; S.trailLen[0] = 10; S.speed[0] = 2000; S.fam[0] = 0;
    for (let i = 0; i < 300; i++) stepBrain(c, 0.016, still());
    return S.active[0];
  };
  assert.equal(run(closed), 1, 'garis tertutup tidak berujung');
  assert.equal(run(open), 0, 'garis terbuka habis di ujungnya');
});

// --- data kecil buatan sendiri: untuk jalur yang jarang terjadi pada data asli ------------------------------------------------------
// lines: [{ kind, pts: [[x, y, z]...] (satuan desain), n: [nx, ny, nz] (Int8, 100 = satu) }]; nilai bawaan normal: ke atas.
function miniData(lines) {
  const n = lines.reduce((t, l) => t + l.pts.length, 0);
  const pos = new DataView(new ArrayBuffer(n * 6));
  const nrm = new Int8Array(n * 3);
  let o = 0;
  for (const l of lines) for (const p of l.pts) { p.forEach((v, c) => pos.setInt16(o * 6 + c * 2, Math.round(v * 32), true)); (l.n ?? [0, 0, 100]).forEach((v, c) => { nrm[o * 3 + c] = v; }); o++; }
  return { w: BRAIN.w, h: BRAIN.h, unit: BRAIN.unit, kinds: lines.map((l) => l.kind), counts: lines.map((l) => l.pts.length), pos: Buffer.from(pos.buffer).toString('base64'), nrm: Buffer.from(nrm.buffer).toString('base64') };
}
const ROW = [[-200, 0, 0], [-120, 0, 0], [-40, 0, 0], [40, 0, 0], [120, 0, 0], [200, 0, 0]];
const LOOP = [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0], [0, 0, 0]]; // garis tertutup (titik pertama = terakhir), 4 segmen sepanjang 100

test('sparkBrain: kelompok yang dipilih tidak punya garis di sisi yang terlihat: dipakai garis kelompok itu di sisi mana pun, lalu lipatan apa pun', () => {
  // satu lipatan, normal menghadap menjauh dari kamera (yaw 0: kamera di sisi x negatif, jadi normal +x = belakang), jadi masuk kelompok 1 (alpha)
  const b = createBrain(miniData([{ kind: 0, pts: ROW, n: [100, 0, 0] }]), 0);
  assert.ok(b.df[0] < -0.5, `menghadap menjauh ${b.df[0]}`);
  assert.equal(b.family[0], 1);
  const s1 = sparkBrain(b, key('KeyA'), 'exact', 1000, seq(0.5, 0.5, 0.5)); // want = kelompok 1
  assert.ok(s1 >= 0, 'tahap 1: kelompok yang sama di sisi belakang');
  assert.equal(b.spark.fam[s1], 1);
  const c = createBrain(miniData([{ kind: 0, pts: ROW, n: [100, 0, 0] }]), 0);
  const s2 = sparkBrain(c, key('KeyA'), 'exact', 1000, seq(0.5, 0.1, 0.5)); // want = kelompok 0, yang tidak punya garis
  assert.ok(s2 >= 0, 'tahap 2: lipatan apa pun');
  assert.equal(c.spark.fam[s2], 1, 'percikan memakai kelompok garis yang ada');
  assert.equal(brainStats(c).sparks, 1);
});

test('sparkBrain: kelompok terpilih lebih diutamakan daripada kedekatan: garis kelompok itu di sisi belakang menang atas garis kelompok lain yang lebih dekat di sisi depan', () => {
  const front = [-100, 0, 0]; // normal ke kamera (yaw 0: kamera di sisi x negatif)
  const back = [100, 0, 0];
  const rowAt = (z) => ROW.map(([x, y]) => [x, y, z]);
  // dua garis sama panjang: yang pertama kelompok 0 (di depan, dekat posisi tombol), yang kedua kelompok 2 (di belakang, jauh)
  const b = createBrain(miniData([{ kind: 0, pts: rowAt(0), n: front }, { kind: 0, pts: rowAt(300), n: back }]), 0);
  assert.deepEqual([b.family[0], b.family[1]], [0, 2]);
  assert.ok(b.df[0] > 0.5 && b.df[b.start[1]] < -0.5);
  const s = sparkBrain(b, key('KeyA'), 'exact', 1000, seq(0.5, 0.9, 0.5)); // want = kelompok 2
  assert.ok(s >= 0);
  assert.equal(b.spark.fam[s], 2, 'kelompok terpilih dipertahankan');
  assert.equal(b.spark.line[s], 1);
  const c = createBrain(miniData([{ kind: 0, pts: rowAt(0), n: front }, { kind: 0, pts: rowAt(300), n: front }]), 0);
  const s2 = sparkBrain(c, key('KeyA'), 'exact', 1000, seq(0.5, 0.9, 0.5));
  assert.equal(c.spark.line[s2], 1, 'bila kelompok itu juga terlihat, ia dipilih pada tahap pertama');
});

test('drawBrain: kepala percikan di tepi otak (separuh menghadap kamera) terangnya di antara depan dan belakang, tanpa lompatan', () => {
  const rows = [[-100, 0, 0], [0, 100, 0], [100, 0, 0]].map((n, i) => ({ kind: 0, pts: ROW.map(([x, y, z]) => [x, y + i * 150, z]), n })); // depan, tepi (df 0), belakang
  const b = createBrain(miniData(rows), 0);
  assert.ok(b.df[0] > 0.9 && Math.abs(b.df[b.start[1]]) < 0.2 && b.df[b.start[2]] < -0.9, `df ${b.df[0]}, ${b.df[b.start[1]]}, ${b.df[b.start[2]]}`);
  const S = b.spark;
  for (let k = 0; k < 3; k++) { S.active[k] = 1; S.line[k] = k; S.seg[k] = 0; S.t[k] = 0; S.dir[k] = 1; S.age[k] = 0; S.life[k] = 1; S.a[k] = 1; S.e[k] = 1; S.trailLen[k] = 20; S.speed[k] = 0; S.fam[k] = 0; }
  S.count = 3;
  const { ctx, rec } = fakeCtx(1920, 1080);
  drawBrain(ctx, b, createGeom(1920, 1080, 'wide'), 'rgb(1,2,3)', still());
  const [front, edge, back] = rec.fillAlphas;
  assert.ok(front > edge && edge > back && back > 0, `depan ${front}, tepi ${edge}, belakang ${back}`);
});

test('sparkBrain: tanpa lipatan sama sekali tidak ada percikan dan tidak ada yang menyala', () => {
  const b = createBrain(miniData([{ kind: 2, pts: ROW }, { kind: 3, pts: ROW }]), 0);
  assert.equal(b.foldEnd, 0);
  assert.equal(sparkBrain(b, key('KeyA'), 'exact', 1000, seq(0.5)), -1);
  assert.equal(brainStats(b).sparks, 0);
  assert.equal(brainStats(b).lit, 0);
  sparkBrain(b, key('Enter', { cls: 'enter' }), 'zone', 1000);
  assert.equal(b.energy[1], 0, 'batang otak tidak menyala oleh Enter');
});

test('percikan di garis tertutup melingkar ke depan dan ke belakang, dan jejaknya ikut melingkar', () => {
  const g = createGeom(1920, 1080, 'wide');
  const make = () => { const b = createBrain(miniData([{ kind: 0, pts: LOOP }]), 0); assert.equal(b.closed[0], 1); return b; };
  const place = (b, seg, t, dir, speed, trailLen) => { const S = b.spark; S.active[0] = 1; S.count = 1; S.line[0] = 0; S.seg[0] = seg; S.t[0] = t; S.dir[0] = dir; S.age[0] = 0; S.life[0] = 60; S.a[0] = 1; S.e[0] = 1; S.trailLen[0] = trailLen; S.speed[0] = speed; S.fam[0] = 1; };
  // maju: dari segmen 3 pada 75% sejauh 100 satuan: melewati titik akhir, kembali ke segmen 0 pada 75%
  let b = make();
  place(b, 3, 0.75, 1, 1000, 10);
  stepBrain(b, 0.1, still({ noSig: 1 }));
  assert.equal(b.spark.active[0], 1);
  assert.equal(b.spark.seg[0], 0);
  assert.ok(Math.abs(b.spark.t[0] - 0.75) < 1e-5, `t ${b.spark.t[0]}`);
  // mundur: dari segmen 0 pada 25% sejauh 100 satuan: kembali ke segmen 3 pada 25%
  b = make();
  place(b, 0, 0.25, -1, 1000, 10);
  stepBrain(b, 0.1, still({ noSig: 1 }));
  assert.equal(b.spark.active[0], 1);
  assert.equal(b.spark.seg[0], 3);
  assert.ok(Math.abs(b.spark.t[0] - 0.25) < 1e-5, `t ${b.spark.t[0]}`);
  // jejak: kepala di segmen 0 pada 50% (maju), jejak 130 satuan: ke titik 0 (50), lalu ke belakang melewati ujung ke segmen 3, berhenti pada 20% dari titik 4 (80 satuan lagi)
  b = make();
  stepBrain(b, 0, still({ noSig: 1 }));
  drawBrain(fakeCtx(1920, 1080).ctx, b, g, 'rgb(1,2,3)', still({ noSig: 1 }));
  place(b, 0, 0.5, 1, 0, 130);
  const n = trailPoints(b, 0);
  assert.equal(n, 3);
  const P = (k) => [b.sx[k], b.sy[k]];
  const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const want = [lerp2(P(0), P(1), 0.5), P(0), lerp2(P(3), P(4), 0.2)];
  want.forEach((w, q) => assert.ok(Math.hypot(b.trail[q * 2] - w[0], b.trail[q * 2 + 1] - w[1]) < 1e-2, `titik jejak ${q}: ${b.trail[q * 2]},${b.trail[q * 2 + 1]} vs ${w}`));
  // jejak mundur: kepala di segmen 3 pada 90% (mundur), jejak 40 satuan: ke titik 4 (10), lalu melewati ujung ke segmen 0, berhenti pada 30% dari titik 0
  place(b, 3, 0.9, -1, 0, 40);
  const m = trailPoints(b, 0);
  assert.equal(m, 3);
  const want2 = [lerp2(P(3), P(4), 0.9), P(4), lerp2(P(0), P(1), 0.3)];
  want2.forEach((w, q) => assert.ok(Math.hypot(b.trail[q * 2] - w[0], b.trail[q * 2 + 1] - w[1]) < 1e-2, `titik jejak mundur ${q}: ${b.trail[q * 2]},${b.trail[q * 2 + 1]} vs ${w}`));
});

// --- gambar ------------------------------------------------------------------------------------
test('drawBrain: semua koordinat berhingga di dalam kanvas, alpha 0..1, ada garis dan percikan', () => {
  for (const layout of ['wide', 'tall']) {
    const [W, H] = layout === 'wide' ? [1920, 1080] : [1080, 1920];
    const g = createGeom(W, H, layout);
    const b = createBrain();
    for (const c of ['KeyA', 'KeyK', 'Space', 'ShiftLeft']) sparkBrain(b, key(c, c === 'ShiftLeft' ? { cls: 'other', modifier: true } : {}), 'zone', 1000);
    const { ctx, rec } = fakeCtx(W, H);
    stepBrain(b, 0, drive({ pos: 0.9, density: 6 })); // dt 0: percikan acak yang mulai di ujung garis tidak habis sebelum digambar
    drawBrain(ctx, b, g, 'rgb(142,216,208)', drive({ pos: 0.9, density: 6 }));
    assert.deepEqual(rec.bad, [], layout);
    assert.ok(rec.strokes >= 3, `garis ${rec.strokes}`);
    assert.ok(rec.alphas.every((a) => a >= 0 && a <= 1), String(rec.alphas));
    assert.ok(rec.widths.every((w) => w > 0), String(rec.widths));
    assert.ok(rec.fills >= 4, `kepala percikan ${rec.fills}`);
  }
});

test('drawBrain di semua sudut putar: koordinat di dalam kotak otak pada kanvas', () => {
  const g = createGeom(1920, 1080, 'wide');
  const R = brainRect(g);
  const b = createBrain();
  for (let a = 0; a < 24; a++) {
    b.yaw = (a / 24) * TAU;
    stepBrain(b, 0, still());
    const { ctx, rec } = fakeCtx(1920, 1080);
    drawBrain(ctx, b, g, 'rgb(1,2,3)', still());
    assert.deepEqual(rec.bad, []);
    for (let i = 0; i < b.n; i++) assert.ok(b.sx[i] >= R.x0 - 0.5 && b.sx[i] <= R.x0 + R.w + 0.5 && b.sy[i] >= R.y0 - 0.5 && b.sy[i] <= R.y0 + R.h + 0.5, `sudut ${a} titik ${i}: ${b.sx[i]},${b.sy[i]}`);
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

test('depthShade: sisi yang separuh menghadap kamera berada di antara belakang dan depan (transisi halus)', () => {
  for (const t of [0.2, 0.6, 1]) {
    const lo = depthShade(t, 0);
    const hi = depthShade(t, 1);
    const mid = depthShade(t, 0.5);
    assert.ok(mid > lo && mid < hi, `pada ${t}: ${lo} < ${mid} < ${hi}`);
    assert.equal(depthShade(t, true), hi);
    assert.equal(depthShade(t, false), lo);
  }
});

test('depthShade: makin dekat makin terang, sisi belakang lebih redup tetapi tidak hilang (tembus pandang)', () => {
  const D = CONFIG.brain.depth;
  assert.equal(depthShade(1, true), 1);
  assert.ok(Math.abs(depthShade(0, true) - D.far) < 1e-12);
  let prev = -1;
  for (let t = 0; t <= 1; t += 0.05) { const v = depthShade(t, true); assert.ok(v > prev, `naik pada ${t}`); prev = v; }
  for (const t of [0, 0.3, 0.7, 1]) {
    assert.ok(depthShade(t, false) < depthShade(t, true), `belakang lebih redup pada ${t}`);
    assert.ok(depthShade(t, false) > 0, 'belakang tetap terlihat');
    assert.ok(Math.abs(depthShade(t, false) - D.back * depthShade(t, true)) < 1e-12);
  }
  assert.ok(depthShade(-3, true) === depthShade(0, true) && depthShade(3, true) === 1, 'dijepit');
});

test('drawBrain: tembus pandang: hampir semua garis tergambar, termasuk yang menghadap menjauh dari kamera', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  stepBrain(b, 0, still());
  let front = 0; let back = 0;
  for (let li = 0; li < b.lines; li++) {
    for (let i = b.start[li]; i < b.start[li] + b.len[li] - 1; i++) { if ((b.df[i] + b.df[i + 1]) / 2 > -0.02) front++; else back++; }
  }
  assert.ok(front > 500 && back > 500, `sisi depan ${front}, belakang ${back}`);
  const { ctx } = fakeCtx(1920, 1080);
  drawBrain(ctx, b, g, 'rgb(1,2,3)', still());
  const S = brainStats(b);
  assert.ok(S.drawn - S.drawnBack >= 0.95 * front, `depan tergambar ${S.drawn - S.drawnBack} dari ${front}`);
  assert.ok(S.drawnBack >= 0.25 * back && S.drawnBack > 300, `belakang tergambar ${S.drawnBack} dari ${back}`);
});

test('drawBrain: biaya tetap: jumlah perintah jalur tidak lebih dari dua per segmen, goresan sedikit', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  stepBrain(b, 0, drive());
  const { ctx, rec } = fakeCtx(1920, 1080);
  drawBrain(ctx, b, g, 'rgb(1,2,3)', drive());
  const segs = b.n - b.lines;
  assert.ok(rec.calls <= 2 * segs, `perintah jalur ${rec.calls} untuk ${segs} segmen`);
  assert.ok(rec.calls < 1.4 * segs, `garis berurutan disambung tanpa moveTo: ${rec.calls}`);
  assert.ok(rec.strokes <= 100, `goresan ${rec.strokes}`);
});

test('drawBrain: otak tidak berdenyut: dengan masukan tetap dan putaran berhenti, gambar dari frame ke frame persis sama', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  const d = still({ noSig: 1, density: 3 });
  const snap = () => { const { ctx, rec } = fakeCtx(1920, 1080, { log: true }); drawBrain(ctx, b, g, 'rgb(1,2,3)', d); return rec.ops.join('|'); };
  stepBrain(b, 0.016, d);
  const first = snap();
  for (let i = 0; i < 60; i++) stepBrain(b, 0.016, d);
  assert.equal(snap(), first);
});

test('drawBrain: celah utama dan batang otak tidak bergerak oleh agitasi walau lipatan bergerak', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  const d = still({ pos: 0.95 });
  stepBrain(b, 0.016, d);
  const { ctx } = fakeCtx(1920, 1080);
  drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
  const pick = () => [...linesOfKind(1), ...linesOfKind(3)].flatMap((li) => Array.from(b.sx.subarray(b.start[li], b.start[li] + b.len[li])));
  const first = pick();
  const foldFirst = Array.from(b.sx.subarray(0, 40));
  for (let i = 0; i < 40; i++) stepBrain(b, 0.016, d);
  drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
  assert.deepEqual(pick(), first);
  assert.ok(Array.from(b.sx.subarray(0, 40)).some((x, i) => x !== foldFirst[i]), 'lipatan bergerak');
});

test('sparkBrain: kapasitas penuh: percikan baru mendaur ulang yang tertua dan jumlahnya tetap kapasitas', () => {
  const b = createBrain();
  for (let i = 0; i < SP.cap; i++) { const s = sparkBrain(b, key('KeyA'), 'zone', 1000 + i); assert.ok(s >= 0); b.spark.age[s] = 0.5 - i * 0.01; } // yang dibuat lebih awal lebih tua
  assert.equal(brainStats(b).sparks, SP.cap);
  let oldest = 0;
  for (let i = 1; i < SP.cap; i++) if (b.spark.age[i] > b.spark.age[oldest]) oldest = i;
  const s = sparkBrain(b, key('KeyK'), 'zone', 5000);
  assert.equal(s, oldest, 'yang tertua diganti');
  assert.equal(b.spark.age[s], 0);
  assert.equal(brainStats(b).sparks, SP.cap);
});

test('trailPoints: jejak mengikuti garis di belakang kepala (maju: ke indeks lebih kecil, mundur: ke indeks lebih besar) sejauh trailLen', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  stepBrain(b, 0, still({ noSig: 1 }));
  drawBrain(fakeCtx(1920, 1080).ctx, b, g, 'rgb(1,2,3)', still({ noSig: 1 })); // mengisi koordinat piksel
  const li = linesOfKind(0).find((l) => b.len[l] >= 12 && !b.closed[l]);
  const s0 = b.start[li];
  const L = (k) => b.segLen[s0 + k];
  const P = (k) => [b.sx[s0 + k], b.sy[s0 + k]];
  const mid = (k, t) => [P(k)[0] + (P(k + 1)[0] - P(k)[0]) * t, P(k)[1] + (P(k + 1)[1] - P(k)[1]) * t];
  const S = b.spark;
  const read = (n) => Array.from({ length: n }, (_, q) => [b.trail[q * 2], b.trail[q * 2 + 1]]);
  const close = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-2;
  S.active[0] = 1; S.line[0] = li; S.seg[0] = 5; S.t[0] = 0.25;
  // maju: kepala di segmen 5 pada 25%; jejak melewati titik 5 dan 4, lalu berhenti di tengah segmen 3
  S.dir[0] = 1; S.trailLen[0] = 0.25 * L(5) + L(4) + 0.5 * L(3);
  let n = trailPoints(b, 0);
  let got = read(n);
  assert.equal(n, 4);
  for (const [p, q] of [[got[0], mid(5, 0.25)], [got[1], P(5)], [got[2], P(4)], [got[3], mid(3, 0.5)]]) assert.ok(close(p, q), `maju: ${p} vs ${q}`);
  // mundur: kepala di segmen 5 pada 25%; jejak ada di sisi indeks lebih besar: titik 6 dan 7, lalu tengah segmen 7
  S.dir[0] = -1; S.trailLen[0] = 0.75 * L(5) + L(6) + 0.5 * L(7);
  n = trailPoints(b, 0);
  got = read(n);
  assert.equal(n, 4);
  for (const [p, q] of [[got[0], mid(5, 0.25)], [got[1], P(6)], [got[2], P(7)], [got[3], mid(7, 0.5)]]) assert.ok(close(p, q), `mundur: ${p} vs ${q}`);
  // jejak pendek: berhenti di dalam segmen yang sama
  S.dir[0] = 1; S.trailLen[0] = 0.1 * L(5);
  n = trailPoints(b, 0);
  assert.equal(n, 2);
  assert.ok(close(read(2)[1], mid(5, 0.25 - 0.1)));
});

test('drawBrain: setiap sisi jalur yang digambar adalah segmen nyata dari satu garis (tidak ada sambungan antar garis)', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  const d = drive({ pos: 0.7, density: 5 });
  for (let i = 0; i < 20; i++) stepBrain(b, 0.016, d);
  const { ctx, rec } = fakeCtx(1920, 1080, { log: true });
  drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
  const f3 = (v) => v.toFixed(3);
  const real = new Set();
  for (let li = 0; li < b.lines; li++) for (let i = b.start[li]; i < b.start[li] + b.len[li] - 1; i++) real.add(`${f3(b.sx[i])},${f3(b.sy[i])}>${f3(b.sx[i + 1])},${f3(b.sy[i + 1])}`);
  let prev = null; let edges = 0; let stray = 0;
  for (const op of rec.ops) {
    if (op === 'b') { prev = null; continue; }
    if (op[0] !== 'm' && op[0] !== 'l') { if (op[0] === 's') prev = null; continue; }
    const pt = op.slice(1);
    if (op[0] === 'l' && prev !== null) { edges++; if (!real.has(`${prev}>${pt}`)) stray++; }
    prev = pt;
  }
  assert.ok(edges > 5000, `sisi tergambar ${edges}`);
  assert.equal(stray, 0, `${stray} sisi yang bukan segmen nyata`);
});

test('drawBrain: goresan garis digambar dari yang paling redup ke yang paling terang, dengan lebar menurut sisi dan kedalaman', () => {
  const g = createGeom(1920, 1080, 'wide'); // skala 1: lebar dalam px desain
  const b = createBrain();
  stepBrain(b, 0, still({ density: 4 }));
  const { ctx, rec } = fakeCtx(1920, 1080);
  drawBrain(ctx, b, g, 'rgb(1,2,3)', still({ density: 4 }));
  for (let i = 1; i < rec.alphas.length; i++) assert.ok(rec.alphas[i] >= rec.alphas[i - 1] - 1e-12, `urutan alpha ${rec.alphas[i - 1]} lalu ${rec.alphas[i]}`);
  const W = CONFIG.brain.width;
  const seen = new Set(rec.widths.map((w) => Math.round(w * 100) / 100));
  for (const w of W) assert.ok(seen.has(Math.max(1, w)), `lebar ${w} tidak dipakai: ${[...seen]}`);
  assert.ok(W[0] < W[1] && W[1] < W[2], 'belakang < depan jauh < depan dekat');
});

test('drawBrain: lipatan yang menyala (Enter) lebih terang dan lebih tebal daripada yang padam', () => {
  const g = createGeom(1920, 1080, 'wide');
  const sums = (enter) => {
    const b = createBrain();
    stepBrain(b, 0, still({ density: 4 }));
    if (enter) sparkBrain(b, key('Enter', { cls: 'enter' }), 'zone', 1000);
    const { ctx, rec } = fakeCtx(1920, 1080);
    drawBrain(ctx, b, g, 'rgb(1,2,3)', still({ density: 4 }));
    let alpha = 0; let width = 0;
    rec.strokeCalls.forEach((n, i) => { alpha += rec.alphas[i] * n; width += rec.widths[i] * n; });
    return { alpha, width };
  };
  const off = sums(false);
  const on = sums(true);
  assert.ok(on.alpha > off.alpha * 1.1, `terang ${on.alpha.toFixed(0)} vs ${off.alpha.toFixed(0)}`);
  assert.ok(on.width > off.width * 1.05, `tebal ${on.width.toFixed(0)} vs ${off.width.toFixed(0)}`);
});

test('bucketAlpha: tingkat alpha berskala akar: halus di bagian redup, terang penuh di tingkat tertinggi, naik terus', () => {
  const WC = 4;
  let prev = -1;
  for (let level = 0; level <= 24; level++) { const a = bucketAlpha(level * WC); assert.ok(a > prev || level === 0, `naik pada tingkat ${level}`); prev = a; assert.ok(a >= 0 && a <= 1); }
  assert.equal(bucketAlpha(24 * WC), 1);
  assert.ok(bucketAlpha(WC) < 0.005, 'tingkat 1 hampir tak terlihat, jadi garis yang muncul dari nol tidak melompat');
  assert.equal(bucketAlpha(3 * WC + 2), bucketAlpha(3 * WC), 'kelas lebar tidak memengaruhi alpha');
});

test('drawBrain: tanpa sinyal pun tembus pandang: sebagian besar garis sisi belakang tetap tergambar (hanya sangat redup)', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  const d = still({ noSig: 1 });
  stepBrain(b, 0, d);
  let back = 0;
  for (let li = 0; li < b.lines; li++) for (let i = b.start[li]; i < b.start[li] + b.len[li] - 1; i++) if ((b.df[i] + b.df[i + 1]) / 2 <= -0.03) back++;
  drawBrain(fakeCtx(1920, 1080).ctx, b, g, 'rgb(1,2,3)', d);
  assert.ok(brainStats(b).drawnBack >= 0.9 * back, `belakang tergambar ${brainStats(b).drawnBack} dari ${back}`);
});

test('drawBrain: saat berputar tidak ada garis yang tiba-tiba berganti terang (tanpa lompatan depan-belakang di tepi otak)', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  const d = drive({ pos: 0.3, density: 4 });
  const alphas = () => { const out = new Float32Array(b.nSeg); for (let s = 0; s < b.nSeg; s++) out[s] = b.bucketOf[s] === 255 ? 0 : bucketAlpha(b.bucketOf[s]); return out; };
  stepBrain(b, 0.016, d); drawBrain(fakeCtx(1920, 1080).ctx, b, g, 'rgb(1,2,3)', d);
  let worst = 0;
  for (let f = 0; f < 120; f++) {
    const before = alphas();
    stepBrain(b, 0.016, d); drawBrain(fakeCtx(1920, 1080).ctx, b, g, 'rgb(1,2,3)', d);
    const after = alphas();
    for (let s = 0; s < b.nSeg; s++) worst = Math.max(worst, Math.abs(after[s] - before[s]));
  }
  assert.ok(worst < 0.1, `lompatan alpha satu segmen antar frame ${worst.toFixed(3)}`);
});

test('drawBrain: percikan di sisi belakang lebih redup daripada di sisi depan, tetapi tetap terlihat', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  stepBrain(b, 0, still({ noSig: 0 }));
  const segOf = (test) => { for (const li of linesOfKind(0)) for (let i = b.start[li]; i < b.start[li] + b.len[li] - 1; i++) if (test((b.df[i] + b.df[i + 1]) / 2, (b.dd[i] + b.dd[i + 1]) / 2)) return [li, i - b.start[li]]; return null; };
  const front = segOf((f, dep) => f > 0.7 && dep > 0.6 * BRAIN.unit);
  const back = segOf((f, dep) => f < -0.7 && dep < -0.6 * BRAIN.unit);
  assert.ok(front && back, 'ada segmen depan-dekat dan belakang-jauh');
  const S = b.spark;
  [front, back].forEach(([li, seg], k) => { S.active[k] = 1; S.line[k] = li; S.seg[k] = seg; S.t[k] = 0; S.dir[k] = 1; S.age[k] = 0; S.life[k] = 1; S.a[k] = 1; S.e[k] = 1; S.trailLen[k] = 20; S.speed[k] = 0; S.fam[k] = 0; });
  S.count = 2;
  const { ctx, rec } = fakeCtx(1920, 1080);
  drawBrain(ctx, b, g, 'rgb(1,2,3)', still({ noSig: 0 }));
  assert.equal(rec.fillAlphas.length, 2);
  assert.ok(rec.fillAlphas[1] > 0.05, 'sisi belakang tetap terlihat');
  assert.ok(rec.fillAlphas[0] > rec.fillAlphas[1] * 1.5, `depan ${rec.fillAlphas[0]} vs belakang ${rec.fillAlphas[1]}`);
});

// --- titik sensor Muse di otak ------------------------------------------------------------------------------------------
const GOOD = '#7ADFA0'; const FAIR = '#F2B24E'; const POOR = '#FF5E72';
const LEVELS = ['good', 'fair', 'poor', 'good']; // urutan TP9, AF7, AF8, TP10
const withContact = (levels, o = {}) => still({ noSig: 0, contact: levels, ...o });
const settle = (b, d, s = 1.2) => { for (let i = 0; i < Math.round(s / 0.016); i++) stepBrain(b, 0.016, d); };
const sensorArcs = (rec) => rec.arcs.filter((a) => a.r > 3 && a.alpha > 0);

test('titik sensor: letaknya di permukaan otak sesuai Muse: AF7/AF8 di dahi kiri dan kanan, TP9/TP10 di samping bawah belakang telinga', () => {
  const b = createBrain();
  const [tp9, af7, af8, tp10] = Array.from(b.sensor);
  const P = (i) => [b.x[i], b.y[i], b.z[i]];
  for (const i of b.sensor) assert.equal(BRAIN.kinds[b.lineOf[i]], 0, 'di lipatan korteks, bukan batang otak');
  assert.ok(P(tp9)[0] < 0 && P(af7)[0] < 0 && P(af8)[0] > 0 && P(tp10)[0] > 0, 'kiri: x negatif, kanan: x positif');
  assert.ok(Math.abs(P(af7)[0] + P(af8)[0]) < 0.12 * BRAIN.unit && Math.abs(P(tp9)[0] + P(tp10)[0]) < 0.12 * BRAIN.unit, 'kiri dan kanan simetris');
  assert.ok(P(af7)[1] > 0.45 * BRAIN.unit && P(af8)[1] > 0.45 * BRAIN.unit, 'dahi di depan');
  assert.ok(P(tp9)[1] < P(af7)[1] - 0.4 * BRAIN.unit && P(tp10)[1] < P(af8)[1] - 0.4 * BRAIN.unit, 'di belakang telinga lebih ke belakang daripada dahi');
  assert.ok(Math.abs(P(tp9)[0]) > Math.abs(P(af7)[0]) && Math.abs(P(tp10)[0]) > Math.abs(P(af8)[0]), 'di samping, lebih lateral daripada dahi');
  assert.ok(P(tp9)[2] < P(af7)[2] && P(tp10)[2] < P(af8)[2], 'lebih rendah daripada dahi');
});

test('titik sensor: proyeksinya ikut berputar dan sama dengan proyeksi bersama (orbit), tanpa goyang agitasi', () => {
  const b = createBrain(BRAIN, 0.8);
  stepBrain(b, 0, still({ pos: 0.95 }));
  for (let k = 0; k < 4; k++) {
    const [x, y, d] = restPosition(b, b.sensor[k]);
    assert.ok(Math.abs(b.sdx[k] - x) < 0.02 && Math.abs(b.sdy[k] - y) < 0.02 && Math.abs(b.sdd[k] - d) < 0.02, `sensor ${k}`);
  }
  const before = Array.from(b.sdx);
  for (let i = 0; i < 40; i++) stepBrain(b, 0.016, drive({ pos: 0.95 }));
  assert.ok(Array.from(b.sdx).some((x, k) => Math.abs(x - before[k]) > 1), 'ikut berputar');
});

test('titik sensor: muncul halus selama sekitar 0,6 detik saat ada kontak, memudar saat hilang, dan tanpa kontak tidak tampil', () => {
  const b = createBrain();
  assert.equal(brainStats(b).sensors, null);
  stepBrain(b, 0.1, withContact(LEVELS));
  const early = brainStats(b).sensorAlpha;
  assert.ok(early > 0 && early < 0.5, `baru mulai muncul: ${early}`);
  settle(b, withContact(LEVELS));
  assert.equal(brainStats(b).sensorAlpha, 1);
  assert.deepEqual(brainStats(b).sensors, LEVELS);
  stepBrain(b, 0.1, withContact(null));
  assert.ok(brainStats(b).sensorAlpha > 0 && brainStats(b).sensorAlpha < 1, 'memudar, tidak hilang seketika');
  assert.deepEqual(brainStats(b).sensors, LEVELS, 'memudar dengan warna terakhir');
  settle(b, withContact(null));
  assert.equal(brainStats(b).sensors, null);
  settle(b, still({ contact: undefined }));
  assert.equal(brainStats(b).sensors, null);
});

test('titik sensor: digambar dengan warna levelnya (hijau, kuning terisi; merah berupa cincin), dan tidak digambar tanpa kontak', () => {
  const g = createGeom(1920, 1080, 'wide');
  const b = createBrain();
  const d = withContact(LEVELS);
  settle(b, d);
  const { ctx, rec } = fakeCtx(1920, 1080);
  drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
  const count = (arr, c) => arr.filter((x) => x === c).length;
  assert.equal(count(rec.fillStyles, GOOD), 2, 'dua sensor hijau terisi');
  assert.equal(count(rec.fillStyles, FAIR), 1, 'satu sensor kuning terisi');
  assert.equal(count(rec.fillStyles, POOR), 0, 'sensor merah tidak terisi');
  assert.equal(count(rec.strokeStyles, POOR), 1, 'sensor merah berupa cincin');
  const off = createBrain();
  stepBrain(off, 0.016, still());
  const r2 = fakeCtx(1920, 1080);
  drawBrain(r2.ctx, off, g, 'rgb(1,2,3)', still());
  for (const c of [GOOD, FAIR, POOR]) assert.equal(r2.rec.fillStyles.concat(r2.rec.strokeStyles).filter((x) => x === c).length, 0, `${c} tanpa kontak`);
});

test('titik sensor: cukup besar untuk terbaca (sekitar 10 sampai 16 px pada skala 1), dan yang di sisi belakang tetap tampak tetapi lebih kecil dan redup (tembus pandang)', () => {
  const g = createGeom(1920, 1080, 'wide'); // skala 1
  const b = createBrain(BRAIN, 0); // yaw 0: kamera di sisi kiri otak, jadi TP9 dan AF7 menghadap kamera, AF8 dan TP10 di belakang
  const d = withContact(['good', 'good', 'good', 'good']);
  settle(b, d);
  const { ctx, rec } = fakeCtx(1920, 1080);
  drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
  const dots = sensorArcs(rec).filter((a) => a.r > 3 && a.r < 20);
  const byX = (k) => dots.filter((a) => Math.abs(a.x - (brainRect(g).x0 + b.sdx[k] * brainRect(g).s)) < 0.5 && Math.abs(a.y - (brainRect(g).y0 + b.sdy[k] * brainRect(g).s)) < 0.5).at(-1);
  const front = byX(0); const back = byX(3);
  assert.ok(front && back, 'dua sensor ditemukan');
  assert.ok(b.sdf[0] > 0.3 && b.sdf[3] < -0.3, `menghadap ${b.sdf[0]} ${b.sdf[3]}`);
  assert.ok(front.r >= 5 && front.r <= 9, `jari-jari depan ${front.r}`);
  assert.ok(back.r < front.r && back.r >= 3.5, `jari-jari belakang ${back.r}`);
  assert.ok(front.alpha > back.alpha && back.alpha > 0.3, `terang depan ${front.alpha}, belakang ${back.alpha}`);
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

test('drawBrain: terang dasar tiap kelompok mengikuti levelnya; tanpa data semua sama (netral); otak kecil tetap', () => {
  const g = createGeom(1920, 1080, 'wide');
  const famFor = (d) => {
    const b = createBrain();
    for (let i = 0; i < 600; i++) stepBrain(b, 0.016, d);
    const { ctx } = fakeCtx(1920, 1080);
    drawBrain(ctx, b, g, 'rgb(1,2,3)', d);
    return Array.from(b.famAlpha);
  };
  const [t, a, bt, cb] = famFor(drive({ theta: 1, alpha: 0.5, beta: 0 }));
  assert.ok(t > a && a > bt, `${t} ${a} ${bt}`);
  const neutral = famFor(drive({}));
  assert.ok(neutral.every((x) => Math.abs(x - neutral[0]) < 1e-6), String(neutral));
  assert.deepEqual(famFor(drive({ theta: 0.5, alpha: 0.5, beta: 0.5 })), neutral);
  assert.equal(cb, neutral[3], 'otak kecil tidak ikut level gelombang');
  assert.equal(famFor(drive({ theta: 0, alpha: 1, beta: 0 }))[3], famFor(drive({ theta: 1, alpha: 0, beta: 1 }))[3]);
  const busy = famFor(drive({ density: CONFIG.ribbon.densityAmpMax }));
  assert.ok(Math.abs(busy[0] - 0.42) < 1e-3, `netral pada ketikan padat ${busy[0]} (spec: 0,42 pada level 0,5)`);
  assert.ok(Math.abs(neutral[0] - 0.42 * CONFIG.brain.alpha.base[0]) < 1e-3, `netral tanpa ketikan ${neutral[0]} (0,8x)`);
});

test('sparkBrain: satu percikan hanya menyalakan bagian kecil dari seluruh lipatan, di kelompok mana pun (nyala tetap lokal)', () => {
  const lenOf = (b, li) => { let t = 0; for (let i = b.start[li]; i < b.start[li] + b.len[li] - 1; i++) t += b.segLen[i]; return t; };
  for (const [levels, fam] of [[{ theta: 1, alpha: 0, beta: 0 }, 0], [{ theta: 0, alpha: 1, beta: 0 }, 1], [{ theta: 0, alpha: 0, beta: 1 }, 2]]) {
    for (const code of ['KeyF', 'Space']) {
      const b = createBrain();
      const d = drive(levels);
      for (let i = 0; i < 600; i++) stepBrain(b, 0.016, d);
      let total = 0;
      for (const li of linesOfKind(0)) total += lenOf(b, li);
      const s = sparkBrain(b, key(code), 'exact', 1000, seq(0.5));
      assert.equal(b.spark.fam[s], fam);
      let lit = 0;
      for (let li = 0; li < b.lines; li++) if (b.energy[li] > 0) lit += lenOf(b, li);
      assert.ok(lit > 0 && lit <= 0.05 * total, `kelompok ${fam}, ${code}: menyalakan ${(100 * lit / total).toFixed(1)}% dari panjang lipatan`);
    }
  }
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
    for (let li = 0; li < b.lines; li++) if (b.energy[li] > 0) { lit++; assert.equal(b.family[li], fam, `garis ${li} menyala di luar kelompok`); }
    assert.ok(lit >= 1);
    speeds.push(b.spark.speed[s]); trails.push(b.spark.trailLen[s]);
  }
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2], `kecepatan ${speeds}`);
  assert.ok(trails[0] > trails[1] && trails[1] > trails[2], `ekor ${trails}`);
});
