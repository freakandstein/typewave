import test from 'node:test';
import assert from 'node:assert/strict';
import { beadU, alongFrac } from '../../src/core/placement.js';
import { keyInfo } from '../../src/data/layout-ansi75.js';

const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('exact: u persis dari tombol', () => {
  assert.ok(near(beadU('KeyA', 'exact'), keyInfo('KeyA').u));
  assert.ok(near(beadU('Space', 'exact'), keyInfo('Space').u));
});

test('zone: acak di rentang tangan; kolom persis tidak pernah tampil', () => {
  const rnd = seq(0, 0.25, 0.5, 0.75, 0.999999);
  const left = Array.from({ length: 5 }, () => beadU('KeyA', 'zone', rnd));
  assert.ok(left.every((u) => u >= 0 && u <= 0.475));
  assert.equal(new Set(left.map((u) => u.toFixed(6))).size, 5);
  assert.ok(left.every((u) => !near(u, keyInfo('KeyA').u, 1e-6)));
  const right = Array.from({ length: 5 }, () => beadU('KeyL', 'zone', rnd));
  assert.ok(right.every((u) => u >= 0.525 && u <= 1));
  const sp = Array.from({ length: 5 }, () => beadU('Space', 'zone', rnd));
  assert.ok(sp.every((u) => u >= 0.375 && u <= 0.625));
});

test('tombol tak dikenal: exact = tengah, zone = rentang tengah', () => {
  assert.equal(beadU('Vk0C', 'exact'), 0.5);
  const u = beadU('Vk0C', 'zone', () => 0);
  assert.ok(near(u, 0.375));
});

test('alongFrac memetakan u ke rentang layout', () => {
  assert.ok(near(alongFrac(0, 'wide'), 0.10));
  assert.ok(near(alongFrac(1, 'wide'), 0.90));
  assert.ok(near(alongFrac(0.475, 'wide'), 0.48));
  assert.ok(near(alongFrac(0, 'tall'), 0.24));
  assert.ok(near(alongFrac(1, 'tall'), 0.86));
});
