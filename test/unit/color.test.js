import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothstep, clamp, lerp, hexToRgb, rgbToOklab, oklabToRgb, gradeInto, createStateWord } from '../../src/core/color.js';

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rgbNear = (c, hex, tol = 1.5) => hexToRgb(hex).every((v, i) => near(c[i], v, tol));
const fresh = () => ({ ground: [0, 0, 0], ink: [0, 0, 0] });

test('smoothstep, clamp, lerp', () => {
  assert.equal(smoothstep(0.15, 0.35, 0.1), 0);
  assert.equal(smoothstep(0.15, 0.35, 0.4), 1);
  assert.ok(near(smoothstep(0.15, 0.35, 0.25), 0.5, 1e-12));
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(lerp(2, 4, 0.5), 3);
});

test('OKLab round trip untuk semua token', () => {
  for (const hex of ['#0F2B33', '#8ED8D0', '#2D2112', '#F2B24E', '#2B0F1E', '#FF5E72', '#2A2D31', '#ECE7DC']) {
    const rgb = hexToRgb(hex);
    const back = oklabToRgb(rgbToOklab(rgb));
    assert.ok(rgb.every((v, i) => near(v, back[i], 0.5)), hex + ' -> ' + back);
  }
});

test('titik jangkar token: calm, plateau flow, tense', () => {
  const out = fresh();
  gradeInto(out, 0.05, 1, 0);
  assert.ok(rgbNear(out.ground, '#0F2B33')); assert.ok(rgbNear(out.ink, '#8ED8D0'));
  gradeInto(out, 0.5, 1, 0);
  assert.ok(rgbNear(out.ground, '#2D2112')); assert.ok(rgbNear(out.ink, '#F2B24E'));
  gradeInto(out, 0.95, 1, 0);
  assert.ok(rgbNear(out.ground, '#2B0F1E')); assert.ok(rgbNear(out.ink, '#FF5E72'));
});

test('plateau flow 0.35..0.65 dan transisi halus 0.15..0.35', () => {
  const a = fresh();
  const b = fresh();
  gradeInto(a, 0.35, 1, 0);
  gradeInto(b, 0.65, 1, 0);
  assert.deepEqual(a.ground.map(Math.round), b.ground.map(Math.round));
  let prev = null;
  for (let i = 0; i <= 20; i++) {
    gradeInto(a, 0.15 + i * 0.01, 1, 0);
    if (prev !== null) assert.ok(Math.abs(a.ground[0] - prev) < 4);
    prev = a.ground[0];
  }
});

test('q menurunkan saturasi ink; noSignal k=1 menjadi Batu dan Kapas', () => {
  const full = fresh();
  const low = fresh();
  gradeInto(full, 0.5, 1, 0);
  gradeInto(low, 0.5, 0, 0);
  const chroma = (c) => { const lab = rgbToOklab(c); return Math.hypot(lab[1], lab[2]); };
  assert.ok(near(chroma(low.ink) / chroma(full.ink), 0.5, 0.03));
  gradeInto(low, 0.5, 1, 1);
  assert.ok(rgbNear(low.ground, '#2A2D31'));
  assert.ok(rgbNear(low.ink, '#ECE7DC'));
});

test('kata state: ambang 0.35/0.65 dan hysteresis 500 ms', () => {
  const w = createStateWord(500);
  assert.equal(w.update(0.2, 0), 'calm');
  assert.equal(w.update(0.4, 100), 'calm');
  assert.equal(w.update(0.4, 400), 'calm');
  assert.equal(w.update(0.4, 650), 'flow');
  assert.equal(w.update(0.7, 700), 'flow');
  assert.equal(w.update(0.3, 800), 'flow');
  assert.equal(w.update(0.7, 900), 'flow');
  assert.equal(w.update(0.7, 1450), 'tense');
  assert.equal(createStateWord(500).update(0.35, 0), 'flow');
  assert.equal(createStateWord(500).update(0.65, 0), 'flow');
  assert.equal(createStateWord(500).update(0.66, 0), 'tense');
  assert.equal(createStateWord(500).update(0.349, 0), 'calm');
});
