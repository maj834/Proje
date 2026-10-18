'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { tmpDir } = require('./helpers/util.js');
const S = require('../sistem-main.js');

const stats = (o = {}) => ({ type: 'stats', t: 1, cpu: { usage: 23.4, cores: [10, 90], temp: 61.6, tempMax: 72 }, gpu: { usage: 5, temp: 50 },
  mem: { used: 8e9, total: 16e9, pressure: 'normal', swap: 0 }, fps: { display: 120, screen: 59.6 }, fans: [1800, 2100],
  battery: { pct: 80, charging: true, temp: 31.2, cycles: 120, watts: 12.5 }, net: { down: 1234567, up: 1000 },
  disk: { read: 0, write: 5e6, free: 1e11 }, power: 14.2, thermal: 'nominal', ...o });

test('sanitize: bilinen alanlar, sinir disi ve bozuk degerler null', () => {
  const s = S.sanitize(stats({ cpu: { usage: 150, temp: 400, cores: [5, 'x', -1], tempMax: null }, thermal: 'yanlis', fans: [1000, 99999, 'a'],
    battery: null, mem: { used: 1, total: 0 }, extra: '<script>' }));
  assert.equal(s.cpu.usage, null); assert.equal(s.cpu.temp, null); assert.deepEqual(s.cpu.cores, [5, null, null]);
  assert.equal(s.thermal, null); assert.deepEqual(s.fans, [1000]); assert.equal(s.battery, null); assert.equal(s.mem.total, null);
  assert.equal(s.extra, undefined);
  assert.equal(S.sanitize({ type: 'hello' }), null); assert.equal(S.sanitize(null), null);
  const ok = S.sanitize(stats());
  assert.equal(ok.cpu.temp, 61.6); assert.equal(ok.fps.screen, 59.6); assert.equal(ok.battery.watts, 12.5);
});

test('barTitle ve rate: menu cubugu yazisi Turkce bicimde, olmayan deger atlanir', () => {
  const s = S.sanitize(stats());
  assert.equal(S.barTitle(s, ['temp', 'cpu']), '62°  CPU 23%');
  assert.equal(S.barTitle(s, ['fps', 'ram', 'net', 'fan', 'gpu']), '60 fps  RAM 50%  ↓1,2 MB/s  2100 rpm  GPU 5%');
  const yok = S.sanitize(stats({ cpu: { usage: 10, cores: [], temp: null }, fans: [] }));
  assert.equal(S.barTitle(yok, ['temp', 'fan', 'cpu']), 'CPU 10%');
  assert.equal(S.barTitle(null, ['temp']), '');
  assert.equal(S.rate(999), '999 B/s'); assert.equal(S.rate(1500), '1,5 KB/s'); assert.equal(S.rate(25e6), '25 MB/s');
});

test('clean: menu cubugu en fazla 4 bilinen deger, esik sinirli', () => {
  assert.deepEqual(S.clean({ bar: ['temp', 'yok', 'cpu', 'gpu', 'ram', 'fps'], hot: 500 }), { bar: ['temp', 'cpu', 'gpu', 'ram'], hot: 110 });
  assert.deepEqual(S.clean({ bar: 'x', hot: 'a' }), { bar: ['temp', 'cpu'], hot: 95 });
});

// Sahte yardimci + sahte Electron: tus, panel, olcum hizi, gonderen kontrolu ve kapatma
test('registerSystem: menu cubugu yazisi, panel acilinca 1 sn + FPS, kapaninca 2 sn, modul kapatilinca durur', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const log = path.join(d, 'cmd.log'), bin = path.join(d, 'yardimci.js');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs=require('fs');process.stdout.write(JSON.stringify({type:'hello',version:1,arch:'arm64',chip:'Apple M2',model:'Mac14,2',cores:8,memTotal:16e9})+'\\n');
require('readline').createInterface({input:process.stdin}).on('line',l=>{fs.appendFileSync(${JSON.stringify(log)},l+'\\n');const m=JSON.parse(l);
  if(m.cmd==='once')process.stdout.write(JSON.stringify(${JSON.stringify(stats())})+'\\n');if(m.cmd==='quit')process.exit(0)}).on('close',()=>process.exit(0));`);
  fs.chmodSync(bin, 0o755);
  process.env.CEM_SISTEM_BIN = bin; t.after(() => { delete process.env.CEM_SISTEM_BIN; });
  const handlers = {}, titles = [], sent = [], notes = [];
  let visible = false, onReady, quit, trayClick, destroyed = false, on = true, conf = {};
  const wc = { send: (ch, m) => sent.push([ch, m]), setWindowOpenHandler() {}, on() {}, isDevToolsOpened: () => false };
  const winEv = {};
  function Win() { return { webContents: wc, loadFile() {}, isDestroyed: () => false, isVisible: () => visible, getSize: () => [340, 520],
    setPosition() {}, show() { visible = true; winEv.show && winEv.show(); }, hide() { visible = false; winEv.hide && winEv.hide(); }, focus() {},
    close() { visible = false; }, on(e, f) { winEv[e] = f; } }; }
  function Tray() { return { setToolTip() {}, setTitle: x => titles.push(x), on: (e, f) => { if (e === 'click') trayClick = f; },
    getBounds: () => ({ x: 500, y: 0, width: 40, height: 24 }), destroy() { destroyed = true; } }; }
  const ui = S.registerSystem({ ipcMain: { handle: (c, f) => { handlers[c] = f; } }, app: { isPackaged: false, whenReady: () => ({ then: f => { onReady = f; } }), on: (e, f) => { quit = f; } },
    BrowserWindow: Win, Tray, nativeImage: { createEmpty: () => ({}) }, screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    path, Notification: Object.assign(function (o) { return { show() { notes.push(o); } }; }, { isSupported: () => true }),
    cfg: () => ({ system: conf }), save: o => { conf = o.system; }, isOn: () => on });
  const wait = async (f, ms = 15000) => { const e = Date.now() + ms; while (!f()) { if (Date.now() > e) throw new Error('zaman asimi'); await new Promise(r => setTimeout(r, 20)); } };
  const cmds = () => { if (!fs.existsSync(log)) return []; const s = fs.readFileSync(log, 'utf8'); return s.slice(0, s.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse); }; // yalnizca tamamlanmis satirlar (yardimci yazarken okunabilir)
  onReady();
  await wait(() => titles.includes('62°  CPU 23%'));
  assert.deepEqual(cmds().slice(0, 3), [{ cmd: 'interval', ms: 2000 }, { cmd: 'fps', on: false }, { cmd: 'once' }]);
  // tusa basinca panel acilir: hizli olcum + FPS
  trayClick(); assert.equal(visible, true);
  await wait(() => cmds().some(c => c.cmd === 'fps' && c.on));
  assert.ok(cmds().some(c => c.cmd === 'interval' && c.ms === 1000));
  // baska pencereden gelen istek reddedilir; panelden gelen kabul edilir
  assert.equal(await handlers['sys:state']({ sender: {} }), null);
  const st = await handlers['sys:state']({ sender: wc });
  assert.equal(st.hello.chip, 'Apple M2'); assert.equal(st.last.cpu.temp, 61.6);
  assert.equal(await handlers['sys:set']({ sender: {} }, { bar: ['fps'] }), null);
  const r = await handlers['sys:set']({ sender: wc }, { bar: ['fps', 'temp'] });
  assert.deepEqual(r.conf.bar, ['fps', 'temp']); assert.equal(titles.at(-1), '60 fps  62°');
  // panel kapaninca yavas olcum; FPS menu cubugunda secili oldugu icin acik kalir
  trayClick(); assert.equal(visible, false);
  await wait(() => { const c = cmds(); return c.at(-2).ms === 2000 && c.at(-1).cmd === 'fps'; });
  assert.equal(cmds().at(-1).on, true);
  // modul kapatilinca menu cubugu tusu kalkar, yardimci kapanir
  on = false; ui.disable(); assert.equal(destroyed, true);
  await wait(() => cmds().some(c => c.cmd === 'quit'));
  quit();
});

test('isinma bildirimi: esik ya da macOS sicak durumu, 10 dakikada bir', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const bin = path.join(d, 'y.js');
  fs.writeFileSync(bin, `#!${process.execPath}
for(const s of [${JSON.stringify(stats({ cpu: { usage: 90, cores: [], temp: 97, tempMax: 99 } }))},${JSON.stringify(stats({ thermal: 'critical' }))}])process.stdout.write(JSON.stringify(s)+'\\n');
process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`);
  fs.chmodSync(bin, 0o755);
  process.env.CEM_SISTEM_BIN = bin; t.after(() => { delete process.env.CEM_SISTEM_BIN; });
  const notes = []; let onReady, ui;
  ui = S.registerSystem({ ipcMain: { handle() {} }, app: { isPackaged: false, whenReady: () => ({ then: f => { onReady = f; } }), on() {} },
    BrowserWindow: function () {}, Tray: function () { return { setToolTip() {}, setTitle() {}, on() {}, destroy() {} }; }, nativeImage: { createEmpty: () => ({}) },
    screen: {}, path, Notification: Object.assign(function (o) { return { show() { notes.push(o); } }; }, { isSupported: () => true }),
    cfg: () => ({}), save() {}, isOn: () => true });
  onReady();
  const e = Date.now() + 3000; while (!notes.length && Date.now() < e) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 200));
  assert.equal(notes.length, 1); assert.match(notes[0].body, /99°C/);
  ui.disable();
});

// Sahte Electron (tus + panel) ile registerSystem; bin: sahte yardimci betigi
function sysHarness(t, script, conf = {}) {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const bin = path.join(d, 'y.js');
  fs.writeFileSync(bin, `#!${process.execPath}\n${script}`); fs.chmodSync(bin, 0o755);
  process.env.CEM_SISTEM_BIN = bin; t.after(() => { delete process.env.CEM_SISTEM_BIN; });
  let visible = false, onReady, trayClick; const winEv = {}, sent = [];
  const wc = { send: (ch, m) => sent.push([ch, m]), setWindowOpenHandler() {}, on() {}, isDevToolsOpened: () => false };
  function Win() { return { webContents: wc, loadFile() {}, isDestroyed: () => false, isVisible: () => visible, getSize: () => [340, 520],
    setPosition() {}, show() { visible = true; winEv.show && winEv.show(); }, hide() { visible = false; winEv.hide && winEv.hide(); }, focus() {},
    close() { visible = false; }, on(e, f) { winEv[e] = f; } }; }
  function Tray() { return { setToolTip() {}, setTitle() {}, on: (e, f) => { if (e === 'click') trayClick = f; },
    getBounds: () => ({ x: 500, y: 0, width: 40, height: 24 }), destroy() {} }; }
  const ui = S.registerSystem({ ipcMain: { handle() {} }, app: { isPackaged: false, whenReady: () => ({ then: f => { onReady = f; } }), on() {} },
    BrowserWindow: Win, Tray, nativeImage: { createEmpty: () => ({}) }, screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    path, Notification: null, cfg: () => ({ system: conf }), save() {}, isOn: () => true });
  t.after(() => ui.disable());
  onReady();
  const wait = async (f, ms = 15000) => { const e = Date.now() + ms; while (!f()) { if (Date.now() > e) throw new Error('zaman asimi'); await new Promise(r => setTimeout(r, 20)); } };
  return { ui, click: () => trayClick(), wait, sent };
}

test('ekran kaydi izni hatasi panel her acildiginda yeniden gorunur (M1)', async (t) => {
  // sistem.swift gibi: hatalar tekillestirilir, ama FPS acilinca izin hatasinin tekillestirmesi sifirlanir
  const { ui, click, wait } = sysHarness(t, `
const w = o => process.stdout.write(JSON.stringify(o) + '\\n'), reported = new Set(), NP = 'Ekran kaydı izni yok';
const report = m => { if (!reported.has(m)) { reported.add(m); w({ type: 'error', msg: m }) } };
let on = false; w({ type: 'hello', chip: 'M1', cores: 8 });
require('readline').createInterface({ input: process.stdin }).on('line', l => { const m = JSON.parse(l);
  if (m.cmd === 'fps' && !!m.on !== on) { on = !!m.on; if (on) { reported.delete(NP); report(NP) } }
  if (m.cmd === 'once') w(${JSON.stringify(stats({ fps: { display: 60, screen: null } }))});
  if (m.cmd === 'quit') process.exit(0) }).on('close', () => process.exit(0));`);
  click();
  await wait(() => ui.view().error === 'Ekran kaydı izni yok');
  click();                                                  // panel kapandi: FPS kapali, hata silinir
  await wait(() => ui.view().error === null);
  click();                                                  // yeniden acildi: hata yeniden bildirilir
  await wait(() => ui.view().error === 'Ekran kaydı izni yok');
});

test('sistem.html: olcum kalmayinca (last=null) kutular "—" olur, eski degerler kalmaz (L3)', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'sistem.html'), 'utf8');
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const els = {};
  const mk = () => ({ style: {}, textContent: '', innerHTML: '', className: '', children: [], setAttribute() {},
    replaceChildren(...c) { this.children = c; }, append(...c) { this.children.push(...c); } });
  const document = { getElementById: id => (els[id] = els[id] || mk()), createElement: mk, addEventListener() {} };
  let push; const last = S.sanitize(stats());
  const state = { supported: true, hello: { chip: 'Apple M2', cores: 8 }, last, hist: [last, last], error: null, conf: { bar: ['temp'] }, bars: [{ id: 'temp', name: 'Sıcaklık' }] };
  const sys = { on: f => { push = f; }, state: () => Promise.resolve(state), set: async () => null, hide() {} };
  vm.runInNewContext(code, { document, sys, Math, Promise });
  await new Promise(r => setImmediate(r));
  assert.equal(els.temp.textContent, '62°C');
  assert.match(els.down.textContent, /MB\/s/); assert.ok(els.cores.children.length > 0); assert.ok(els.fans.children.length > 0);
  push({ last: null, hello: null, hist: [], error: 'Sistem yardımcısı yeniden başlatılıyor…' });
  for (const id of ['temp', 'cpu', 'fps', 'gpu', 'mem', 'press', 'swap', 'power', 'bat', 'btemp', 'bwatt', 'cyc', 'down', 'up', 'dr', 'dw', 'free'])
    assert.equal(els[id].textContent, '—', id);
  for (const id of ['temps', 'cpus', 'fpss', 'gpus']) assert.equal(els[id].textContent, '', id);
  assert.equal(els.cores.children.length, 0); assert.equal(els.fans.children.length, 0); assert.equal(els.memb.style.width, '0%');
  assert.equal(els.th.style.display, 'none');
  assert.equal(els.err.textContent, 'Sistem yardımcısı yeniden başlatılıyor…');
});
