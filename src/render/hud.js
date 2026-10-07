// HUD sebagai elemen DOM di atas kanvas (spec 3.2 dan 6.3): teks memakai font variabel lewat font-variation-settings, yang tidak ada di Canvas 2D.
import { CONFIG } from '../config.js';
import { labelFor, headsetText } from '../core/text.js';

// Ikon hati untuk detak jantung: SVG statis (tidak berdenyut), berwarna lewat CSS (currentColor).
const HEART_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.6C6.6 16.4 3 13.2 3 9.1 3 6.3 5.1 4.2 7.7 4.2c1.8 0 3.4.9 4.3 2.4.9-1.5 2.5-2.4 4.3-2.4C18.9 4.2 21 6.3 21 9.1c0 4.1-3.6 7.3-9 11.5z"/></svg>';

export function createHud(root, doc = document) {
  root.textContent = '';
  root.style.fontVariationSettings = `"wdth" ${CONFIG.type.hudWdth}, "wght" ${CONFIG.type.hudWght}`; // tetap: semua teks HUD mewarisinya
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
  const heart = doc.createElement('i');
  heart.id = 'hud-heart';
  heart.className = 'hud-heart';
  heart.innerHTML = HEART_SVG;
  // Baris HR di bawah wpm: ikon hati lalu HR. Titik sensor Muse ada di otak 3D (render/brain.js). Tanpa timer sesi (permintaan user: tidak perlu, dan angkanya yang berganti tiap detik terasa bergoyang).
  Object.assign(el, { hr, heart });
  el.small.append(heart, hr);

  const last = { state: null, wpm: null, hr: null, status: null, wpmOn: null, debug: null, heartOn: null };
  const set = (node, key, text) => { if (last[key] !== text) { last[key] = text; node.textContent = text; } };

  return {
    el,
    setLayout(layout, k) {
      root.classList.remove('layout-wide', 'layout-tall');
      root.classList.add('layout-' + layout);
      root.style.setProperty('--k', String(k));
    },
    update(v) {
      set(el.state, 'state', v.word ? labelFor(v.word, v.lang) : '');
      set(el.wpm, 'wpm', `${Math.round(v.wpm)} ${labelFor('wpm', v.lang)}`);
      if (v.wpmOn !== last.wpmOn) { last.wpmOn = v.wpmOn; el.wpm.classList.toggle('on', !!v.wpmOn); }
      const hasHr = v.hr !== null && v.hr !== undefined;
      set(hr, 'hr', hasHr ? `${Math.round(v.hr)} ${labelFor('bpm', v.lang)}` : '');
      if (hasHr !== last.heartOn) { last.heartOn = hasHr; heart.classList.toggle('on', hasHr); }
      const status = [headsetText(v.headset, v.noSignal, v.lang), v.paused ? labelFor('paused', v.lang) : ''].filter(Boolean).join('  ');
      set(el.status, 'status', status);
      if (v.debugText !== undefined && v.debugText !== null) set(el.debug, 'debug', v.debugText);
    },
  };
}
