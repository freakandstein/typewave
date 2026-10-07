import test from 'node:test';
import assert from 'node:assert/strict';
import { createWsSource } from '../../src/input/ws.js';
import { createBus } from '../../src/core/bus.js';

class FakeWS {
  static instances = [];
  constructor(url) { this.url = url; FakeWS.instances.push(this); }
  close() { this.closedByUs = true; if (this.onclose) this.onclose(); }
}

function setup() {
  FakeWS.instances = [];
  const bus = createBus();
  const events = [];
  for (const t of ['key', 'mind', 'ctl', 'hello', 'headset']) bus.on(t, (e) => events.push([t, e]));
  const delays = [];
  const timers = [];
  const src = createWsSource({
    bus, url: 'ws://x/ws', WebSocketImpl: FakeWS, now: () => 777,
    setTimer: (fn, ms) => { delays.push(ms); timers.push(fn); },
  });
  const ws = () => FakeWS.instances.at(-1);
  return { src, events, delays, timers, ws };
}

test('pesan dirutekan ke bus dan dinormalisasi', () => {
  const { src, events, ws } = setup();
  ws().onopen();
  assert.equal(src.state.connected, true);
  ws().onmessage({ data: '{"t":"hello","keys":true}' });
  ws().onmessage({ data: '{"t":"hello","keys":true,"paused":true,"secure":false}' });
  ws().onmessage({ data: '{"t":"key","code":"KeyA","at":5,"rep":true,"mods":["shift"]}\n{"t":"key","code":"KeyB"}' });
  ws().onmessage({ data: '{"t":"mind","pos":0.4,"hr":70,"q":0.9}' });
  ws().onmessage({ data: '{"t":"ctl","pause":true}' });
  assert.deepEqual(events, [
    ['hello', { keys: true }],
    ['hello', { keys: true, paused: true, secure: false }],
    ['key', { code: 'KeyA', at: 5, rep: true, mods: ['shift'] }],
    ['key', { code: 'KeyB', at: 777, rep: false, mods: [] }],
    ['mind', { pos: 0.4, hr: 70, q: 0.9 }],
    ['ctl', { t: 'ctl', pause: true }],
  ]);
  assert.equal(src.state.keys, true);
});

test('baris rusak dan tipe tak dikenal diabaikan tanpa error', () => {
  const { events, ws } = setup();
  ws().onopen();
  for (const bad of ['not json', '{"t":"nope"}', '[1]', 'null', '{"t":"key"}', '{"t":"key","code":""}', '', '\n\n']) ws().onmessage({ data: bad });
  assert.deepEqual(events, []);
});

test('reconnect dengan backoff 1 s, 2 s, 5 s, 5 s dan reset setelah tersambung', () => {
  const { src, events, delays, timers, ws } = setup();
  ws().onopen();
  ws().onclose();
  assert.deepEqual(events.at(-1), ['hello', { keys: false }]);
  assert.equal(src.state.connected, false);
  for (let i = 0; i < 4; i++) { timers.shift()(); ws().onclose(); }
  assert.deepEqual(delays, [1000, 2000, 5000, 5000, 5000]);
  timers.shift()();
  ws().onopen();
  ws().onclose();
  assert.equal(delays.at(-1), 1000);
});

test('close() menghentikan reconnect', () => {
  const { src, delays, ws } = setup();
  ws().onopen();
  src.close();
  assert.deepEqual(delays, []);
});

test('mind dengan level gelombang meneruskan theta, alpha, beta; tanpa level bentuk lama tidak berubah', () => {
  const { events, ws } = setup();
  ws().onopen();
  ws().onmessage({ data: '{"t":"mind","pos":0.4,"hr":70,"q":0.9,"theta":0.6,"alpha":0.2,"beta":0.9}' });
  assert.deepEqual(events.at(-1), ['mind', { pos: 0.4, hr: 70, q: 0.9, theta: 0.6, alpha: 0.2, beta: 0.9 }]);
  ws().onmessage({ data: '{"t":"mind","pos":0.4,"hr":70,"q":0.9}' });
  assert.deepEqual(events.at(-1), ['mind', { pos: 0.4, hr: 70, q: 0.9 }]);
});

test('headset: status dan kontak diteruskan apa adanya; tanpa status yang berupa teks diabaikan', () => {
  const { events, ws } = setup();
  ws().onopen();
  ws().onmessage({ data: '{"t":"headset","state":"connected","contact":[1,0.5,0.2,0.9]}' });
  assert.deepEqual(events.at(-1), ['headset', { state: 'connected', contact: [1, 0.5, 0.2, 0.9] }]);
  ws().onmessage({ data: '{"t":"headset","state":"reconnecting","attempt":2}' });
  assert.deepEqual(events.at(-1), ['headset', { state: 'reconnecting', attempt: 2 }]);
  const n = events.length;
  for (const bad of ['{"t":"headset"}', '{"t":"headset","state":7}', '{"t":"headset","state":null}']) ws().onmessage({ data: bad });
  assert.equal(events.length, n);
});
