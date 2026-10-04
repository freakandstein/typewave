import test from 'node:test';
import assert from 'node:assert/strict';
import { KIND, createBeads, spawnBead, allowRep, spawnForKey, updateBeads, drawBeads } from '../../src/render/beads.js';
import { createRibbon, prefillRibbon, advanceRibbon } from '../../src/render/ribbon.js';
import { createGeom } from '../../src/render/scene.js';
import { keyInfo } from '../../src/data/layout-ansi75.js';

const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
const g = createGeom(1920, 1080, 'wide');
const FLAT = { amp: 0, thick: 10, rough: 0, cr: 1, cg: 2, cb: 3, wavelength: 420 };
const ribbon = () => { const rb = createRibbon(g.L); prefillRibbon(rb, FLAT); return rb; };
const spec = (rb, over = {}) => ({ kind: KIND.CHAR, id: rb.headId - 100, s: 0, now: 0, r: 5, a: 0.9, ring: 1, col: 'rgb(1,2,3)', ...over });

test('jatuh dengan ease-in 280 ms lalu ikut terbawa pita; ring 500 ms setelah mendarat', () => {
  const rb = ribbon(); const p = createBeads();
  const i = spawnBead(p, spec(rb));
  updateBeads(p, rb, g, 200, 0.016, 0);
  assert.ok(near(p.y[i], g.spawnC)); assert.equal(p.x[i], 800);
  updateBeads(p, rb, g, 200, 0.016, 140);
  assert.ok(near(p.y[i], g.spawnC + (g.center - g.spawnC) * 0.25));
  updateBeads(p, rb, g, 200, 0.016, 280);
  assert.ok(near(p.y[i], g.center));
  updateBeads(p, rb, g, 200, 0.016, 530);
  assert.ok(near(p.ringR[i], 9)); assert.ok(near(p.ringA[i], 0.25));
  advanceRibbon(rb, 40, FLAT);
  updateBeads(p, rb, g, 200, 0.016, 600);
  assert.ok(near(p.x[i], 840));
  updateBeads(p, rb, g, 200, 0.016, 900);
  assert.equal(p.ringA[i], 0);
});

test('kedaluwarsa setelah 8 detik; keluar frame mematikan bead', () => {
  const rb = ribbon(); const p = createBeads();
  spawnBead(p, spec(rb));
  updateBeads(p, rb, g, 200, 0.016, 7999);
  assert.equal(p.activeCount, 1);
  updateBeads(p, rb, g, 200, 0.016, 8001);
  assert.equal(p.activeCount, 0);
  const q = createBeads();
  spawnBead(q, spec(rb, { id: rb.headId - 241 }));
  advanceRibbon(rb, 8, FLAT);
  updateBeads(q, rb, g, 200, 0.016, 100);
  assert.equal(q.activeCount, 0);
});

test('batas 400 bead aktif: yang tertua didaur ulang', () => {
  const rb = ribbon(); const p = createBeads();
  for (let i = 0; i < 450; i++) spawnBead(p, spec(rb, { now: i }));
  updateBeads(p, rb, g, 200, 0.016, 450);
  assert.equal(p.activeCount, 400);
  let minBorn = Infinity;
  for (let i = 0; i < p.cap; i++) if (p.active[i]) minBorn = Math.min(minBorn, p.born[i]);
  assert.equal(minBorn, 50);
});

test('bead mundur bergerak melawan aliran 40% kecepatan dan larut 700 ms', () => {
  const rb = ribbon(); const p = createBeads();
  const i = spawnBead(p, spec(rb, { kind: KIND.BACK, s: 1000, a: 0.8, ring: 0 }));
  updateBeads(p, rb, g, 200, 0.1, 100);
  assert.ok(near(p.x[i], 992)); assert.ok(near(p.alpha[i], 0.8 * (1 - 100 / 700)));
  updateBeads(p, rb, g, 200, 0.1, 700);
  assert.equal(p.activeCount, 0);
});

test('batang space memanjang 40 px dalam 400 ms lalu hilang', () => {
  const rb = ribbon(); const p = createBeads();
  const i = spawnBead(p, spec(rb, { kind: KIND.SPACE, a: 0.8, ring: 0 }));
  updateBeads(p, rb, g, 200, 0.016, 200);
  assert.ok(near(p.len[i], 30)); assert.ok(near(p.alpha[i], 0.4)); assert.ok(near(p.y[i], g.center));
  updateBeads(p, rb, g, 200, 0.016, 400);
  assert.equal(p.activeCount, 0);
});

test('allowRep: maksimum 12 per 1000 ms (jendela geser)', () => {
  const p = createBeads();
  let allowed = 0;
  for (let t = 0; t < 1000; t += 10) if (allowRep(p, t)) allowed++;
  assert.equal(allowed, 12);
  assert.equal(allowRep(p, 1000), true);
  const q = createBeads();
  let n = 0;
  for (let i = 0; i < 100; i++) if (allowRep(q, 5)) n++;
  assert.equal(n, 12);
});

const opts = (extra = {}) => ({ privacy: 'exact', ink: [200, 100, 50], now: 0, rand: () => 0.5, ...extra });
const ann = (o = {}) => ({ code: 'KeyA', rep: false, mods: [], cls: 'char', modifier: false, counted: true, iki: 200, ...o });

test('spawnForKey: kelas tombol menentukan jenis, radius mengikuti IKI', () => {
  const rb = ribbon(); const p = createBeads();
  const r = (a) => { const i = spawnForKey(p, rb, g, a, opts()); return i < 0 ? i : { kind: p.kind[i], r: p.r[i], a: p.a[i], ring: p.ring[i] }; };
  assert.deepEqual(r(ann({ iki: 120 })), { kind: KIND.CHAR, r: 3, a: 0.9, ring: 1 });
  assert.equal(r(ann({ iki: 920 })).r, 10);
  assert.equal(r(ann({ iki: null })).r, 10);
  assert.equal(r(ann({ iki: null, counted: false, mods: ['cmd'] })).r, 6.5);
  assert.equal(r(ann({ cls: 'enter', code: 'Enter' })), -1);
  assert.equal(r(ann({ cls: 'backspace', code: 'Backspace' })).kind, KIND.BACK);
  assert.equal(r(ann({ code: 'Space' })).kind, KIND.SPACE);
  assert.deepEqual(r(ann({ cls: 'other', modifier: true, code: 'ShiftLeft' })), { kind: KIND.NEUTRAL, r: 3, a: 0.6, ring: 0 });
  assert.deepEqual(r(ann({ cls: 'other', code: 'ArrowUp' })), { kind: KIND.NEUTRAL, r: 3, a: 0.6, ring: 0 });
});

test('spawnForKey: auto-repeat ringan dan dibatasi 12/detik (sisanya -1)', () => {
  const rb = ribbon(); const p = createBeads();
  const results = Array.from({ length: 15 }, () => spawnForKey(p, rb, g, ann({ rep: true, iki: null, counted: false }), opts()));
  assert.equal(results.filter((i) => i >= 0).length, 12);
  assert.equal(results.filter((i) => i < 0).length, 3);
  const first = results[0];
  assert.deepEqual([p.kind[first], p.r[first], p.a[first], p.ring[first]], [KIND.REP, 3, 0.5, 0]);
});

test('spawnForKey: exact menempatkan bead di kolom tombol; zone mengacak di rentang tangan', () => {
  const rb = ribbon(); const p = createBeads();
  const u = keyInfo('KeyA').u;
  const expectS = (0.1 + 0.8 * u) * g.L;
  const i = spawnForKey(p, rb, g, ann(), opts());
  updateBeads(p, rb, g, 200, 0.016, 1000);
  assert.ok(Math.abs(p.x[i] - expectS) <= 4, `${p.x[i]} vs ${expectS}`);
  const xs = [0, 0.3, 0.6, 0.99].map((v) => {
    const j = spawnForKey(p, rb, g, ann(), opts({ privacy: 'zone', rand: () => v }));
    updateBeads(p, rb, g, 200, 0.016, 1000);
    return p.x[j];
  });
  assert.ok(xs.every((x) => x >= 0.1 * g.L - 4 && x <= 0.48 * g.L + 4), xs.join());
  assert.equal(new Set(xs.map((x) => Math.round(x))).size, 4);
});

test('banjir ketikan: tidak ada pertumbuhan di atas kapasitas', () => {
  const rb = ribbon(); const p = createBeads();
  for (let t = 0; t < 5000; t += 10) spawnForKey(p, rb, g, ann(), opts({ now: t }));
  updateBeads(p, rb, g, 200, 0.016, 5000);
  assert.equal(p.activeCount, 400);
  assert.equal(p.active.length, 400);
});

test('drawBeads memakai arc untuk bead dan ring, garis untuk space (mock ctx)', () => {
  const rb = ribbon(); const p = createBeads();
  spawnBead(p, spec(rb, { id: rb.headId - 50 }));
  spawnBead(p, spec(rb, { kind: KIND.SPACE, ring: 0, id: rb.headId - 60, now: 300 }));
  updateBeads(p, rb, g, 200, 0.016, 530);
  const calls = { arc: 0, stroke: 0, fill: 0 };
  const ctx = { beginPath() {}, arc() { calls.arc++; }, fill() { calls.fill++; }, stroke() { calls.stroke++; }, moveTo() {}, lineTo() {} };
  drawBeads(ctx, p, g);
  assert.equal(calls.arc, 2); assert.ok(calls.fill >= 1); assert.ok(calls.stroke >= 2);
  assert.equal(ctx.globalAlpha, 1);
});
