'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('./helpers/util.js');
const N = require('../neo.js');
const { registerNeo, clean } = require('../neo-main.js');

// Sahte Claude istemcisi: sirayla verilen cevaplari dondurur, istekleri kaydeder
function fakeClient(replies) {
  const reqs = [];
  return { reqs, beta: { messages: { create: async (r) => { reqs.push(JSON.parse(JSON.stringify(r))); const x = replies.shift(); if (x instanceof Error) throw x; return x; } } } };
}
const msg = (content, stop = 'end_turn') => ({ content, stop_reason: stop, usage: {} });
const txt = t => ({ type: 'text', text: t });
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });

test('beyin: arac cagrisi, sonuc geri gonderilir, kisa cevap doner; istek bicimi dogru', async () => {
  const calls = [];
  const actions = { stock: async s => { calls.push(s); return { symbol: s, price: 312.5, change_pct: 1.2 }; } };
  const c = fakeClient([msg([use('t1', 'stock_info', { symbol: 'THYAO' })], 'tool_use'), msg([txt('THYAO 312 lira 50 kuruş, yüzde 1,2 artıda.')])]);
  const b = N.createBrain({ getKey: () => 'k', actions, client: c, now: () => Date.UTC(2026, 9, 20, 7) });
  const r = await b.ask('türk hava yolları kaç');
  assert.equal(r.text, 'THYAO 312 lira 50 kuruş, yüzde 1,2 artıda.'); assert.deepEqual(r.tools, ['stock_info']); assert.deepEqual(calls, ['THYAO']);
  const q = c.reqs[0];
  assert.equal(q.model, 'claude-opus-5-5'); assert.equal(q.output_config.effort, 'low'); assert.equal(q.fallbacks, 'default');
  assert.deepEqual(q.betas, ['server-side-fallback-2026-07-01']); assert.equal(q.thinking, undefined); assert.equal(q.tool_choice, undefined);
  assert.ok(q.tools.some(t => t.type === 'web_search_20260209'));
  for (const t of q.tools.filter(t => t.input_schema)) {                 // strict: desteklenmeyen kisitlar yok
    assert.equal(t.strict, true); assert.equal(t.input_schema.additionalProperties, false);
    assert.doesNotMatch(JSON.stringify(t.input_schema), /minimum|maximum|minLength|maxLength/);
  }
  assert.match(q.messages[0].content, /^\[.*\] türk hava yolları kaç$/);
  const second = c.reqs[1].messages;                                    // asistan turu degismeden geri gider, ardindan arac sonucu
  assert.equal(second[1].role, 'assistant'); assert.equal(second[2].content[0].type, 'tool_result'); assert.match(second[2].content[0].content, /312\.5/);
});

test('beyin: pause_turn devam eder, refusal ve hata kullaniciya Turkce doner, 5 dk sonra hafiza sifirlanir', async () => {
  let t = 0;
  const c = fakeClient([msg([txt('ara')], 'pause_turn'), msg([txt('Dolar 41 lira.')]), msg([], 'refusal'), msg([txt('Merhaba.')])]);
  const b = N.createBrain({ getKey: () => 'k', actions: {}, client: c, now: () => t });
  assert.equal((await b.ask('dolar kaç')).text, 'Dolar 41 lira.');
  assert.equal((await b.ask('kötü bir şey')).text, 'Bu isteğe yardımcı olamıyorum.');
  t += 6 * 60 * 1000;
  await b.ask('selam');
  assert.equal(c.reqs.at(-1).messages.length, 1, '5 dakika sonra yeni konusma');
  const e = N.createBrain({ getKey: () => '', actions: {} });
  assert.equal((await e.ask('x')).error, 'nokey');
  const f = N.createBrain({ getKey: () => 'k', actions: {}, client: fakeClient([new Error('ag')]) });
  const r = await f.ask('x'); assert.equal(r.text, 'Bir şeyler ters gitti.'); assert.deepEqual(f.history(), []);
});

test('runTool: dogrulama, sinirlar, yalniz https, arac hatasi is_error olarak doner', async () => {
  const got = [];
  const a = { appVolume: (n, p) => { got.push([n, p]); return { ok: true }; }, openUrl: u => ({ ok: true, u }), timer: (m, l) => ({ m, l }), status: () => { throw new Error('sensör yok'); } };
  assert.deepEqual(await N.runTool(a, 'set_app_volume', { app: 'Spotify', percent: 450 }), { ok: true }); assert.deepEqual(got, [['Spotify', 200]]);
  assert.match((await N.runTool(a, 'open_url', { url: 'http://x.com' })).error, /https/);
  assert.match((await N.runTool(a, 'open_url', { url: 'https://x.com/a b' })).error, /https/);
  assert.deepEqual((await N.runTool(a, 'set_timer', { minutes: 99999, label: 'çay' })), { m: 1440, l: 'çay' });
  assert.match((await N.runTool(a, 'yok', {})).error, /Bilinmeyen/);
  assert.match((await N.runTool(a, 'set_app_volume', { app: 'x' })).error, /Eksik/);
  assert.deepEqual(await N.runTool(a, 'system_status', {}), { error: 'sensör yok' });
  const c = fakeClient([msg([use('t1', 'system_status', {})], 'tool_use'), msg([txt('Okuyamadım.')])]);
  await N.createBrain({ getKey: () => 'k', actions: a, client: c }).ask('sıcaklık');
  assert.equal(c.reqs[1].messages[2].content[0].is_error, true);
});

test('clean: ayarlar sinirli', () => {
  assert.deepEqual(clean({ wake: false, voice: 5, rate: 9, hotkey: 'Alt+Space; rm', brain: 'gpt' }), { wake: false, voice: '', rate: 0.7, brain: 'groq', hotkey: 'Alt+Space' });
  assert.deepEqual(clean({ brain: 'claude' }), { wake: true, voice: '', rate: 0.5, brain: 'claude', hotkey: 'Alt+Space' });
});

// Sahte ses yardimcisi + sahte Electron: uyanma -> komut -> dusunme -> konusma -> bekleme akisi
test('registerNeo: Hey Neo akisi, kisayol, pencere gonderen kontrolu ve kapatma', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const log = path.join(d, 'cmd.log'), bin = path.join(d, 'neo.js');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs=require('fs'),o=x=>process.stdout.write(JSON.stringify(x)+'\\n');
o({type:'hello',version:1,wakeOnDevice:true,cmdOnDevice:false,locale:'tr-TR',voices:[{id:'v1',name:'Yelda',lang:'tr-TR',quality:'enhanced'}]});
require('readline').createInterface({input:process.stdin}).on('line',l=>{fs.appendFileSync(${JSON.stringify(log)},l+'\\n');const m=JSON.parse(l);
  if(m.cmd==='start'){o({type:'state',state:'idle'});setTimeout(()=>{o({type:'wake',text:'hey neo'});o({type:'state',state:'listening'});o({type:'partial',text:'spotify'});o({type:'command',text:'spotify sesini yüzde 150 yap',reason:'silence'})},50)}
  if(m.cmd==='say')setTimeout(()=>o({type:'spoken',id:m.id}),30);
  if(m.cmd==='idle')o({type:'state',state:'idle'});
  if(m.cmd==='quit')process.exit(0)}).on('close',()=>process.exit(0));`);
  fs.chmodSync(bin, 0o755);
  process.env.CEM_NEO_BIN = bin; t.after(() => { delete process.env.CEM_NEO_BIN; });
  const handlers = {}, keys = {}, orbMsgs = [];
  let onReady, quit, on = true, conf = {};
  const wcOrb = { send: (ch, m) => { if (ch === 'neo:orb') orbMsgs.push(m); }, setWindowOpenHandler() {}, on() {} };
  function Win() { return { webContents: wcOrb, loadFile() {}, isDestroyed: () => false, isVisible: () => true, getSize: () => [420, 150], setPosition() {},
    showInactive() {}, show() {}, focus() {}, hide() {}, close() {}, on() {}, once() {}, setAlwaysOnTop() {}, setVisibleOnAllWorkspaces() {} }; }
  const asked = [];
  const brain = { ask: async q => { asked.push(q); return { text: 'Spotify yüzde 150.', tools: ['set_app_volume'] }; }, reset() {} };
  const ui = registerNeo({ ipcMain: { handle: (c, f) => { handlers[c] = f; } }, app: { isPackaged: false, whenReady: () => ({ then: f => { onReady = f; } }), on: (e, f) => { quit = f; } },
    BrowserWindow: Win, path, screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 25, width: 1440, height: 875 } }) },
    globalShortcut: { register: (k, f) => { keys[k] = f; return true; }, unregister: k => { delete keys[k]; } },
    Notification: function () { return { show() {} }; }, cfg: () => ({ neo: conf }), save: o => { conf = o.neo; }, keys: { get: () => 'k', set() {} }, shell: { openExternal() {} }, actions: {}, isOn: () => on, brain });
  const wait = async (f, ms = 3000) => { const e = Date.now() + ms; while (!f()) { if (Date.now() > e) throw new Error('zaman asimi'); await new Promise(r => setTimeout(r, 15)); } };
  const cmds = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : []);
  onReady();
  assert.equal(typeof keys['Alt+Space'], 'function', '⌥Bosluk kisayolu');
  await wait(() => cmds().some(c => c.cmd === 'say'));
  const c = cmds();
  assert.equal(c[0].cmd, 'config'); assert.ok(c[0].wake.includes('hey neo')); assert.equal(c[1].cmd, 'start');
  assert.deepEqual(asked, ['spotify sesini yüzde 150 yap']);
  assert.ok(c.some(x => x.cmd === 'thinking')); assert.equal(c.find(x => x.cmd === 'say').text, 'Spotify yüzde 150.');
  await wait(() => cmds().filter(x => x.cmd === 'idle').length >= 1);
  assert.ok(orbMsgs.some(m => m.state === 'thinking') && orbMsgs.some(m => m.answer === 'Spotify yüzde 150.'));
  // pencere: baska gonderen reddedilir; ayar degisince uyandirma durur
  assert.equal(await handlers['neo:state']({ sender: {} }), null);
  const st = await handlers['neo:state']({ sender: wcOrb });
  assert.equal(st.log[0].a, 'Spotify yüzde 150.'); assert.equal(st.hello.voices[0].name, 'Yelda');
  await handlers['neo:set']({ sender: wcOrb }, { wake: false });
  await wait(() => cmds().some(x => x.cmd === 'stop'));
  // kisayol: dinlemeye basla
  keys['Alt+Space'](); await wait(() => cmds().some(x => x.cmd === 'listen'));
  on = false; ui.disable(); assert.equal(keys['Alt+Space'], undefined);
  await wait(() => cmds().some(x => x.cmd === 'quit'));
  quit();
});

// ---- Groq beyni (sahte fetch) ----
function fakeFetch(steps) {
  const reqs = [];
  const f = async (url, o) => { reqs.push({ url, body: JSON.parse(o.body), auth: o.headers.authorization }); const st = steps.shift();
    if (st instanceof Error) throw st;
    return { ok: st.status === 200, status: st.status, text: async () => JSON.stringify(st.body) }; };
  f.reqs = reqs; return f;
}
const ch = (message, finish = 'stop') => ({ status: 200, body: { choices: [{ message, finish_reason: finish }] } });

test('Groq beyni: fonksiyon cagrisi, arac sonucu tool mesajiyla doner, istek bicimi', async () => {
  const got = [];
  const F = fakeFetch([ch({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'set_app_volume', arguments: '{"app":"Spotify","percent":150}' } }] }, 'tool_calls'),
    ch({ role: 'assistant', content: 'Spotify yüzde 150.' })]);
  const b = N.createGroqBrain({ getKey: () => 'gsk_x', actions: { appVolume: (a, p) => { got.push([a, p]); return { ok: true }; } }, fetch: F, now: () => Date.UTC(2026, 9, 20, 7) });
  const r = await b.ask('spotify sesini yüzde 150 yap');
  assert.equal(r.text, 'Spotify yüzde 150.'); assert.deepEqual(r.tools, ['set_app_volume']); assert.deepEqual(got, [['Spotify', 150]]);
  const q = F.reqs[0];
  assert.equal(q.url, 'https://api.groq.com/openai/v1/chat/completions'); assert.equal(q.auth, 'Bearer gsk_x');
  assert.equal(q.body.model, 'openai/gpt-oss-120b'); assert.equal(q.body.reasoning_effort, 'low'); assert.equal(q.body.messages[0].role, 'system');
  assert.ok(q.body.tools.some(t => t.type === 'browser_search')); assert.equal(q.body.tools.filter(t => t.type === 'function').length, N.TOOLS.length);
  const m2 = F.reqs[1].body.messages;
  assert.equal(m2.at(-1).role, 'tool'); assert.equal(m2.at(-1).tool_call_id, 'c1'); assert.equal(m2.at(-2).tool_calls[0].function.name, 'set_app_volume');
});

test('Groq beyni: 429 kucuk modele gecer, browser_search 400 ise birakilir, 401 ve limit mesajlari Turkce', async () => {
  const F = fakeFetch([{ status: 400, body: { error: { message: 'tool browser_search is not supported' } } }, { status: 429, body: { error: { message: 'rate limit' } } }, ch({ role: 'assistant', content: 'Tamam.' })]);
  const b = N.createGroqBrain({ getKey: () => 'gsk_x', actions: {}, fetch: F });
  assert.equal((await b.ask('selam')).text, 'Tamam.');
  assert.equal(F.reqs[1].body.tools.some(t => t.type === 'browser_search'), false, 'web aramasi kapatildi');
  assert.equal(F.reqs[2].body.model, 'openai/gpt-oss-20b'); assert.equal(b.model(), 'openai/gpt-oss-20b');
  const A = N.createGroqBrain({ getKey: () => 'gsk_x', actions: {}, fetch: fakeFetch([{ status: 401, body: {} }]) });
  assert.equal((await A.ask('x')).text, 'Groq anahtarı geçersiz.');
  const L = N.createGroqBrain({ getKey: () => 'gsk_x', actions: {}, fetch: fakeFetch([{ status: 429, body: {} }, { status: 429, body: {} }, { status: 429, body: {} }]) });
  assert.match((await L.ask('x')).text, /ücretsiz sınırı/);
  assert.equal((await N.createGroqBrain({ getKey: () => '', actions: {} }).ask('x')).error, 'nokey');
  const bad = fakeFetch([ch({ role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'open_url', arguments: '{bozuk' } }] }, 'tool_calls'), ch({ role: 'assistant', content: 'Açamadım.' })]);
  await N.createGroqBrain({ getKey: () => 'gsk_x', actions: {}, fetch: bad }).ask('aç');
  assert.match(bad.reqs[1].body.messages.at(-1).content, /Geçersiz JSON/);
});
