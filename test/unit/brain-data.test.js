import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAIN } from '../../src/data/brain.js';

const all = () => [...BRAIN.outline, ...BRAIN.folds];
const pointsOf = (list) => list.reduce((n, l) => n + l.pts.length / 2, 0);

test('data otak: kotak desain, kontur, dan lipatan terisi', () => {
  assert.ok(BRAIN.w > 0 && BRAIN.h > 0);
  assert.ok(BRAIN.outline.length >= 3, 'cerebrum, cerebellum, batang otak');
  assert.ok(BRAIN.folds.length >= 30, `lipatan ${BRAIN.folds.length}`);
});

test('data otak: koordinat bulat, berhingga, di dalam kotak; garis punya >= 2 titik dan loop >= 3 titik', () => {
  for (const l of all()) {
    assert.equal(l.pts.length % 2, 0);
    assert.ok(l.pts.length / 2 >= (l.closed ? 3 : 2), `titik ${l.pts.length / 2}`);
    for (let i = 0; i < l.pts.length; i += 2) {
      const x = l.pts[i];
      const y = l.pts[i + 1];
      assert.ok(Number.isInteger(x) && Number.isInteger(y), `${x},${y}`);
      assert.ok(x >= 0 && x <= BRAIN.w && y >= 0 && y <= BRAIN.h, `${x},${y} di luar kotak`);
    }
  }
});

test('data otak: jumlah titik dalam anggaran supaya gambar per frame murah', () => {
  const n = pointsOf(all());
  assert.ok(n <= 8000, `${n} titik`);
  assert.ok(pointsOf(BRAIN.folds) >= 500, 'lipatan cukup rapat untuk terbaca sebagai otak');
});

test('data otak: lipatan menyebar di seluruh otak (kiri-kanan dan atas-bawah), supaya percikan selalu punya jalur', () => {
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const l of BRAIN.folds) {
    for (let i = 0; i < l.pts.length; i += 2) {
      x0 = Math.min(x0, l.pts[i]); x1 = Math.max(x1, l.pts[i]);
      y0 = Math.min(y0, l.pts[i + 1]); y1 = Math.max(y1, l.pts[i + 1]);
    }
  }
  assert.ok(x0 <= 0.15 * BRAIN.w && x1 >= 0.85 * BRAIN.w, `x ${x0}..${x1}`);
  assert.ok(y0 <= 0.2 * BRAIN.h && y1 >= 0.8 * BRAIN.h, `y ${y0}..${y1}`);
});

test('data otak: garis otak kecil (folia) bertanda cb dan berada di bawah-kanan, supaya tidak ikut kelompok gelombang', () => {
  const cb = BRAIN.folds.filter((l) => l.tag === 'cb');
  assert.ok(cb.length >= 5, `folia bertanda: ${cb.length}`);
  for (const l of cb) {
    for (let i = 0; i < l.pts.length; i += 2) assert.ok(l.pts[i] > 0.55 * BRAIN.w && l.pts[i + 1] > 0.65 * BRAIN.h, `${l.pts[i]},${l.pts[i + 1]}`);
  }
  assert.ok(BRAIN.folds.filter((l) => l.tag !== 'cb').length >= 20, 'lipatan korteks tetap ada');
});
