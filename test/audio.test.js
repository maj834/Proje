'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PRESETS, clampS, neutral, cleanApps, registerAudio } = require('../audio-main.js');

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

test('cleanApps: cikis aygiti adi (device) gecer, beklenmeyen alanlar ve bozuk kayitlar atilir', () => {
  assert.deepEqual(cleanApps([
    { bundle: 'com.apple.Music', name: 'Müzik', playing: true, active: true, denied: false, path: '/Applications/Music.app', device: ' AirPods Pro ', x: 1 },
    { bundle: 'com.spotify.client', name: 'Spotify', playing: 0, device: '' },
    { bundle: 'a.b', device: 5 },
    { name: 'bundle yok' }, null, 'x',
  ]), [
    { bundle: 'com.apple.Music', name: 'Müzik', playing: true, active: true, denied: false, path: '/Applications/Music.app', device: 'AirPods Pro' },
    { bundle: 'com.spotify.client', name: 'Spotify', playing: false, active: false, denied: false },
    { bundle: 'a.b', name: 'a.b', playing: false, active: false, denied: false },
  ]);
  assert.deepEqual(cleanApps(undefined), []);
  assert.equal(cleanApps([{ bundle: 'a', device: 'x'.repeat(500) }])[0].device.length, 120);
});

test('registerAudio: yardimcinin "apps" satirindaki device alani pencere durumuna tasinir', async (t) => {
  // Sahte yardimci: hello + apps (device ile) yazar, stdin kapaninca cikar
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-test-'));
  const bin = path.join(dir, 'ses-yardimcisi');
  fs.writeFileSync(bin, `#!${process.execPath}
const w = o => process.stdout.write(JSON.stringify(o) + '\\n');
w({ type: 'hello', supported: true, os: 'test' });
w({ type: 'apps', apps: [{ bundle: 'com.apple.Music', name: 'Müzik', playing: true, active: true, denied: false, device: 'AirPods' },
  { bundle: 'com.google.Chrome', name: 'Chrome', playing: false, active: false, denied: false }] });
process.stdin.on('data', () => {}); process.stdin.on('end', () => process.exit(0));
`, { mode: 0o755 });
  const old = process.env.GRAFIK_SES_BIN; process.env.GRAFIK_SES_BIN = bin;
  const handlers = {}, quitters = [];
  const ipcMain = { handle: (n, f) => { handlers[n] = f } };
  const app = { isPackaged: false, whenReady: () => new Promise(() => {}), on: (e, f) => { if (e === 'will-quit') quitters.push(f) },
    getFileIcon: async () => { throw new Error('yok') } };
  const api = registerAudio({ ipcMain, app, BrowserWindow: function () {}, path, cfg: () => ({}), save: () => {} });
  t.after(() => { api.stop(); if (old === undefined) delete process.env.GRAFIK_SES_BIN; else process.env.GRAFIK_SES_BIN = old;
    fs.rmSync(dir, { recursive: true, force: true }) });
  handlers['ses:state']();
  let v; for (let i = 0; i < 100 && !(v = api.view()).apps.length; i++) await new Promise(r => setTimeout(r, 30));
  assert.equal(v.supported, true);
  const music = v.apps.find(a => a.bundle === 'com.apple.Music'), chrome = v.apps.find(a => a.bundle === 'com.google.Chrome');
  assert.equal(music.device, 'AirPods');
  assert.equal(chrome.device, undefined);
  assert.equal(music.gain, 1);                              // ayar alanlari device ile birlikte korunur
});
