import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserKeys, modsOf } from '../../src/input/browserkeys.js';
import { createBus } from '../../src/core/bus.js';

function fakeWin() {
  const l = {};
  return {
    addEventListener: (t, f) => { (l[t] ||= []).push(f); },
    removeEventListener: (t, f) => { l[t] = (l[t] || []).filter((x) => x !== f); },
    fire: (t, e) => (l[t] || []).forEach((f) => f(e)),
    count: (t) => (l[t] || []).length,
  };
}

test('modsOf', () => {
  assert.deepEqual(modsOf({ shiftKey: true, ctrlKey: true, altKey: true, metaKey: true }), ['shift', 'ctrl', 'alt', 'cmd']);
  assert.deepEqual(modsOf({}), []);
});

test('keydown menjadi event key dengan rep dan mods; enabled() mengatur; stop() melepas', () => {
  const win = fakeWin(); const bus = createBus(); const got = []; let on = true;
  bus.on('key', (e) => got.push(e));
  const bk = createBrowserKeys({ bus, win, enabled: () => on, now: () => 42 });
  win.fire('keydown', { code: 'KeyA', repeat: false, shiftKey: true });
  win.fire('keydown', { code: 'KeyB', repeat: true });
  on = false;
  win.fire('keydown', { code: 'KeyC' });
  on = true;
  win.fire('keydown', { code: '' });
  assert.deepEqual(got, [
    { code: 'KeyA', at: 42, rep: false, mods: ['shift'] },
    { code: 'KeyB', at: 42, rep: true, mods: [] },
  ]);
  bk.stop();
  assert.equal(win.count('keydown'), 0);
});
