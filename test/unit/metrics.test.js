import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics, sanitizeMind } from '../../src/core/metrics.js';

const key = (code, at, extra = {}) => ({ code, at, rep: false, mods: [], ...extra });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('sanitizeMind menjepit dan membuang nilai ngawur', () => {
  assert.deepEqual(sanitizeMind({ pos: 1.7, hr: 71, q: 2 }), { pos: 1, hr: 71, q: 1, theta: null, alpha: null, beta: null });
  assert.deepEqual(sanitizeMind({ pos: -0.2 }), { pos: 0, hr: null, q: 1, theta: null, alpha: null, beta: null });
  assert.equal(sanitizeMind({ pos: NaN }), null);
  assert.equal(sanitizeMind({ pos: '0.5' }), null);
  assert.equal(sanitizeMind(null), null);
  assert.equal(sanitizeMind({ pos: 0.5, hr: 0 }).hr, null);
  assert.equal(sanitizeMind({ pos: 0.5, hr: 999 }).hr, null);
  assert.equal(sanitizeMind({ pos: 0.5, q: NaN }).q, 1);
});

test('sanitizeMind: level gelombang dijepit ke 0..1; nilai ngawur atau tidak ada menjadi null', () => {
  const s = sanitizeMind({ pos: 0.5, theta: 1.7, alpha: -2, beta: NaN });
  assert.deepEqual([s.theta, s.alpha, s.beta], [1, 0, null]);
  const t = sanitizeMind({ pos: 0.5, theta: '0.4', alpha: null, beta: 0.25 });
  assert.deepEqual([t.theta, t.alpha, t.beta], [null, null, 0.25]);
});

test('snapshot: level gelombang mengikuti mind terakhir; null bila tidak ada atau tanpa sinyal', () => {
  const m = createMetrics(0);
  const bands = (t) => { const s = m.snapshot(t); return [s.theta, s.alpha, s.beta]; };
  assert.deepEqual(bands(0), [null, null, null]);
  m.onMind({ pos: 0.5, theta: 0.8, alpha: 0.1, beta: 0.4 }, 100);
  assert.deepEqual(bands(200), [0.8, 0.1, 0.4]);
  m.onMind({ pos: 0.5 }, 300);
  assert.deepEqual(bands(400), [null, null, null], 'pesan tanpa level tidak menyisakan nilai lama');
  m.onMind({ pos: 0.5, theta: 0.8, alpha: 0.1, beta: 0.4 }, 500);
  assert.deepEqual(bands(600), [0.8, 0.1, 0.4]);
  assert.deepEqual(bands(6600), [null, null, null], 'lebih dari 5 detik tanpa mind: noSignal membuang level');
});

test('onMind dengan nilai ngawur diabaikan dan tidak merusak state', () => {
  const m = createMetrics(0);
  assert.equal(m.onMind({ pos: NaN }, 0), false);
  assert.equal(m.snapshot(0).noSignal, true);
  assert.equal(m.onMind({ pos: 0.4, hr: 65, q: 0.8 }, 10), true);
  m.tick(20, 0.016);
  const s = m.snapshot(20);
  assert.ok(Number.isFinite(s.pos) && Number.isFinite(s.wpm) && Number.isFinite(s.density));
});

test('WPM: 50 karakter IKI 150 ms = 80 wpm; backspace, repeat, shortcut, modifier tidak dihitung', () => {
  const m = createMetrics(0);
  for (let i = 0; i < 50; i++) m.onKey(key('KeyA', i * 150), i * 150);
  m.onKey(key('Backspace', 7400), 7400);
  m.onKey(key('KeyB', 7410, { rep: true }), 7410);
  m.onKey(key('KeyC', 7420, { mods: ['cmd'] }), 7420);
  m.onKey(key('ShiftLeft', 7430), 7430);
  assert.ok(near(m.snapshot(7500).rawWpm, 80, 0.5));
});

test('jendela WPM di awal burst minimal 3 detik', () => {
  const m = createMetrics(0);
  for (let i = 0; i < 4; i++) m.onKey(key('KeyA', 250 * i), 250 * i);
  assert.ok(near(m.snapshot(1000).rawWpm, (4 / 5) * (60000 / 3000), 1e-9));
});

test('IKI > 3000 ms = jeda: memulai burst baru dan tidak masuk statistik', () => {
  const m = createMetrics(0);
  assert.equal(m.onKey(key('KeyA', 0), 0).iki, null);
  assert.equal(m.onKey(key('KeyA', 200), 200).iki, 200);
  assert.equal(m.onKey(key('KeyA', 5200), 5200).iki, 5000);
  assert.equal(m.ikiMean(), 200);
});

test('annotasi: kelas tombol dan counted', () => {
  const m = createMetrics(0);
  assert.deepEqual(
    (({ cls, modifier, counted }) => ({ cls, modifier, counted }))(m.onKey(key('Backspace', 0), 0)),
    { cls: 'backspace', modifier: false, counted: true });
  assert.equal(m.onKey(key('ShiftLeft', 1), 1).counted, false);
  assert.equal(m.onKey(key('Enter', 2, { rep: true }), 2).counted, false);
  assert.equal(m.onKey(key('Vk0C', 3), 3).cls, 'other');
  assert.equal(m.onKey({ code: 'KeyA' }, 4).at, 4);
});

test('density: EMA tau 1.5 s mendekati laju ketikan, meluruh, dan tidak naik karena modifier', () => {
  const m = createMetrics(0);
  for (let i = 0; i < 100; i++) m.onKey(key('KeyA', i * 200), i * 200);
  const d = m.snapshot(19800).density;
  assert.ok(near(d, 5, 0.5), String(d));
  assert.ok(near(m.snapshot(19800 + 1500).density, d / Math.E, 1e-9));
  const before = m.snapshot(21000).density;
  m.onKey(key('ShiftLeft', 21000), 21000);
  assert.equal(m.snapshot(21000).density, before);
});

test('idle dan noSignal memakai ambang 3000 ms dan 5000 ms', () => {
  const m = createMetrics(0);
  assert.equal(m.snapshot(0).idle, true);
  assert.equal(m.snapshot(0).noSignal, true);
  m.onKey(key('KeyA', 1000), 1000);
  m.onMind({ pos: 0.5 }, 1000);
  assert.equal(m.snapshot(3999).idle, false);
  assert.equal(m.snapshot(4001).idle, true);
  assert.equal(m.snapshot(5999).noSignal, false);
  assert.equal(m.snapshot(6001).noSignal, true);
});

test('pos: snap pada mind pertama, lalu dihaluskan spring tanpa lompat', () => {
  const m = createMetrics(0);
  m.onMind({ pos: 0.2 }, 0);
  assert.equal(m.snapshot(0).pos, 0.2);
  m.onMind({ pos: 0.9 }, 100);
  let prev = m.snapshot(100).pos;
  let maxStep = 0;
  for (let i = 1; i <= 120; i++) {
    m.tick(100 + i * 16, 0.016);
    const p = m.snapshot(100 + i * 16).pos;
    maxStep = Math.max(maxStep, p - prev);
    prev = p;
  }
  assert.ok(maxStep < 0.03, String(maxStep));
  assert.ok(near(prev, 0.9, 0.01));
});

test('sesi: log per detik, backspace termasuk repeat, jeda terpanjang termasuk jeda berjalan, flowSec', () => {
  const m = createMetrics(0);
  m.onKey(key('KeyA', 1000), 1000);
  m.onKey(key('Backspace', 1200), 1200);
  m.onKey(key('Backspace', 1230, { rep: true }), 1230);
  for (let t = 0; t <= 30000; t += 100) { m.onMind({ pos: 0.5, hr: 70 }, t); m.tick(t, 0.1); }
  const s = m.summary(30000);
  assert.equal(s.backspaces, 2);
  assert.equal(s.chars, 1);
  assert.equal(s.log.length, 30);
  assert.equal(s.flowSec, 30);
  assert.ok(near(s.longestGapMs, 30000 - 1230, 1));
  assert.equal(s.durationMs, 30000);
  assert.equal(s.log[0].t, 1000);
});

test('stall panjang: log mengisi celah dengan nilai terakhir, tidak ada NaN', () => {
  const m = createMetrics(0);
  m.onMind({ pos: 0.4, hr: 65 }, 0);
  m.tick(500, 0.016);
  m.tick(30500, 0.05);
  const s = m.summary(30500);
  assert.equal(s.log.length, 30);
  assert.ok(s.log.slice(0, 5).every((e) => e.pos === 0.4));
  assert.ok(s.log.slice(5).every((e) => e.pos === null));
  const snap = m.snapshot(30500);
  assert.ok(Number.isFinite(snap.pos) && Number.isFinite(snap.wpm) && Number.isFinite(snap.hr));
});

test('avg WPM hanya dari detik mengetik; peak dari jendela', () => {
  const m = createMetrics(0);
  for (let i = 0; i < 60; i++) m.onKey(key('KeyA', 1000 + i * 200), 1000 + i * 200);
  for (let t = 0; t <= 30000; t += 100) m.tick(t, 0.1);
  const s = m.summary(30000);
  assert.ok(s.typingSec > 10 && s.typingSec < 20, String(s.typingSec));
  assert.ok(near(s.peakWpm, 60, 2), String(s.peakWpm));
  assert.ok(s.avgWpm > 40 && s.avgWpm <= 62, String(s.avgWpm));
});
