'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
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
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) });
  api.start();                                              // ses:state yalnizca Ses penceresinden kabul edilir
  let v; for (let i = 0; i < 100 && !(v = api.view()).apps.length; i++) await new Promise(r => setTimeout(r, 30));
  assert.equal(v.supported, true);
  const music = v.apps.find(a => a.bundle === 'com.apple.Music'), chrome = v.apps.find(a => a.bundle === 'com.google.Chrome');
  assert.equal(music.device, 'AirPods');
  assert.equal(chrome.device, undefined);
  assert.equal(music.gain, 1);                              // ayar alanlari device ile birlikte korunur
});

// Sahte yardimci + sahte Ses penceresi: { api, handlers, wc, saved, cmds, wait }
function harness(t, script, conf = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-test-'));
  const bin = path.join(dir, 'ses-yardimcisi'), log = path.join(dir, 'cmd.log');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs'), w = o => process.stdout.write(JSON.stringify(o) + '\\n');
${script}
require('readline').createInterface({ input: process.stdin }).on('line', l => { try { fs.appendFileSync(${JSON.stringify(log)}, l + '\\n') } catch (e) {}
  const m = JSON.parse(l); if (typeof onCmd === 'function') onCmd(m); if (m.cmd === 'quit') process.exit(0) }).on('close', () => process.exit(0));
`, { mode: 0o755 });
  const old = process.env.GRAFIK_SES_BIN; process.env.GRAFIK_SES_BIN = bin;
  const handlers = {}, saved = [];
  const wc = { send() {}, setWindowOpenHandler() {}, on() {} };
  function Win() { return { webContents: wc, loadFile() {}, once() {}, on() {}, show() {}, focus() {}, isDestroyed: () => false }; }
  const app = { isPackaged: false, whenReady: () => new Promise(() => {}), on() {}, getFileIcon: async () => { throw new Error('yok') } };
  let c = { sound: conf };
  const api = registerAudio({ ipcMain: { handle: (n, f) => { handlers[n] = f } }, app, BrowserWindow: Win, path,
    cfg: () => c, save: o => { saved.push(o); c = { ...c, ...o } } });
  t.after(async () => { const started = api.view().supported !== null || fs.existsSync(log); api.stop(); if (old === undefined) delete process.env.GRAFIK_SES_BIN; else process.env.GRAFIK_SES_BIN = old;
    // Yuk altinda yardimci gec acilip 'quit'i islerken log'a yazabilir: silmeden once quit satirini (en fazla 10 sn) bekle
    for (let i = 0; started && i < 500 && !cmds().some(c => c.cmd === 'quit'); i++) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 50));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) });
  const cmds = () => { if (!fs.existsSync(log)) return []; const s = fs.readFileSync(log, 'utf8'); return s.slice(0, s.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse); }; // yalnizca tamamlanmis satirlar (yardimci yazarken okunabilir)
  const wait = async (f, ms = 15000) => { const e = Date.now() + ms; while (!f()) { if (Date.now() > e) throw new Error('zaman asimi'); await new Promise(r => setTimeout(r, 20)); } };
  return { api, handlers, wc, saved, cmds, wait };
}

test('izin reddi (tcc) hatasi ayni turda gelen "apps" satiriyla silinmez; o uygulamaya yeni ayar verilince kalkar (H2)', async (t) => {
  // Yardimci Engine.sync ile ayni sirada yazar: once tcc hatasi, sonra denied isaretli liste. "set" sonrasi denied kalkar.
  const { api, handlers, wc, wait } = harness(t, `
w({ type: 'hello', supported: true, os: '14.5' });
w({ type: 'apps', apps: [{ bundle: 'com.google.Chrome', name: 'Chrome', playing: true, active: true, denied: false }] });
setTimeout(() => { w({ type: 'error', code: 'tcc', msg: 'Uygulama sesine erişim izni yok.' });
  w({ type: 'apps', apps: [{ bundle: 'com.google.Chrome', name: 'Chrome', playing: true, active: false, denied: true }] });
  setTimeout(() => w({ type: 'apps', apps: [{ bundle: 'com.google.Chrome', name: 'Chrome', playing: false, active: false, denied: true }] }), 50) }, 100);
var onCmd = m => { if (m.cmd === 'set' && m.bundle === 'com.google.Chrome') w({ type: 'apps', apps: [{ bundle: 'com.google.Chrome', name: 'Chrome', playing: true, active: true, denied: false }] }) };
`, { apps: { 'com.google.Chrome': { gain: 0.3 } } });
  api.open();
  await wait(() => api.view().apps.some(a => !a.playing));   // ret + sonraki liste satirlari islendi
  let v = api.view();
  assert.equal(v.tccError, 'Uygulama sesine erişim izni yok.');
  assert.equal(v.error, null);                              // genel hata alanina karismaz
  assert.equal(v.apps[0].denied, true);
  // kullanici o uygulamanin ayarini degistirir: yardimci denied'i kaldirir, hata da kalkar
  v = await handlers['ses:app']({ sender: wc }, 'com.google.Chrome', { gain: 0.5 });
  assert.equal(v.tccError, null);
  await wait(() => api.view().apps[0].active);
  assert.equal(api.view().tccError, null);
});

test('ses:* IPC yalnizca Ses penceresinden kabul edilir (L1)', async (t) => {
  const { api, handlers, wc, saved, cmds, wait } = harness(t, `w({ type: 'hello', supported: true, os: '14.5' }); w({ type: 'apps', apps: [] });`);
  // pencere yokken / baska gonderenden: hicbiri ayar degistirmez, yardimciyi baslatmaz
  for (const e of [undefined, {}, { sender: {} }]) {
    assert.equal(await handlers['ses:state'](e), null);
    assert.equal(await handlers['ses:app'](e, 'com.x.y', { gain: 2 }), null);
    assert.equal(await handlers['ses:global'](e, { gain: 2 }), null);
    assert.equal(await handlers['ses:preset'](e, 'bas'), null);
    assert.equal(await handlers['ses:reset'](e), null);
    await handlers['ses:volume'](e, 1); await handlers['ses:mute'](e, true); await handlers['ses:device'](e, 'uid');
  }
  assert.equal(saved.length, 0);
  assert.equal(api.view().supported, null);                 // yardimci baslatilmadi
  api.open();
  await wait(() => api.view().supported === true);
  const v = await handlers['ses:state']({ sender: {} });
  assert.equal(v, null);
  assert.equal((await handlers['ses:state']({ sender: wc })).supported, true);
  const r = await handlers['ses:app']({ sender: wc }, 'com.x.y', { gain: 1.5 });
  assert.equal(r.global.gain, 1); assert.equal(saved.at(-1).sound.apps['com.x.y'].gain, 1.5);
  await handlers['ses:volume']({ sender: {} }, 0.1);
  await handlers['ses:volume']({ sender: wc }, 0.7);
  await wait(() => cmds().some(c => c.cmd === 'masterVolume'));
  assert.deepEqual(cmds().filter(c => c.cmd === 'masterVolume'), [{ cmd: 'masterVolume', value: 0.7 }]);
});

test('ses.html: izin hatasi (tccError) genel hata olmasa da gorunur (H2)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ses.html'), 'utf8');
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const els = {};
  const mk = () => ({ style: {}, textContent: '', innerHTML: '', value: '', classList: { toggle() {}, add() {}, remove() {} }, replaceChildren() {}, append() {} });
  const document = { getElementById: id => (els[id] = els[id] || mk()), createElement: mk };
  let push;
  const base = { supported: true, error: null, tccError: null, apps: [], devices: [], presets: ['kapali'], preset: 'kapali', global: { gain: 1, bass: 0, treble: 0 } };
  const ses = { on: f => { push = f }, state: () => ({ then() {} }) };
  vm.runInNewContext(code, { document, ses, setTimeout, Object, Math });
  push({ ...base, tccError: 'Uygulama sesine erişim izni yok.' });
  assert.equal(els.err.style.display, 'block'); assert.equal(els.err.textContent, 'Uygulama sesine erişim izni yok.');
  push({ ...base, error: 'Ses yardımcısı durdu (1).', tccError: 'İzin yok.' });
  assert.equal(els.err.textContent, 'Ses yardımcısı durdu (1). İzin yok.');
  push(base);
  assert.equal(els.err.style.display, 'none'); assert.equal(els.err.textContent, '');
});
