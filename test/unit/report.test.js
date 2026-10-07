import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReport, hookText, dominantState, drawReport, createReportView, exportPng } from '../../src/render/report.js';
import { runSession } from './_helpers.js';

const session = JSON.parse(fs.readFileSync(new URL('../../replay/sample-session.json', import.meta.url), 'utf8'));
const sum = runSession(session);
const e = session.expected;

function mockCtx() {
  const c = {
    texts: [], sizes: [], fills: [], rects: 0, strokes: 0, fillStyle: '', font: '', fontStretch: '',
    measureText(t) { return { width: t.length * parseFloat(c.font.split(' ')[1]) * 0.5 }; },
    fillText(t) { c.texts.push(t); c.sizes.push(parseFloat(c.font.split(' ')[1])); },
    fillRect() { c.rects++; c.fills.push(c.fillStyle); },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() { c.strokes++; },
  };
  return c;
}

test('buildReport en: angka kartu cocok dengan statistik acuan sesi sintetis', () => {
  const rep = buildReport(sum, 'en');
  assert.deepEqual(rep.lines, [
    '2 min 30 s session',
    `${Math.round(e.avgWpm)} wpm average, ${Math.round(e.peakWpm)} peak`,
    '1 min 10 s neutral',
    'longest pause 12 s',
    '7 backspaces',
  ]);
  assert.equal(rep.hook, '1 min 10 s neutral');
  assert.equal(rep.strip.length, 150 * 4);
  assert.equal(rep.wpm.length, 150);
  assert.ok(Math.abs(rep.wpmMax - e.peakWpm) < 0.05);
  assert.equal(rep.dominant.word, 'flow');
});

test('buildReport id', () => {
  const rep = buildReport(sum, 'id');
  assert.deepEqual(rep.lines, [
    'sesi 2 menit 30 detik',
    `rata-rata ${Math.round(e.avgWpm)} wpm, puncak ${Math.round(e.peakWpm)}`,
    '1 menit 10 detik netral',
    'jeda terpanjang 12 detik',
    '7 backspace',
  ]);
  assert.equal(rep.hook, 'netral selama 1 menit 10 detik');
});

test('hook tanpa menit di flow memakai state dominan; tanpa data mind memakai durasi', () => {
  const calm = Array.from({ length: 480 }, (_, i) => ({ t: (i + 1) * 1000, pos: 0.2, wpm: 0, hr: 70, idle: true }));
  assert.equal(hookText({ flowSec: 0, log: calm, durationMs: 480000 }, 'en'), 'mostly calm for 8 min');
  assert.equal(hookText({ flowSec: 0, log: calm, durationMs: 480000 }, 'id'), 'dominan tenang selama 8 menit');
  const none = Array.from({ length: 5 }, (_, i) => ({ t: (i + 1) * 1000, pos: null, wpm: 0, hr: null, idle: true }));
  assert.equal(hookText({ flowSec: 0, log: none, durationMs: 5000 }, 'en'), '5 s session');
  assert.equal(hookText({ flowSec: 0, log: none, durationMs: 5000 }, 'id'), 'sesi selama 5 detik');
  assert.equal(dominantState([]), null);
  assert.deepEqual(dominantState(calm), { word: 'calm', sec: 480 });
});

test('drawReport wide: latar, hook, 5 baris angka, strip 150 kolom, sumbu font statis', () => {
  const rep = buildReport(sum, 'en');
  const ctx = mockCtx();
  drawReport(ctx, 1920, 1080, rep, { solid: true });
  assert.equal(ctx.texts.length, 6);
  assert.equal(ctx.texts[0], rep.hook);
  assert.equal(ctx.rects, 1 + 150);
  assert.equal(ctx.strokes, 1);
  assert.ok(ctx.font.startsWith('500 '), ctx.font);
  assert.equal(ctx.fontStretch, 'normal');
});

test('drawReport tall bukan solid: latar redup 60%, teks panjang diperkecil agar muat', () => {
  const rep = buildReport(sum, 'id');
  const ctx = mockCtx();
  drawReport(ctx, 1080, 1920, rep, { solid: false });
  assert.equal(ctx.texts.length, 6);
  assert.equal(ctx.fills[0], 'rgba(0,0,0,0.6)');
  const maxW = 1080 - 2 * 0.07 * 1080;
  ctx.texts.forEach((t, i) => assert.ok(t.length * ctx.sizes[i] * 0.5 <= maxW + 1e-6, `${t} (${ctx.sizes[i]}px)`));
});

function viewHarness() {
  const timers = [];
  const canvas = { width: 0, height: 0, style: { display: 'none' }, getContext: () => mockCtx() };
  const win = { innerWidth: 1280, innerHeight: 720 };
  const changes = [];
  const view = createReportView({
    canvas, getSummary: () => sum, getLang: () => 'en', win,
    setTimer: (fn, ms) => { const h = { fn, ms, off: false }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.off = true; },
    onChange: (v) => changes.push(v),
  });
  return { view, canvas, timers, changes };
}

test('tampilan: toggle, menutup sendiri setelah 9 detik, pemicu kedua menutup lebih awal', () => {
  const { view, canvas, timers, changes } = viewHarness();
  view.toggle();
  assert.equal(view.visible, true);
  assert.equal(canvas.style.display, 'block');
  assert.equal(canvas.width, 1280);
  assert.equal(timers.at(-1).ms, 9000);
  timers.at(-1).fn();
  assert.equal(view.visible, false);
  assert.equal(canvas.style.display, 'none');
  view.toggle();
  view.toggle();
  assert.equal(view.visible, false);
  view.hide();
  assert.deepEqual(changes, [true, false, true, false]);
});

test('ukuran kartu mengikuti bingkai (getSize), bukan jendela', () => {
  const canvas = { width: 0, height: 0, style: { display: 'none' }, getContext: () => mockCtx() };
  const view = createReportView({
    canvas, getSummary: () => sum, getLang: () => 'en', win: { innerWidth: 720, innerHeight: 1280 }, getSize: () => ({ W: 720, H: 405 }),
    setTimer: () => 1, clearTimer: () => {},
  });
  view.show();
  assert.equal(canvas.width, 720);
  assert.equal(canvas.height, 405);
});

test('repaint hanya menggambar saat terlihat', () => {
  const { view, canvas } = viewHarness();
  let draws = 0;
  canvas.getContext = () => { draws++; return mockCtx(); };
  view.repaint();
  assert.equal(draws, 0);
  view.show();
  assert.equal(draws, 1);
  view.repaint();
  assert.equal(draws, 2);
});

test('exportPng: kanvas berukuran persis dan blob PNG; gagal bila toBlob mengembalikan null', async () => {
  let made = null;
  const mkDoc = (blob) => ({ createElement: () => (made = { width: 0, height: 0, getContext: () => mockCtx(), toBlob: (cb, type) => cb(blob && { ...blob, type }) }) });
  const rep = buildReport(sum, 'en');
  const b = await exportPng(rep, 1920, 1080, mkDoc({ size: 123 }));
  assert.equal(b.size, 123);
  assert.equal(b.type, 'image/png');
  assert.deepEqual([made.width, made.height], [1920, 1080]);
  await exportPng(rep, 1080, 1920, mkDoc({ size: 1 }));
  assert.deepEqual([made.width, made.height], [1080, 1920]);
  await assert.rejects(exportPng(rep, 1080, 1920, mkDoc(null)), /toBlob/);
});
