import test from 'node:test';
import assert from 'node:assert/strict';
import { labelFor, typeAxes, formatTimer, formatDur } from '../../src/core/text.js';

test('label en dan id', () => {
  assert.equal(labelFor('calm', 'en'), 'calm');
  assert.equal(labelFor('flow', 'id'), 'mengalir');
  assert.equal(labelFor('tense', 'id'), 'tegang');
  assert.equal(labelFor('noSignal', 'id'), 'tanpa sinyal');
  assert.equal(labelFor('paused', 'id'), 'jeda');
  assert.equal(labelFor('noSignal', 'xx'), 'no signal');
});

test('sumbu font mengikuti pos: calm lebar dan tipis, tense padat dan tebal', () => {
  assert.deepEqual(typeAxes(0), { wdth: 130, wght: 300 });
  assert.deepEqual(typeAxes(1), { wdth: 70, wght: 700 });
  assert.deepEqual(typeAxes(0.5), { wdth: 100, wght: 500 });
  assert.deepEqual(typeAxes(5), { wdth: 70, wght: 700 });
});

test('formatTimer dan formatDur', () => {
  assert.equal(formatTimer(0), '00:00');
  assert.equal(formatTimer(860000), '14:20');
  assert.equal(formatTimer(-5), '00:00');
  assert.equal(formatDur(860, 'id'), '14 menit 20 detik');
  assert.equal(formatDur(860, 'en'), '14 min 20 s');
  assert.equal(formatDur(480, 'id'), '8 menit');
  assert.equal(formatDur(20, 'id'), '20 detik');
});
