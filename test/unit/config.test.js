import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, scaleFor } from '../../src/config.js';

test('token warna persis seperti spec', () => {
  assert.deepEqual(CONFIG.colors.calm, { ground: '#0F2B33', ink: '#8ED8D0' });
  assert.deepEqual(CONFIG.colors.flow, { ground: '#2D2112', ink: '#F2B24E' });
  assert.deepEqual(CONFIG.colors.tense, { ground: '#2B0F1E', ink: '#FF5E72' });
  assert.deepEqual(CONFIG.colors.noSignal, { ground: '#2A2D31', ink: '#ECE7DC' });
  assert.equal(CONFIG.colors.text, '#ECE7DC');
});

test('config beku dan skala memakai sisi pendek', () => {
  assert.equal(Object.isFrozen(CONFIG), true);
  assert.equal(scaleFor(1920, 1080), 1);
  assert.equal(scaleFor(1080, 1920), 1);
  assert.equal(scaleFor(960, 540), 0.5);
});
