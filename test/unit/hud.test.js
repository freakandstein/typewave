import test from 'node:test';
import assert from 'node:assert/strict';
import { createHud } from '../../src/render/hud.js';

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

const base = { word: 'flow', pos: 0.5, wpm: 74.4, wpmOn: true, hr: 68.2, timerMs: 860000, noSignal: false, paused: false, lang: 'en' };

function setup() {
  const doc = fakeDoc();
  const root = doc.mk();
  const hud = createHud(root, doc);
  return { hud, root };
}

test('teks HUD: state word, NN wpm, HR, timer; label id', () => {
  const { hud } = setup();
  hud.update(base);
  assert.equal(hud.el.state.textContent, 'flow');
  assert.equal(hud.el.wpm.textContent, '74 wpm');
  assert.equal(hud.el.small.children[0].textContent, '68 bpm');
  assert.equal(hud.el.small.children[1].textContent, '14:20');
  hud.update({ ...base, word: 'tense', lang: 'id', noSignal: true, paused: true });
  assert.equal(hud.el.state.textContent, 'tegang');
  assert.equal(hud.el.status.textContent, 'tanpa sinyal  jeda');
  hud.update({ ...base, word: '' });
  assert.equal(hud.el.state.textContent, '');
});

test('HR disembunyikan bila tidak ada; WPM mengikuti wpmOn lewat class', () => {
  const { hud } = setup();
  hud.update({ ...base, hr: null, wpmOn: false });
  assert.equal(hud.el.small.children[0].textContent, '');
  assert.equal(hud.el.wpm.classes.has('on'), false);
  hud.update({ ...base, wpmOn: true });
  assert.equal(hud.el.wpm.classes.has('on'), true);
});

test('sumbu font hanya diperbarui bila berubah >= 0.5 dan mengikuti pos', () => {
  const { hud } = setup();
  hud.update({ ...base, pos: 0 });
  assert.equal(hud.el.state.style.fontVariationSettings, '"wdth" 130.0, "wght" 300.0');
  hud.update({ ...base, pos: 0.0005 });
  assert.equal(hud.el.state.style.fontVariationSettings, '"wdth" 130.0, "wght" 300.0');
  hud.update({ ...base, pos: 1 });
  assert.equal(hud.el.state.style.fontVariationSettings, '"wdth" 70.0, "wght" 700.0');
  assert.equal(hud.el.wpm.style.fontVariationSettings, '"wdth" 70.0, "wght" 700.0');
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
