import test from 'node:test';
import assert from 'node:assert/strict';
import { createStats, recordKey, percentile } from '../../src/debug.js';

test('recordKey menghitung, menyimpan urutan dan latensi, dengan batas 5000', () => {
  const s = createStats();
  recordKey(s, { code: 'KeyA', at: 100 }, 130);
  recordKey(s, { code: 'KeyB', at: 200 }, 205);
  assert.equal(s.keysReceived, 2);
  assert.equal(s.lastCode, 'KeyB');
  assert.deepEqual(s.seq, ['KeyA', 'KeyB']);
  assert.deepEqual(s.latencies, [30, 5]);
  for (let i = 0; i < 6000; i++) recordKey(s, { code: 'KeyC', at: 0 }, 1);
  assert.equal(s.seq.length, 5000);
  assert.equal(s.latencies.length, 5000);
  assert.equal(s.keysReceived, 6002);
});

test('percentile', () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95), 96);
});
