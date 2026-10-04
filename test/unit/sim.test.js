import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, wanderPos, nextAutoKey, nextAutoDelay } from '../../src/input/sim.js';
import { createBus } from '../../src/core/bus.js';

function fakeDoc() {
  const made = [];
  const mk = (tag) => {
    const el = {
      tag, children: [], listeners: {},
      append(...c) { this.children.push(...c); },
      appendChild(c) { this.children.push(c); return c; },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      fire(t) { (this.listeners[t] || []).forEach((f) => f()); },
    };
    made.push(el);
    return el;
  };
  return { createElement: mk, byId: (id) => made.find((e) => e.id === id) };
}

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

test('wanderPos selalu 0..1; nextAutoKey dan nextAutoDelay deterministik terhadap rng', () => {
  for (let s = 0; s < 1000; s += 7) { const p = wanderPos(s); assert.ok(p >= 0 && p <= 1); }
  assert.equal(nextAutoKey(() => 0.01), 'Backspace');
  assert.equal(nextAutoKey(() => 0.05), 'Enter');
  assert.equal(nextAutoKey(() => 0.5), 'KeyK');
  assert.equal(nextAutoDelay(() => 0.5), 140);
  assert.ok(nextAutoDelay(() => 0.01) >= 400);
});

test('panel: mind tiap 200 ms mengikuti slider; mind bisa dimatikan (uji noSignal)', () => {
  const doc = fakeDoc(); const h = harness(); const bus = createBus(); const minds = [];
  bus.on('mind', (m) => minds.push(m));
  const sim = createSim({ bus, root: doc.createElement('div'), doc, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, rng: () => 0.5 });
  h.advance(1000);
  assert.equal(minds.length, 5);
  assert.deepEqual(minds[0], { pos: 0.5, hr: 70, q: 1, theta: 0.5, alpha: 0.5, beta: 0.5 });
  const pos = doc.byId('sim-pos'); pos.value = '0.9'; pos.fire('input');
  h.advance(200);
  assert.equal(minds.at(-1).pos, 0.9);
  const mind = doc.byId('sim-mind'); mind.checked = false; mind.fire('change');
  const n = minds.length;
  h.advance(1000);
  assert.equal(minds.length, n);
  assert.equal(sim.state.mind, false);
});

test('panel: slider theta, alpha, beta mengatur level gelombang yang dikirim (default 0.5 = netral)', () => {
  const doc = fakeDoc(); const h = harness(); const bus = createBus(); const minds = [];
  bus.on('mind', (m) => minds.push(m));
  createSim({ bus, root: doc.createElement('div'), doc, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, rng: () => 0.5 });
  h.advance(200);
  assert.deepEqual([minds[0].theta, minds[0].alpha, minds[0].beta], [0.5, 0.5, 0.5]);
  const th = doc.byId('sim-theta'); th.value = '0.9'; th.fire('input');
  const be = doc.byId('sim-beta'); be.value = '0.1'; be.fire('input');
  h.advance(200);
  assert.deepEqual([minds.at(-1).theta, minds.at(-1).alpha, minds.at(-1).beta], [0.9, 0.5, 0.1]);
});

test('ketik otomatis menghasilkan key palsu ~7/detik dan bisa dihentikan', () => {
  const doc = fakeDoc(); const h = harness(); const bus = createBus(); const keys = [];
  bus.on('key', (k) => keys.push(k));
  const sim = createSim({ bus, root: doc.createElement('div'), doc, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, rng: () => 0.5 });
  sim.setAuto(true);
  h.advance(1000);
  assert.ok(keys.length >= 7 && keys.length <= 9, String(keys.length));
  assert.ok(keys.every((k) => k.code === 'KeyK' && k.rep === false));
  sim.setAuto(false);
  const n = keys.length;
  h.advance(1000);
  assert.equal(keys.length, n);
  doc.byId('sim-auto').fire('click');
  assert.equal(sim.state.auto, true);
  sim.stop();
});
