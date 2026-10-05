import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, wanderPos, wanderBands, nextAutoKey, nextAutoDelay } from '../../src/input/sim.js';
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

test('wanderBands: level 0..1 dan mengikuti pos seperti EEG sungguhan (tenang: theta dan alpha tinggi; tegang: beta tinggi)', () => {
  for (let s = 0; s < 400; s += 3) for (const p of [0, 0.3, 0.7, 1]) for (const v of Object.values(wanderBands(p, s))) assert.ok(v >= 0 && v <= 1, `${p} ${s} ${v}`);
  const calm = wanderBands(0.05, 10);
  const tense = wanderBands(0.95, 10);
  assert.ok(calm.theta > tense.theta + 0.4 && calm.alpha > tense.alpha + 0.3 && tense.beta > calm.beta + 0.5, JSON.stringify({ calm, tense }));
});

test('nextAutoDelay mengikuti pos bila diberikan: tenang mengetik pelan, tegang cepat; tanpa pos tetap seperti dulu', () => {
  assert.equal(nextAutoDelay(() => 0.5), 140);
  assert.ok(nextAutoDelay(() => 0.5, 0) > 2 * nextAutoDelay(() => 0.5, 1));
});

test('mode demo: langsung mengetik sendiri dan mind mengembara (pos dan level gelombang bergerak); slider mengambil alih; tombol menghentikan ketikan', () => {
  const doc = fakeDoc(); const h = harness(); const bus = createBus(); const keys = []; const minds = [];
  bus.on('key', (k) => keys.push(k)); bus.on('mind', (m) => minds.push(m));
  const sim = createSim({ bus, root: doc.createElement('div'), doc, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, rng: () => 0.5, demo: true });
  assert.equal(sim.state.auto, true); assert.equal(sim.state.wander, true);
  assert.equal(doc.byId('sim-wander').checked, true); assert.equal(doc.byId('sim-auto').textContent, 'berhenti');
  h.advance(30000);
  assert.ok(keys.length > 30, `ketikan otomatis: ${keys.length}`);
  const range = (f) => Math.max(...minds.map(f)) - Math.min(...minds.map(f));
  for (const [name, f] of [['pos', (m) => m.pos], ['theta', (m) => m.theta], ['alpha', (m) => m.alpha], ['beta', (m) => m.beta]]) assert.ok(range(f) > 0.15, `${name} harus bergerak: ${range(f)}`);
  const pos = doc.byId('sim-pos'); pos.value = '0.2'; pos.fire('input');
  h.advance(200);
  const frozen = minds.at(-1);
  h.advance(5000);
  const now = minds.at(-1);
  assert.deepEqual([now.pos, now.theta, now.alpha, now.beta], [frozen.pos, frozen.theta, frozen.alpha, frozen.beta], 'slider mengambil alih: tidak mengembara lagi');
  doc.byId('sim-auto').fire('click');
  const n = keys.length;
  h.advance(2000);
  assert.equal(keys.length, n);
  sim.stop();
});

test('tanpa demo panel tetap seperti dulu: tidak mengembara dan tidak mengetik sendiri', () => {
  const doc = fakeDoc(); const h = harness(); const bus = createBus(); const keys = []; const minds = [];
  bus.on('key', (k) => keys.push(k)); bus.on('mind', (m) => minds.push(m));
  const sim = createSim({ bus, root: doc.createElement('div'), doc, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, rng: () => 0.5 });
  h.advance(20000);
  assert.equal(keys.length, 0); assert.equal(sim.state.wander, false);
  assert.ok(minds.every((m) => m.pos === 0.5 && m.theta === 0.5 && m.beta === 0.5));
  sim.stop();
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
