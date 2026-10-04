import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplay, loadReplay } from '../../src/input/replay.js';
import { createBus } from '../../src/core/bus.js';

function harness() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, off: false }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.off = true; },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = timers.filter((x) => !x.off && x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        t = next.at; next.off = true; next.fn();
      }
      t = end;
    },
  };
}

const EVENTS = [
  { t: 0, type: 'mind', pos: 0.4, hr: 70, q: 1 },
  { t: 100, type: 'key', code: 'KeyA' },
  { t: 250, type: 'key', code: 'Backspace' },
];

test('memutar dengan timeline asli dan memanggil onDone sekali', () => {
  const h = harness(); const bus = createBus(); const got = []; let done = 0;
  bus.on('key', (e) => got.push(['key', e.code, e.at]));
  bus.on('mind', (e) => got.push(['mind', e.pos]));
  const r = createReplay({ bus, events: EVENTS, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, onDone: () => done++ });
  r.start();
  assert.deepEqual(got, [['mind', 0.4]]);
  h.advance(100);
  assert.deepEqual(got.at(-1), ['key', 'KeyA', 100]);
  h.advance(149); assert.equal(got.length, 2); assert.equal(done, 0);
  h.advance(1);
  assert.deepEqual(got.at(-1), ['key', 'Backspace', 250]);
  assert.equal(done, 1); assert.equal(r.done, true);
});

test('speed 2 menggandakan kecepatan dan stop menghentikan emisi', () => {
  const h = harness(); const bus = createBus(); let n = 0;
  bus.on('key', () => n++);
  const r = createReplay({ bus, events: EVENTS, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, speed: 2 });
  r.start(); h.advance(50); assert.equal(n, 1);
  r.stop(); h.advance(1000); assert.equal(n, 1);
});

test('loadReplay memvalidasi bentuk file', async () => {
  const ok = await loadReplay('/replay/x.json', async () => ({ ok: true, json: async () => ({ events: EVENTS }) }));
  assert.equal(ok.length, 3);
  await assert.rejects(loadReplay('/replay/x.json', async () => ({ ok: false, status: 404 })), /404/);
  await assert.rejects(loadReplay('/replay/x.json', async () => ({ ok: true, json: async () => ({ nope: 1 }) })), /events/);
});

test('mind dalam rekaman meneruskan level gelombang bila ada', () => {
  const h = harness(); const bus = createBus(); const minds = [];
  bus.on('mind', (e) => minds.push(e));
  const events = [{ t: 0, type: 'mind', pos: 0.4, hr: 70, q: 1, theta: 0.7, alpha: 0.3, beta: 0.1 }, { t: 50, type: 'mind', pos: 0.5, hr: 70, q: 1 }];
  createReplay({ bus, events, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer }).start();
  h.advance(50);
  assert.deepEqual([minds[0].theta, minds[0].alpha, minds[0].beta], [0.7, 0.3, 0.1]);
  assert.deepEqual(minds[1], { pos: 0.5, hr: 70, q: 1 });
});
