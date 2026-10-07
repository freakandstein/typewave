import test from 'node:test';
import assert from 'node:assert/strict';
import { contactLevel, sanitizeHeadset, createHeadset } from '../../src/core/headset.js';

test('contactLevel memakai ambang yang sama dengan DSP: >= 0,65 dipakai (good), >= 0,25 marginal (fair), di bawahnya buruk (poor)', () => {
  assert.equal(contactLevel(1), 'good');
  assert.equal(contactLevel(0.65), 'good');
  assert.equal(contactLevel(0.64), 'fair');
  assert.equal(contactLevel(0.25), 'fair');
  assert.equal(contactLevel(0.24), 'poor');
  assert.equal(contactLevel(0), 'poor');
});

test('sanitizeHeadset: hanya status yang dikenal; percobaan bilangan bulat 1..9999 saat reconnecting; kontak harus 4 angka dan dijepit 0..1', () => {
  assert.equal(sanitizeHeadset(null), null);
  assert.equal(sanitizeHeadset({}), null);
  assert.equal(sanitizeHeadset({ state: 'bogus' }), null);
  assert.equal(sanitizeHeadset({ state: 7 }), null);
  assert.deepEqual(sanitizeHeadset({ state: 'connecting' }), { state: 'connecting', attempt: 0, contact: null });
  assert.deepEqual(sanitizeHeadset({ state: 'stopped' }), { state: 'stopped', attempt: 0, contact: null });
  assert.equal(sanitizeHeadset({ state: 'reconnecting', attempt: 2 }).attempt, 2);
  assert.equal(sanitizeHeadset({ state: 'reconnecting', attempt: 2.6 }).attempt, 3);
  for (const bad of [undefined, 0, -3, 'x', NaN, null]) assert.equal(sanitizeHeadset({ state: 'reconnecting', attempt: bad }).attempt, 1, String(bad));
  assert.equal(sanitizeHeadset({ state: 'reconnecting', attempt: 1e9 }).attempt, 9999);
  assert.deepEqual(sanitizeHeadset({ state: 'connected', contact: [1, 0.5, 2, -1] }).contact, [1, 0.5, 1, 0]);
  for (const bad of [[1, 1, 1], [1, 1, 1, 1, 1], [1, 'x', 1, 1], [1, NaN, 1, 1], [1, null, 1, 1], 'abcd', 5, {}]) {
    assert.equal(sanitizeHeadset({ state: 'connected', contact: bad }).contact, null, JSON.stringify(bad));
  }
});

test('createHeadset: unknown sebelum ada pesan; status mengikuti pesan; kontak menjadi level hanya saat connected', () => {
  const h = createHeadset();
  assert.deepEqual({ ...h.snapshot(0), contact: null }, { state: 'unknown', attempt: 0, contact: null });
  assert.equal(h.onMessage({ state: 'connected', contact: [1, 0.5, 0.1, 0.9] }, 1000), true);
  let s = h.snapshot(1500);
  assert.equal(s.state, 'connected');
  assert.deepEqual(s.contact, ['good', 'fair', 'poor', 'good']);
  h.onMessage({ state: 'reconnecting', attempt: 2, contact: [1, 1, 1, 1] }, 2000);
  s = h.snapshot(2100);
  assert.equal(s.state, 'reconnecting');
  assert.equal(s.attempt, 2);
  assert.equal(s.contact, null, 'selama putus tidak ada titik sensor');
  h.onMessage({ state: 'connecting' }, 2200);
  assert.equal(h.snapshot(2300).state, 'connecting');
});

test('pesan tak valid ditolak dan tidak menyegarkan status', () => {
  const h = createHeadset();
  h.onMessage({ state: 'connected', contact: [1, 1, 1, 1] }, 1000);
  assert.equal(h.onMessage({ state: 'bogus' }, 3900), false);
  assert.equal(h.onMessage(null, 3900), false);
  assert.equal(h.snapshot(4100).state, 'offline', 'pesan sampah tidak boleh dianggap detak sumber EEG');
});

test('diam lebih dari 3 detik = sumber EEG terputus (offline); stopped juga offline; pesan baru memulihkan', () => {
  const h = createHeadset();
  h.onMessage({ state: 'connected', contact: [1, 1, 1, 1] }, 1000);
  assert.equal(h.snapshot(1000 + 3000).state, 'connected');
  const s = h.snapshot(1000 + 3001);
  assert.equal(s.state, 'offline');
  assert.equal(s.contact, null);
  h.onMessage({ state: 'connected', contact: [1, 1, 1, 1] }, 5000);
  assert.equal(h.snapshot(5100).state, 'connected');
  h.onMessage({ state: 'stopped' }, 5200);
  assert.equal(h.snapshot(5300).state, 'offline');
});

test('bridge terputus mengalahkan status lain dan pulih saat tersambung lagi; tanpa pesan sama sekali tetap unknown', () => {
  const h = createHeadset();
  h.onBridge(false);
  assert.equal(h.snapshot(0).state, 'bridge');
  h.onBridge(true);
  assert.equal(h.snapshot(0).state, 'unknown', 'sumber EEG belum pernah terlihat: bukan "terputus", hanya tidak ada sinyal');
  h.onMessage({ state: 'connected', contact: [1, 1, 1, 1] }, 1000);
  h.onBridge(false);
  const s = h.snapshot(1100);
  assert.equal(s.state, 'bridge');
  assert.equal(s.contact, null);
  h.onBridge(true);
  assert.equal(h.snapshot(1200).state, 'connected');
});

test('bridge hidup lagi: status terakhir dianggap segar dari saat sambung ulang (detak berikutnya datang dalam 200 ms), baru offline bila tetap sunyi 3 detik', () => {
  const h = createHeadset();
  h.onMessage({ state: 'connected', contact: [1, 1, 1, 1] }, 1000);
  h.onBridge(false, 1500);
  assert.equal(h.snapshot(8000).state, 'bridge');
  h.onBridge(true, 9000); // bridge mati 7,5 detik: detak sumber EEG tentu tidak sampai
  assert.equal(h.snapshot(9100).state, 'connected', 'tanpa kedip "sumber EEG terputus" sebelum detak pertama sempat datang');
  assert.equal(h.snapshot(9000 + 3000).state, 'connected');
  assert.equal(h.snapshot(9000 + 3001).state, 'offline', 'tetap sunyi setelah bridge kembali: sumber EEG memang tidak ada');
  h.onMessage({ state: 'connected', contact: [1, 1, 1, 1] }, 9500);
  assert.equal(h.snapshot(9600).state, 'connected');
});

test('onBridge(true) saat bridge memang sudah tersambung tidak menyegarkan status basi', () => {
  const h = createHeadset();
  h.onMessage({ state: 'connected', contact: [1, 1, 1, 1] }, 1000);
  h.onBridge(true, 9000);
  assert.equal(h.snapshot(9100).state, 'offline');
});

test('onBridge(true) tanpa pernah ada pesan headset tetap unknown', () => {
  const h = createHeadset();
  h.onBridge(false, 1000);
  h.onBridge(true, 2000);
  assert.equal(h.snapshot(2100).state, 'unknown');
});
