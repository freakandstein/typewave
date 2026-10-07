import test from 'node:test';
import assert from 'node:assert/strict';
import { labelFor, formatDur, headsetText } from '../../src/core/text.js';

test('label demoHint ada di en dan id', () => {
  assert.match(labelFor('demoHint', 'en'), /demo/i);
  assert.match(labelFor('demoHint', 'id'), /demo/i);
  assert.notEqual(labelFor('demoHint', 'en'), labelFor('demoHint', 'id'));
});

test('label en dan id', () => {
  assert.equal(labelFor('calm', 'en'), 'calm');
  assert.equal(labelFor('flow', 'id'), 'netral');
  assert.equal(labelFor('flow', 'en'), 'neutral');
  assert.equal(labelFor('tense', 'id'), 'tegang');
  assert.equal(labelFor('noSignal', 'id'), 'tanpa sinyal');
  assert.equal(labelFor('paused', 'id'), 'jeda');
  assert.equal(labelFor('noSignal', 'xx'), 'no signal');
});

test('formatDur', () => {
  assert.equal(formatDur(860, 'id'), '14 menit 20 detik');
  assert.equal(formatDur(860, 'en'), '14 min 20 s');
  assert.equal(formatDur(480, 'id'), '8 menit');
  assert.equal(formatDur(20, 'id'), '20 detik');
});

test('headsetText: tanpa info headset sama seperti dulu (no signal bila mind mati); tiap status punya teks en dan id', () => {
  const H = (state, extra = {}) => ({ state, attempt: 0, contact: null, ...extra });
  assert.equal(headsetText(undefined, true, 'en'), 'no signal');
  assert.equal(headsetText(undefined, false, 'en'), '');
  assert.equal(headsetText(H('unknown'), true, 'id'), 'tanpa sinyal');
  assert.equal(headsetText(H('unknown'), false, 'id'), '');
  assert.equal(headsetText(H('bridge'), true, 'id'), 'bridge terputus');
  assert.equal(headsetText(H('bridge'), true, 'en'), 'bridge disconnected');
  assert.equal(headsetText(H('offline'), true, 'id'), 'sumber EEG terputus');
  assert.equal(headsetText(H('offline'), true, 'en'), 'EEG source offline');
  assert.equal(headsetText(H('connecting'), true, 'id'), 'menyambung ke headset');
  assert.equal(headsetText(H('connecting'), true, 'en'), 'connecting to headset');
  assert.equal(headsetText(H('reconnecting', { attempt: 2 }), true, 'id'), 'menyambung ulang, percobaan 2');
  assert.equal(headsetText(H('reconnecting', { attempt: 1 }), true, 'en'), 'reconnecting, attempt 1');
});

test('headsetText: putus tampil segera walau data lama belum basi; connected hanya bicara saat belum ada mind: menyiapkan sinyal atau cek sensor', () => {
  const H = (state, extra = {}) => ({ state, attempt: 0, contact: null, ...extra });
  assert.equal(headsetText(H('reconnecting', { attempt: 3 }), false, 'id'), 'menyambung ulang, percobaan 3');
  assert.equal(headsetText(H('bridge'), false, 'id'), 'bridge terputus');
  assert.equal(headsetText(H('connected'), true, 'id'), 'menyiapkan sinyal');
  assert.equal(headsetText(H('connected'), true, 'en'), 'warming up');
  const poor = ['poor', 'poor', 'poor', 'poor'];
  assert.equal(headsetText(H('connected', { contact: poor }), true, 'id'), 'cek sensor');
  assert.equal(headsetText(H('connected', { contact: poor }), true, 'en'), 'check the sensors');
  assert.equal(headsetText(H('connected', { contact: ['poor', 'good', 'poor', 'poor'] }), true, 'id'), 'menyiapkan sinyal', 'satu sensor bagus masih cukup untuk mulai');
  const good = ['good', 'good', 'good', 'good'];
  assert.equal(headsetText(H('connected', { contact: good }), false, 'id'), '', 'mind mengalir dan sensor terbaca: tidak ada yang perlu dikatakan');
  assert.equal(headsetText(H('connected', { contact: ['poor', 'good', 'fair', 'poor'] }), false, 'id'), '');
});

test('headsetText: baru tersambung ulang (belum ada kontak segar) = menyiapkan sinyal walau mind lama belum basi; semua sensor buruk = cek sensor seketika', () => {
  const H = (state, extra = {}) => ({ state, attempt: 0, contact: null, ...extra });
  assert.equal(headsetText(H('connected'), false, 'id'), 'menyiapkan sinyal', 'tanpa jeda kosong antara "menyambung ulang" dan "menyiapkan sinyal"');
  assert.equal(headsetText(H('connected'), false, 'en'), 'warming up');
  assert.equal(headsetText(H('connected', { contact: ['poor', 'poor', 'poor', 'poor'] }), false, 'id'), 'cek sensor', 'tidak menunggu mind lama basi 5 detik');
});

test('headsetText: "cek sensor" bila tidak ada satu pun sensor hijau (DSP butuh minimal satu kanal bagus untuk menghasilkan mind), bukan hanya bila keempatnya merah', () => {
  const H = (contact) => ({ state: 'connected', attempt: 0, contact });
  assert.equal(headsetText(H(['fair', 'fair', 'fair', 'fair']), true, 'id'), 'cek sensor', 'semuanya kuning: mind tidak akan pernah ada, bukan sekadar belum siap');
  assert.equal(headsetText(H(['poor', 'fair', 'poor', 'fair']), true, 'en'), 'check the sensors');
  assert.equal(headsetText(H(['poor', 'fair', 'poor', 'fair']), false, 'id'), 'cek sensor', 'seketika, tanpa menunggu mind lama basi');
  assert.equal(headsetText(H(['fair', 'fair', 'good', 'fair']), true, 'id'), 'menyiapkan sinyal', 'satu sensor hijau sudah cukup untuk mind');
  assert.equal(headsetText(H(['poor', 'poor', 'good', 'poor']), false, 'id'), '', 'mind mengalir dari sensor hijau itu');
});
