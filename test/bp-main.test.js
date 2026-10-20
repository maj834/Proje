'use strict';
// Borsa Pro ana surec modulu: sahte Electron, sahte piyasa/veri/lab/analist, sahte zamanlayici ve saat. Ag yok.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { tmpDir } = require('./helpers/util');
const engine = require('../engine');
const realMarket = require('../market');
const BP = require('../borsa-pro-main.js');

const CHANNELS = ['bp:ai', 'bp:alarm', 'bp:ask', 'bp:capital', 'bp:demo', 'bp:depth', 'bp:feeds', 'bp:lab', 'bp:load', 'bp:okul', 'bp:open', 'bp:overview', 'bp:plan', 'bp:planApply', 'bp:portfolio', 'bp:prefs',
  'bp:quotes', 'bp:report', 'bp:scan', 'bp:scanCancel', 'bp:search', 'bp:state', 'bp:watch'];
const T0 = Date.UTC(2026, 9, 19, 8, 0);                 // Pazartesi 11:00 Istanbul
const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const deferred = () => { let ok; const p = new Promise(r => { ok = r; }); return { p, ok }; };

// --- sahte bagimliliklar --------------------------------------------------------------------
// Belirlenimci sentetik mumlar (07:00 UTC = 10:00 Istanbul)
// wave: periyodik egilim (rejim degisimi -> sistem sinyalleri)
function synth(n = 300, { start = 100, drift = 0.002, t0 = Date.UTC(2025, 0, 2, 7), step = 86400000, seed = 7, wave = 0, period = 60 } = {}) {
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const rows = []; let c = start;
  for (let i = 0; i < n; i++) {
    const o = c; c = Math.max(1, o * (1 + drift + wave * Math.sin(i / period * 2 * Math.PI) + (rnd() - 0.5) * 0.03));
    const h = Math.max(o, c) * (1 + rnd() * 0.01), l = Math.min(o, c) * (1 - rnd() * 0.01);
    rows.push({ t: t0 + i * step, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v: Math.round(1e6 * (0.5 + rnd())) });
  }
  return rows;
}
const DAILY = synth(300), WEEKLY = synth(120, { step: 7 * 86400000, seed: 11 }), HOURLY = synth(200, { step: 3600000, seed: 5 }), XU = synth(300, { start: 9000, seed: 3 });

function fakeMarket(o = {}) {
  const daily = o.daily || DAILY;
  const calls = { multi: [], quote: [], candles: [], news: [] };
  const m = {
    TF: realMarket.TF, yahooSymbol: realMarket.yahooSymbol, calls, price: o.price ?? 150, stale: false, quoteErr: null, gates: {}, multiErr: null, empty: false,
    async multi(sym, { tf = '1g', market = 'BIST', extra } = {}) {
      calls.multi.push({ sym, tf, market, extra });
      if (m.gates[sym]) await m.gates[sym];
      if (m.multiErr) throw new Error(m.multiErr);
      if (m.empty) return { frames: {}, quotes: {}, errors: [tf + ': Bağlantı yok.'] };
      const fr = { '1g': daily, '1h': WEEKLY, '1s': HOURLY, '5dk': HOURLY, '15dk': HOURLY, '1dk': HOURLY };
      const tfs = [...new Set([tf, ...(extra || realMarket.MTF[tf] || [])])];
      const q = { price: daily.at(-1).c, prev: daily.at(-2).c, currency: 'TRY', name: 'TURK HAVA YOLLARI', time: daily.at(-1).t };
      return { frames: Object.fromEntries(tfs.map(k => [k, fr[k]])), quotes: Object.fromEntries(tfs.map(k => [k, q])), errors: [] };
    },
    async quote(sym) {
      calls.quote.push(sym);
      if (m.quoteGate) await m.quoteGate;
      if (m.quoteErr) throw new Error(m.quoteErr);
      return { symbol: sym, price: m.price, prev: 148, chg: m.price - 148, chgPct: +((m.price / 148 - 1) * 100).toFixed(2), time: daily.at(-1).t + 3600000, currency: 'TRY', stale: m.stale };
    },
    async candles(sym, tf) {
      calls.candles.push({ sym, tf });
      if (sym === 'XU100') { if (m.benchErr) throw new Error('XU100 yok'); return { rows: XU, quote: {} }; }
      return { rows: m.labRows || daily, quote: { price: daily.at(-1).c } };
    },
    async yahooNews(sym) { calls.news.push(sym); return { items: [{ title: 'Yahoo haberi', url: 'https://example.com/h', time: 1 }] }; },
  };
  return m;
}
function fakeData() {
  const calls = { quotes: [], scan: [], stats: [], overview: 0, search: [] };
  const d = {
    calls, gate: null, overviewErr: null, quotesErr: null, prices: {},
    async quotes(list, opt) {
      calls.quotes.push({ list, opt });
      if (d.quotesErr) throw new Error(d.quotesErr);
      return list.map(s => ({ symbol: String(s).toUpperCase(), price: d.prices[s] ?? 100, prev: 95, chg: 5, chgPct: 5.26, spark: [], error: null }));
    },
    async scan(syms, opt) {
      calls.scan.push({ syms, opt });
      const rows = [];
      for (let i = 0; i < syms.length; i++) {
        if (d.gate) await d.gate;
        if (opt.signal && opt.signal.aborted) break;
        rows.push({ symbol: syms[i], price: 10, chgPct: i % 2 ? -1 : 1, verdict: { label: 'AL', dir: 1, score: 60 - i, confidence: 70 }, score: 60 - i, tags: [] });
        opt.onProgress({ done: i + 1, total: syms.length, symbol: syms[i] });
      }
      return { at: T0, tf: opt.tf, total: syms.length, rows, errors: [], cancelled: !!(opt.signal && opt.signal.aborted) };
    },
    stats(rows, bench) { calls.stats.push({ n: rows.length, bench: bench ? bench.length : null }); return { perf: { d5: 1 }, hi52: 200, beta: 1.1 }; },
    async overview() { calls.overview++; if (d.overviewErr) throw new Error(d.overviewErr); return [{ sym: 'XU100.IS', name: 'BIST 100', price: 9000 }]; },
    breadth(rows) { return { up: rows.length, down: 0, flat: 0, avgChg: 1, al: rows.length, sat: 0, bekle: 0 }; },
    search(q) { calls.search.push(q); if (q === 'patla') throw new Error('arama bozuk'); return [{ symbol: 'THYAO', name: 'Türk Hava Yolları' }].filter(x => x.symbol.startsWith(String(q).toUpperCase())); },
    matches(row, id) { return id === 'guclu-al' ? row.score >= 50 : false; },
  };
  return d;
}
function fakeLab() {
  const calls = [];
  return { calls, STRATEGIES: [{ id: 'ema', name: 'EMA 20/50 kesişimi' }],
    compare(rows, opts) { calls.push({ n: rows.length, opts }); return { results: [{ id: 'ema', name: 'EMA', stats: { trades: 6, totalRet: 12 }, trades: [] }], best: 'ema', bh: { ret: 5 }, note: 'not' }; } };
}
function fakeAnalyst(ps = ['groq', 'claude']) {
  const calls = { brief: [], ask: [] };
  const a = { calls, ps, briefErr: null,
    providers: () => a.ps,
    async brief(ctx, o) { calls.brief.push({ ctx, o }); if (a.briefErr) throw new Error(a.briefErr); return { ok: true, provider: o.provider, model: 'm', data: { ozet: 'Özet', gorunum: 'notr' }, cost: 0 }; },
    async ask(ctx, h, q, o) { calls.ask.push({ ctx, h, q, o }); return { ok: true, answer: 'Cevap', provider: o.provider }; } };
  return a;
}
function fakePower() {
  let st = { battery: false, locked: false, asleep: false }; const subs = new Set();
  return { inited: 0, state: () => st, away: () => st.locked || st.asleep, on(f) { subs.add(f); return () => subs.delete(f); }, init() { this.inited++; },
    set(o) { st = { ...st, ...o }; for (const f of subs) f(st); } };
}
function fakeTimers() {
  const list = []; let id = 0;
  return { list, setTimeout(f, ms) { const h = { id: ++id, f, ms }; list.push(h); return h.id; },
    clearTimeout(h) { const i = list.findIndex(x => x.id === h); if (i >= 0) list.splice(i, 1); },
    get pending() { return list.length; }, get ms() { return list.length ? list[0].ms : null; },
    async fire() { const h = list.shift(); assert.ok(h, 'kurulu zamanlayici yok'); return await h.f(); } };
}
function fakeCal(open = true) {
  const c = { open, reason: open ? null : 'seans 18:15\'te kapandı', OPEN: 595, CLOSE: 1095, HALF_CLOSE: 765,
    status: () => ({ open: c.open, reason: c.reason, closeMin: 1095, half: false }), isOpen: () => c.open };
  return c;
}
const U = { BIST30: Array.from({ length: 30 }, (_, i) => 'AAA' + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? 'X' : '')),
  BIST50: Array.from({ length: 50 }, (_, i) => 'BB' + i), BIST100: Array.from({ length: 100 }, (_, i) => 'CC' + i), note: 'yaklaşık' };
const PRESETS = [{ id: 'guclu-al', name: 'Güçlü AL' }, { id: 'kirilim', name: 'Kırılım' }];

function harness(t, o = {}) {
  const handlers = {}, sent = [], wins = [], notes = [], opened = [], said = [], navs = [];
  let ready = null, quit = null;
  const dir = tmpDir(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = { c: o.conf ? { borsaPro: o.conf } : {}, saves: 0 };
  function Win(opts) {
    const ev = {}, wc = { send: (ch, d) => sent.push([ch, d]), setWindowOpenHandler(f) { wc.openHandler = f; }, on(e, f) { wc['on_' + e] = f; } };
    const w = { opts, webContents: wc, ev, destroyed: false, shown: 0, loadFile(f) { w.file = f; }, once(e, f) { ev[e] = f; }, on(e, f) { ev[e] = f; },
      isDestroyed: () => w.destroyed, isMinimized: () => false, restore() {}, show() { w.shown++; }, focus() {}, setBackgroundColor(c) { w.bg = c; },
      close() { if (w.destroyed) return; w.destroyed = true; if (ev.closed) ev.closed(); } };
    wins.push(w); return w;
  }
  function Notif(opts) { const n = { opts, show() { notes.push(opts); }, on(e, f) { n['on_' + e] = f; } }; Notif.last = n; return n; }
  Notif.isSupported = () => true;
  const clock = { t: o.now ?? T0 };
  const timers = fakeTimers(), power = fakePower(), calendar = fakeCal(o.open !== false);
  const market = fakeMarket(o.mk || {}), data = fakeData(), lab = fakeLab(), analyst = o.analyst || fakeAnalyst();
  const extCalls = { botNews: [], extSignals: [] }, depthBox = { d: null };
  const ext = { botNews: s => { extCalls.botNews.push(s); return Promise.resolve({ list: [{ title: 'Bot haberi', summary: 'Bot özeti', score: 3, ts: '2026-10-19T07:00:00Z' }], calendar: [{ day: '2026-10-25', kind: 'temettü', title: 'Temettü' }], akd: { days: 5, top: [] } }); },
    extSignals: s => { extCalls.extSignals.push(s); return { depth: null, news: null }; }, depth: () => depthBox.d, riskPct: () => 1 };
  const h = { on: true, handlers, sent, wins, notes, opened, said, navs, store, market, data, lab, analyst, timers, power, calendar, clock, extCalls, depthBox, dir,
    get win() { return wins.at(-1); }, ready: () => ready && ready(), quit: () => quit && quit(),
    evts: type => sent.filter(([ch, d]) => ch === 'bp:evt' && (!type || d.type === type)).map(x => x[1]),
    conf: () => BP.clean(store.c.borsaPro) };
  const deps = { ipcMain: { handle: (c, f) => { handlers[c] = f; } },
    app: { getPath: () => dir, on: (e, f) => { if (e === 'will-quit') quit = f; }, whenReady: () => ({ then: f => { ready = f; } }) },
    BrowserWindow: Win, path, screen: { getPrimaryDisplay: () => ({ workAreaSize: o.area || { width: 1920, height: 1080 } }) },
    Notification: Notif, shell: { openExternal: u => opened.push(u) }, nativeTheme: { shouldUseDarkColors: o.dark !== false, on() {} },
    cfg: () => store.c, save: x => { store.c = { ...store.c, ...x }; store.saves++; }, isOn: () => h.on,
    demo: o.demo === undefined ? require('../bp-demo') : o.demo, market, engine: o.engine || engine, calendar, power, data, lab, analyst, ext, say: s => said.push(s), now: () => clock.t, timers,
    meta: o.meta === undefined ? { U, PRESETS, TAGS: { 'kirilim-yukari': { name: 'Yukarı kırılım', dir: 1 } } } : o.meta,
    quant: o.quant || null, history: o.history || null, fund: o.fund || null, radar: o.radar || null, planner: o.planner || null, apis: o.apis || null, secrets: o.secrets || null };
  h.deps = deps; h.Notif = Notif;
  h.ui = BP.registerBorsaPro(deps);
  h.call = (ch, arg) => handlers[ch]({ sender: h.win && h.win.webContents }, arg);
  t.after(() => h.ui.disable());
  return h;
}

// --- saf yardimcilar -------------------------------------------------------------------------
test('code / num / nextChangeMs: kod normallestirme, Turkce sayi, seans sinirlari', () => {
  assert.equal(BP.code('thyao'), 'THYAO'); assert.equal(BP.code(' şişe '), 'SISE'); assert.equal(BP.code('THYAO.IS'), 'THYAO');
  assert.equal(BP.code('A1CAP'), 'A1CAP'); assert.equal(BP.code('ığdır'), 'IGDIR');
  for (const bad of ['x', 'ABCDEFGHI', '1234', 'TH YAO!', 5, null, undefined, '', 'a'.repeat(30)]) assert.equal(BP.code(bad), null, String(bad));
  assert.equal(BP.num('12,5', 0, 100), 12.5); assert.equal(BP.num('1.234,50', 0, 1e9), 1234.5); assert.equal(BP.num('1,234.50', 0, 1e9), 1234.5);
  assert.equal(BP.num(' 7 ', 0, 10), 7); assert.equal(BP.num('abc', 0, 10), null); assert.equal(BP.num(Infinity, 0, 1e99), null);
  assert.equal(BP.num(5, 0, 4), null); assert.equal(BP.num('', 0, 4), null); assert.equal(BP.num({}, 0, 4), null);
  const cal = require('../calendar');
  assert.equal(BP.nextChangeMs(T0, cal), 106 * 60000 + 1000);                         // 11:00 -> 12:46 (yarim gun kapanisi)
  assert.equal(BP.nextChangeMs(Date.UTC(2026, 9, 19, 6, 0), cal), 55 * 60000 + 1000);  // 09:00 -> 09:55 acilis
  assert.equal(BP.nextChangeMs(Date.UTC(2026, 9, 19, 14, 0), cal), 76 * 60000 + 1000); // 17:00 -> 18:16
  assert.equal(BP.nextChangeMs(Date.UTC(2026, 9, 19, 16, 0), cal), 3 * 3600000);       // 19:00 -> gece yarisi, 3 sa ile sinirli
  assert.equal(BP.nextChangeMs(Date.UTC(2026, 9, 19, 8, 0, 30), {}), 105.5 * 60000 + 1000);
  assert.ok(BP.nextChangeMs(Date.UTC(2026, 9, 19, 20, 59, 59, 900), {}) >= 1000);      // 23:59:59 -> en az 1 sn
});

test('clean: bos ve bozuk ayar varsayilana doner, yalniz gecerli kayitlar kalir', () => {
  const d = BP.clean(undefined);
  assert.deepEqual(d, { watch: BP.DEF_WATCH, tf: '1g', market: 'BIST', symbol: 'THYAO', alarms: [], positions: [], capital: null, prefs: {} });
  assert.notEqual(d.watch, BP.DEF_WATCH, 'varsayilan dizi kopyalanir');
  const good = { id: 'abcdef0123456789', symbol: 'THYAO', kind: 'above', price: 160, note: 'not', created: 5, fired: null, last: 150 };
  const c = BP.clean({ watch: ['thyao', 'THYAO', 'bad!', 5, 'garan'], tf: 'x', market: 'NYSE', symbol: '<script>',
    alarms: [good, { ...good }, { ...good, id: 'zz' }, { ...good, id: '0123456789abcdef', kind: 'nope' }, { ...good, id: '1123456789abcdef', price: -1 },
      { id: '2123456789abcdef', symbol: 'garan', kind: 'verdict', price: 99, last: 'AL' }, null, 'x'],
    positions: [{ id: '3123456789abcdef', symbol: 'akbnk', qty: 10, cost: 50, stop: 45 }, { id: '4123456789abcdef', symbol: 'akbnk', qty: -1, cost: 50 },
      { symbol: 'akbnk', qty: 1, cost: 1 }, { id: '5123456789abcdef', symbol: 'akbnk', qty: 1, cost: 1, date: '2026-02-31' }],
    capital: -5, prefs: { show: { ema: true, x: 'y', 'bad key': true }, tab: 'grafik', evil: 1, provider: 'openai', universe: 'BIST50' } });
  assert.deepEqual(c.watch, ['THYAO', 'GARAN']);
  assert.equal(c.tf, '1g'); assert.equal(c.market, 'BIST'); assert.equal(c.symbol, 'THYAO'); assert.equal(c.capital, null);
  assert.deepEqual(c.alarms.map(a => a.id), ['abcdef0123456789', '2123456789abcdef']);
  assert.equal(c.alarms[1].price, null); assert.equal(c.alarms[1].last, 'AL'); assert.equal(c.alarms[1].symbol, 'GARAN');
  assert.deepEqual(c.positions.map(p => p.id), ['3123456789abcdef']);
  assert.deepEqual(c.positions[0], { id: '3123456789abcdef', symbol: 'AKBNK', qty: 10, cost: 50, date: null, note: '', stop: 45, target: null });
  assert.deepEqual(c.prefs, { show: { ema: true }, tab: 'grafik', universe: 'BIST50' });
  assert.deepEqual(BP.clean({ watch: [] }).watch, [], 'bos liste kullanicinin secimi');
});

test('summarize: deger, K/Z, gunluk K/Z (bugun alinan maliyetten), agirlik, stopa risk; fiyatsiz pozisyon maliyetten', () => {
  const P = [{ id: 'a', symbol: 'AAA', qty: 100, cost: 10, date: '2026-09-01', stop: 9, target: 12 },
    { id: 'b', symbol: 'BBB', qty: 10, cost: 50, date: '2026-10-19', stop: null, target: null },
    { id: 'c', symbol: 'CCC', qty: 5, cost: 20, date: null, stop: 25, target: null }];
  const px = { AAA: { price: 11, prev: 10.5, chgPct: 4.76 }, BBB: { price: 55, prev: 54 } };
  const s = BP.summarize(P, k => px[k], '2026-10-19');
  assert.deepEqual([s.value, s.cost, s.pnl, s.pnlPct, s.dayPnl, s.risk], [1750, 1600, 150, 9.38, 100, 200]);
  const [a, b, c] = s.positions;
  assert.deepEqual([a.value, a.pnl, a.pnlPct, a.dayPnl, a.riskTL, a.toStopPct, a.toTargetPct, a.weight, a.chgPct], [1100, 100, 10, 50, 200, -18.18, 9.09, 62.86, 4.76]);
  assert.deepEqual([b.value, b.pnl, b.dayPnl, b.weight], [550, 50, 50, 31.43]);
  assert.deepEqual([c.value, c.pnl, c.noPrice, c.riskTL, c.stopHit, c.weight], [100, 0, true, null, false, 5.71]);
  // stopun altindaki fiyat: risk 0, stopHit
  const st = BP.summarize([{ ...P[0], stop: 12 }], () => ({ price: 11 }), 'x').positions[0];
  assert.equal(st.riskTL, 0); assert.equal(st.stopHit, true);
  assert.deepEqual(BP.summarize([], () => null, 'x'), { value: 0, cost: 0, pnl: 0, pnlPct: null, dayPnl: 0, dayPct: null, risk: 0, positions: [] });
});

test('alarmText: Turkce ekler ve fiyat bicimi', () => {
  assert.equal(BP.alarmText({ symbol: 'THYAO', kind: 'above', price: 1250.5, note: 'kırılım' }, 1251), 'THYAO 1.250,50 seviyesinin üstüne çıktı (son 1.251,00) · kırılım');
  assert.equal(BP.alarmText({ symbol: 'THYAO', kind: 'below', price: 0.5 }, 0.4567), 'THYAO 0,50 seviyesinin altına indi (son 0,4567)');
  assert.equal(BP.alarmText({ symbol: 'GARAN', kind: 'verdict', last: 'BEKLE' }, 1, { label: 'AL', score: 34 }), 'GARAN günlük kararı BEKLE\'den AL\'a döndü (skor 34)');
  assert.equal(BP.alarmText({ symbol: 'GARAN', kind: 'verdict', last: 'SAT' }, 1, { label: 'BEKLE' }), 'GARAN günlük kararı SAT\'tan BEKLE\'ye döndü');
});

// --- pencere ve IPC --------------------------------------------------------------------------
test('pencere: secenekler, guvenlik, tekrar acma, sembol olayi, isWin, kapali ozellik', (t) => {
  const h = harness(t);
  assert.deepEqual(Object.keys(h.ui).sort(), ['analyzeSymbol', 'close', 'disable', 'enable', 'isWin', 'onDepth', 'open', 'plan', 'status']);
  h.ui.open();
  const w = h.win, o = w.opts;
  assert.deepEqual([o.width, o.height, o.minWidth, o.minHeight, o.title, o.show, o.backgroundColor], [1360, 860, 1024, 640, 'Borsa Pro', false, '#101316']);
  assert.equal(o.webPreferences.sandbox, true); assert.equal(o.webPreferences.contextIsolation, true); assert.equal(o.webPreferences.nodeIntegration, false);
  assert.equal(o.webPreferences.preload, path.join(__dirname, '..', 'borsa-pro-preload.js'));
  assert.equal(w.file, path.join(__dirname, '..', 'borsa-pro.html'));
  assert.deepEqual(w.webContents.openHandler({ url: 'https://evil' }), { action: 'deny' });
  let prevented = false; w.webContents['on_will-navigate']({ preventDefault: () => { prevented = true; } }); assert.ok(prevented);
  assert.equal(w.shown, 0); w.ev['ready-to-show'](); assert.equal(w.shown, 1);
  h.ui.open(); assert.equal(h.wins.length, 1, 'ikinci pencere acilmaz');
  h.ui.open('akbnk'); assert.deepEqual(h.evts('symbol'), [{ type: 'symbol', symbol: 'AKBNK' }]);
  h.ui.open('???'); assert.equal(h.evts('symbol').length, 1, 'gecersiz kod olay uretmez');
  assert.equal(h.ui.isWin(w.webContents), true); assert.equal(h.ui.isWin({ sender: w.webContents }), true);
  assert.equal(h.ui.isWin({}), false); assert.equal(h.ui.isWin(null), false);
  h.ui.close(); assert.equal(w.destroyed, true); assert.equal(h.ui.isWin(w.webContents), false);
  h.on = false; h.ui.open(); assert.equal(h.wins.length, 1, 'ozellik kapaliyken pencere acilmaz');
  h.on = true; h.ui.open('garan'); assert.equal(h.wins.length, 2);
  assert.equal(h.conf().symbol, 'GARAN', 'yeni pencere bp:state ile istenen sembolu acar');
  assert.equal(h.evts('symbol').length, 1, 'yeni pencerede olay yerine ayar');
});

test('pencere: acik tema rengi, kucuk ekranda sigdirma', (t) => {
  const h = harness(t, { dark: false, area: { width: 1100, height: 600 } });
  h.ui.open();
  assert.deepEqual([h.win.opts.backgroundColor, h.win.opts.width, h.win.opts.height], ['#f5f7f9', 1100, 640]);
});

test('IPC: tum kanallar kayitli; gonderen kontrolu; ozellik kapali; hata Turkce {ok:false}', async (t) => {
  const h = harness(t);
  assert.deepEqual(Object.keys(h.handlers).sort(), CHANNELS);
  for (const ch of CHANNELS) assert.deepEqual(await h.handlers[ch]({ sender: {} }, {}), { ok: false, error: 'İzin yok' }, ch + ' pencere yokken');
  h.ui.open();
  for (const ch of CHANNELS) assert.deepEqual(await h.handlers[ch]({ sender: { other: 1 } }, {}), { ok: false, error: 'İzin yok' }, ch + ' baska gonderen');
  h.on = false;
  for (const ch of CHANNELS) assert.deepEqual(await h.call(ch, {}), { ok: false, error: 'Borsa özelliği kapalı.' }, ch);
  h.on = true;
  assert.deepEqual(await h.call('bp:search', 'patla'), { ok: false, error: 'arama bozuk' });
  // istek surerken ozellik kapatilirsa sonuc gonderilmez
  h.market.gates['THYAO.IS'] = new Promise(r => setTimeout(r, 20));
  const p = h.call('bp:load', { symbol: 'THYAO' }); h.on = false;
  assert.deepEqual(await p, { ok: false, error: 'Borsa özelliği kapalı.' });
});

test('bp:state: varsayilanlar, evren sayilari, son tarama dosyasi, saglayicilar, hazir filtreler', async (t) => {
  const h = harness(t);
  fs.writeFileSync(path.join(h.dir, 'bp-scan.json'), JSON.stringify({ at: 1, tf: '1g', rows: [{ symbol: 'THYAO' }] }));
  h.ui.open();
  const s = await h.call('bp:state');
  assert.deepEqual(s.watch, BP.DEF_WATCH); assert.equal(s.tf, '1g'); assert.equal(s.market, 'BIST'); assert.equal(s.symbol, 'THYAO');
  assert.deepEqual(s.alarms, []); assert.deepEqual(s.portfolio, { positions: [], summary: BP.summarize([], () => null, '') });
  assert.equal(s.capital, null); assert.equal(s.riskPct, 1); assert.deepEqual(s.prefs, {}); assert.deepEqual(s.providers, ['groq', 'claude']);
  assert.equal(s.lastScan.rows[0].symbol, 'THYAO'); assert.deepEqual(s.marketStatus, { open: true, reason: null });
  assert.deepEqual(s.universes, { BIST30: 30, BIST50: 50, BIST100: 100, WATCH: BP.DEF_WATCH.length });
  assert.equal(s.scanning, null); assert.deepEqual(s.presets, PRESETS); assert.ok(s.tags['kirilim-yukari']); assert.equal(s.strategies[0].id, 'ema');
  assert.equal(h.data.calls.quotes.length, 0, 'pozisyon yokken fiyat istenmez');
  // bozuk dosya / evren listesi yok / analist bozuk
  const h2 = harness(t, { meta: null, analyst: { providers: () => { throw new Error('x'); } } });
  fs.writeFileSync(path.join(h2.dir, 'bp-scan.json'), '{bozuk');
  h2.ui.open();
  const s2 = await h2.call('bp:state');
  assert.equal(s2.lastScan, null); assert.deepEqual(s2.providers, []); assert.deepEqual(s2.presets, []);
  assert.deepEqual(s2.universes, { BIST30: 0, BIST50: 0, BIST100: 0, WATCH: BP.DEF_WATCH.length });
});

// --- bp:load -----------------------------------------------------------------------------------
test('bp:load: tam sonuc, 800 satir siniri, sinyaller, gunluk mum taze fiyatla, bench ile istatistik, haberler, cfg', async (t) => {
  const daily = synth(1000, { drift: 0, wave: 0.008, period: 120 });
  const frozen = JSON.stringify(daily.at(-1));
  const h = harness(t, { mk: { daily, price: 777 } });
  h.ui.open();
  const r = await h.call('bp:load', { symbol: 'thyao', tf: '1g', market: 'BIST' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.symbol, r.yahoo, r.market, r.name, r.tf, r.currency], ['THYAO', 'THYAO.IS', 'BIST', 'Türk Hava Yolları', '1g', 'TRY']);
  assert.equal(r.rows.length, 800); assert.equal(r.rows.at(-1).t, daily.at(-1).t);
  assert.equal(r.rows.at(-1).c, 777, 'ayni gunun son mumu taze fiyatla'); assert.ok(r.rows.at(-1).h >= 777);
  assert.equal(JSON.stringify(daily.at(-1)), frozen, 'onbellekteki mum degistirilmez');
  assert.equal(r.quote.price, 777); assert.equal(r.quote.prev, 148); assert.equal(r.quote.chgPct, +((777 / 148 - 1) * 100).toFixed(2));
  assert.equal(r.pro.ok, true); assert.ok(['AL', 'SAT', 'BEKLE'].includes(r.pro.verdict.label)); assert.equal(r.pro.last, 777);
  assert.ok(Array.isArray(r.signals) && r.signals.length >= 5, 'sistem sinyalleri');
  assert.ok(engine.systemSignals(daily).length > r.signals.length, 'gorunen pencere disindaki sinyaller atilir');
  const ts = new Set(r.rows.map(x => x.t));
  for (const s of r.signals) { assert.ok(ts.has(s.t), 'sinyal zamani grafikte'); assert.ok(s.dir === 1 || s.dir === -1); assert.ok(Array.isArray(s.why)); }
  assert.deepEqual(Object.keys(r.frames), ['1s', '1g', '1h']);
  for (const f of Object.values(r.frames)) { assert.ok([-1, 0, 1].includes(f.dir)); assert.equal(typeof f.text, 'string'); }
  assert.deepEqual(h.data.calls.stats, [{ n: 1000, bench: 300 }]); assert.equal(r.stats.beta, 1.1);
  assert.equal(r.news.bot.list[0].title, 'Bot haberi'); assert.equal(r.news.bot.calendar.length, 1); assert.deepEqual(r.news.bot.akd, { days: 5, top: [] });
  assert.equal(r.news.yahoo[0].title, 'Yahoo haberi');
  assert.equal(r.depth, null); assert.deepEqual(r.errors, []); assert.equal(r.stale, false);
  assert.deepEqual(h.extCalls.extSignals, ['THYAO']); assert.deepEqual(h.extCalls.botNews, ['THYAO']);
  assert.deepEqual([h.conf().symbol, h.conf().tf, h.conf().market], ['THYAO', '1g', 'BIST']);
  // sembolsuz istek kayitli sembolu yukler; gecersiz kod
  assert.equal((await h.call('bp:load', {})).symbol, 'THYAO');
  for (const bad of [{ symbol: 'th yao!' }, { symbol: 5 }, null, { symbol: 'x'.repeat(40) }]) {
    if (bad === null) continue;
    assert.deepEqual(await h.call('bp:load', bad), { ok: false, error: 'Geçerli bir hisse kodu yaz (ör. THYAO).' }, JSON.stringify(bad));
  }
});

test('bp:load: derinlik yalniz ayni hisse ve 5 dk icinde; ABD hissesinde bot/derinlik/bench yok; veri yoksa hata', async (t) => {
  const h = harness(t);
  h.ui.open();
  h.depthBox.d = { symbol: 'THYAO', at: T0 - 60000, last: 150.2, source: 'bot', pressure: { score: 42, parts: [{ k: 'x', v: 1 }] }, trend: { text: 'Alış baskısı artıyor' },
    flow: { net: 12000, change: 300 }, signal: { dir: 1, why: ['a', 'b'] }, bids: [{ price: 150, qty: 10, orders: 2 }], asks: [{ price: 150.1, qty: 5 }],
    buyers: [{ name: 'BIYKR', net: 5000, cost: 149.5, extra: 'gizli' }], sellers: [{ name: 'X'.repeat(80), net: -100 }], walls: [{ side: 'bid', price: 150, qty: 99, ratio: 0.4 }] };
  const r = await h.call('bp:load', { symbol: 'THYAO' });
  assert.deepEqual(r.depth, { at: T0 - 60000, source: 'bot', last: 150.2, change: null, ceiling: null, floor: null, buyRatio: null, pressure: 42, parts: [{ k: 'x', v: 1 }],
    trend: 'Alış baskısı artıyor', trendDir: 0, history: [], flow: { net: 12000, change: 300, top: null }, signal: { dir: 1, why: ['a', 'b'] }, live: null, tape: null,
    bids: [{ price: 150, qty: 10 }], asks: [{ price: 150.1, qty: 5 }], buyers: [{ name: 'BIYKR', net: 5000, cost: 149.5 }], sellers: [{ name: 'X'.repeat(40), net: -100, cost: null }],
    trades: [], walls: [{ side: 'bid', price: 150, qty: 99, ratio: 0.4 }] });
  h.depthBox.d = { ...h.depthBox.d, at: T0 - 6 * 60000 };
  assert.equal((await h.call('bp:load', { symbol: 'THYAO' })).depth, null, 'bayat derinlik');
  h.depthBox.d = { ...h.depthBox.d, at: T0, symbol: 'GARAN' };
  assert.equal((await h.call('bp:load', { symbol: 'THYAO' })).depth, null, 'baska hisse');
  h.depthBox.d = 'bozuk';
  assert.equal((await h.call('bp:load', { symbol: 'THYAO' })).depth, null);

  const nb = h.extCalls.botNews.length, nc = h.market.calls.candles.length;
  const us = await h.call('bp:load', { symbol: 'aapl', market: 'US', tf: '1g' });
  assert.equal(us.ok, true); assert.equal(us.yahoo, 'AAPL'); assert.equal(us.symbol, 'AAPL'); assert.equal(us.news.bot, null); assert.equal(us.depth, null);
  assert.equal(h.extCalls.botNews.length, nb, 'ABD hissesinde bot haberi istenmez');
  assert.equal(h.market.calls.candles.length, nc, 'ABD hissesinde XU100 istenmez');
  assert.deepEqual(h.data.calls.stats.at(-1), { n: 300, bench: null });
  assert.equal(h.conf().market, 'US');

  h.market.empty = true;
  assert.deepEqual(await h.call('bp:load', { symbol: 'THYAO', market: 'BIST' }), { ok: false, error: 'Bağlantı yok.', errors: ['1g: Bağlantı yok.'] });
  h.market.empty = false; h.market.multiErr = 'Veri sağlayıcı yanıt vermedi.';
  assert.deepEqual(await h.call('bp:load', { symbol: 'THYAO' }), { ok: false, error: 'Veri sağlayıcı yanıt vermedi.' });
});

test('bp:load: analiz cokse de grafik verisi gelir; yan kaynak hatalari yuklemeyi bozmaz; son istenen sembol kaydedilir', async (t) => {
  const broken = { ...engine, proAnalyze: () => { throw new Error('motor bozuk'); }, systemSignals: () => { throw new Error('x'); } };
  const h = harness(t, { engine: broken });
  h.deps.ext.botNews = () => { throw new Error('bot yok'); };
  h.deps.ext.extSignals = () => { throw new Error('derinlik yok'); };
  h.market.yahooNews = async () => { throw new Error('haber yok'); };
  h.market.quote = async () => { throw new Error('fiyat yok'); };
  h.market.benchErr = true;
  h.ui.open();
  const r = await h.call('bp:load', { symbol: 'THYAO', tf: '1g' });
  assert.equal(r.ok, true); assert.equal(r.pro.ok, false); assert.match(r.pro.error, /motor bozuk/);
  assert.deepEqual(r.errors, ['Analiz: Analiz yapılamadı: motor bozuk']); assert.deepEqual(r.signals, []);
  assert.equal(r.news.bot, null); assert.deepEqual(r.news.yahoo, []); assert.equal(r.quote.price, DAILY.at(-1).c, 'gunluk mum fiyati');
  assert.ok(Object.keys(r.frames).length >= 1, 'zaman dilimi ozeti engine.tfTrend ile');
  assert.equal(h.data.calls.stats.at(-1).bench, null);

  // iki istek ust uste: once istenen sonra biterse ayar en son istenende kalir
  const h2 = harness(t);
  h2.ui.open();
  const g = deferred(); h2.market.gates['THYAO.IS'] = g.p;
  const p1 = h2.call('bp:load', { symbol: 'THYAO' });
  const r2 = await h2.call('bp:load', { symbol: 'GARAN' });
  assert.equal(r2.ok, true); assert.equal(h2.conf().symbol, 'GARAN');
  g.ok(); assert.equal((await p1).ok, true);
  assert.equal(h2.conf().symbol, 'GARAN');
});

// --- liste, tarama, ozet ----------------------------------------------------------------------
test('bp:quotes: en fazla 60, gecersiz girdiler suzulur; bp:watch: ekle/cikar/sirala, tekrarsiz, sinirli, kalici', async (t) => {
  const h = harness(t, { conf: { watch: [] } });
  h.ui.open();
  const q = await h.call('bp:quotes', ['THYAO', 'GARAN']);
  assert.deepEqual(q.map(x => x.symbol), ['THYAO', 'GARAN']);
  assert.deepEqual(h.data.calls.quotes[0], { list: ['THYAO', 'GARAN'], opt: { market: 'BIST' } });
  await h.call('bp:quotes', Array.from({ length: 70 }, (_, i) => 'K' + i));
  assert.equal(h.data.calls.quotes[1].list.length, 60);
  await h.call('bp:quotes', ['ok', 5, null, '', '   ', 'x'.repeat(21)]);
  assert.deepEqual(h.data.calls.quotes[2].list, ['ok']);
  assert.deepEqual(await h.call('bp:quotes', 'THYAO'), []); assert.deepEqual(await h.call('bp:quotes', null), []);
  await h.call('bp:quotes', { symbols: ['AAPL'], market: 'US' });
  assert.deepEqual(h.data.calls.quotes.at(-1), { list: ['AAPL'], opt: { market: 'US' } });
  h.data.quotesErr = 'Bağlantı yok.';
  assert.deepEqual(await h.call('bp:quotes', ['THYAO']), { ok: false, error: 'Bağlantı yok.' });

  assert.deepEqual(await h.call('bp:watch', { op: 'add', symbol: 'thyao' }), { ok: true, watch: ['THYAO'] });
  assert.deepEqual(await h.call('bp:watch', { op: 'add', symbol: 'şişe' }), { ok: true, watch: ['THYAO', 'SISE'] });
  assert.deepEqual(await h.call('bp:watch', { op: 'add', symbol: 'THYAO' }), { ok: true, watch: ['THYAO', 'SISE'] });
  assert.deepEqual(await h.call('bp:watch', { op: 'add', symbol: '!!' }), { ok: false, error: 'Geçerli bir hisse kodu yaz (ör. THYAO).', watch: ['THYAO', 'SISE'] });
  assert.deepEqual(await h.call('bp:watch', { op: 'set', list: ['sise', 'thyao', 'SISE', 'bad!', 7, 'garan'] }), { ok: true, watch: ['SISE', 'THYAO', 'GARAN'] });
  assert.deepEqual(await h.call('bp:watch', { op: 'remove', symbol: 'thyao' }), { ok: true, watch: ['SISE', 'GARAN'] });
  assert.deepEqual(await h.call('bp:watch', { op: 'set', list: 'x' }), { ok: false, error: 'Liste geçersiz.', watch: ['SISE', 'GARAN'] });
  assert.deepEqual(await h.call('bp:watch', {}), { ok: true, watch: ['SISE', 'GARAN'] });
  assert.deepEqual(h.conf().watch, ['SISE', 'GARAN']);
  await h.call('bp:watch', { op: 'set', list: Array.from({ length: 80 }, (_, i) => 'W' + i) });
  assert.equal(h.conf().watch.length, 60);
  const full = await h.call('bp:watch', { op: 'add', symbol: 'NEWW' });
  assert.equal(full.ok, false); assert.match(full.error, /en fazla 60/); assert.equal(full.watch.length, 60);
});

test('bp:scan: ilerleme olaylari, hazir filtre etiketleri, kayit + lastScan, pilde eszamanlilik 2', async (t) => {
  const h = harness(t);
  h.ui.open();
  const r = await h.call('bp:scan', { universe: 'BIST30', tf: '1g' });
  assert.equal(r.ok, true); assert.equal(r.universe, 'BIST30'); assert.equal(r.rows.length, 30); assert.equal(r.cancelled, false);
  const call = h.data.calls.scan[0];
  assert.deepEqual(call.syms, U.BIST30); assert.equal(call.opt.concurrency, 3); assert.equal(call.opt.market, 'BIST'); assert.equal(call.opt.tf, '1g');
  assert.equal(call.opt.bench.length, XU.length); assert.ok(call.opt.signal && typeof call.opt.signal.aborted === 'boolean');
  const ev = h.evts('scan'); assert.equal(ev.length, 30); assert.deepEqual(ev.at(-1), { type: 'scan', done: 30, total: 30, symbol: U.BIST30[29] });
  assert.deepEqual(r.rows[0].presets, ['guclu-al']); assert.deepEqual(r.rows[29].presets, []);
  assert.deepEqual(r.breadth, { up: 30, down: 0, flat: 0, avgChg: 1, al: 30, sat: 0, bekle: 0 });
  const saved = JSON.parse(fs.readFileSync(path.join(h.dir, 'bp-scan.json'), 'utf8'));
  assert.equal(saved.rows.length, 30); assert.equal(saved.universe, 'BIST30');
  assert.equal((await h.call('bp:state')).lastScan.rows.length, 30);
  assert.equal(fs.readdirSync(h.dir).filter(f => f.endsWith('.tmp')).length, 0, 'gecici dosya kalmaz');
  h.power.set({ battery: true });
  await h.call('bp:scan', { universe: 'WATCH', tf: 'zz' });
  assert.equal(h.data.calls.scan[1].opt.concurrency, 2); assert.equal(h.data.calls.scan[1].opt.tf, '1g');
  assert.deepEqual(h.data.calls.scan[1].syms, BP.DEF_WATCH);
  assert.deepEqual(await h.call('bp:scan', { universe: 'NASDAQ' }), { ok: false, error: 'Geçersiz tarama evreni.' });
  assert.deepEqual(await h.call('bp:scan', null), { ok: false, error: 'Geçersiz tarama evreni.' });
  await h.call('bp:watch', { op: 'set', list: [] });
  assert.deepEqual(await h.call('bp:scan', { universe: 'WATCH' }), { ok: false, error: 'İzleme listen boş; önce hisse ekle.' });
  const h2 = harness(t, { meta: null }); h2.ui.open();
  assert.deepEqual(await h2.call('bp:scan', { universe: 'BIST100' }), { ok: false, error: 'Endeks listesi bulunamadı.' });
});

test('bp:scan: ayni anda tek tarama, iptal (kayit yok), pencere kapaninca iptal, durum yazisi', async (t) => {
  const h = harness(t);
  h.ui.open();
  const g = deferred(); h.data.gate = g.p;
  const p = h.call('bp:scan', { universe: 'BIST50' });
  await flush();
  assert.match(h.ui.status(), /^Tarama sürüyor… 0\/50$/);
  assert.deepEqual((await h.call('bp:state')).scanning, { done: 0, total: 50, universe: 'BIST50', tf: '1g' });
  assert.deepEqual(await h.call('bp:scan', { universe: 'BIST30' }), { ok: false, error: 'Tarama zaten sürüyor.' });
  assert.deepEqual(await h.call('bp:scanCancel'), { ok: true, cancelled: true });
  g.ok(); const r = await p;
  assert.equal(r.cancelled, true); assert.equal(r.rows.length, 0);
  assert.equal(fs.existsSync(path.join(h.dir, 'bp-scan.json')), false, 'iptal edilen tarama kaydedilmez');
  assert.deepEqual(await h.call('bp:scanCancel'), { ok: true, cancelled: false });
  // pencere kapaninca suren tarama durur
  const g2 = deferred(); h.data.gate = g2.p;
  const p2 = h.call('bp:scan', { universe: 'BIST30' }); await flush();
  h.win.close(); g2.ok();
  assert.equal((await p2).cancelled, true);
  assert.equal(h.ui.status(), null);
});

test('bp:overview 60 sn onbellek ve hata; bp:search', async (t) => {
  const h = harness(t);
  h.ui.open();
  h.data.overviewErr = 'Bağlantı yok.';
  assert.deepEqual(await h.call('bp:overview'), { ok: false, error: 'Bağlantı yok.' });
  h.data.overviewErr = null;
  const [a, b] = await Promise.all([h.call('bp:overview'), h.call('bp:overview')]);
  assert.deepEqual(a, b); assert.equal(a[0].sym, 'XU100.IS'); assert.equal(h.data.calls.overview, 2, 'es zamanli istekler tek istek');
  h.clock.t += 30000; await h.call('bp:overview'); assert.equal(h.data.calls.overview, 2);
  h.clock.t += 31000; h.data.overviewErr = 'Bağlantı yok.';
  assert.deepEqual(await h.call('bp:overview'), a, 'hata olursa son ozet'); assert.equal(h.data.calls.overview, 3);

  assert.deepEqual(await h.call('bp:search', ' thy '), [{ symbol: 'THYAO', name: 'Türk Hava Yolları' }]);
  assert.deepEqual(h.data.calls.search, ['thy']);
  assert.deepEqual(await h.call('bp:search', ''), []); assert.deepEqual(await h.call('bp:search', 5), []); assert.deepEqual(await h.call('bp:search', { q: 'TH' }), [{ symbol: 'THYAO', name: 'Türk Hava Yolları' }]);
  await h.call('bp:search', 'x'.repeat(100)); assert.equal(h.data.calls.search.at(-1).length, 40);
});

test('bp:lab: secenekler suzulur, sonuc + sembol/tf; yetersiz veri', async (t) => {
  const h = harness(t);
  h.ui.open();
  const r = await h.call('bp:lab', { symbol: 'thyao', tf: '1g', opts: { cost: '0,3', atrStop: 2, longOnly: false, capital: -5, evil: 1 } });
  assert.equal(r.ok, true); assert.equal(r.best, 'ema'); assert.equal(r.symbol, 'THYAO'); assert.equal(r.tf, '1g'); assert.equal(r.n, 300);
  assert.deepEqual(h.lab.calls[0], { n: 300, opts: { cost: 0.3, atrStop: 2, longOnly: false } });
  await h.call('bp:lab', { symbol: 'THYAO', opts: { cost: 99, atrStop: -1, longOnly: 'evet', capital: 1000 } });
  assert.deepEqual(h.lab.calls[1].opts, { capital: 1000 });
  await h.call('bp:lab', { symbol: 'THYAO', opts: null });
  assert.deepEqual(h.lab.calls[2].opts, {});
  assert.deepEqual(await h.call('bp:lab', { symbol: '' }), { ok: false, error: 'Geçerli bir hisse kodu yaz (ör. THYAO).' });
  h.market.labRows = DAILY.slice(0, 10);
  assert.deepEqual(await h.call('bp:lab', { symbol: 'THYAO' }), { ok: false, error: 'Strateji testi için yeterli mum yok (10/30).' });
});

// --- yapay zeka ----------------------------------------------------------------------------------
test('bp:ai: baglam son yuklemeden (yeniden veri cekmez), lab ozeti, pozisyon, saglayici secimi, onbellek', async (t) => {
  const h = harness(t);
  h.ui.open();
  await h.call('bp:portfolio', { op: 'add', pos: { symbol: 'THYAO', qty: 10, cost: 100, stop: 90 } });
  await h.call('bp:portfolio', { op: 'add', pos: { symbol: 'THYAO', qty: 30, cost: 120, stop: 95, target: 150 } });
  await h.call('bp:load', { symbol: 'THYAO', tf: '1g' });
  const nm = h.market.calls.multi.length;
  const r = await h.call('bp:ai', { symbol: 'THYAO', tf: '1g' });
  assert.equal(r.ok, true); assert.equal(r.provider, 'groq'); assert.equal(r.symbol, 'THYAO'); assert.equal(r.tf, '1g');
  assert.equal(h.market.calls.multi.length, nm, 'son yukleme kullanilir');
  const { ctx, o } = h.analyst.calls.brief[0];
  assert.deepEqual(o, { provider: 'groq' });
  assert.deepEqual(Object.keys(ctx).sort(), ['akd', 'depth', 'fund', 'lab', 'name', 'news', 'position', 'pro', 'quant', 'quote', 'radar', 'stats', 'symbol', 'tf']);
  assert.equal(ctx.pro.ok, true); assert.equal(ctx.name, 'Türk Hava Yolları'); assert.deepEqual(ctx.akd, { days: 5, top: [] });
  assert.deepEqual(ctx.lab, { best: 'ema', results: [{ id: 'ema', name: 'EMA', stats: { trades: 6, totalRet: 12 } }] });
  assert.deepEqual(ctx.news.map(n => n.title), ['Bot özeti', 'Yahoo haberi']); assert.equal(ctx.news[0].score, 3);
  assert.deepEqual(ctx.position, { qty: 40, cost: 115, stop: 95, target: 150 });
  // onbellek: ayni istek tekrar sorulmaz; force ile yenilenir
  const again = await h.call('bp:ai', { symbol: 'THYAO', tf: '1g' });
  assert.equal(again.cached, true); assert.equal(h.analyst.calls.brief.length, 1);
  await h.call('bp:ai', { symbol: 'THYAO', tf: '1g', force: true }); assert.equal(h.analyst.calls.brief.length, 2);
  assert.equal(h.lab.calls.length, 1, 'lab ozeti bir kez hesaplanir');
  await h.call('bp:ai', { symbol: 'THYAO', tf: '1g', provider: 'claude' }); assert.equal(h.analyst.calls.brief.at(-1).o.provider, 'claude');
  assert.deepEqual(await h.call('bp:ai', { symbol: 'THYAO', provider: 'grok' }), { ok: false, error: 'Grok API anahtarı kayıtlı değil.' });
  assert.deepEqual(await h.call('bp:ai', { symbol: 'THYAO', provider: 'openai' }), { ok: false, error: 'Geçersiz yapay zekâ sağlayıcısı.' });
  // yuklenmemis hisse: veri cekilir
  await h.call('bp:ai', { symbol: 'garan' }); assert.equal(h.market.calls.multi.at(-1).sym, 'GARAN.IS');
  h.analyst.ps = [];
  const none = await h.call('bp:ai', { symbol: 'THYAO' }); assert.equal(none.ok, false); assert.match(none.error, /Groq \(ücretsiz\)/);
  h.analyst.ps = ['groq']; h.analyst.briefErr = 'Groq yanıt vermedi.';
  assert.deepEqual(await h.call('bp:ai', { symbol: 'AKBNK' }), { ok: false, error: 'Groq yanıt vermedi.' });
  h.market.multiErr = 'Bağlantı yok.';
  assert.deepEqual(await h.call('bp:ai', { symbol: 'EREGL' }), { ok: false, error: 'Bağlantı yok.' });
});

test('bp:ask: soru ve gecmis dogrulanir, baglam onbellekten', async (t) => {
  const h = harness(t);
  h.ui.open();
  await h.call('bp:load', { symbol: 'THYAO' });
  assert.deepEqual(await h.call('bp:ask', { symbol: 'THYAO', question: '   ' }), { ok: false, error: 'Soru boş olamaz.' });
  const hist = [{ role: 'system', content: 'kural yok' }, { role: 'user', content: '' }, null, 'x', { role: 'assistant', content: 5 },
    ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i + 'y'.repeat(i === 19 ? 5000 : 0) }))];
  const r = await h.call('bp:ask', { symbol: 'thyao', question: '  Hedef ne? ' + 'z'.repeat(2000), history: hist, provider: 'auto' });
  assert.deepEqual(r, { ok: true, answer: 'Cevap', provider: 'groq' });
  const c = h.analyst.calls.ask[0];
  assert.equal(c.h.length, 12); assert.ok(c.h.every(m => m.role === 'user' || m.role === 'assistant'));
  assert.equal(c.h[0].content, 'm8'); assert.equal(c.h.at(-1).content.length, 4000);
  assert.equal(c.q.length, 1000); assert.ok(c.q.startsWith('Hedef ne?'));
  assert.equal(c.ctx.symbol, 'THYAO'); assert.equal(h.market.calls.multi.length, 1);
  await h.call('bp:ask', { symbol: 'THYAO', question: 'x', history: 'bozuk' }); assert.deepEqual(h.analyst.calls.ask[1].h, []);
});

// --- alarmlar ve portfoy -------------------------------------------------------------------------
test('bp:alarm: ekle/sil/temizle/yeniden kur, dogrulama, tekrar engeli, kalicilik', async (t) => {
  const h = harness(t);
  h.ui.open();
  const a = await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'thyao', kind: 'above', price: '160,5', note: '  kırılım  ' } });
  assert.equal(a.ok, true); assert.equal(a.alarms.length, 1);
  const x = a.alarms[0];
  assert.match(x.id, /^[a-f0-9]{16}$/);
  assert.deepEqual({ ...x, id: 0 }, { id: 0, symbol: 'THYAO', kind: 'above', price: 160.5, note: 'kırılım', created: T0, fired: null, last: null, text: null });
  assert.deepEqual(h.conf().alarms, a.alarms);
  const bad = async (al, re) => { const r = await h.call('bp:alarm', { op: 'add', alarm: al }); assert.equal(r.ok, false); assert.match(r.error, re); assert.equal(r.alarms.length, h.conf().alarms.length); };
  await bad({ symbol: 'THYAO', kind: 'above', price: 'abc' }, /geçerli bir fiyat/);
  await bad({ symbol: 'THYAO', kind: 'below', price: -1 }, /geçerli bir fiyat/);
  await bad({ symbol: 'THYAO', kind: 'cross', price: 5 }, /türü geçersiz/);
  await bad({ symbol: '', kind: 'above', price: 5 }, /hisse kodu/);
  await bad(null, /hisse kodu/);
  const dup = await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'THYAO', kind: 'above', price: 160.5 } });
  assert.equal(dup.dup, true); assert.equal(dup.alarms.length, 1);
  const v = await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'GARAN', kind: 'verdict', price: 99 } });
  assert.equal(v.alarms[1].price, null); assert.equal(v.alarms[1].last, null);
  // taze fiyat biliniyorsa baslangic olur
  await h.call('bp:quotes', ['AKBNK']);
  const k = await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'AKBNK', kind: 'below', price: 90 } });
  assert.equal(k.alarms[2].last, 100);
  // remove / reset / clear
  assert.equal((await h.call('bp:alarm', { op: 'remove', id: 'nope' })).ok, false);
  assert.equal((await h.call('bp:alarm', { op: 'remove', id: k.alarms[2].id })).alarms.length, 2);
  h.store.c.borsaPro.alarms[0] = { ...h.store.c.borsaPro.alarms[0], fired: T0, text: 'tetik', last: 161 };
  assert.equal((await h.call('bp:alarm', { op: 'reset', id: 'deadbeefdeadbeef' })).ok, false);
  let r = await h.call('bp:alarm', { op: 'reset', id: x.id });
  assert.deepEqual([r.alarms[0].fired, r.alarms[0].text, r.alarms[0].last], [null, null, null]);
  h.store.c.borsaPro.alarms[0] = { ...h.store.c.borsaPro.alarms[0], fired: T0 };
  r = await h.call('bp:alarm', { op: 'clear' });
  assert.deepEqual(r.alarms.map(z => z.symbol), ['GARAN'], 'yalniz tetiklenmis fiyat alarmlari silinir');
  r = await h.call('bp:alarm', { op: 'clear', all: true }); assert.deepEqual(r.alarms, []);
  assert.deepEqual(await h.call('bp:alarm', {}), { ok: true, alarms: [] });
  // en fazla 100
  h.store.c.borsaPro.alarms = Array.from({ length: 100 }, (_, i) => ({ id: (1e15 + i).toString(16).padStart(16, '0'), symbol: 'THYAO', kind: 'above', price: 1000 + i }));
  const full = await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'THYAO', kind: 'below', price: 1 } });
  assert.equal(full.ok, false); assert.match(full.error, /En fazla 100/);
});

test('bp:portfolio: ekle/guncelle/sil, dogrulama, ozet fiyatlari, fiyat yoksa da calisir', async (t) => {
  const h = harness(t);
  h.ui.open();
  h.data.prices = { THYAO: 120 };
  const r = await h.call('bp:portfolio', { op: 'add', pos: { symbol: 'thyao', qty: '100', cost: '100,5', stop: 90, date: '2026-10-01', note: ' uzun vade ', id: 'ffffffffffffffff' } });
  assert.equal(r.ok, true); assert.equal(r.positions.length, 1);
  const p = r.positions[0];
  assert.notEqual(p.id, 'ffffffffffffffff', 'kimlik istemciden alinmaz'); assert.match(p.id, /^[a-f0-9]{16}$/);
  assert.deepEqual({ ...p, id: 0 }, { id: 0, symbol: 'THYAO', qty: 100, cost: 100.5, date: '2026-10-01', note: 'uzun vade', stop: 90, target: null });
  assert.deepEqual(h.data.calls.quotes.at(-1), { list: ['THYAO'], opt: { market: 'BIST', spark: false } });
  assert.deepEqual([r.summary.value, r.summary.cost, r.summary.pnl, r.summary.positions[0].riskTL], [12000, 10050, 1950, 3000]);
  const bad = async (pos, re) => { const x = await h.call('bp:portfolio', { op: 'add', pos }); assert.equal(x.ok, false); assert.match(x.error, re); };
  await bad({ symbol: 'THYAO', qty: 0, cost: 1 }, /Adet/); await bad({ symbol: 'THYAO', qty: 1, cost: 'x' }, /Maliyet/);
  await bad({ symbol: '??', qty: 1, cost: 1 }, /hisse kodu/); await bad({ symbol: 'THYAO', qty: 1, cost: 1, date: '2026-02-31' }, /Tarih/);
  await bad({ symbol: 'THYAO', qty: 1, cost: 1, date: '19.10.2026' }, /Tarih/); await bad({ symbol: 'THYAO', qty: 1, cost: 1, stop: -3 }, /Stop/);
  await bad({ symbol: 'THYAO', qty: 1, cost: 1, target: 'abc' }, /Hedef/); await bad(null, /hisse kodu/);
  let u = await h.call('bp:portfolio', { op: 'update', pos: { id: p.id, qty: 200, stop: null, symbol: 'garan', evil: 1 } });
  assert.deepEqual({ ...u.positions[0], id: 0 }, { id: 0, symbol: 'GARAN', qty: 200, cost: 100.5, date: '2026-10-01', note: 'uzun vade', stop: null, target: null });
  assert.equal(u.positions[0].id, p.id);
  assert.equal((await h.call('bp:portfolio', { op: 'update', pos: { id: p.id, qty: -1 } })).ok, false);
  assert.equal(h.conf().positions[0].qty, 200, 'gecersiz guncelleme kaydedilmez');
  assert.deepEqual(await h.call('bp:portfolio', { op: 'update', pos: { id: 'abcdabcdabcdabcd', qty: 1 } }), { ok: false, error: 'Pozisyon bulunamadı.' });
  assert.deepEqual(await h.call('bp:portfolio', { op: 'fly' }), { ok: false, error: 'Geçersiz işlem.' });
  h.data.quotesErr = 'Bağlantı yok.';
  const g = await h.call('bp:portfolio', {});
  assert.equal(g.ok, true); assert.equal(g.summary.positions.length, 1);
  u = await h.call('bp:portfolio', { op: 'remove', pos: { id: p.id } });
  assert.deepEqual(u.positions, []); assert.deepEqual(h.conf().positions, []);
  assert.deepEqual(await h.call('bp:portfolio', { op: 'remove', id: p.id }), { ok: false, error: 'Pozisyon bulunamadı.' });
});

test('bp:capital, bp:prefs (yalniz bilinen anahtarlar), bp:open (yalniz https)', async (t) => {
  const h = harness(t);
  h.ui.open();
  assert.deepEqual(await h.call('bp:capital', 250000), { ok: true, capital: 250000 }); assert.equal(h.conf().capital, 250000);
  assert.deepEqual(await h.call('bp:capital'), { ok: true, capital: 250000 });
  assert.deepEqual(await h.call('bp:capital', -1), { ok: false, error: 'Sermaye pozitif bir sayı olmalı.' });
  assert.deepEqual(await h.call('bp:capital', 'abc'), { ok: false, error: 'Sermaye pozitif bir sayı olmalı.' });
  assert.equal(h.conf().capital, 250000);
  assert.deepEqual(await h.call('bp:capital', null), { ok: true, capital: null }); assert.equal(h.conf().capital, null);

  const p = await h.call('bp:prefs', { show: { ema: false, rsi: true, vwap: 'auto', bad: 'x', 'k y': true }, tab: 'lab', universe: 'BIST50', provider: 'claude',
    tf: '1h', market: 'US', chartType: 'line', evil: '<script>' });
  assert.deepEqual(p, { show: { ema: false, rsi: true, vwap: 'auto' }, tab: 'lab', universe: 'BIST50', provider: 'claude', tf: '1h', market: 'US', chartType: 'line' });
  const p2 = await h.call('bp:prefs', { tab: '<img>', show: { macd: false }, provider: 'openai' });
  assert.deepEqual(p2, { ...p, show: { ema: false, rsi: true, vwap: 'auto', macd: false } }, 'gecersiz deger kayitliyi silmez; show birlesir');
  assert.deepEqual(h.conf().prefs, p2);
  assert.deepEqual(await h.call('bp:prefs', 'x'), p2);
  assert.equal(h.conf().tf, '1g', 'prefs.tf ust duzey tf\'yi degistirmez');

  assert.deepEqual(await h.call('bp:open', { url: 'https://www.kap.org.tr/tr/x' }), { ok: true });
  assert.deepEqual(await h.call('bp:open', 'https://example.com/a b'), { ok: true });
  for (const u of ['http://x.com', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:pw@x.com', 'nota url', 5, null, 'https://' + 'a'.repeat(3000)]) {
    const r = await h.call('bp:open', { url: u }); assert.equal(r.ok, false, String(u));
  }
  assert.deepEqual(h.opened, ['https://www.kap.org.tr/tr/x', 'https://example.com/a%20b']);
});

// --- izleyici -------------------------------------------------------------------------------------
test('izleyici: is yokken zamanlayici yok; pencere -> durum zamanlayicisi; alarm + seans -> 60 sn, pilde 180 sn; kilitte durur', async (t) => {
  const h = harness(t);
  h.ui.enable(); assert.equal(h.timers.pending, 0, 'alarm ve pencere yok');
  h.ui.open(); assert.equal(h.timers.pending, 1); assert.equal(h.timers.ms, 106 * 60000 + 1000, 'yalniz seans durumu degisiminde uyan');
  await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'THYAO', kind: 'above', price: 160 } });
  assert.equal(h.timers.pending, 1); assert.equal(h.timers.ms, 2000, 'ilk tur hemen');
  await h.timers.fire();
  assert.deepEqual(h.market.calls.quote, ['THYAO']); assert.equal(h.timers.ms, 60000);
  h.power.set({ battery: true }); assert.equal(h.timers.pending, 1); assert.equal(h.timers.ms, 180000, 'pilde 3 dk');
  h.power.set({ locked: true }); assert.equal(h.timers.pending, 0, 'ekran kilitli: durur');
  h.power.set({ locked: false }); assert.equal(h.timers.pending, 1);
  h.power.set({ asleep: true }); assert.equal(h.timers.pending, 0, 'uykuda durur');
  h.power.set({ asleep: false, battery: false });
  h.win.close(); assert.equal(h.timers.pending, 1, 'pencere kapali, bekleyen alarm var');
  h.ui.disable(); assert.equal(h.timers.pending, 0);
  h.ui.enable(); assert.equal(h.timers.pending, 1);
  h.on = false; h.ui.enable(); h.ui.disable(); h.on = true;
  h.ui.enable(); h.ui.open();
  const id = h.conf().alarms[0].id;
  await h.call('bp:alarm', { op: 'remove', id });
  assert.equal(h.timers.ms, 106 * 60000 + 1000, 'alarm silinince yalniz durum');
  h.win.close(); assert.equal(h.timers.pending, 0, 'hicbir is yok: zamanlayici yok');
  h.quit();
});

test('fiyat alarmi: ilk okumada otesindeyse tetik yok; esik gecisi tetikler (bildirim + olay + ses), tek sefer; bayat fiyat yok sayilir', async (t) => {
  const h = harness(t);
  h.ui.enable(); h.ui.open();
  for (const al of [{ kind: 'above', price: 160 }, { kind: 'below', price: 140 }, { kind: 'above', price: 145, note: 'zaten üstünde' }])
    await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'THYAO', ...al } });
  const tick = async (price, dt = 60000) => { h.market.price = price; h.clock.t += dt; await h.timers.fire(); };
  await h.timers.fire();                                                   // ilk okuma 150
  assert.deepEqual(h.market.calls.quote, ['THYAO'], 'ayni hisse tek istek');
  assert.deepEqual(h.conf().alarms.map(a => a.last), [150, 150, 150]); assert.equal(h.notes.length, 0, '145 ustu zaten otede: tetik yok');
  const saves = h.store.saves;
  await tick(151); assert.equal(h.store.saves, saves, 'ayni tarafta kalan fiyat diske yazilmaz');
  assert.equal((await h.call('bp:state')).alarms[0].last, 151, 'gorunumde son fiyat');
  await tick(161);
  assert.equal(h.notes.length, 1);
  assert.deepEqual(h.notes[0], { title: 'Borsa Pro · THYAO', body: 'THYAO 160,00 seviyesinin üstüne çıktı (son 161,00)' });
  const ev = h.evts('alarm'); assert.equal(ev.length, 1);
  assert.equal(ev[0].price, 161); assert.equal(ev[0].text, h.notes[0].body); assert.equal(ev[0].alarm.fired, h.clock.t); assert.equal(ev[0].alarm.kind, 'above');
  assert.deepEqual(h.said, [h.notes[0].body]);
  const st = h.conf().alarms; assert.equal(st[0].fired, h.clock.t); assert.equal(st[0].text, h.notes[0].body); assert.equal(st[2].fired, null);
  // bildirime tiklayinca pencere hisseyle acilir
  h.Notif.last.on_click(); assert.deepEqual(h.evts('symbol').at(-1), { type: 'symbol', symbol: 'THYAO' });
  await tick(170); await tick(158); await tick(165);
  assert.equal(h.notes.length, 1, 'tetiklenen alarm tek seferlik');
  h.market.stale = true; await tick(130); assert.equal(h.notes.length, 1, 'bayat fiyatta tetik yok');
  h.market.stale = false; h.market.quoteErr = 'Bağlantı yok.'; await tick(130); assert.equal(h.notes.length, 1);
  h.market.quoteErr = null; await tick(139);
  assert.equal(h.notes.length, 2); assert.equal(h.notes[1].body, 'THYAO 140,00 seviyesinin altına indi (son 139,00)');
  assert.equal(h.conf().alarms[2].fired, null, '145 ustu alarm hala bekliyor (gecis olmadi)');
  await tick(146); assert.equal(h.notes.length, 3); assert.match(h.notes[2].body, /145,00 seviyesinin üstüne çıktı \(son 146,00\) · zaten üstünde$/);
  // hepsi tetiklendi: pencere kapaninca is kalmaz
  h.win.close(); assert.equal(h.timers.pending, 0);
});

test('fiyat alarmi: yeniden acilista kayitli taraf korunur (kapaliyken olan gecis yakalanir); tur sirasinda silinen alarm tetiklenmez', async (t) => {
  const conf = { alarms: [{ id: 'aaaaaaaaaaaaaaaa', symbol: 'THYAO', kind: 'above', price: 160, created: 1, last: 150 }] };
  const h = harness(t, { conf, mk: { price: 165 } });
  h.ready(); assert.equal(h.power.inited, 1);
  assert.equal(h.timers.pending, 1, 'hazir olunca bekleyen alarm icin izleyici');
  await h.timers.fire();
  assert.equal(h.notes.length, 1, 'kapaliyken olan gecis'); assert.match(h.notes[0].body, /üstüne çıktı \(son 165,00\)/);

  const h2 = harness(t, { conf: { alarms: [{ id: 'bbbbbbbbbbbbbbbb', symbol: 'THYAO', kind: 'above', price: 160, created: 1, last: 150 }] }, mk: { price: 165 } });
  h2.ui.enable(); h2.ui.open();
  const g = deferred(); h2.market.quoteGate = g.p;
  const p = h2.timers.fire(); await flush();
  await h2.call('bp:alarm', { op: 'remove', id: 'bbbbbbbbbbbbbbbb' });
  g.ok(); await p;
  assert.equal(h2.notes.length, 0); assert.deepEqual(h2.conf().alarms, [], 'silinen alarm geri gelmez');
  // ayni anda ikinci tur baslamaz
  h2.market.quoteGate = null;
});

test('alarm baslangic fiyati yalniz taze kaynaktan (market.quote); tarama/mum fiyati ve 3 dk\'dan eski fiyat kullanilmaz', async (t) => {
  const h = harness(t);
  h.ui.open();
  const add = async (sym, price) => (await h.call('bp:alarm', { op: 'add', alarm: { symbol: sym, kind: 'above', price } })).alarms.at(-1).last;
  await h.call('bp:scan', { universe: 'BIST30' });
  assert.equal(await add(U.BIST30[0], 5), null, 'tarama fiyati (gunluk mum) baslangic olmaz');
  h.market.quote = async () => { throw new Error('fiyat yok'); };
  await h.call('bp:load', { symbol: 'GARAN' });
  assert.equal(await add('GARAN', 999), null, 'taze fiyat yoksa mum fiyati baslangic olmaz');
  h.market.quote = fakeMarket().quote.bind(h.market);
  await h.call('bp:load', { symbol: 'THYAO' });
  assert.equal(await add('THYAO', 999), 150, 'bp:load taze fiyati');
  h.clock.t += 3 * 60000 + 1;
  assert.equal(await add('THYAO', 998), null, '3 dk\'dan eski');
  // calendar.status yoksa isOpen
  const h2 = harness(t); delete h2.calendar.status; h2.calendar.open = false; h2.ui.open();
  assert.deepEqual((await h2.call('bp:state')).marketStatus, { open: false, reason: null });
});

test('izleyici: seans kapaliyken fiyat sorulmaz, acilista tur baslar; pencereye durum olayi', async (t) => {
  const h = harness(t, { open: false });
  h.ui.enable(); h.ui.open();
  const s = await h.call('bp:state'); assert.deepEqual(s.marketStatus, { open: false, reason: 'seans 18:15\'te kapandı' });
  await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'THYAO', kind: 'below', price: 100 } });
  assert.equal(h.timers.ms, 106 * 60000 + 1000);
  assert.match(h.ui.status(), /^1 alarm izleniyor · seans kapalı$/);
  await h.timers.fire(); assert.deepEqual(h.market.calls.quote, [], 'seans kapali: fiyat yok'); assert.equal(h.evts('status').length, 0, 'durum degismedi');
  h.calendar.open = true; h.calendar.reason = null; h.clock.t += 106 * 60000;
  await h.timers.fire();
  assert.deepEqual(h.evts('status'), [{ type: 'status', marketStatus: { open: true, reason: null } }]);
  assert.equal(h.timers.ms, 2000, 'seans acildi: tur');
  await h.timers.fire(); assert.deepEqual(h.market.calls.quote, ['THYAO']);
  assert.equal(h.ui.status(), '1 alarm izleniyor');
  // tur icinde seans kapanirsa sonraki uyanis durum anina
  h.calendar.open = false; h.calendar.reason = 'seans 18:15\'te kapandı';
  await h.timers.fire(); assert.equal(h.market.calls.quote.length, 1);
  assert.equal(h.evts('status').length, 2); assert.notEqual(h.timers.ms, 60000);
});

test('karar alarmi: en fazla 15 dk\'da bir, yeni etiket iki kontrolde teyit edilince tetik; tekrar eden alarm', async (t) => {
  const v = { label: 'BEKLE', score: 5 }, seen = [];
  const eng = { ...engine, proAnalyze: (fr, o) => { seen.push({ tfs: Object.keys(fr).sort(), o }); return { ok: true, last: 150, verdict: { label: v.label, score: v.score, dir: 0, confidence: 50, components: [], reasons: [] } }; } };
  const h = harness(t, { engine: eng });
  h.ui.enable(); h.ui.open();
  await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'GARAN', kind: 'verdict', note: 'izle' } });
  const tick = async (dt) => { h.clock.t += dt; await h.timers.fire(); };
  await h.timers.fire();
  assert.deepEqual(h.market.calls.multi.at(-1), { sym: 'GARAN', tf: '1g', market: 'BIST', extra: ['1h'] });
  assert.deepEqual(seen[0].tfs, ['1g', '1h']); assert.equal(seen[0].o.primary, '1g');
  assert.equal(h.conf().alarms[0].last, 'BEKLE', 'ilk kontrol: baslangic'); assert.equal(h.notes.length, 0);
  v.label = 'AL'; v.score = 40;
  await tick(60000); assert.equal(h.market.calls.multi.length, 1, '15 dk dolmadan analiz yok');
  await tick(14 * 60000); assert.equal(h.market.calls.multi.length, 2); assert.equal(h.notes.length, 0, 'ilk gorus: teyit bekler');
  v.label = 'BEKLE';
  await tick(15 * 60000); assert.equal(h.notes.length, 0, 'geri dondu: aday silinir');
  v.label = 'AL';
  await tick(15 * 60000); assert.equal(h.notes.length, 0);
  await tick(15 * 60000);
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].body, 'GARAN günlük kararı BEKLE\'den AL\'a döndü (skor 40) · izle');
  const a = h.conf().alarms[0]; assert.equal(a.last, 'AL'); assert.equal(a.fired, h.clock.t);
  assert.equal(h.evts('alarm')[0].price, 150);
  assert.equal(h.timers.pending, 1, 'karar alarmi izlenmeye devam eder');
  v.label = 'SAT'; v.score = -45;
  await tick(15 * 60000); await tick(15 * 60000);
  assert.equal(h.notes.length, 2); assert.equal(h.notes[1].body, 'GARAN günlük kararı AL\'dan SAT\'a döndü (skor -45) · izle');
  assert.match(h.ui.status(), /^1 alarm izleniyor$/);
});

// --- Neo ve Merkez ----------------------------------------------------------------------------------
test('analyzeSymbol (Neo): ozet bicimi, onbellek, hatalar', async (t) => {
  const h = harness(t);
  const r = await h.ui.analyzeSymbol('thyao');
  assert.deepEqual(Object.keys(r).filter(k => k !== 'tetik').sort(), ['chgPct', 'destek', 'direnc', 'gerekceler', 'guven', 'karar', 'plan', 'price', 'skor', 'symbol', 'trend']);
  assert.equal(r.symbol, 'THYAO'); assert.equal(r.price, 150); assert.ok(['AL', 'SAT', 'BEKLE'].includes(r.karar));
  assert.ok(r.skor >= -100 && r.skor <= 100); assert.ok(r.guven >= 0 && r.guven <= 100); assert.ok(r.gerekceler.length <= 3);
  if (r.plan) { assert.deepEqual(Object.keys(r.plan).sort(), ['giris', 'hedef1', 'hedef2', 'rr', 'stop']); assert.equal(r.plan.giris.length, 2); }
  else assert.ok(r.tetik, 'BEKLE: tetik seviyeleri');
  assert.equal(typeof r.trend, 'string');
  const n = h.market.calls.multi.length;
  assert.deepEqual(await h.ui.analyzeSymbol('THYAO'), r); assert.equal(h.market.calls.multi.length, n, '2 dk onbellek');
  h.clock.t += 121000; await h.ui.analyzeSymbol('THYAO'); assert.equal(h.market.calls.multi.length, n + 1);
  await assert.rejects(h.ui.analyzeSymbol('??'), { message: 'Hisse kodu anlaşılmadı.' });
  await assert.rejects(h.ui.analyzeSymbol(null), { message: 'Hisse kodu anlaşılmadı.' });
  h.market.empty = true; await assert.rejects(h.ui.analyzeSymbol('GARAN'), { message: 'Bağlantı yok.' });
  h.on = false; await assert.rejects(h.ui.analyzeSymbol('THYAO'), { message: 'Borsa özelliği kapalı.' });
  h.on = true; h.market.empty = false;
  const h2 = harness(t, { engine: { ...engine, proAnalyze: () => ({ ok: false, error: 'Yeterli mum yok (10/50).' }) } });
  await assert.rejects(h2.ui.analyzeSymbol('THYAO'), { message: 'Yeterli mum yok (10/50).' });
});

test('status ve disable: pencere, alarm, tarama; kapatinca her sey durur', async (t) => {
  const h = harness(t);
  assert.equal(h.ui.status(), null);
  h.ui.enable(); h.ui.open(); assert.equal(h.ui.status(), 'Borsa Pro açık');
  await h.call('bp:alarm', { op: 'add', alarm: { symbol: 'THYAO', kind: 'above', price: 999 } });
  assert.equal(h.ui.status(), '1 alarm izleniyor');
  await h.call('bp:load', { symbol: 'THYAO' }); await h.call('bp:overview');
  const g = deferred(); h.data.gate = g.p;
  const p = h.call('bp:scan', { universe: 'BIST30' }); await flush();
  h.ui.disable();
  assert.equal(h.win.destroyed, true); assert.equal(h.timers.pending, 0);
  g.ok(); assert.equal((await p).cancelled, true);
  assert.equal(h.ui.status(), '1 alarm izleniyor', 'alarmlar silinmez, yalniz izleme durur');
  assert.deepEqual(await h.handlers['bp:state']({ sender: h.win.webContents }), { ok: false, error: 'İzin yok' });
  // tekrar acilinca overview onbellegi bosalmis olmali
  h.ui.enable(); h.ui.open(); await h.call('bp:overview'); assert.equal(h.data.calls.overview, 2);
});

// --- preload ----------------------------------------------------------------------------------------
test('preload: yalniz bp: kanallari, ana surecle ayni kanal kumesi; on yalniz bp:evt, abonelik birakilir', async (t) => {
  const ePath = require.resolve('electron'), saved = require.cache[ePath], pPath = require.resolve('../borsa-pro-preload.js');
  const invokes = [], listeners = {}; let exposed = null;
  require.cache[ePath] = { id: ePath, filename: ePath, loaded: true, exports: {
    contextBridge: { exposeInMainWorld: (k, v) => { exposed = { k, v }; } },
    ipcRenderer: { invoke: (ch, a) => { invokes.push([ch, a]); return Promise.resolve('ok'); },
      on: (ch, f) => { (listeners[ch] = listeners[ch] || []).push(f); }, removeListener: (ch, f) => { listeners[ch] = (listeners[ch] || []).filter(x => x !== f); } } } };
  t.after(() => { if (saved) require.cache[ePath] = saved; else delete require.cache[ePath]; delete require.cache[pPath]; });
  delete require.cache[pPath]; require(pPath);
  assert.equal(exposed.k, 'bp');
  const api = exposed.v;
  assert.deepEqual(Object.keys(api).sort(), ['ai', 'alarm', 'ask', 'capital', 'demo', 'depth', 'feeds', 'lab', 'load', 'okul', 'on', 'open', 'overview', 'plan', 'planApply', 'portfolio', 'prefs', 'quotes', 'report', 'scan', 'scanCancel', 'search', 'state', 'watch']);
  for (const k of Object.keys(api)) if (k !== 'on') assert.equal(await api[k]({ a: 1 }), 'ok');
  const chans = [...new Set(invokes.map(x => x[0]))].sort();
  assert.deepEqual(chans, CHANNELS, 'ana surecin kaydettigi kanallarla birebir');
  assert.deepEqual(invokes.find(x => x[0] === 'bp:state'), ['bp:state', undefined], 'state arguman tasimaz');
  assert.deepEqual(invokes.find(x => x[0] === 'bp:load'), ['bp:load', { a: 1 }]);
  await api.open('https://x.com'); assert.deepEqual(invokes.at(-1), ['bp:open', { url: 'https://x.com' }]);
  await api.capital(null); assert.deepEqual(invokes.at(-1), ['bp:capital', null]);
  const got = []; const off = api.on(d => got.push(d));
  assert.deepEqual(Object.keys(listeners), ['bp:evt']);
  listeners['bp:evt'][0]({ sender: 1 }, { type: 'scan', done: 1 }); assert.deepEqual(got, [{ type: 'scan', done: 1 }]);
  const bad = api.on(() => { throw new Error('arayuz hatasi'); });
  const ce = console.error; console.error = () => {}; try { for (const f of listeners['bp:evt']) f({}, { type: 'x' }); } finally { console.error = ce; }
  assert.equal(got.length, 2, 'bir dinleyicinin hatasi digerini bozmaz');
  off(); bad(); assert.equal(listeners['bp:evt'].length, 0);
  assert.equal(typeof api.on('nope'), 'function');
  // gercek ana surec kayitlariyla capraz kontrol
  const h = harness(t); assert.deepEqual(Object.keys(h.handlers).sort(), chans);
});

// --- olasilik motoru, uzun gecmis, temel veri -------------------------------------------------
test('bp:load: olasilik motoru uzun gecmisle (son donem taze gunluk mumlar), dilim tablolari, temel veri, rapor, Neo ozeti', async (t) => {
  const Q = require('../bp-quant.js');
  const daily = synth(400, { drift: 0.001, wave: 0.006, period: 80 });
  // Uzun gecmis: gunluk serinin baslangicindan once 1600 mum + ayni donemde farkli (bayat) degerler; son donem gunlukten alinmali
  const old = synth(1600, { drift: 0.0005, wave: 0.006, period: 80, t0: daily[0].t - 1600 * 86400000, seed: 9 });
  const stale = daily.map(r => ({ ...r, c: r.c * 0.5, o: r.o * 0.5, h: r.h * 0.5, l: r.l * 0.5 }));
  const histCalls = [];
  const history = { get: async y => { histCalls.push(y); return [...old, ...stale]; } };
  let fundArgs = null;
  const fund = { scoreFundamentals: (f, o) => { fundArgs = { f, o }; return { ok: true, valuation: { label: 'Ucuz', score: 0.5 }, lines: ['F/K düşük'] }; } };
  const seen = [];
  const quant = { ...Q, analyze: a => { seen.push(a); return Q.analyze(a); } };
  const h = harness(t, { mk: { daily, price: daily.at(-1).c }, quant, history, fund });
  h.market.fundamentals = async (y, m) => ({ symbol: y, pe: 5.1, pb: 1.2, sector: 'Ulaştırma' });
  h.ui.open();
  const r = await h.call('bp:load', { symbol: 'THYAO', tf: '1g' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(histCalls, ['THYAO.IS']);
  const H = seen[0].hist;
  assert.equal(H.length, 2000, 'eski 1600 + gunluk 400');
  assert.equal(H.at(-1).c, daily.at(-1).c, 'son donem taze gunluk mumlardan (bayat gecmis degil)');
  assert.ok(H.slice(0, 1600).every((x, i) => x.t === old[i].t));
  assert.ok(r.quant && r.quant.rating && ['Sat', 'Azalt', 'Tut', 'Al', 'Güçlü Al'].includes(r.quant.rating.label));
  assert.ok(r.quant.score && r.quant.ranges && r.quant.tech);
  assert.ok(r.techFrames && r.techFrames['1g'] && r.techFrames['1h'], 'her dilim icin teknik ozet');
  assert.ok(['Güçlü Al', 'Al', 'Nötr', 'Sat', 'Güçlü Sat'].includes(r.techFrames['1g'].overall.label));
  assert.deepEqual(r.fund.raw.pe, 5.1); assert.equal(r.fund.score.valuation.label, 'Ucuz'); assert.equal(fundArgs.o.last, r.quote.price);
  assert.ok(r.report && r.report.text.includes('THYAO') && !/NaN|undefined/.test(r.report.text));
  // Neo ozeti analist notu ve plan olasiligini da tasir
  const an = await h.ui.analyzeSymbol('THYAO');
  assert.equal(an.analistNotu, r.quant.rating.label);
  if (r.quant.rating.target) assert.equal(an.birAyHedef.potansiyelYuzde, r.quant.rating.target.upside);
  // Yapay zeka baglami quant ve temel veriyi icerir
  await h.call('bp:ai', { symbol: 'THYAO', tf: '1g' });
  const ctx = h.analyst.calls.brief.at(-1).ctx;
  assert.equal(ctx.quant.rating.label, r.quant.rating.label); assert.equal(ctx.fund.valuation.label, 'Ucuz'); assert.equal(ctx.fund.raw.pe, 5.1);
});

test('bp:load: gecmis ya da temel veri alinamazsa analiz yine doner; quant hatasi yutulur', async (t) => {
  const Q = require('../bp-quant.js');
  const history = { get: async () => { throw new Error('Bağlantı yok.'); } };
  const quant = { ...Q, analyze: () => { throw new Error('patladi'); } };
  const h = harness(t, { quant, history });
  h.market.fundamentals = async () => { throw new Error('Temel veri alınamadı'); };
  h.ui.open();
  const r = await h.call('bp:load', { symbol: 'THYAO' });
  assert.equal(r.ok, true); assert.equal(r.quant, null); assert.equal(r.fund, null); assert.equal(r.pro.ok, true);
  assert.ok(r.techFrames && r.techFrames['1g'], 'teknik tablo ayri hesaplanir');
});

test('bp:report: analist modulu report destekliyorsa onbellekli, desteklemiyorsa anlasilir hata', async (t) => {
  const a = fakeAnalyst(['groq']); let n = 0;
  a.report = async (ctx, o) => { n++; return { ok: true, provider: o.provider, model: 'm', data: { not: 'Al', ozet: 'x' } }; };
  const h = harness(t, { analyst: a });
  h.ui.open();
  await h.call('bp:load', { symbol: 'THYAO' });
  const r1 = await h.call('bp:report', { symbol: 'THYAO' }), r2 = await h.call('bp:report', { symbol: 'THYAO' });
  assert.equal(r1.ok, true); assert.equal(r1.data.not, 'Al'); assert.equal(r2.cached, true); assert.equal(n, 1);
  await h.call('bp:report', { symbol: 'THYAO', force: true }); assert.equal(n, 2);
  const h2 = harness(t);
  h2.ui.open();
  assert.deepEqual(await h2.call('bp:report', { symbol: 'THYAO' }), { ok: false, error: 'Yapay zekâ raporu bu sürümde yok.' });
});

// --- Telegram derinligi (Borsa Pro) --------------------------------------------------------------
test('bp:depth: getir / canli takip / durum / terminal / kurulum; hata ve Telegram yokken anlasilir sonuc; yeni derinlik olayi', async (t) => {
  const h = harness(t);
  const calls = []; let info = { connected: true, bot: '@bot', auto: 0, symbol: null, source: 'telegram', safe: { hour: 1, day: 2 } };
  Object.assign(h.deps.ext, {
    fetchDepth: async s => { calls.push(['fetch', s]); if (s === 'GARAN') return { ok: false, error: 'Çok sık istek: biraz bekle', wait: true };
      h.depthBox.d = { symbol: s, at: T0, last: 151, pressure: { score: 30 }, bids: [{ price: 151, qty: 5 }], asks: [], buyers: [], sellers: [],
        tape: { enough: true, score: 40, dir: 1, why: ['Son 5 dk aktif alış %70'], w5: { buy: 7, sell: 3, delta: 0.4, vwap: 150.9 }, cvd: [{ m: 1, v: 3 }, { m: 2, v: 5 }] },
        trades: [{ time: '10:01:02', price: 151, qty: 100, side: 'buy', buyer: 'BIYKR', seller: 'GRM' }] }; return { ok: true, symbol: s }; },
    depthAuto: (sec, s) => { calls.push(['auto', sec, s]); info = { ...info, auto: sec, symbol: s }; return info; },
    depthInfo: () => info, openTerminal: async () => { calls.push(['term']); return { ok: true }; }, setupTg: () => { calls.push(['setup']); } });
  h.ui.open();
  const r = await h.call('bp:depth', { op: 'fetch', symbol: 'thyao' });
  assert.equal(r.ok, true); assert.deepEqual(calls[0], ['fetch', 'THYAO']); assert.equal(r.depth.pressure, 30); assert.equal(r.tg.bot, '@bot');
  assert.equal(r.depth.tape.w5.delta, 0.4); assert.deepEqual(r.depth.tape.cvd, [3, 5]); assert.equal(r.depth.trades[0].side, 'buy');
  const w = await h.call('bp:depth', { op: 'fetch', symbol: 'GARAN' });
  assert.equal(w.ok, false); assert.equal(w.wait, true); assert.match(w.error, /sık istek/);
  assert.deepEqual(await h.call('bp:depth', { op: 'fetch', symbol: 'x!' }), { ok: false, error: 'Geçerli bir hisse kodu yaz (ör. THYAO).' });
  const a = await h.call('bp:depth', { op: 'auto', sec: 30, symbol: 'THYAO' });
  assert.equal(a.ok, true); assert.deepEqual(calls.at(-1), ['auto', 30, 'THYAO']); assert.equal(a.tg.auto, 30);
  await h.call('bp:depth', { op: 'auto', sec: 999, symbol: 'THYAO' }); assert.deepEqual(calls.at(-1), ['auto', 0, 'THYAO'], 'gecersiz aralik kapatir');
  assert.equal((await h.call('bp:depth', { op: 'terminal' })).ok, true); await h.call('bp:depth', { op: 'setup' });
  assert.deepEqual(calls.slice(-2), [['term'], ['setup']]);
  const st = await h.call('bp:depth', { symbol: 'THYAO' });
  assert.equal(st.ok, true); assert.equal(st.depth.last, 151);
  // Telegram bagli degil
  info = { ...info, connected: false };
  h.deps.ext.fetchDepth = async () => ({ ok: false, error: 'Telegram bağlı değil. Ayarlar › Telegram derinlik botu bölümünden bağlan.', needTg: true });
  const n = await h.call('bp:depth', { op: 'fetch', symbol: 'THYAO' });
  assert.equal(n.ok, false); assert.equal(n.needTg, true);
  // yeni derinlik olayi pencereye gider
  h.ui.onDepth('THYAO');
  const ev = h.evts('depth').at(-1); assert.equal(ev.symbol, 'THYAO'); assert.equal(ev.depth.last, 151);
});

// --- sermaye planlayici ve Hisse Radar ------------------------------------------------------------
test('bp:plan: adaylar son taramanin AL hisselerinden, tam analizle planlayiciya; ilerleme olayi; dogrulama; portfoye ve alarma ekleme', async (t) => {
  const Q = require('../bp-quant.js'); let got = null;
  const planner = { plan: o => { got = o; return { ok: true, picks: o.candidates.slice(0, 2).map(c => ({ symbol: c.symbol, lots: 10, ref: c.price, entry: c.price, stop: +(c.price * 0.95).toFixed(2), t1: +(c.price * 1.08).toFixed(2) })),
    totals: { invested: 1000 }, rejected: [{ symbol: 'X', why: 'likidite' }], notes: [] }; } };
  const radar = { forSymbol: async s => ({ symbol: s, consensus: { karar: 'AL', skor: 0.4, guven: 60 }, models: [] }) };
  const h = harness(t, { planner, radar, quant: Q, meta: { U, PRESETS, TAGS: {}, sectorOf: s => s === 'AAAA' ? 'Bankacılık' : 'Diğer' } });
  h.ui.open();
  // tarama yokken izleme listesinden
  const r0 = await h.call('bp:plan', { capital: 10000, risk: 'dengeli', horizon: '1h', maxPos: 2 });
  assert.equal(r0.ok, true, r0.error); assert.equal(r0.source, 'izleme'); assert.equal(got.capital, 10000); assert.equal(got.risk, 'dengeli'); assert.equal(got.maxPos, 2);
  assert.ok(got.candidates.length >= 2); const c0 = got.candidates[0];
  assert.ok(c0.plan && c0.verdict && 'odds' in c0 && c0.ranges && 'h5' in c0.ranges); assert.equal(c0.radar.karar, 'AL');
  assert.ok(h.evts('plan').length >= 2, 'ilerleme olayi'); assert.deepEqual(r0.rejected[0], { symbol: 'X', why: 'likidite' });
  // gecersiz girdiler
  assert.match((await h.call('bp:plan', { capital: 100 })).error, /en az 500/);
  assert.match((await h.call('bp:plan', { capital: 'abc' })).error, /en az 500/);
  // portfoye ekle + alarmlar
  const ap = await h.call('bp:planApply', { picks: r0.picks, alarms: true });
  assert.equal(ap.ok, true); assert.equal(ap.added, 2); assert.equal(h.conf().positions.length, 2); assert.equal(h.conf().positions[0].note, 'Sermaye planı');
  assert.equal(h.conf().alarms.length, 4, 'her secim icin stop ve hedef alarmi');
  // planlayici yoksa
  const h2 = harness(t); h2.ui.open();
  assert.deepEqual(await h2.call('bp:plan', { capital: 10000 }), { ok: false, error: 'Sermaye planlayıcı bu sürümde yok.' });
});

test('bp:load: Hisse Radar konsensusu sonuca, yapay zeka baglamina ve olasilik motoruna gider; radar hatasi analizi bozmaz', async (t) => {
  const Q = require('../bp-quant.js'); const seen = [];
  const quant = { ...Q, analyze: a => { seen.push(a); return Q.analyze(a); } };
  const radar = { forSymbol: async s => s === 'GARAN' ? Promise.reject(new Error('ag yok')) : { symbol: s, consensus: { karar: 'SAT', skor: -0.5, guven: 70 }, models: [{ id: 'groq', karar: 'SAT' }] } };
  const h = harness(t, { quant, radar }); h.ui.open();
  const r = await h.call('bp:load', { symbol: 'THYAO' });
  assert.equal(r.radar.consensus.karar, 'SAT'); assert.equal(seen.at(-1).radar.karar, 'SAT');
  await h.call('bp:ai', { symbol: 'THYAO' }); assert.equal(h.analyst.calls.brief.at(-1).ctx.radar.consensus.karar, 'SAT');
  const g = await h.call('bp:load', { symbol: 'GARAN' });
  assert.equal(g.ok, true); assert.equal(g.radar, null);
  const us = await h.call('bp:load', { symbol: 'AAPL', market: 'US' }); assert.equal(us.radar, null, 'ABD hissesinde radar yok');
});

test('bp:feeds: durum, anahtar kaydi + dogrulama, piyasa (doviz/kripto/radar), hisse haberi; anahtar pencereye gitmez', async (t) => {
  const keys = {}, tests = [], newsQ = [];
  const apis = {
    status: () => ({ news: { configured: !!keys.news, left: 88, lastError: null, lastOk: null }, fx: { configured: !!keys.fx, left: 1400 }, gecko: { configured: !!keys.gecko } }),
    test: async p => { tests.push(p); return p === 'fx' ? { ok: false, msg: 'Anahtar geçersiz.' } : { ok: true, msg: 'Çalışıyor.' }; },
    fx: async b => ({ ok: true, base: b, rates: { TRY: 41.9, EUR: 0.86 }, time: 1 }),
    crypto: async () => ({ ok: true, coins: [{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', price: { usd: 100000, try: 4.19e6 }, chg24h: 1.2 }] }),
    newsFor: async (sym, name) => { newsQ.push([sym, name]); return { ok: true, items: [{ title: 'Başlık', source: 'AA', url: 'https://aa.com.tr/x', time: 1 }], left: 87 }; } };
  const secrets = { set: (p, k) => { if (k) keys[p] = k; else delete keys[p]; } };
  const radar = { forSymbol: async () => null, market: async () => ({ updatedAt: 1, modeller: [{ id: 'groq', ad: 'Groq', durum: 'ok' }], ozet: { yukselis: ['THYAO'], dusus: [] } }), status: () => ({ ok: true }) };
  const h = harness(t, { apis, secrets, radar }); h.ui.open();
  let r = await h.call('bp:feeds', { op: 'status' });
  assert.equal(r.ok, true); assert.deepEqual(Object.keys(r.status).sort(), ['fx', 'gecko', 'news']); assert.equal(r.status.news.configured, false);
  // gecersiz bicim reddedilir, kaydedilmez
  r = await h.call('bp:feeds', { op: 'key', provider: 'news', key: 'kisa' }); assert.equal(r.ok, false); assert.equal(keys.news, undefined);
  r = await h.call('bp:feeds', { op: 'key', provider: 'evil', key: 'a'.repeat(32) }); assert.equal(r.ok, false);
  // kayit + otomatik test
  r = await h.call('bp:feeds', { op: 'key', provider: 'news', key: ' ' + 'a1'.repeat(16) + ' ' });
  assert.equal(r.ok, true); assert.equal(keys.news, 'a1'.repeat(16)); assert.deepEqual(r.test, { ok: true, msg: 'Çalışıyor.' }); assert.equal(r.status.news.configured, true);
  assert.ok(!JSON.stringify(r).includes('a1a1a1a1'), 'anahtar yanitta yok');
  r = await h.call('bp:feeds', { op: 'key', provider: 'fx', key: 'b'.repeat(24) }); assert.equal(r.test.ok, false); assert.equal(r.test.msg, 'Anahtar geçersiz.');
  // piyasa: anahtari olmayan kaynak istenmez
  r = await h.call('bp:feeds', { op: 'market' });
  assert.equal(r.ok, true); assert.equal(r.fx.rates.TRY, 41.9); assert.equal(r.crypto, null, 'gecko anahtari yok'); assert.deepEqual(r.radar.ozet.yukselis, ['THYAO']);
  // haber: hisse adi ile
  r = await h.call('bp:feeds', { op: 'news', symbol: 'thyao' });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.items.length, 1); assert.equal(newsQ[0][0], 'THYAO'); assert.equal(r.left, 87);
  assert.equal((await h.call('bp:feeds', { op: 'news', symbol: '!!' })).ok, false);
  // anahtar silme
  r = await h.call('bp:feeds', { op: 'key', provider: 'news', key: '' }); assert.equal(r.ok, true); assert.equal(keys.news, undefined);
  r = await h.call('bp:feeds', { op: 'news', symbol: 'THYAO' }); assert.equal(r.ok, false); assert.equal(r.needKey, true);
  assert.equal((await h.call('bp:feeds', { op: 'nope' })).ok, false);
  // modul yoksa zarif
  const h2 = harness(t); h2.ui.open();
  r = await h2.call('bp:feeds', { op: 'market' }); assert.equal(r.ok, true); assert.equal(r.fx, null); assert.equal(r.crypto, null);
  assert.equal((await h2.call('bp:feeds', { op: 'key', provider: 'news', key: 'a'.repeat(32) })).ok, false);
});

// --- yerel demo hesap -----------------------------------------------------------------------
function demoHarness(t,o={}){const h=harness(t,o);h.ui.open();h.ui.enable();h.px=100;h.bars=[];h.stale=false;
  h.market.candles=async(sym,tf)=>({rows:tf==='1g'?[]:h.bars,stale:h.stale,quote:{price:h.px,currency:sym.endsWith('.IS')?'TRY':'USD',time:h.clock.t,name:'Test'}});
  h.demo=o=>h.call('bp:demo',o);return h}
test('bp:demo: al/sat, ayrilan adet/bakiye, iptal, ayarlar ve hesabi sifirlama',async t=>{
  const h=demoHarness(t);const order=(x={})=>h.demo({op:'order',symbol:'THYAO',market:'BIST',side:'buy',type:'market',qty:10,...x});
  let r=await order();assert.equal(r.ok,true);assert.equal(r.summary.accounts.BIST.cash,98998);assert.equal(r.summary.accounts.BIST.pos[0].qty,10);
  assert.equal(h.notes.at(-1).title,'Borsa Pro · Demo');assert.equal(h.evts('demo').length,1);assert.equal(h.said.length,0);
  r=await order({type:'limit',price:90,qty:20});assert.equal(r.summary.accounts.BIST.reserved,1803.6);const id=r.order.id;
  r=await h.demo({op:'cancel',id});assert.equal(r.summary.accounts.BIST.reserved,0);
  r=await order({side:'sell',type:'stop',price:95,qty:8});assert.equal(r.summary.accounts.BIST.pos[0].free,2);
  r=await order({side:'sell',qty:3});assert.equal(r.ok,false);assert.match(r.error,/Satılabilir/);
  r=await h.demo({op:'quote',symbol:'THYAO',market:'BIST'});assert.equal(r.quote.symbol,'THYAO.IS');assert.ok(r.maxBuy>0);
  r=await h.demo({op:'settings',commissionPct:0.1,slippageBp:5,anyTime:true});assert.deepEqual(r.summary.set,{commission:0.001,slippage:5,anyTime:true});
  r=await h.demo({op:'reset',market:'BIST',start:50000});assert.equal(r.summary.accounts.BIST.cash,50000);assert.equal(r.summary.orders.length,0);assert.equal(r.summary.trades.length,0);
  assert.equal(r.summary.accounts.US.cash,10000);assert.ok(fs.existsSync(path.join(h.dir,'bp-demo.json')));
});
test('bp:demo: mum dokunusu, bosluk, bildirim ve gecmis zaman damgasi',async t=>{
  const h=demoHarness(t);let r=await h.demo({op:'order',symbol:'THYAO',market:'BIST',side:'buy',type:'limit',price:90,qty:10});assert.ok(r.order);
  const at=h.clock.t+60000;h.clock.t+=180000;h.px=100;h.bars=[{t:at,o:88,h:100,l:87,c:99}];
  r=await h.demo({op:'refresh'});assert.equal(r.fills.length,1);assert.equal(r.fills[0].price,88);assert.equal(r.fills[0].at,at);assert.equal(h.notes.length,1);
  r=await h.demo({op:'refresh'});assert.equal(r.fills.length,0);assert.equal(h.notes.length,1);
});
test('bp:demo: eski veri, yanlis para birimi, gecersiz adet/ayar ve kapali motor',async t=>{
  const h=demoHarness(t);const o={op:'order',symbol:'THYAO',market:'BIST',side:'buy',type:'market',qty:1};
  h.stale=true;assert.equal((await h.demo(o)).ok,false);h.stale=false;
  for(const patch of [{qty:1.5},{qty:0},{market:'UK'},{type:'stop',price:90}])assert.equal((await h.demo({...o,...patch})).ok,false);
  const orig=h.market.candles;h.market.candles=async()=>({rows:[],quote:{price:100,currency:'USD',time:h.clock.t}});assert.equal((await h.demo(o)).ok,false);h.market.candles=orig;
  assert.equal((await h.demo({op:'settings',commissionPct:2})).ok,false);
  h.market.candles=async()=>({rows:[],quote:{price:100,currency:'TRY',time:h.clock.t-26*60000}});assert.equal((await h.demo(o)).ok,false);
  const no=demoHarness(t,{demo:null});assert.equal((await no.demo({op:'state'})).ok,false);
});
test('bp:demo: siralama, ozellik kapanirken devam eden emir yazilmaz',async t=>{
  const h=demoHarness(t),gate=deferred();const orig=h.market.candles;h.market.candles=async(...a)=>{await gate.p;return orig(...a)};
  const req=h.demo({op:'order',symbol:'THYAO',market:'BIST',side:'buy',type:'market',qty:1});await flush();h.ui.disable();gate.ok();assert.equal((await req).ok,false);
  h.ui.enable();h.ui.open();const r=await h.demo({op:'state'});assert.equal(r.summary.trades.length,0);assert.equal(r.summary.accounts.BIST.cash,100000);
});
test('bp:demo: bekleyen emir arka planda, kilitte durur ve yeniden acilista geri gelir',async t=>{
  const h=demoHarness(t);await h.demo({op:'order',symbol:'THYAO',market:'BIST',side:'buy',type:'limit',price:90,qty:2});
  assert.equal(h.timers.pending,2);h.ui.close();assert.equal(h.timers.pending,1);
  h.power.set({locked:true});assert.equal(h.timers.pending,0);h.power.set({locked:false});assert.equal(h.timers.pending,1);
  h.clock.t+=60000;h.px=89;await h.timers.fire();await flush(20);assert.equal(h.notes.length,1);assert.equal(h.timers.pending,0);
});
