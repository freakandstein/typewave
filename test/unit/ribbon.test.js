import test from 'node:test';
import assert from 'node:assert/strict';
import { createRibbon, advanceRibbon, prefillRibbon, ribbonIndex, ribbonCAt, drawRibbon } from '../../src/render/ribbon.js';
import { createGeom } from '../../src/render/scene.js';

const P = { amp: 100, thick: 10, rough: 0.5, cr: 10, cg: 20, cb: 30, wavelength: 420 };

function mockCtx() {
  const ctx = {
    pts: [], stops: [], fills: 0, grads: 0, fillStyle: null,
    beginPath() {}, closePath() {},
    moveTo(x, y) { this.pts.push([x, y]); },
    lineTo(x, y) { this.pts.push([x, y]); },
    createLinearGradient() { ctx.grads++; return { addColorStop: (f, c) => ctx.stops.push([f, c]) }; },
    fill() { this.fills++; },
  };
  return ctx;
}

test('kapasitas ~ L/8 + 2 sampel', () => {
  assert.equal(createRibbon(1920).n, 242);
});

test('satu sampel per 8 px, sisa jarak disimpan', () => {
  const rb = createRibbon(1920);
  advanceRibbon(rb, 7, P);
  assert.equal(rb.count, 0); assert.equal(rb.acc, 7);
  advanceRibbon(rb, 1, P);
  assert.equal(rb.count, 1); assert.equal(rb.headId, 1); assert.equal(rb.acc, 0);
  advanceRibbon(rb, 20, P);
  assert.equal(rb.count, 3); assert.equal(rb.headId, 3); assert.equal(rb.acc, 4);
});

test('prefill mengisi seluruh buffer; amplitudo dibatasi amp', () => {
  const rb = createRibbon(1920);
  prefillRibbon(rb, P);
  assert.equal(rb.count, rb.n);
  for (let i = 0; i < rb.n; i++) assert.ok(Math.abs(rb.c[i]) <= 100 + 1e-4, String(rb.c[i]));
  assert.equal(rb.acc, 0);
});

test('ribbonIndex: id terbaru = head, id yang sudah tertimpa = -1; ribbonCAt memakai posisi s', () => {
  const rb = createRibbon(1920);
  prefillRibbon(rb, P);
  assert.equal(ribbonIndex(rb, rb.headId), rb.head);
  assert.equal(ribbonIndex(rb, rb.headId + 1), -1);
  assert.notEqual(ribbonIndex(rb, rb.headId - (rb.n - 1)), -1);
  assert.equal(ribbonIndex(rb, rb.headId - rb.n), -1);
  advanceRibbon(rb, 8 * 5, P);
  assert.equal(ribbonIndex(rb, rb.headId - 5), (rb.head - 5 + rb.n) % rb.n);
  const a = 7;
  assert.equal(ribbonCAt(rb, rb.acc + a * rb.spacing), rb.c[(rb.head - a + rb.n) % rb.n]);
  assert.equal(ribbonCAt(rb, -50), 0);
  assert.equal(ribbonCAt(rb, 99999), 0);
});

test('drawRibbon wide: satu poligon, satu gradient 13 stop, semua titik di dalam kanvas', () => {
  const g = createGeom(1920, 1080, 'wide');
  const rb = createRibbon(g.L);
  prefillRibbon(rb, P);
  const ctx = mockCtx();
  drawRibbon(ctx, rb, g);
  assert.equal(ctx.fills, 1); assert.equal(ctx.grads, 1); assert.equal(ctx.stops.length, 13);
  assert.equal(ctx.pts.length, 2 * rb.n);
  for (const [x, y] of ctx.pts) { assert.ok(x >= -1 && x <= g.L + 8, 'x ' + x); assert.ok(y > g.center - 140 && y < g.center + 140, 'y ' + y); }
  assert.ok(ctx.stops[0][1].startsWith('rgba(10,20,30,0.2'), ctx.stops[0][1]);
  assert.ok(ctx.stops[12][1].startsWith('rgba(10,20,30,1'), ctx.stops[12][1]);
});

test('drawRibbon tall: titik berada di dalam kanvas 1080x1920 di sekitar x = 42%', () => {
  const g = createGeom(1080, 1920, 'tall');
  const rb = createRibbon(g.L);
  prefillRibbon(rb, P);
  const ctx = mockCtx();
  drawRibbon(ctx, rb, g);
  // pita sengaja melewati tepi hilir (atas) satu spasi sampel agar tanpa celah
  for (const [x, y] of ctx.pts) { assert.ok(y >= -8.5 && y <= 1920.5, 'y ' + y); assert.ok(x > 453.6 - 120 && x < 453.6 + 120, 'x ' + x); }
});

test('drawRibbon dengan sampel < 2 tidak menggambar', () => {
  const g = createGeom(1920, 1080, 'wide');
  const ctx = mockCtx();
  drawRibbon(ctx, createRibbon(g.L), g);
  assert.equal(ctx.fills, 0);
});

const idxAt = (rb, a) => (((rb.head - a) % rb.n) + rb.n) % rb.n;
const crossings = (rb) => {
  let n = 0, prev = 0;
  for (let a = 0; a < rb.count; a++) {
    const sg = Math.sign(rb.c[idxAt(rb, a)]);
    if (sg !== 0 && prev !== 0 && sg !== prev) n++;
    if (sg !== 0) prev = sg;
  }
  return n;
};

test('panjang gelombang lebih pendek + harmonik lebih besar = jauh lebih banyak osilasi pada pita yang sama', () => {
  const calm = createRibbon(1920);
  prefillRibbon(calm, { ...P, wavelength: 640, harm: 0.15 });
  const tense = createRibbon(1920);
  prefillRibbon(tense, { ...P, wavelength: 200, harm: 0.45 });
  assert.ok(crossings(tense) > 2 * crossings(calm), `tense ${crossings(tense)} vs calm ${crossings(calm)}`);
});

test('harm=0 sinus murni pada panjang gelombang yang diberikan; harm=1 harmonik 2.3x; |c| <= amp', () => {
  const d = (2 * Math.PI * 8) / 420;
  for (const [harm, f] of [[0, (ph) => Math.sin(ph)], [1, (ph) => Math.sin(ph * 2.3 + 1.1)]]) {
    const rb = createRibbon(1920);
    prefillRibbon(rb, { ...P, wavelength: 420, harm });
    for (const a of [0, 1, 17, 100, rb.count - 1]) {
      const k = rb.headId - a;
      assert.ok(Math.abs(rb.c[idxAt(rb, a)] - 100 * f(k * d)) < 1e-2, `harm ${harm} age ${a}`);
    }
  }
  const mixed = createRibbon(1920);
  prefillRibbon(mixed, { ...P, wavelength: 300, harm: 0.37 });
  for (let a = 0; a < mixed.count; a++) assert.ok(Math.abs(mixed.c[idxAt(mixed, a)]) <= 100 + 1e-3);
});

test('tanpa harm: bentuk lama (0.7 sinus + 0.3 harmonik) tetap berlaku', () => {
  const d = (2 * Math.PI * 8) / 420;
  const rb = createRibbon(1920);
  prefillRibbon(rb, P);
  const k = rb.headId - 5;
  assert.ok(Math.abs(rb.c[idxAt(rb, 5)] - 100 * (0.7 * Math.sin(k * d) + 0.3 * Math.sin(k * d * 2.3 + 1.1))) < 1e-2);
});
