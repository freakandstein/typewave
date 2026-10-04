import test from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/bus.js';

test('emit memanggil semua handler dan off melepas handler', () => {
  const bus = createBus();
  const got = [];
  const off = bus.on('key', (e) => got.push(['a', e]));
  bus.on('key', (e) => got.push(['b', e]));
  bus.emit('key', 1);
  off();
  bus.emit('key', 2);
  assert.deepEqual(got, [['a', 1], ['b', 1], ['b', 2]]);
});

test('handler yang melempar error tidak menghentikan handler lain', () => {
  const bus = createBus();
  const orig = console.error;
  console.error = () => {};
  try {
    let ok = false;
    bus.on('x', () => { throw new Error('boom'); });
    bus.on('x', () => { ok = true; });
    bus.emit('x', null);
    assert.equal(ok, true);
  } finally {
    console.error = orig;
  }
});

test('emit tipe tanpa handler tidak error', () => {
  createBus().emit('none', 1);
});
