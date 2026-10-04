// Metrics ketikan + sesi (spec 5.1 dan 7). Semua fungsi menerima waktu (ms) sebagai parameter: jam bisa disuntik.
import { CONFIG } from '../config.js';
import { classify, isModifier, counts } from './keys.js';
import { createSpring, stepSpring, snapSpring } from './spring.js';
import { clamp } from './color.js';

const M = CONFIG.metrics;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Menjepit atau membuang nilai ngawur dari pesan `mind`. null = abaikan pesan.
export function sanitizeMind(m) {
  const pos = num(m && m.pos);
  if (pos === null) return null;
  const hr = num(m.hr);
  const q = num(m.q);
  const level = (v) => { const x = num(v); return x === null ? null : clamp(x, 0, 1); };
  return {
    pos: clamp(pos, 0, 1),
    hr: hr !== null && hr >= M.hrRange[0] && hr <= M.hrRange[1] ? hr : null,
    q: q === null ? 1 : clamp(q, 0, 1),
    theta: level(m.theta), // level gelombang 0..1 relatif terhadap kebiasaan user (null = tidak dikirim)
    alpha: level(m.alpha),
    beta: level(m.beta),
  };
}

export function createMetrics(start = 0) {
  const omega = CONFIG.spring.omega;
  const a = { keys: 0, chars: 0, backspaces: 0, longestGapMs: 0, peakWpm: 0, typingSec: 0, wpmSum: 0, flowSec: 0 };
  const st = {
    lastKeyAt: null, lastMindAt: null, lastCharAt: null, burstStart: null,
    chars: [], dens: 0, densAt: null, ikiSum: 0, ikiN: 0,
    rawPos: 0.5, rawHr: null, rawQ: 1, gotMind: false, gotHr: false, rawTheta: null, rawAlpha: null, rawBeta: null,
    pos: createSpring(0.5, omega), hr: createSpring(0, omega), wpm: createSpring(0, omega),
    log: [], nextSample: start + 1000,
  };
  const snap = {
    pos: 0.5, hr: 0, q: 1, wpm: 0, rawPos: 0.5, rawHr: null, rawWpm: 0, density: 0,
    idle: true, typing: false, noSignal: true, hrValid: false, keys: 0, theta: null, alpha: null, beta: null,
  };

  const isIdle = (t) => st.lastKeyAt === null || t - st.lastKeyAt > M.idleMs;
  const isNoSignal = (t) => st.lastMindAt === null || t - st.lastMindAt > M.noSignalMs;
  const densityAt = (t) => (st.densAt === null ? 0 : st.dens * Math.exp(-Math.max(0, t - st.densAt) / M.densityTauMs));

  // WPM mentah pada waktu t: karakter dalam jendela / 5 x (60 / detik jendela).
  function wpmRaw(t) {
    if (st.burstStart === null) return 0;
    const win = clamp(t - st.burstStart, M.wpmMinWindowMs, M.wpmWindowMs);
    let n = 0;
    for (let i = st.chars.length - 1; i >= 0; i--) {
      const c = st.chars[i];
      if (c > t) continue;
      if (c < t - win) break;
      n++;
    }
    return (n / 5) * (60000 / win);
  }

  function onKey(ev, now) {
    const at = num(ev.at) ?? now;
    const code = String(ev.code ?? '');
    const cls = classify(code);
    const modifier = isModifier(code);
    const counted = counts(ev) && !modifier;
    a.keys++;
    if (st.lastKeyAt !== null) a.longestGapMs = Math.max(a.longestGapMs, at - st.lastKeyAt);
    st.lastKeyAt = at;
    if (cls === 'backspace') a.backspaces++;
    if (counted) {
      st.dens = densityAt(at) + 1000 / M.densityTauMs;
      st.densAt = at;
    }
    let iki = null;
    if (counted && cls === 'char') {
      if (st.lastCharAt !== null) iki = Math.max(0, at - st.lastCharAt);
      if (iki !== null && iki <= M.pauseMs) { st.ikiSum += iki; st.ikiN++; }
      if (iki === null || iki > M.pauseMs) st.burstStart = at;
      st.lastCharAt = at;
      st.chars.push(at);
      const cut = at - M.wpmWindowMs - 1000;
      while (st.chars.length && st.chars[0] < cut) st.chars.shift();
      a.chars++;
    }
    return { code, at, rep: !!ev.rep, mods: Array.isArray(ev.mods) ? ev.mods : [], cls, modifier, counted, iki };
  }

  function onMind(m, now) {
    const s = sanitizeMind(m);
    if (!s) return false;
    st.lastMindAt = now;
    st.rawPos = s.pos;
    st.rawQ = s.q;
    st.rawHr = s.hr;
    st.rawTheta = s.theta;
    st.rawAlpha = s.alpha;
    st.rawBeta = s.beta;
    if (!st.gotMind) { snapSpring(st.pos, s.pos); st.gotMind = true; }
    if (s.hr !== null && !st.gotHr) { snapSpring(st.hr, s.hr); st.gotHr = true; }
    return true;
  }

  // Satu sampel per detik berdasarkan timestamp; celah (timer tertahan) diisi dengan nilai terakhir.
  function sampleUpTo(now) {
    while (now >= st.nextSample) {
      const t = st.nextSample;
      st.nextSample += 1000;
      const idle = isIdle(t);
      const sig = !isNoSignal(t);
      const w = idle ? 0 : wpmRaw(t);
      st.log.push({ t: t - start, pos: sig ? st.rawPos : null, wpm: w, hr: sig ? st.rawHr : null, idle });
      if (!idle) { a.typingSec++; a.wpmSum += w; if (w > a.peakWpm) a.peakWpm = w; }
      if (sig && st.rawPos >= M.flowRange[0] && st.rawPos <= M.flowRange[1]) a.flowSec++;
    }
  }

  function tick(now, dt) {
    stepSpring(st.pos, st.rawPos, dt);
    if (st.rawHr !== null) stepSpring(st.hr, st.rawHr, dt);
    stepSpring(st.wpm, wpmRaw(now), dt);
    sampleUpTo(now);
  }

  function snapshot(now) {
    snap.pos = st.pos.x;
    snap.hr = st.hr.x;
    snap.q = st.rawQ;
    snap.wpm = st.wpm.x;
    snap.rawPos = st.rawPos;
    snap.rawHr = st.rawHr;
    snap.rawWpm = wpmRaw(now);
    snap.density = densityAt(now);
    snap.idle = isIdle(now);
    snap.typing = !snap.idle;
    snap.noSignal = isNoSignal(now);
    snap.hrValid = st.rawHr !== null && !snap.noSignal;
    snap.theta = snap.noSignal ? null : st.rawTheta;
    snap.alpha = snap.noSignal ? null : st.rawAlpha;
    snap.beta = snap.noSignal ? null : st.rawBeta;
    snap.keys = a.keys;
    return snap;
  }

  function summary(now) {
    sampleUpTo(now);
    const ongoing = st.lastKeyAt === null ? 0 : Math.max(0, now - st.lastKeyAt);
    return {
      durationMs: now - start,
      avgWpm: a.typingSec ? a.wpmSum / a.typingSec : 0,
      peakWpm: a.peakWpm,
      flowSec: a.flowSec,
      longestGapMs: Math.max(a.longestGapMs, ongoing),
      backspaces: a.backspaces,
      typingSec: a.typingSec,
      chars: a.chars,
      keys: a.keys,
      log: st.log,
    };
  }

  return { onKey, onMind, tick, snapshot, summary, ikiMean: () => (st.ikiN ? st.ikiSum / st.ikiN : null) };
}
