// Panel simulator (?sim=1): slider pos/hr/q dan level gelombang theta/alpha/beta, auto-wander, "ketik otomatis", dan mematikan mind (uji noSignal).
import { clamp } from '../core/color.js';

const AUTO = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'KeyE', 'KeyR', 'KeyO', 'KeyI', 'Space'];

export const wanderPos = (tSec) => clamp(0.5 + 0.42 * Math.sin(tSec / 14) + 0.08 * Math.sin(tSec / 3.1));

export function nextAutoKey(rng) {
  const r = rng();
  if (r < 0.04) return 'Backspace';
  if (r < 0.06) return 'Enter';
  return AUTO[Math.floor(rng() * AUTO.length) % AUTO.length];
}

export const nextAutoDelay = (rng) => (rng() < 0.08 ? 400 + rng() * 800 : 70 + rng() * 140);

export function createSim({ bus, root, doc = document, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, rng = Math.random, mindMs = 200 }) {
  const st = { pos: 0.5, hr: 70, q: 1, theta: 0.5, alpha: 0.5, beta: 0.5, wander: false, mind: true, auto: false };
  const t0 = now();
  let mindTimer = null;
  let autoTimer = null;

  const field = (label, el) => { const l = doc.createElement('label'); l.append(label, el); root.appendChild(l); return el; };
  const input = (id, type, props) => { const el = doc.createElement('input'); el.id = id; el.type = type; Object.assign(el, props); return el; };

  const posEl = field('pos ', input('sim-pos', 'range', { min: '0', max: '1', step: '0.01', value: '0.5' }));
  const hrEl = field('hr ', input('sim-hr', 'range', { min: '40', max: '160', step: '1', value: '70' }));
  const qEl = field('q ', input('sim-q', 'range', { min: '0', max: '1', step: '0.05', value: '1' }));
  const bandEls = {};
  for (const k of ['theta', 'alpha', 'beta']) bandEls[k] = field(`${k} `, input(`sim-${k}`, 'range', { min: '0', max: '1', step: '0.05', value: '0.5' }));
  const wanderEl = field(' auto-wander', input('sim-wander', 'checkbox', { checked: false }));
  const mindEl = field(' kirim mind', input('sim-mind', 'checkbox', { checked: true }));
  const autoBtn = doc.createElement('button');
  autoBtn.id = 'sim-auto';
  autoBtn.textContent = 'ketik otomatis';
  root.appendChild(autoBtn);

  posEl.addEventListener('input', () => { st.pos = Number(posEl.value); st.wander = false; wanderEl.checked = false; });
  hrEl.addEventListener('input', () => { st.hr = Number(hrEl.value); });
  qEl.addEventListener('input', () => { st.q = Number(qEl.value); });
  for (const k of ['theta', 'alpha', 'beta']) bandEls[k].addEventListener('input', () => { st[k] = Number(bandEls[k].value); });
  wanderEl.addEventListener('change', () => { st.wander = !!wanderEl.checked; });
  mindEl.addEventListener('change', () => { st.mind = !!mindEl.checked; });

  function tickMind() {
    if (st.mind) {
      if (st.wander) { st.pos = wanderPos((now() - t0) / 1000); posEl.value = st.pos.toFixed(2); }
      bus.emit('mind', { pos: st.pos, hr: st.hr, q: st.q, theta: st.theta, alpha: st.alpha, beta: st.beta });
    }
    mindTimer = setTimer(tickMind, mindMs);
  }

  function autoStep() {
    bus.emit('key', { code: nextAutoKey(rng), at: now(), rep: false, mods: [] });
    autoTimer = setTimer(autoStep, nextAutoDelay(rng));
  }

  function setAuto(on) {
    if (on === st.auto) return;
    st.auto = on;
    autoBtn.textContent = on ? 'berhenti' : 'ketik otomatis';
    if (on) autoStep();
    else { clearTimer(autoTimer); autoTimer = null; }
  }

  autoBtn.addEventListener('click', () => setAuto(!st.auto));
  mindTimer = setTimer(tickMind, mindMs);

  return {
    state: st,
    setAuto,
    setMind(on) { st.mind = on; mindEl.checked = on; },
    stop() { clearTimer(mindTimer); clearTimer(autoTimer); },
  };
}
