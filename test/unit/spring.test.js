import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpring, stepSpring, snapSpring } from '../../src/core/spring.js';

test('menuju target tanpa overshoot dari keadaan diam', () => {
  const s = createSpring(0, 5);
  let max = 0;
  for (let i = 0; i < 600; i++) { stepSpring(s, 1, 1 / 60); max = Math.max(max, s.x); }
  assert.ok(max <= 1 + 1e-9, 'overshoot ' + max);
  assert.ok(Math.abs(s.x - 1) < 1e-3);
});

test('hasil tidak bergantung pada dt (solusi analitik)', () => {
  const a = createSpring(0, 5);
  const b = createSpring(0, 5);
  stepSpring(a, 1, 1.0);
  for (let i = 0; i < 100; i++) stepSpring(b, 1, 0.01);
  assert.ok(Math.abs(a.x - b.x) < 1e-9);
  assert.ok(Math.abs(a.v - b.v) < 1e-9);
});

test('dt <= 0 tidak mengubah state; snap mereset kecepatan', () => {
  const s = createSpring(0.3, 5);
  stepSpring(s, 1, 0.1);
  const x = s.x;
  assert.equal(stepSpring(s, 1, 0), x);
  snapSpring(s, 0.7);
  assert.equal(s.x, 0.7);
  assert.equal(s.v, 0);
});
