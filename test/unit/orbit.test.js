import test from 'node:test';
import assert from 'node:assert/strict';
import { PITCH, viewOf, perspK, projectInto } from '../../src/core/orbit.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const proj = (yaw, pitch, x, y, z, unit = 1) => {
  const X = new Float64Array(1); const Y = new Float64Array(1); const D = new Float64Array(1);
  projectInto(viewOf(yaw, pitch), perspK(unit), x, y, z, X, Y, D, 0);
  return { sx: X[0], up: Y[0], depth: D[0] };
};

test('viewOf: kosinus dan sinus yaw dan pitch', () => {
  const v = viewOf(0.5, 0.2);
  assert.ok(near(v.cy, Math.cos(0.5)) && near(v.sy, Math.sin(0.5)) && near(v.cp, Math.cos(0.2)) && near(v.sp, Math.sin(0.2)));
  assert.equal(viewOf(1, 0).cp, 1);
  assert.equal(PITCH > 0 && PITCH < 0.3, true, 'kamera sedikit di atas otak');
});

test('projectInto yaw 0 tanpa pitch: sisi kiri otak menghadap kamera, depan di kiri layar, atas di atas', () => {
  const front = proj(0, 0, 0, 1, 0);
  assert.ok(front.sx < 0 && near(front.depth, 0) && near(front.up, 0), 'depan (y+) ke kiri layar');
  const back = proj(0, 0, 0, -1, 0);
  assert.ok(back.sx > 0, 'belakang ke kanan layar');
  const top = proj(0, 0, 0, 0, 1);
  assert.ok(top.up > 0 && near(top.sx, 0), 'atas (z+) naik di layar');
  const leftSide = proj(0, 0, -1, 0, 0);
  const rightSide = proj(0, 0, 1, 0, 0);
  assert.ok(leftSide.depth > 0 && rightSide.depth < 0, 'sisi kiri model (x-) dekat ke kamera');
});

test('projectInto yaw seperempat putaran: kamera melihat dari depan otak', () => {
  const frontPole = proj(Math.PI / 2, 0, 0, 1, 0);
  assert.ok(near(frontPole.sx, 0) && frontPole.depth > 0.99, `kutub depan menghadap kamera: ${frontPole.depth}`);
  const backPole = proj(Math.PI / 2, 0, 0, -1, 0);
  assert.ok(backPole.depth < -0.99);
});

test('projectInto: pitch positif membuat kamera di atas, jadi titik yang lebih tinggi lebih dekat', () => {
  const hi = proj(0, 0.3, 0, 0, 1);
  const lo = proj(0, 0.3, 0, 0, -1);
  assert.ok(hi.depth > lo.depth);
  assert.ok(near(proj(0, 0, 0, 0, 1).depth, 0));
});

test('projectInto: kamera di atas melihat ke bawah, jadi titik yang dekat tampak lebih rendah di layar dan yang jauh lebih tinggi', () => {
  const nearPt = proj(0, 0.3, -1, 0, 0);
  const farPt = proj(0, 0.3, 1, 0, 0);
  assert.ok(nearPt.up < 0 && farPt.up > 0, `dekat ${nearPt.up}, jauh ${farPt.up}`);
  assert.ok(near(proj(0, 0, -1, 0, 0).up, 0), 'tanpa pitch tidak ada pergeseran vertikal');
});

test('projectInto: perspektif lemah, yang dekat tampak lebih besar daripada yang jauh pada simpangan sama', () => {
  const nearOne = proj(0, 0, -1, 0.5, 0);
  const farOne = proj(0, 0, 1, 0.5, 0);
  assert.ok(Math.abs(nearOne.sx) > Math.abs(farOne.sx));
  const mid = proj(0, 0, 0, 0.5, 0);
  assert.ok(Math.abs(nearOne.sx) > Math.abs(mid.sx) && Math.abs(mid.sx) > Math.abs(farOne.sx));
  assert.ok(Math.abs(nearOne.sx) / Math.abs(farOne.sx) < 1.5, 'tidak berlebihan: otak tetap terbaca sebagai satu benda');
});

test('perspK: kekuatan perspektif tetap dalam satuan model, jadi otak berukuran lain tetap berbentuk sama', () => {
  const a = proj(0.7, 0.1, 0.3, 0.8, 0.2, 1);
  const b = proj(0.7, 0.1, 0.3 * 400, 0.8 * 400, 0.2 * 400, 400);
  assert.ok(near(a.sx * 400, b.sx, 1e-6) && near(a.up * 400, b.up, 1e-6) && near(a.depth * 400, b.depth, 1e-6));
});

test('projectInto menulis ke indeks yang diminta dan tidak menyentuh yang lain', () => {
  const X = new Float32Array(3).fill(-7); const Y = new Float32Array(3).fill(-7); const D = new Float32Array(3).fill(-7);
  projectInto(viewOf(0.3, PITCH), perspK(1), 0.2, 0.3, 0.4, X, Y, D, 1);
  assert.equal(X[0], -7); assert.equal(X[2], -7);
  assert.ok(X[1] !== -7 && Y[1] !== -7 && D[1] !== -7);
});
