#!/usr/bin/env node
// Generator sesi sintetis (deterministik) untuk replay + statistik acuan. Implementasi acuan di sini sengaja
// terpisah dari src/core/metrics.js (scan mundur, bukan inkremental) supaya keduanya saling memeriksa.
// Pemakaian: node tools/gen_session.mjs [--out replay/sample-session.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DURATION = 150000;
const LETTERS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'KeyE', 'KeyR', 'KeyO'];
const BURSTS = [[10000, 40000, 200], [52000, 92000, 125], [100000, 140000, 160]]; // [mulai, akhir (eksklusif), IKI ms]
const BACKSPACE_SLOTS = [40, 80, 120, 160, 200, 240, 280]; // slot dalam burst ke-2
const ENTER_SLOTS = [100, 220, 300];
// Ketikan digeser 37 ms supaya tidak pernah tepat di batas sampel 1 detik (ketikan nyata tidak pernah sejajar;
// kesejajaran membuat jendela tertutup menghitung satu huruf lebih banyak secara sistematis).
const KEY_OFFSET = 37;
const posAt = (t) => (t < 40500 ? 0.2 : t < 100500 ? 0.5 : t < 140500 ? 0.8 : 0.5);
// Level gelombang sintetis mengikuti posisi tenang-tegang (santai = theta dan alpha tinggi, tegang = beta tinggi) dengan variasi lambat.
const lvl = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
const bandsAt = (pos, t) => ({
  theta: lvl(0.9 - 0.8 * pos + 0.12 * Math.sin(t / 4700 + 2)),
  alpha: lvl(0.95 - 0.7 * pos + 0.1 * Math.sin(t / 3100 + 1)),
  beta: lvl(0.1 + 0.85 * pos + 0.08 * Math.sin(t / 2300)),
});

export function refStats(events, durationMs) {
  const keys = events.filter((e) => e.type === 'key');
  const minds = events.filter((e) => e.type === 'mind');
  const charTimes = keys.filter((e) => e.code !== 'Backspace' && e.code !== 'Enter').map((e) => e.t);
  let longestGapMs = 0;
  for (let i = 1; i < keys.length; i++) longestGapMs = Math.max(longestGapMs, keys[i].t - keys[i - 1].t);
  longestGapMs = Math.max(longestGapMs, durationMs - keys[keys.length - 1].t);
  let typingSec = 0, wpmSum = 0, peakWpm = 0, flowSec = 0;
  for (let b = 1000; b <= durationMs; b += 1000) {
    const lastKey = [...keys].reverse().find((e) => e.t <= b);
    const idle = !lastKey || b - lastKey.t > 3000;
    const upto = charTimes.filter((t) => t <= b);
    let wpm = 0;
    if (!idle && upto.length) {
      let k = upto.length - 1;
      while (k > 0 && upto[k] - upto[k - 1] <= 3000) k--; // awal burst: scan mundur selama jeda <= 3 s
      const win = Math.min(10000, Math.max(3000, b - upto[k]));
      wpm = (upto.filter((t) => t >= b - win).length / 5) * (60000 / win);
    }
    if (!idle) { typingSec++; wpmSum += wpm; peakWpm = Math.max(peakWpm, wpm); }
    const m = [...minds].reverse().find((e) => e.t <= b);
    if (m && b - m.t <= 5000 && m.pos >= 0.35 && m.pos <= 0.65) flowSec++;
  }
  return {
    durationMs,
    backspaces: keys.filter((e) => e.code === 'Backspace').length,
    chars: charTimes.length,
    longestGapMs,
    typingSec,
    avgWpm: typingSec ? wpmSum / typingSec : 0,
    peakWpm,
    flowSec,
  };
}

export function buildSession() {
  const events = [];
  for (let t = 0; t <= DURATION; t += 200) events.push({ t, type: 'mind', pos: posAt(t), hr: 70, q: 1, ...bandsAt(posAt(t), t) });
  BURSTS.forEach(([from, to, iki], b) => {
    for (let i = 0; from + i * iki < to; i++) {
      let code = i % 6 === 5 ? 'Space' : LETTERS[i % LETTERS.length];
      if (b === 1 && BACKSPACE_SLOTS.includes(i)) code = 'Backspace';
      if (b === 1 && ENTER_SLOTS.includes(i)) code = 'Enter';
      events.push({ t: from + KEY_OFFSET + i * iki, type: 'key', code });
    }
  });
  events.sort((x, y) => x.t - y.t);
  return {
    meta: { name: 'sample-session', durationMs: DURATION, note: 'sintetis, deterministik; bukan rekaman ketikan nyata' },
    events,
    expected: refStats(events, DURATION),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const i = process.argv.indexOf('--out');
  const out = i >= 0 ? process.argv[i + 1] : 'replay/sample-session.json';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(buildSession()) + '\n');
  console.log('wrote', out);
}
