// Perakit utama: sumber input -> bus -> metrics -> render. dt di-clamp (spec 10); geometri dibangun ulang saat resize.
import { CONFIG } from './config.js';
import { createBus } from './core/bus.js';
import { createMetrics } from './core/metrics.js';
import { gradeInto, createStateWord, clamp, lerp, smoothstep } from './core/color.js';
import { createSpring, stepSpring } from './core/spring.js';
import { waveShapeInto } from './core/wave.js';
import { parseParams, resolveLayout } from './params.js';
import { createWsSource } from './input/ws.js';
import { createBrowserKeys } from './input/browserkeys.js';
import { createSim } from './input/sim.js';
import { createReplay, loadReplay } from './input/replay.js';
import { createGeom, stageRect, wideRatio } from './render/scene.js';
import { createRibbon, advanceRibbon, prefillRibbon, drawRibbon } from './render/ribbon.js';
import { createBeads, spawnForKey, updateBeads, drawBeads, KIND } from './render/beads.js';
import { createFootprint, lightKey, decayFootprint, drawFootprint } from './render/keyboard.js';
import { createBrain, sparkBrain, stepBrain, drawBrain, brainStats, brainRect } from './render/brain.js';
import { createHud } from './render/hud.js';
import { buildReport, createReportView, exportPng } from './render/report.js';
import { createStats, recordKey, percentile } from './debug.js';
import { labelFor } from './core/text.js';

const PERF_N = 600;
const rgb = (c, f = 1) => `rgb(${clamp(c[0] * f, 0, 255) | 0},${clamp(c[1] * f, 0, 255) | 0},${clamp(c[2] * f, 0, 255) | 0})`;

export function start({ canvas, hudRoot, reportCanvas, panel, win }) {
  const doc = win.document;
  const stageEl = canvas.parentElement; // wadah kanvas, HUD, dan kartu: diletakkan di tengah jendela sebagai bingkai 16:9 atau 9:16
  const params = parseParams(win.location.search, win.location);
  const exclusive = !!params.replay; // replay mematikan sumber lain
  const bus = createBus();
  const stats = createStats();
  let metrics = createMetrics(Date.now());
  let sessionStart = Date.now();
  const word = createStateWord();
  const ctx = canvas.getContext('2d');
  const hud = createHud(hudRoot, doc);
  const grade = { ground: [0, 0, 0], ink: [0, 0, 0] };
  gradeInto(grade, 0.5, 1, 1);
  const spr = { rest: createSpring(0, CONFIG.spring.restOmega), noSig: createSpring(1, CONFIG.spring.noSignalOmega) };
  const rp = { thick: 2, amp: 8, speed: 40, rough: 0, wavelength: 420, cr: 0, cg: 0, cb: 0 };
  const view = { word: '', pos: 0.5, wpm: 0, wpmOn: false, hr: null, timerMs: 0, noSignal: true, paused: false, lang: params.lang, debugText: null };
  const live = { paused: false, secure: false, keysFromBridge: false, listener: 'off' };
  const sweeps = new Float64Array(4).fill(-1e12);
  const perf = { frame: new Float32Array(PERF_N), draw: new Float32Array(PERF_N), n: 0 };
  const trace = { v: new Float32Array(PERF_N), n: 0 };
  const dbg = { at: -1e9, str: '' };
  const drive = { pos: 0.5, density: 0, noSig: 1, theta: null, alpha: null, beta: null }; // masukan ilustrasi otak per frame (objek dipakai ulang)
  let g, rb, beads, fp, brain = null, sim = null;
  let breathe = 0, lastTs = 0, lastDt = 0.016, maxDtSeen = 0, maxRawGap = 0, firstFrame = true;

  // --- laporan -------------------------------------------------------------
  // HUD disembunyikan selama kartu tampil supaya teksnya tidak menumpuk dengan hook kartu.
  const report = createReportView({
    canvas: reportCanvas, getSummary: () => metrics.summary(Date.now()), getLang: () => params.lang, win, getSize: () => ({ W: g.W, H: g.H }),
    onChange: (visible) => { hudRoot.style.visibility = visible ? 'hidden' : 'visible'; },
  });

  // --- parameter pita per frame (objek `rp` dipakai ulang) ---------------------
  function fillRp(snap, now) {
    const R = CONFIG.ribbon;
    const rest = clamp(spr.rest.x);
    const breath = 0.5 + 0.5 * Math.sin((2 * Math.PI * R.idleBreathHz * now) / 1000);
    const thickA = lerp(R.thickness[0], R.thickness[1], clamp(snap.wpm / R.wpmMax));
    const ampA = lerp(R.amp[0], R.amp[1], clamp(snap.density / R.densityAmpMax));
    const speedA = lerp(R.speed[0], R.speed[1], clamp(snap.density / R.densitySpeedMax));
    rp.thick = lerp(thickA, lerp(R.idleThick[0], R.idleThick[1], breath), rest) * g.k;
    rp.amp = lerp(ampA, R.idleAmp, rest) * g.k;
    rp.speed = lerp(speedA, R.idleSpeed, rest) * g.k;
    rp.rough = smoothstep(R.roughFrom, 1, snap.pos);
    waveShapeInto(rp, lerp(snap.pos, 0.5, clamp(spr.noSig.x))); // tenang <-> tegang; kembali netral saat tanpa sinyal
    rp.wavelength *= g.k;
    rp.cr = grade.ink[0]; rp.cg = grade.ink[1]; rp.cb = grade.ink[2];
  }

  function build() {
    const ww = Math.max(1, win.innerWidth);
    const wh = Math.max(1, win.innerHeight);
    const layout = resolveLayout(params.layout, ww, wh);
    const st = stageRect(layout, ww, wh, params.fit, wideRatio(params.ratio, params.keyboard));
    Object.assign(stageEl.style, { left: `${st.x}px`, top: `${st.y}px`, width: `${st.w}px`, height: `${st.h}px` });
    canvas.width = st.w;
    canvas.height = st.h;
    g = createGeom(st.w, st.h, layout, undefined, params.keyboard, params.fit === 'contain');
    rb = createRibbon(g.L);
    beads = createBeads();
    fp = createFootprint();
    brain = params.brain ? createBrain() : null;
    hud.setLayout(layout, g.k);
    doc.documentElement.classList.toggle('transparent', params.transparent);
    fillRp(metrics.snapshot(Date.now()), Date.now());
    prefillRibbon(rb, rp);
    report.repaint();
  }

  // --- input -----------------------------------------------------------------
  function triggerSweep(now) {
    let o = 0;
    for (let i = 1; i < sweeps.length; i++) if (sweeps[i] < sweeps[o]) o = i;
    sweeps[o] = now;
  }

  bus.on('key', (ev) => {
    if (live.paused) return;
    const now = Date.now();
    recordKey(stats, ev, now);
    const ann = metrics.onKey(ev, now);
    if (params.keyboard) lightKey(fp, ann.code, params.privacy);
    if (ann.cls === 'enter' && !ann.rep) triggerSweep(now); // Enter ditahan tidak boleh membuat garis berkedip
    spawnForKey(beads, rb, g, ann, { privacy: params.privacy, ink: grade.ink, now });
    if (brain) sparkBrain(brain, ann, params.privacy, now);
  });
  bus.on('mind', (m) => { metrics.onMind(m, Date.now()); });
  bus.on('hello', (h) => {
    stats.helloCount++;
    stats.hello = h;
    live.keysFromBridge = !!h.keys;
    if (typeof h.paused === 'boolean') live.paused = h.paused; // status bridge terkini mengalahkan yang basi
    if (typeof h.secure === 'boolean') live.secure = h.secure;
  });
  bus.on('ctl', (c) => {
    if (typeof c.pause === 'boolean') live.paused = c.pause;
    if (typeof c.secure === 'boolean') live.secure = c.secure;
    if (c.report === true) report.toggle();
  });

  win.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyR' && !e.repeat) report.toggle();
    else if (e.code === 'Escape') report.hide();
  });
  win.addEventListener('resize', build);

  if (params.ws && !exclusive) createWsSource({ bus, url: params.ws, onState: (s) => { stats.wsConnected = s.connected; } });
  if (params.sim && !exclusive) {
    sim = createSim({ bus, root: panel, doc, demo: params.demo });
    createBrowserKeys({ bus, win, enabled: () => !live.keysFromBridge });
  }
  if (params.replay) {
    loadReplay(`replay/${params.replay}.json`).then((events) => {
      metrics = createMetrics(Date.now());
      sessionStart = Date.now();
      createReplay({ bus, events, onDone: () => { stats.replayDone = true; } }).start();
      stats.replayStarted = true;
    }).catch((err) => console.error('[replay]', err));
  }
  if (params.debug && params.ws) {
    const poll = () => fetch('/status').then((r) => r.json()).then((j) => { live.listener = j.listener; }).catch(() => {}).finally(() => setTimeout(poll, 2000));
    poll();
  }

  // --- ekspor dan kontrol --------------------------------------------------------
  const exportKind = (kind) => exportPng(buildReport(metrics.summary(Date.now()), params.lang), CONFIG.report[kind][0], CONFIG.report[kind][1], doc);
  if (params.controls) {
    for (const kind of ['wide', 'tall']) {
      const [w, h] = CONFIG.report[kind];
      const b = doc.createElement('button');
      b.id = `export-${kind}`;
      b.textContent = `export ${w}×${h}`;
      b.addEventListener('click', () => exportKind(kind).then((blob) => {
        const a = doc.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `typewave-${kind}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }));
      panel.appendChild(b);
    }
  }
  if (params.sim || params.controls) panel.classList.add('on');
  const hint = doc.getElementById('demo-hint');
  if (params.demo && hint) { hint.querySelector('span').textContent = labelFor('demoHint', params.lang); hint.hidden = false; }

  // --- gambar ----------------------------------------------------------------------
  function drawSweeps(now, ink) {
    const E = CONFIG.enter;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, E.px * g.k);
    ctx.globalAlpha = E.a;
    for (let i = 0; i < sweeps.length; i++) {
      const t = (now - sweeps[i]) / E.ms;
      if (t < 0 || t > 1) continue;
      const s = t * g.L;
      ctx.beginPath();
      ctx.moveTo(g.x(s, 0), g.y(s, 0));
      ctx.lineTo(g.x(s, g.A), g.y(s, g.A));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function perfSummary() {
    const n = Math.min(perf.n, PERF_N);
    const f = Array.from(perf.frame.subarray(0, n));
    const d = Array.from(perf.draw.subarray(0, n));
    const mean = f.reduce((a, b) => a + b, 0) / (n || 1);
    return { n, fpsAvg: mean ? 1000 / mean : 0, frameP95: percentile(f, 0.95), drawP95: percentile(d, 0.95), drawMax: d.length ? Math.max(...d) : 0 };
  }

  function debugText(now) {
    if (now - dbg.at < 250) return dbg.str;
    dbg.at = now;
    const p = perfSummary();
    dbg.str = `fps ${p.fpsAvg.toFixed(0)}  draw p95 ${p.drawP95.toFixed(1)} ms  keys ${stats.keysReceived}  last ${stats.lastCode ?? '-'}\n`
      + `listener ${live.secure ? 'secure-input' : live.listener}  ws ${stats.wsConnected ? 'on' : 'off'}  ${g.layout} ${g.W}x${g.H}`;
    return dbg.str;
  }

  function frame(ts) {
    const t0 = win.performance.now();
    const now = Date.now();
    const rawGap = firstFrame ? 0.016 : (ts - lastTs) / 1000;
    const dt = clamp(rawGap, 0, CONFIG.maxDt);
    firstFrame = false;
    lastTs = ts;
    lastDt = dt;
    if (rawGap > maxRawGap) maxRawGap = rawGap;
    if (dt > maxDtSeen) maxDtSeen = dt;

    metrics.tick(now, dt);
    const snap = metrics.snapshot(now);
    stepSpring(spr.rest, snap.idle ? 1 : 0, dt);
    stepSpring(spr.noSig, snap.noSignal ? 1 : 0, dt);
    gradeInto(grade, snap.pos, snap.q, clamp(spr.noSig.x));
    if (snap.hrValid) breathe += ((2 * Math.PI * snap.hr) / 60) * dt;
    const lum = snap.hrValid ? 1 + CONFIG.breathe * Math.sin(breathe) : 1;

    fillRp(snap, now);
    advanceRibbon(rb, rp.speed * dt, rp);
    updateBeads(beads, rb, g, rp.speed, dt, now);
    if (params.keyboard) decayFootprint(fp, dt);
    if (brain) {
      drive.pos = snap.pos;
      drive.density = snap.density;
      drive.noSig = clamp(spr.noSig.x);
      drive.theta = snap.theta; // level gelombang EEG 0..1 (null = tidak ada data: netral)
      drive.alpha = snap.alpha;
      drive.beta = snap.beta;
      stepBrain(brain, dt, drive);
    }

    if (params.transparent) ctx.clearRect(0, 0, g.W, g.H);
    else { ctx.globalAlpha = 1; ctx.fillStyle = rgb(grade.ground, lum); ctx.fillRect(0, 0, g.W, g.H); }
    const ink = rgb(grade.ink);
    if (params.keyboard) drawFootprint(ctx, fp, g, params.privacy, ink);
    if (brain) drawBrain(ctx, brain, g, ink, drive);
    drawRibbon(ctx, rb, g);
    drawBeads(ctx, beads, g);
    drawSweeps(now, ink);

    view.word = snap.noSignal ? '' : word.update(snap.pos, now);
    view.pos = snap.pos;
    view.wpm = snap.wpm;
    view.wpmOn = snap.typing;
    view.hr = snap.hrValid ? snap.hr : null;
    view.timerMs = now - sessionStart;
    view.noSignal = snap.noSignal;
    view.paused = live.paused;
    view.debugText = params.debug ? debugText(now) : null;
    hud.update(view);

    const i = perf.n % PERF_N;
    perf.frame[i] = rawGap * 1000;
    perf.draw[i] = win.performance.now() - t0;
    perf.n++;
    trace.v[trace.n % PERF_N] = snap.pos;
    trace.n++;
    win.requestAnimationFrame(frame);
  }

  build();
  win.requestAnimationFrame(frame);

  if (params.debug) {
    const kindCounts = () => {
      const c = { char: 0, neutral: 0, rep: 0, back: 0, space: 0 };
      const names = { [KIND.CHAR]: 'char', [KIND.NEUTRAL]: 'neutral', [KIND.REP]: 'rep', [KIND.BACK]: 'back', [KIND.SPACE]: 'space' };
      for (let i = 0; i < beads.cap; i++) if (beads.active[i]) c[names[beads.kind[i]]]++;
      return c;
    };
    win.__typewave = {
      stats, params,
      p95: () => percentile(stats.latencies, 0.95),
      emit: (type, payload) => bus.emit(type, payload),
      press: (code, extra = {}) => bus.emit('key', { code, at: Date.now(), rep: false, mods: [], ...extra }),
      setMind: (m) => bus.emit('mind', m),
      setAuto: (on) => { if (sim) sim.setAuto(on); },
      simulateStall: (ms) => { lastTs -= ms; },
      report: () => metrics.summary(Date.now()),
      perf: perfSummary,
      posTrace: () => {
        const n = Math.min(trace.n, PERF_N);
        if (trace.n <= PERF_N) return Array.from(trace.v.subarray(0, n));
        const s = trace.n % PERF_N;
        return [...trace.v.subarray(s), ...trace.v.subarray(0, s)];
      },
      ribbonCenterline: () => {
        const out = [];
        for (let a = 0; a < rb.count; a++) out.push(rb.c[(((rb.head - a) % rb.n) + rb.n) % rb.n]);
        return out;
      },
      exportPng: async (kind) => {
        const blob = await exportKind(kind);
        const sig = Array.from(new Uint8Array(await blob.arrayBuffer()).subarray(0, 8));
        const bmp = await createImageBitmap(blob);
        return { size: blob.size, type: blob.type, signature: sig, width: bmp.width, height: bmp.height };
      },
      state: () => {
        const now = Date.now();
        const s = metrics.snapshot(now);
        let sw = 0;
        for (let i = 0; i < sweeps.length; i++) if (now - sweeps[i] >= 0 && now - sweeps[i] <= CONFIG.enter.ms) sw++;
        return {
          layout: g.layout, W: g.W, H: g.H, k: g.k, center: g.center, spawnC: g.spawnC,
          pos: s.pos, rawPos: s.rawPos, wpm: s.wpm, density: s.density, idle: s.idle, noSignal: s.noSignal,
          paused: live.paused, secure: live.secure, word: word.word,
          ground: grade.ground.map(Math.round), ink: grade.ink.map(Math.round),
          beadsActive: beads.activeCount, beadKinds: kindCounts(), sweeps: sw,
          brain: brain ? { ...brainStats(brain), ...brainRect(g) } : null,
          reportVisible: report.visible, lastDt, maxDt: maxDtSeen, maxRawGap, hello: stats.hello,
        };
      },
    };
  }
}
