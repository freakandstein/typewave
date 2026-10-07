import test from 'node:test';
import assert from 'node:assert/strict';
import { createHud } from '../../src/render/hud.js';
import { CONFIG } from '../../src/config.js';

function fakeDoc() {
  const mk = () => {
    const e = {
      children: [], classes: new Set(), textContent: '', className: '', id: '',
      style: { props: {}, fontVariationSettings: '', setProperty(k, v) { this.props[k] = v; } },
      classList: {
        add: (...c) => c.forEach((x) => e.classes.add(x)),
        remove: (...c) => c.forEach((x) => e.classes.delete(x)),
        toggle: (c, on) => { if (on) e.classes.add(c); else e.classes.delete(c); },
      },
      appendChild(c) { e.children.push(c); return c; },
      append(...cs) { e.children.push(...cs); },
    };
    return e;
  };
  return { createElement: mk, mk };
}

const base = { word: 'flow', pos: 0.5, wpm: 74.4, wpmOn: true, hr: 68.2, noSignal: false, paused: false, lang: 'en' };

function setup() {
  const doc = fakeDoc();
  const root = doc.mk();
  const hud = createHud(root, doc);
  return { hud, root };
}

test('teks HUD: state word, NN wpm, HR; label id; tidak ada timer sesi', () => {
  const { hud } = setup();
  hud.update(base);
  assert.equal(hud.el.state.textContent, 'flow');
  assert.equal(hud.el.wpm.textContent, '74 wpm');
  assert.equal(hud.el.hr.textContent, '68 bpm');
  assert.equal(hud.el.timer, undefined, 'timer sesi tidak ada di HUD (permintaan user)');
  hud.update({ ...base, word: 'tense', lang: 'id', noSignal: true, paused: true });
  assert.equal(hud.el.state.textContent, 'tegang');
  assert.equal(hud.el.status.textContent, 'tanpa sinyal  jeda');
  hud.update({ ...base, word: '' });
  assert.equal(hud.el.state.textContent, '');
});

test('HR disembunyikan bila tidak ada; WPM mengikuti wpmOn lewat class', () => {
  const { hud } = setup();
  hud.update({ ...base, hr: null, wpmOn: false });
  assert.equal(hud.el.hr.textContent, '');
  assert.equal(hud.el.wpm.classes.has('on'), false);
  hud.update({ ...base, wpmOn: true });
  assert.equal(hud.el.wpm.classes.has('on'), true);
});

test('sumbu huruf HUD konstan (tidak membesar dan mengecil): diatur sekali dari CONFIG, tidak mengikuti pos, tanpa penimpaan per elemen', () => {
  const { hud, root } = setup();
  const want = `"wdth" ${CONFIG.type.hudWdth}, "wght" ${CONFIG.type.hudWght}`;
  assert.equal(root.style.fontVariationSettings, want, 'diatur saat HUD dibuat, supaya semua teks mewarisinya');
  for (const pos of [0, 0.2, 0.5, 0.8, 1]) hud.update({ ...base, pos });
  assert.equal(root.style.fontVariationSettings, want, 'pos tidak mengubahnya');
  for (const k of ['state', 'wpm', 'small', 'status']) assert.equal(hud.el[k].style.fontVariationSettings, '', `${k}: tidak ada sumbu sendiri yang menimpa`);
});

test('setLayout memasang class layout dan skala --k; debugText hanya bila diberikan', () => {
  const { hud, root } = setup();
  hud.setLayout('tall', 0.5);
  assert.equal(root.classes.has('layout-tall'), true);
  assert.equal(root.classes.has('layout-wide'), false);
  assert.equal(root.style.props['--k'], '0.5');
  hud.setLayout('wide', 1);
  assert.equal(root.classes.has('layout-tall'), false);
  hud.update({ ...base, debugText: 'fps 60' });
  assert.equal(hud.el.debug.textContent, 'fps 60');
  hud.update(base);
  assert.equal(hud.el.debug.textContent, 'fps 60');
});

test('titik sensor: empat titik berurutan TP9, AF7, AF8, TP10 mengikuti level; tampil hanya bila ada kontak; warna terakhir bertahan saat memudar', () => {
  const { hud } = setup();
  assert.equal(hud.el.contact.children.length, 4);
  hud.update({ ...base, contact: null });
  assert.equal(hud.el.contact.classes.has('on'), false);
  hud.update({ ...base, contact: ['good', 'fair', 'poor', 'good'] });
  assert.equal(hud.el.contact.classes.has('on'), true);
  assert.deepEqual(hud.el.contact.children.map((d) => d.className), ['dot tp9 good', 'dot af7 fair', 'dot af8 poor', 'dot tp10 good']);
  hud.update({ ...base, contact: ['good', 'good', 'good', 'good'] });
  assert.deepEqual(hud.el.contact.children.map((d) => d.className), ['dot tp9 good', 'dot af7 good', 'dot af8 good', 'dot tp10 good']);
  hud.update({ ...base, contact: null });
  assert.equal(hud.el.contact.classes.has('on'), false);
  assert.deepEqual(hud.el.contact.children.map((d) => d.className), ['dot tp9 good', 'dot af7 good', 'dot af8 good', 'dot tp10 good'], 'memudar dengan warna terakhir, tidak berganti');
});

test('blok kanan atas satu baris pendek: titik sensor, ikon hati, lalu HR (tanpa timer)', () => {
  const { hud } = setup();
  assert.deepEqual(hud.el.small.children.map((c) => c.id), ['hud-contact', 'hud-heart', 'hud-hr']);
  assert.equal(hud.el.small.children[0], hud.el.contact);
  assert.equal(hud.el.small.children[1], hud.el.heart);
  assert.equal(hud.el.small.children[2], hud.el.hr);
});

test('ikon hati menemani detak jantung: tampil hanya saat HR ada, berupa SVG statis tanpa animasi', () => {
  const { hud } = setup();
  assert.match(hud.el.heart.innerHTML, /^<svg [^>]*viewBox="0 0 24 24"/);
  assert.doesNotMatch(hud.el.heart.innerHTML, /<animate|<set|animateTransform|@keyframes|style=|class=/i, 'ikon diam: tidak berdenyut mengikuti detak jantung');
  hud.update({ ...base, hr: null });
  assert.equal(hud.el.heart.classes.has('on'), false);
  hud.update({ ...base, hr: 71 });
  assert.equal(hud.el.heart.classes.has('on'), true);
  hud.update({ ...base, hr: 72.4 });
  assert.equal(hud.el.heart.classes.has('on'), true);
  hud.update({ ...base, hr: undefined });
  assert.equal(hud.el.heart.classes.has('on'), false);
});

test('status HUD mengikuti status headset dan digabung dengan jeda; tanpa status headset tetap seperti dulu', () => {
  const { hud } = setup();
  hud.update({ ...base, lang: 'id', noSignal: true, paused: true, headset: { state: 'reconnecting', attempt: 2, contact: null } });
  assert.equal(hud.el.status.textContent, 'menyambung ulang, percobaan 2  jeda');
  hud.update({ ...base, lang: 'en', noSignal: true, headset: { state: 'connected', attempt: 0, contact: ['poor', 'poor', 'poor', 'poor'] } });
  assert.equal(hud.el.status.textContent, 'check the sensors');
  hud.update({ ...base, lang: 'en', noSignal: false, headset: { state: 'connected', attempt: 0, contact: ['good', 'good', 'good', 'good'] } });
  assert.equal(hud.el.status.textContent, '');
  hud.update({ ...base, lang: 'en', noSignal: true });
  assert.equal(hud.el.status.textContent, 'no signal');
});
