import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, isModifier, hasShortcutMod, counts } from '../../src/core/keys.js';

test('classify', () => {
  const cases = {
    KeyA: 'char', Digit5: 'char', Minus: 'char', Space: 'char', Numpad7: 'char', Comma: 'char',
    Backspace: 'backspace', Enter: 'enter', NumpadEnter: 'enter',
    Tab: 'other', Escape: 'other', ShiftLeft: 'other', MetaRight: 'other', ArrowUp: 'other', F5: 'other', Vk0C: 'other', Delete: 'other',
  };
  for (const [code, cls] of Object.entries(cases)) assert.equal(classify(code), cls, code);
});

test('isModifier hanya untuk modifier', () => {
  for (const c of ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'AltRight', 'MetaLeft', 'CapsLock', 'Fn']) assert.equal(isModifier(c), true, c);
  for (const c of ['KeyA', 'Space', 'Enter', 'ArrowLeft']) assert.equal(isModifier(c), false, c);
});

test('counts: auto-repeat dan shortcut ctrl/cmd tidak dihitung, shift/alt dihitung', () => {
  assert.equal(counts({ rep: false, mods: [] }), true);
  assert.equal(counts({ rep: true, mods: [] }), false);
  assert.equal(counts({ rep: false, mods: ['cmd'] }), false);
  assert.equal(counts({ rep: false, mods: ['ctrl', 'shift'] }), false);
  assert.equal(counts({ rep: false, mods: ['shift'] }), true);
  assert.equal(counts({ rep: false, mods: ['alt'] }), true);
  assert.equal(counts({ rep: false }), true);
  assert.equal(hasShortcutMod(undefined), false);
});
