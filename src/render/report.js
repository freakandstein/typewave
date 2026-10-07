// Kartu laporan sesi (spec 7): data, gambar di canvas (sumbu font statis agar sama di layar dan PNG),
// tampilan sementara, dan ekspor PNG.
import { CONFIG } from '../config.js';
import { gradeInto } from '../core/color.js';
import { formatDur, labelFor } from '../core/text.js';

const stateOf = (pos) => (pos < CONFIG.zone.calmMax ? 'calm' : pos > CONFIG.zone.tenseMin ? 'tense' : 'flow');

export function dominantState(log) {
  const n = { calm: 0, flow: 0, tense: 0 };
  let any = false;
  for (const e of log) if (e.pos !== null) { n[stateOf(e.pos)]++; any = true; }
  if (!any) return null;
  let best = 'calm';
  for (const k of ['flow', 'tense']) if (n[k] > n[best]) best = k;
  return { word: best, sec: n[best] };
}

export function hookText(sum, lang = 'en') {
  const id = lang === 'id';
  if (sum.flowSec > 0) return id ? `netral selama ${formatDur(sum.flowSec, 'id')}` : `${formatDur(sum.flowSec, 'en')} neutral`;
  const dom = dominantState(sum.log);
  if (dom) return id ? `dominan ${labelFor(dom.word, 'id')} selama ${formatDur(dom.sec, 'id')}` : `mostly ${labelFor(dom.word, 'en')} for ${formatDur(dom.sec, 'en')}`;
  const d = formatDur(sum.durationMs / 1000, lang);
  return id ? `sesi selama ${d}` : `${d} session`;
}

export function buildReport(sum, lang = 'en') {
  const id = lang === 'id';
  const dur = formatDur(sum.durationMs / 1000, lang);
  const avg = Math.round(sum.avgWpm);
  const peak = Math.round(sum.peakWpm);
  const lines = id
    ? [`sesi ${dur}`, `rata-rata ${avg} wpm, puncak ${peak}`, `${formatDur(sum.flowSec, 'id')} netral`,
       `jeda terpanjang ${formatDur(sum.longestGapMs / 1000, 'id')}`, `${sum.backspaces} backspace`]
    : [`${dur} session`, `${avg} wpm average, ${peak} peak`, `${formatDur(sum.flowSec, 'en')} neutral`,
       `longest pause ${formatDur(sum.longestGapMs / 1000, 'en')}`, `${sum.backspaces} backspaces`];
  const n = sum.log.length;
  const strip = new Float32Array(n * 4);
  const wpm = new Float32Array(n);
  const tmp = { ground: [0, 0, 0], ink: [0, 0, 0] };
  let wpmMax = 60;
  for (let i = 0; i < n; i++) {
    const e = sum.log[i];
    if (e.pos === null) gradeInto(tmp, 0.5, 1, 1); else gradeInto(tmp, e.pos, 1, 0);
    strip[i * 4] = tmp.ink[0];
    strip[i * 4 + 1] = tmp.ink[1];
    strip[i * 4 + 2] = tmp.ink[2];
    strip[i * 4 + 3] = e.idle ? 0.45 : 1;
    wpm[i] = e.wpm;
    if (e.wpm > wpmMax) wpmMax = e.wpm;
  }
  return { hook: hookText(sum, lang), lines, strip, wpm, wpmMax, dominant: dominantState(sum.log), lang };
}

function setFont(ctx, px) {
  ctx.font = `${CONFIG.type.reportWght} ${px}px Anybody, system-ui, sans-serif`;
  if ('fontStretch' in ctx) ctx.fontStretch = 'normal';
}

// Mengecilkan font sampai teks muat dalam maxW; mengembalikan ukuran akhir (font tetap terpasang di ctx).
function fit(ctx, text, px, maxW) {
  let p = px;
  setFont(ctx, p);
  while (p > 8 && ctx.measureText(text).width > maxW) { p *= 0.94; setFont(ctx, p); }
  return p;
}

export function drawReport(ctx, W, H, rep, { solid = true } = {}) {
  const R = CONFIG.report;
  const u = Math.min(W, H);
  const m = R.margin * u;
  const w = W - 2 * m;
  const L = R.layout[H > W ? 'tall' : 'wide'];
  const text = CONFIG.colors.text;

  if (solid) {
    const t = { ground: [0, 0, 0], ink: [0, 0, 0] };
    if (rep.dominant) gradeInto(t, { calm: 0.1, flow: 0.5, tense: 0.9 }[rep.dominant.word], 1, 0); else gradeInto(t, 0.5, 1, 1);
    ctx.fillStyle = `rgb(${t.ground[0] | 0},${t.ground[1] | 0},${t.ground[2] | 0})`;
  } else {
    ctx.fillStyle = `rgba(0,0,0,${R.dim})`;
  }
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = text;
  const hookPx = fit(ctx, rep.hook, R.hookPx * u, w);
  ctx.fillText(rep.hook, m, m + hookPx);

  const n = rep.wpm.length;
  const cy = L.chartY * H;
  const ch = L.chartH * H;
  if (n >= 2) {
    const cols = Math.max(2, Math.min(n, Math.floor(w)));
    ctx.strokeStyle = text;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(2, 0.003 * u);
    ctx.beginPath();
    for (let c = 0; c < cols; c++) {
      const i0 = Math.floor((c / cols) * n);
      const i1 = Math.max(i0 + 1, Math.floor(((c + 1) / cols) * n));
      let v = 0;
      for (let i = i0; i < i1 && i < n; i++) if (rep.wpm[i] > v) v = rep.wpm[i];
      const x = m + (c / (cols - 1)) * w;
      const y = cy + ch - (v / rep.wpmMax) * ch;
      if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (n >= 1) {
    const cols = Math.min(n, Math.floor(w));
    const cw = w / cols;
    const sy = L.stripY * H;
    const sh = L.stripH * H;
    for (let c = 0; c < cols; c++) {
      const i = Math.min(n - 1, Math.floor(((c + 0.5) / cols) * n));
      ctx.fillStyle = `rgba(${rep.strip[i * 4] | 0},${rep.strip[i * 4 + 1] | 0},${rep.strip[i * 4 + 2] | 0},${rep.strip[i * 4 + 3].toFixed(2)})`;
      ctx.fillRect(m + c * cw, sy, cw + 0.5, sh);
    }
  }
  ctx.fillStyle = text;
  rep.lines.forEach((line, i) => {
    fit(ctx, line, L.statsPx * H, w);
    ctx.fillText(line, m, L.statsY * H + i * L.statsStep * H);
  });
}

export function createReportView({ canvas, getSummary, getLang, win, getSize = null, setTimer = setTimeout, clearTimer = clearTimeout, showMs = CONFIG.report.showMs, onChange }) {
  let visible = false;
  let timer = null;
  function paint() {
    const { W, H } = getSize ? getSize() : { W: win.innerWidth, H: win.innerHeight }; // ukuran bingkai, bukan jendela
    canvas.width = W;
    canvas.height = H;
    drawReport(canvas.getContext('2d'), W, H, buildReport(getSummary(), getLang()), { solid: false });
  }
  function hide() {
    if (!visible) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    canvas.style.display = 'none';
    visible = false;
    if (onChange) onChange(false);
  }
  function show() {
    if (visible) return;
    paint();
    canvas.style.display = 'block';
    visible = true;
    timer = setTimer(hide, showMs);
    if (onChange) onChange(true);
  }
  return {
    show, hide,
    toggle() { if (visible) hide(); else show(); },
    repaint() { if (visible) paint(); },
    get visible() { return visible; },
  };
}

export function exportPng(rep, W, H, doc = document) {
  return new Promise((resolve, reject) => {
    const c = doc.createElement('canvas');
    c.width = W;
    c.height = H;
    drawReport(c.getContext('2d'), W, H, rep, { solid: true });
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob gagal'))), 'image/png');
  });
}
