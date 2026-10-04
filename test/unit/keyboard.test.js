import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootprint, lightKey, decayFootprint, footprintRect, drawFootprint } from '../../src/render/keyboard.js';
import { createGeom } from '../../src/render/scene.js';
import { KEYS, keyIndex, ZONES } from '../../src/data/layout-ansi75.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const litCount = (arr) => Array.from(arr).filter((v) => v > 0).length;

test('exact: hanya tombol itu yang menyala; kode tak dikenal diabaikan tanpa error', () => {
  const fp = createFootprint();
  lightKey(fp, 'KeyA', 'exact');
  assert.equal(fp.lit[keyIndex('KeyA')], 1);
  assert.equal(litCount(fp.lit), 1);
  lightKey(fp, 'Vk0C', 'exact');
  assert.equal(litCount(fp.lit), 1);
  assert.equal(litCount(fp.zlit), 0);
});

test('zone: zona menyala, Space menyalakan dua zona, tombol persis tidak', () => {
  const fp = createFootprint();
  lightKey(fp, 'KeyA', 'zone');
  assert.equal(fp.zlit[ZONES.indexOf('L2')], 1);
  assert.equal(litCount(fp.zlit), 1);
  lightKey(fp, 'Space', 'zone');
  assert.equal(fp.zlit[ZONES.indexOf('L3')], 1);
  assert.equal(fp.zlit[ZONES.indexOf('R3')], 1);
  assert.equal(litCount(fp.lit), 0);
});

test('memudar linear ke 0 dalam 450 ms', () => {
  const fp = createFootprint();
  lightKey(fp, 'KeyA', 'exact');
  decayFootprint(fp, 0.225);
  assert.ok(near(fp.lit[keyIndex('KeyA')], 0.5, 1e-3));
  decayFootprint(fp, 0.225);
  assert.equal(fp.lit[keyIndex('KeyA')], 0);
  decayFootprint(fp, 1);
  assert.equal(fp.lit[keyIndex('KeyA')], 0);
});

test('footprintRect wide: lebar 80% (10%..90%), di bawah pita dan di dalam kanvas (tata letak ?keyboard=1)', () => {
  const g = createGeom(1920, 1080, 'wide', undefined, true);
  const R = footprintRect(g);
  assert.ok(near(R.x0, 192)); assert.ok(near(R.w, 1536)); assert.ok(near(R.unit, 96)); assert.ok(near(R.uh, 57.6));
  assert.ok(R.y0 > g.center + 120 + 28, 'footprint tidak boleh menumpuk pita: ' + R.y0);
  assert.ok(R.y0 + R.h <= 1080);
});

test('footprintRect tall: di luar safe zone (kanan 15%, bawah 20%)', () => {
  const g = createGeom(1080, 1920, 'tall');
  const R = footprintRect(g);
  assert.ok(R.x0 + R.w <= 0.85 * g.W, String(R.x0 + R.w));
  assert.ok(R.y0 + R.h <= 0.80 * g.H, String(R.y0 + R.h));
  assert.ok(R.x0 >= 0);
});

function mockCtx() {
  return { fills: 0, rects: 0, globalAlpha: 0, fillStyle: '', beginPath() {}, roundRect() { this.rects++; }, rect() { this.rects++; }, fill() { this.fills++; } };
}

test('drawFootprint exact: 1 path redup + 1 fill per tombol menyala; globalAlpha dikembalikan ke 1', () => {
  const g = createGeom(1920, 1080, 'wide');
  const fp = createFootprint();
  const a = mockCtx();
  drawFootprint(a, fp, g, 'exact', 'rgb(1,2,3)');
  assert.equal(a.fills, 1); assert.equal(a.rects, KEYS.length); assert.equal(a.globalAlpha, 1);
  lightKey(fp, 'KeyA', 'exact');
  lightKey(fp, 'KeyL', 'exact');
  const b = mockCtx();
  drawFootprint(b, fp, g, 'exact', 'rgb(1,2,3)');
  assert.equal(b.fills, 3);
});

test('drawFootprint zone: satu fill per tombol di dalam zona yang menyala', () => {
  const g = createGeom(1920, 1080, 'wide');
  const fp = createFootprint();
  lightKey(fp, 'KeyA', 'zone');
  const inZone = KEYS.filter((k) => k.hand === 'L' && k.row === 2).length;
  const ctx = mockCtx();
  drawFootprint(ctx, fp, g, 'zone', 'rgb(1,2,3)');
  assert.equal(ctx.fills, 1 + inZone);
});
