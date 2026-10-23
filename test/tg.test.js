'use strict';
// tg.js canli Telegram hesabi ister; yalnizca saf yardimci floodSeconds denenir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { errors } = require('telegram');
const { floodSeconds } = require('../tg.js');

test('floodSeconds: FloodWaitError, FLOOD_WAIT mesaji, diger hatalar', () => {
  const fw = new errors.FloodWaitError({ request: undefined, capture: 42 });
  assert.equal(fw.seconds, 42);
  assert.equal(floodSeconds(fw), 42);
  assert.equal(floodSeconds(new Error('A wait of FLOOD_WAIT_17 seconds is required')), 17);
  assert.equal(floodSeconds(new Error('FLOOD_WAIT')), 60);
  assert.equal(floodSeconds(new Error('PHONE_CODE_INVALID')), 0);
  assert.equal(floodSeconds(null), 0);
  assert.equal(floodSeconds(undefined), 0);
});

// --- GramJS sahtesi: tg.js cevrimdisi yuklenir -----------------------------------
const Module = require('module');
function mockTg(opts = {}) {
  const st = { handlers: [], disconnects: 0, sendFails: false, ...opts };
  class FakeClient {
    constructor() { this.connected = true; this.session = { save: () => 'S' }; st.client = this; }
    setLogLevel() {}
    async start(p) { if (st.startFails) { await p.phoneNumber(); await p.onError(new Error(st.startFails)); } }
    async connect() { if (st.connectFails) throw new Error(st.connectFails); }
    async checkAuthorization() { return true; }
    async getMe() { return { firstName: 'Cem', username: 'cem' }; }
    async getEntity() { return { id: 777n }; }
    addEventHandler(f, e) { st.handlers.push([f, e]); }
    removeEventHandler(f, e) { const i = st.handlers.findIndex(h => h[0] === f && h[1] === e); if (i >= 0) st.handlers.splice(i, 1); }
    async sendMessage() {
      if (st.sendFails) throw new Error('A wait of FLOOD_WAIT_30 seconds is required');
      // Bot hemen cevap verir.
      setTimeout(() => { for (const [f] of [...st.handlers]) f({ message: { id: 2, senderId: 777n, message: 'cevap', replyMarkup: null } }); }, 10);
      return { id: 1 };
    }
    async downloadMedia() { return Buffer.from('x'); }
    async getMessages() { return []; }
    async disconnect() { st.disconnects++; this.connected = false; }
  }
  class Ev { constructor(o) { this.o = o; } }
  const fakes = {
    telegram: { TelegramClient: FakeClient, Api: { auth: { LogOut: class {} } }, errors: { FloodWaitError: class {} } },
    'telegram/sessions': { StringSession: class {} },
    'telegram/events': { NewMessage: Ev },
    'telegram/events/EditedMessage': { EditedMessage: Ev }
  };
  const p = require.resolve('../tg.js');
  delete require.cache[p];
  const orig = Module._load;
  Module._load = function (r, ...a) { return fakes[r] || orig.call(this, r, ...a); };
  try { st.tg = require(p); } finally { Module._load = orig; delete require.cache[p]; }
  return st;
}
const timers = () => process.getActiveResourcesInfo().filter(x => x === 'Timeout').length;

test('query: sendMessage hata verirse dinleyiciler ve zamanlayici kalmaz (M1)', async () => {
  const st = mockTg({ sendFails: true });
  await st.tg.restore({ apiId: 1, apiHash: 'h', session: 's' });
  const t0 = timers();
  for (let i = 0; i < 3; i++) await assert.rejects(st.tg.query('@bot', 'THYAO'), /FLOOD_WAIT/);
  assert.equal(st.handlers.length, 0, 'olay dinleyicileri kaldirilmali');
  assert.equal(timers(), t0, 'tick zamanlayicisi temizlenmeli');
});

test('query: basarili sorgu dinleyicileri kaldirir, 15 sn yedek zamanlayicisi kalmaz (M1)', async () => {
  const st = mockTg();
  await st.tg.restore({ apiId: 1, apiHash: 'h', session: 's' });
  const t0 = timers();
  const msgs = await st.tg.query('@bot', 'THYAO', { quietMs: 20, timeoutMs: 5000 });
  assert.deepEqual(msgs.map(m => m.text), ['cevap']);
  assert.equal(st.handlers.length, 0);
  assert.equal(timers(), t0, 'Promise.race zamanlayicisi temizlenmeli');
});

test('connect / restore: hata olursa yari acik istemci kapatilir (L4)', async () => {
  const st = mockTg({ startFails: 'PHONE_CODE_INVALID' });
  await assert.rejects(st.tg.connect({ apiId: 1, apiHash: 'h', ask: async () => '+90' }), /PHONE_CODE_INVALID/);
  assert.equal(st.disconnects, 1);
  assert.equal(st.tg.connected(), false);
  st.connectFails = 'net down';
  await assert.rejects(st.tg.restore({ apiId: 1, apiHash: 'h', session: 's' }), /net down/);
  assert.equal(st.disconnects, 2);
  assert.equal(st.tg.connected(), false);
  await assert.rejects(st.tg.query('@bot', 'X'), /bağlı değil/);
});
