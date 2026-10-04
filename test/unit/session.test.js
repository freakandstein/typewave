import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSession } from '../../tools/gen_session.mjs';
import { runSession } from './_helpers.js';

const session = JSON.parse(fs.readFileSync(new URL('../../replay/sample-session.json', import.meta.url), 'utf8'));

test('sample-session.json cocok dengan generator (deterministik)', () => {
  assert.deepEqual(buildSession(), session);
});

test('sesi sintetis: hanya huruf, Space, Backspace, Enter (tidak pernah rekaman ketikan nyata)', () => {
  const allowed = new Set(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'KeyE', 'KeyR', 'KeyO', 'Space', 'Backspace', 'Enter']);
  const codes = new Set(session.events.filter((e) => e.type === 'key').map((e) => e.code));
  for (const c of codes) assert.ok(allowed.has(c), c);
});

test('statistik acuan memuat nilai yang diketahui', () => {
  const e = session.expected;
  assert.equal(e.durationMs, 150000);
  assert.equal(e.backspaces, 7);
  assert.equal(e.chars, 710);
  assert.equal(e.longestGapMs, 12200);
  assert.equal(e.flowSec, 70);
  assert.ok(e.peakWpm > 85 && e.peakWpm < 100, String(e.peakWpm));
});

test('metrics.summary cocok dengan statistik acuan independen', () => {
  const s = runSession(session);
  const e = session.expected;
  assert.equal(s.durationMs, e.durationMs);
  assert.equal(s.backspaces, e.backspaces);
  assert.equal(s.chars, e.chars);
  assert.equal(s.longestGapMs, e.longestGapMs);
  assert.equal(s.flowSec, e.flowSec);
  assert.equal(s.typingSec, e.typingSec);
  assert.ok(Math.abs(s.avgWpm - e.avgWpm) < 0.05, `${s.avgWpm} vs ${e.avgWpm}`);
  assert.ok(Math.abs(s.peakWpm - e.peakWpm) < 0.05, `${s.peakWpm} vs ${e.peakWpm}`);
  assert.equal(s.log.length, 150);
});

test('sesi sintetis memuat level gelombang: santai theta dan alpha tinggi, tegang beta tinggi, semua 0..1', () => {
  const minds = session.events.filter((e) => e.type === 'mind');
  assert.ok(minds.every((e) => ['theta', 'alpha', 'beta'].every((k) => e[k] >= 0 && e[k] <= 1)), 'level di luar 0..1 atau hilang');
  const at = (t) => minds.find((e) => e.t === t);
  const calm = at(20000);
  const tense = at(120000);
  assert.ok(calm.theta > 0.6 && calm.alpha > 0.6 && calm.beta < 0.4, JSON.stringify(calm));
  assert.ok(tense.beta > 0.6 && tense.theta < 0.4 && tense.alpha < 0.5, JSON.stringify(tense));
});
