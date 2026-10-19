'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { EventEmitter } = require('events');
const { tmpDir } = require('./helpers/util');

// power.js tek ornek (singleton): her test kendi durumunu geri alir
const power = require('../power.js');
const reset = () => power._set({ battery: false, locked: false, asleep: false });

test('power: powerMonitor olaylari durumu gunceller, aboneler yalniz degisimde cagrilir', () => {
  reset();
  const pm = new EventEmitter(); pm.isOnBatteryPower = () => false;
  power.init(pm);
  const seen = []; const off = power.on(s => seen.push({ ...s }));
  pm.emit('on-battery'); pm.emit('on-battery'); pm.emit('lock-screen');
  assert.equal(power.state().battery, true); assert.equal(power.away(), true);
  pm.emit('unlock-screen'); pm.emit('suspend'); assert.equal(power.away(), true);
  pm.emit('resume'); pm.emit('on-ac');
  assert.equal(power.away(), false); assert.equal(power.state().battery, false);
  assert.equal(seen.length, 6, 'ayni olay tekrar bildirilmez');
  off(); pm.emit('on-battery'); assert.equal(seen.length, 6, 'abonelik birakildi');
  reset();
});

test('Neo: ekran kilitlenince mikrofon kapanir, acilinca geri gelir; pilde dinleme ayari', async (t) => {
  reset();
  const { registerNeo } = require('../neo-main.js');
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const log = path.join(d, 'cmd.log'), bin = path.join(d, 'neo.js');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs=require('fs'),o=x=>process.stdout.write(JSON.stringify(x)+'\\n');
o({type:'hello',version:1,wakeOnDevice:true,cmdOnDevice:false,locale:'tr-TR',voices:[]});
require('readline').createInterface({input:process.stdin}).on('line',l=>{fs.appendFileSync(${JSON.stringify(log)},l+'\\n');const m=JSON.parse(l);
  if(m.cmd==='quit')process.exit(0)}).on('close',()=>process.exit(0));`);
  fs.chmodSync(bin, 0o755);
  process.env.CEM_NEO_BIN = bin; t.after(() => { delete process.env.CEM_NEO_BIN; reset(); });
  const handlers = {}; let onReady, conf = {};
  const wc = { send() {}, setWindowOpenHandler() {}, on() {} };
  function Win() { return { webContents: wc, loadFile() {}, isDestroyed: () => false, isVisible: () => false, getSize: () => [420, 150], setPosition() {},
    showInactive() {}, show() {}, focus() {}, hide() {}, close() {}, on() {}, once() {}, setAlwaysOnTop() {}, setVisibleOnAllWorkspaces() {} }; }
  const ui = registerNeo({ ipcMain: { handle: (c, f) => { handlers[c] = f; } }, app: { isPackaged: false, whenReady: () => ({ then: f => { onReady = f; } }), on() {} },
    BrowserWindow: Win, path, screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 100, height: 100 } }) },
    globalShortcut: { register: () => true, unregister() {} }, Notification: function () { return { show() {} }; },
    cfg: () => ({ neo: conf }), save: o => { conf = o.neo; }, keys: { get: () => 'k', set() {} }, shell: {}, actions: {}, isOn: () => true,
    brain: { ask: async () => ({ text: 'x' }), reset() {} } });
  t.after(() => ui.disable());                                           // hata olsa da yardimci kapansin
  const wait = async (f, ms = 15000) => { const e = Date.now() + ms; while (!f()) { if (Date.now() > e) throw new Error('zaman asimi: ' + JSON.stringify(cmds()) + ' ' + (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(0, 400) : 'log yok')); await new Promise(r => setTimeout(r, 15)); } };
  const cmds = () => { if (!fs.existsSync(log)) return []; const s = fs.readFileSync(log, 'utf8'); return s.slice(0, s.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse).filter(c => c.cmd === 'start' || c.cmd === 'stop').map(c => c.cmd); };
  onReady();
  await wait(() => cmds().length === 1); assert.deepEqual(cmds(), ['start']);
  power._set({ locked: true }); await wait(() => cmds().length === 2); assert.deepEqual(cmds(), ['start', 'stop']);
  power._set({ battery: true }); power._set({ locked: false });          // pilde (varsayilan: pilde de dinle)
  await wait(() => cmds().length === 3); assert.equal(cmds()[2], 'start');
  ui.open();                                                             // ayar yalnizca Neo penceresinden kabul edilir
  await handlers['neo:set']({ sender: wc }, { batteryWake: false });     // pildeyken dinleme kapali
  await wait(() => cmds().length === 4); assert.equal(cmds()[3], 'stop');
  power._set({ battery: false });                                        // prize takildi
  await wait(() => cmds().length === 5); assert.equal(cmds()[4], 'start');
  power._set({ asleep: true }); power._set({ asleep: true });            // ayni durum tekrar: tek 'stop'
  await wait(() => cmds().length === 6); await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(cmds().slice(5), ['stop']);
});
