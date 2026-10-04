// Teks: label en/id, sumbu font (spec 3.2), format timer dan durasi.
import { CONFIG } from '../config.js';
import { clamp, lerp } from './color.js';

export const LABELS = {
  en: { calm: 'calm', flow: 'flow', tense: 'tense', noSignal: 'no signal', paused: 'paused', wpm: 'wpm', bpm: 'bpm' },
  id: { calm: 'tenang', flow: 'mengalir', tense: 'tegang', noSignal: 'tanpa sinyal', paused: 'jeda', wpm: 'wpm', bpm: 'bpm' },
};

export const labelFor = (key, lang = 'en') => (LABELS[lang] || LABELS.en)[key];

export function typeAxes(pos) {
  const p = clamp(pos);
  return { wdth: lerp(CONFIG.type.wdth[0], CONFIG.type.wdth[1], p), wght: lerp(CONFIG.type.wght[0], CONFIG.type.wght[1], p) };
}

export function formatTimer(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDur(totalSec, lang = 'en') {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60), s = sec % 60;
  const u = lang === 'id' ? { m: 'menit', s: 'detik' } : { m: 'min', s: 's' };
  if (m && s) return `${m} ${u.m} ${s} ${u.s}`;
  if (m) return `${m} ${u.m}`;
  return `${s} ${u.s}`;
}
