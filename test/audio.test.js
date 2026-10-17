'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, clampS, neutral } = require('../audio-main.js');

test('clampS: sinirlar ve varsayilanlar', () => {
  assert.deepEqual(clampS({ gain: 5, bass: 40, treble: -40, mute: 1 }), { gain: 2, bass: 12, treble: -12, mute: true });
  assert.deepEqual(clampS({ gain: -1 }), { gain: 0, bass: 0, treble: 0, mute: false });
  assert.deepEqual(clampS({ gain: 'x', bass: null }), { gain: 0, bass: 0, treble: 0, mute: false });
});

test('neutral: yalnizca gercekten degisiklik yoksa', () => {
  assert.equal(neutral(clampS({ gain: 1 })), true);
  assert.equal(neutral(clampS({ gain: 1.5 })), false);
  assert.equal(neutral(clampS({ gain: 1, bass: 3 })), false);
  assert.equal(neutral(clampS({ gain: 1, mute: true })), false);
});

test('hazir efektler gecerli araliklarda; kapali notr', () => {
  for (const [k, p] of Object.entries(PRESETS)) assert.deepEqual(clampS(p), { ...p, mute: false }, k);
  assert.equal(neutral(clampS(PRESETS.kapali)), true);
  assert.ok(PRESETS.yukselt.gain > 1 && PRESETS.yukselt.gain <= 2);
});
