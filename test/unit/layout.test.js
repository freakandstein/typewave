import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, LAYOUT_W, ZONES, keyInfo, keyIndex, zonesFor } from '../../src/data/layout-ansi75.js';

test('82 tombol unik; baris 1..5 lebar tepat 16u; baris 0 tidak melebihi 16u', () => {
  assert.equal(LAYOUT_W, 16);
  assert.equal(KEYS.length, 82);
  assert.equal(new Set(KEYS.map((k) => k.code)).size, 82);
  const widths = [0, 0, 0, 0, 0, 0];
  for (const k of KEYS) widths[k.y] += k.w;
  for (let y = 1; y <= 5; y++) assert.equal(widths[y], 16, 'baris ' + y);
  assert.ok(widths[0] <= 16);
});

test('posisi tengah u ada di dalam (0,1) dan Escape di kiri, Delete di kanan', () => {
  for (const k of KEYS) assert.ok(k.u > 0 && k.u < 1, k.code);
  assert.ok(keyInfo('Escape').u < 0.1);
  assert.ok(keyInfo('Delete').u > 0.8);
  assert.equal(keyIndex('NopeKey'), -1);
  assert.equal(keyInfo('NopeKey'), null);
});

test('tangan mengikuti touch typing standar', () => {
  const hand = (c) => keyInfo(c).hand;
  assert.equal(hand('KeyA'), 'L'); assert.equal(hand('KeyB'), 'L'); assert.equal(hand('Digit5'), 'L'); assert.equal(hand('ShiftLeft'), 'L');
  assert.equal(hand('KeyL'), 'R'); assert.equal(hand('KeyN'), 'R'); assert.equal(hand('Digit6'), 'R'); assert.equal(hand('ArrowUp'), 'R'); assert.equal(hand('Enter'), 'R');
  assert.equal(hand('Space'), 'B');
});

test('zona: baris F dan angka = 0, QWERTY = 1, home = 2, shift dan bawah = 3; Space = dua zona', () => {
  assert.deepEqual(zonesFor('Digit1'), ['L0']);
  assert.deepEqual(zonesFor('F9'), ['R0']);
  assert.deepEqual(zonesFor('KeyQ'), ['L1']);
  assert.deepEqual(zonesFor('KeyA'), ['L2']);
  assert.deepEqual(zonesFor('KeyM'), ['R3']);
  assert.deepEqual(zonesFor('ArrowLeft'), ['R3']);
  assert.deepEqual(zonesFor('Space'), ['L3', 'R3']);
  assert.deepEqual(zonesFor('Vk0C'), []);
  assert.equal(ZONES.length, 8);
  for (const k of KEYS) for (const z of zonesFor(k.code)) assert.ok(ZONES.includes(z), z);
});
