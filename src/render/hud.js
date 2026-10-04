// HUD sebagai elemen DOM di atas kanvas (spec 3.2 dan 6.3): Canvas 2D tidak bisa mengatur sumbu wdth secara kontinu.
import { typeAxes, labelFor, formatTimer } from '../core/text.js';

export function createHud(root, doc = document) {
  root.textContent = '';
  const mk = (cls, id) => { const d = doc.createElement('div'); d.className = cls; d.id = id; root.appendChild(d); return d; };
  const el = {
    state: mk('hud-state', 'hud-state'),
    wpm: mk('hud-wpm', 'hud-wpm'),
    small: mk('hud-small', 'hud-small'),
    status: mk('hud-status', 'hud-status'),
    debug: mk('hud-debug', 'hud-debug'),
  };
  const hr = doc.createElement('span');
  hr.id = 'hud-hr';
  const timer = doc.createElement('span');
  timer.id = 'hud-timer';
  el.small.append(hr, timer);

  const last = { wdth: -1, wght: -1, state: null, wpm: null, hr: null, timer: null, status: null, wpmOn: null, debug: null };
  const set = (node, key, text) => { if (last[key] !== text) { last[key] = text; node.textContent = text; } };

  return {
    el,
    setLayout(layout, k) {
      root.classList.remove('layout-wide', 'layout-tall');
      root.classList.add('layout-' + layout);
      root.style.setProperty('--k', String(k));
    },
    update(v) {
      const ax = typeAxes(v.pos);
      if (Math.abs(ax.wdth - last.wdth) >= 0.5 || Math.abs(ax.wght - last.wght) >= 0.5) {
        last.wdth = ax.wdth;
        last.wght = ax.wght;
        const fv = `"wdth" ${ax.wdth.toFixed(1)}, "wght" ${ax.wght.toFixed(1)}`;
        el.state.style.fontVariationSettings = fv;
        el.wpm.style.fontVariationSettings = fv;
        el.small.style.fontVariationSettings = fv;
        el.status.style.fontVariationSettings = fv;
      }
      set(el.state, 'state', v.word ? labelFor(v.word, v.lang) : '');
      set(el.wpm, 'wpm', `${Math.round(v.wpm)} ${labelFor('wpm', v.lang)}`);
      if (v.wpmOn !== last.wpmOn) { last.wpmOn = v.wpmOn; el.wpm.classList.toggle('on', !!v.wpmOn); }
      set(hr, 'hr', v.hr === null || v.hr === undefined ? '' : `${Math.round(v.hr)} ${labelFor('bpm', v.lang)}`);
      set(timer, 'timer', formatTimer(v.timerMs));
      const status = [v.noSignal ? labelFor('noSignal', v.lang) : '', v.paused ? labelFor('paused', v.lang) : ''].filter(Boolean).join('  ');
      set(el.status, 'status', status);
      if (v.debugText !== undefined && v.debugText !== null) set(el.debug, 'debug', v.debugText);
    },
  };
}
