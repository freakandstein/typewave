import test from 'node:test';
import assert from 'node:assert/strict';
import { parseParams, resolveLayout } from '../../src/params.js';

test('default sesuai spec 8.2', () => {
  assert.deepEqual(parseParams(''), {
    layout: 'wide', fit: 'contain', ratio: null, transparent: false, privacy: 'zone', sim: false, replay: null, lang: 'en',
    ws: 'ws://127.0.0.1:8770/ws', debug: false, controls: false, keyboard: false, brain: true,
  });
});

test('nilai valid dibaca; nilai tidak valid jatuh ke default', () => {
  const p = parseParams('?layout=tall&transparent=1&privacy=exact&sim=1&lang=id&debug=1&controls=1&keyboard=1&brain=0&replay=sample-session&ws=ws://127.0.0.1:9/ws');
  assert.equal(p.layout, 'tall'); assert.equal(p.transparent, true); assert.equal(p.privacy, 'exact'); assert.equal(p.sim, true);
  assert.equal(p.lang, 'id'); assert.equal(p.debug, true); assert.equal(p.controls, true); assert.equal(p.keyboard, true); assert.equal(p.brain, false);
  assert.equal(p.replay, 'sample-session'); assert.equal(p.ws, 'ws://127.0.0.1:9/ws');
  const bad = parseParams('?layout=square&privacy=nope&lang=fr&transparent=maybe');
  assert.equal(bad.layout, 'wide'); assert.equal(bad.privacy, 'zone'); assert.equal(bad.lang, 'en'); assert.equal(bad.transparent, false);
});

test('ws=off menjadi null; replay dibersihkan dari karakter path', () => {
  assert.equal(parseParams('?ws=off').ws, null);
  assert.equal(parseParams('?replay=../../etc/passwd').replay, '....etcpasswd');
  assert.equal(parseParams('?replay=').replay, null);
});

test('ws default mengikuti origin halaman (bridge di port mana pun); file: dan ws eksplisit tetap', () => {
  assert.equal(parseParams('', { protocol: 'http:', host: '127.0.0.1:9000' }).ws, 'ws://127.0.0.1:9000/ws');
  assert.equal(parseParams('', { protocol: 'https:', host: 'localhost:8770' }).ws, 'wss://localhost:8770/ws');
  assert.equal(parseParams('', { protocol: 'file:', host: '' }).ws, 'ws://127.0.0.1:8770/ws');
  assert.equal(parseParams('?ws=ws://127.0.0.1:1/ws', { protocol: 'http:', host: 'x:2' }).ws, 'ws://127.0.0.1:1/ws');
  assert.equal(parseParams('?ws=off', { protocol: 'http:', host: 'x:2' }).ws, null);
});

test('ratio: "21:9", "3:1", dan desimal dibaca; yang tidak valid menjadi null (bawaan dipakai)', () => {
  assert.equal(parseParams('').ratio, null);
  assert.ok(Math.abs(parseParams('?ratio=21:9').ratio - 21 / 9) < 1e-9);
  assert.equal(parseParams('?ratio=3:1').ratio, 3);
  assert.equal(parseParams('?ratio=2.5').ratio, 2.5);
  for (const bad of ['?ratio=abc', '?ratio=0:9', '?ratio=-2', '?ratio=3:0', '?ratio=1:2:3', '?ratio=']) assert.equal(parseParams(bad).ratio, null, bad);
});

test('fit: contain (bingkai utuh dengan bilah) adalah default; fill memenuhi jendela; nilai lain jatuh ke default', () => {
  assert.equal(parseParams('').fit, 'contain');
  assert.equal(parseParams('?fit=fill').fit, 'fill');
  assert.equal(parseParams('?fit=cover').fit, 'contain');
});

test('tanpa ?layout= halaman selalu horizontal, walau jendelanya potret; auto dan tall tetap bisa dipilih', () => {
  assert.equal(resolveLayout(parseParams('').layout, 1080, 1920), 'wide');
  assert.equal(resolveLayout(parseParams('?layout=square').layout, 1080, 1920), 'wide');
  assert.equal(parseParams('?layout=auto').layout, 'auto');
  assert.equal(resolveLayout(parseParams('?layout=auto').layout, 1080, 1920), 'tall');
  assert.equal(resolveLayout(parseParams('?layout=tall').layout, 1920, 1080), 'tall');
});

test('resolveLayout: auto mengikuti rasio viewport', () => {
  assert.equal(resolveLayout('auto', 1920, 1080), 'wide');
  assert.equal(resolveLayout('auto', 1080, 1920), 'tall');
  assert.equal(resolveLayout('auto', 1000, 1000), 'wide');
  assert.equal(resolveLayout('tall', 1920, 1080), 'tall');
  assert.equal(resolveLayout('wide', 1080, 1920), 'wide');
});
