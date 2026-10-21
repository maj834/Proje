'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const M = require('../market.js');
const D = require('../bp-data.js');
const { createData, U, NAMES, MACRO, PRESETS, TAGS, resampleWeekly, _util } = D;

// --- sentetik veri ------------------------------------------------------------------------------------------------
const DAYMS = 86400000;
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// Kapanislardan hafta ici gunluk mumlar (07:00 UTC = 10:00 TSI, Yahoo BIST gunluk mum saati gibi).
function fromCloses(cs, { start = Date.UTC(2024, 0, 1, 7), v = () => 1e6, seed = 3 } = {}) {
  const r = rng(seed), out = []; let t = start, prev = cs[0];
  for (let i = 0; i < cs.length; i++) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += DAYMS;
    const c = cs[i], o = prev, h = Math.max(o, c) * (1 + 0.004 * r()), l = Math.min(o, c) * (1 - 0.004 * r());
    out.push({ t, o, h, l, c, v: v(i) }); prev = c; t += DAYMS;
  }
  return out;
}
function walk(n, { seed = 1, drift = 0, vol = 0.02, p0 = 100 } = {}) {
  const r = rng(seed), cs = []; let p = p0;
  for (let i = 0; i < n; i++) { p *= 1 + drift + (r() - 0.5) * vol; cs.push(p); }
  return cs;
}
const SC = {
  up: () => fromCloses(walk(300, { drift: 0.004, vol: 0.01 })),
  down: () => fromCloses(walk(300, { drift: -0.004, vol: 0.01, seed: 2 })),
  flat: (seed = 9) => fromCloses(walk(300, { drift: 0, vol: 0.02, seed })),
  // 300 mumluk yatay seyrin son mumunda 40 gunluk zirvenin %6 ustune hacimli kirilim
  brk: () => { const cs = walk(299, { vol: 0.006, seed: 4 }); cs.push(Math.max(...cs.slice(-40)) * 1.06); return fromCloses(cs, { v: i => i === 299 ? 5e6 : 1e6 }); },
  // Uzun dusus + sert donus: SMA50, SMA200'u son mumlarda yukari keser
  gold: () => {
    const cs = []; for (let i = 0; i < 260; i++) cs.push(200 - 0.3 * i); for (let i = 0; i < 120; i++) cs.push(cs[cs.length - 1] + 1.2);
    const a = E.smaS(cs, 50), b = E.smaS(cs, 200); let k = -1;
    for (let i = 201; i < cs.length; i++) if (a[i] > b[i] && a[i - 1] <= b[i - 1]) { k = i; break; }
    return fromCloses(cs.slice(0, k + 4));
  },
  // Sert dususten sonra hacimsiz tepki mumu: RSI dipten yukari doner
  bounce: () => { const cs = walk(280, { vol: 0.01, seed: 6 }); for (let i = 0; i < 20; i++) cs.push(cs[cs.length - 1] * 0.975); cs.push(cs[cs.length - 1] * 1.03); return fromCloses(cs); }
};

// Sahte market: cagrilar kaydedilir, eszamanlilik olculur; gecikme / hata / onbellek bayragi ayarlanabilir.
const wait = ms => new Promise(r => setTimeout(r, ms));
function fakeMarket({ rows = () => SC.flat(), quote = null, delay = 0, fail = {}, cached = false } = {}) {
  const calls = []; let inflight = 0, maxIn = 0;
  const enter = () => { inflight++; maxIn = Math.max(maxIn, inflight); };
  const m = {
    yahooSymbol: M.yahooSymbol, TF: M.TF, calls,
    get maxIn() { return maxIn; },
    async candles(s, tf = '1g', mkt = 'BIST') {
      const y = M.yahooSymbol(s, mkt); calls.push({ fn: 'candles', y, tf, mkt }); enter();
      try {
        const d = typeof delay === 'function' ? delay(y, tf, 'candles') : delay; if (d) await wait(d);
        const f = fail[y] && fail[y](y, tf, 'candles'); if (f) throw f;
        const r = rows(y, tf);
        return { symbol: y, tf, rows: r, quote: { price: r.length ? r[r.length - 1].c : null, prev: r.length > 1 ? r[r.length - 2].c : null, name: 'YAHOO ' + y, currency: 'TRY', time: r.length ? r[r.length - 1].t : null }, cached: typeof cached === 'function' ? cached(y, tf) : cached };
      } finally { inflight--; }
    },
    async quote(s, mkt = 'BIST') {
      const y = M.yahooSymbol(s, mkt); calls.push({ fn: 'quote', y, mkt }); enter();
      try {
        const d = typeof delay === 'function' ? delay(y, null, 'quote') : delay; if (d) await wait(d);
        const f = fail[y] && fail[y](y, null, 'quote'); if (f) throw f;
        return quote ? quote(y, mkt) : { symbol: y, price: 10, prev: 8, chg: 2, chgPct: 25, dayHigh: 11, dayLow: 9, volume: 1000, time: Date.UTC(2024, 0, 1, 12), name: 'Q ' + y, currency: 'TRY' };
      } finally { inflight--; }
    }
  };
  return m;
}
const mk = (market, extra = {}) => { const sleeps = []; const d = createData({ market, engine: E, now: extra.now || (() => 1e12), sleep: async ms => { sleeps.push(ms); }, ...extra }); d.sleeps = sleeps; return d; };
const errOnce = (msg, n = 1) => { let k = 0; return () => (k++ < n ? new Error(msg) : null); };

// --- sabitler -----------------------------------------------------------------------------------------------------
test('U: BIST30 < BIST50 < BIST100, tekrarsiz, gecerli kodlar, hepsinin adi var', () => {
  assert.equal(U.BIST30.length, 30); assert.equal(U.BIST50.length, 50); assert.equal(U.BIST100.length, 100);
  for (const k of ['BIST30', 'BIST50', 'BIST100']) {
    assert.equal(new Set(U[k]).size, U[k].length, k + ' tekrar');
    for (const s of U[k]) { assert.match(s, /^[A-Z][A-Z0-9]{3,5}$/, s); assert.ok(NAMES[s] && NAMES[s].length > 1, 'ad yok: ' + s); assert.equal(M.yahooSymbol(s), s + '.IS'); }
  }
  assert.ok(U.BIST30.every(s => U.BIST50.includes(s)) && U.BIST50.every(s => U.BIST100.includes(s)));
  assert.deepEqual(Object.keys(U), ['BIST30', 'BIST50', 'BIST100', 'BIST500'], 'not alani numaralandirilmaz');
  assert.equal(U.BIST500.length, 500); assert.equal(new Set(U.BIST500).size, 500); assert.ok(U.BIST100.every(s => U.BIST500.includes(s)));
  for (const s of U.BIST500) assert.match(s, /^[A-Z][A-Z0-9]{1,7}$/, s);
  assert.match(U.note, /Yaklaşık/);
  for (const s of ['THYAO', 'ASELS', 'GARAN', 'SISE', 'TUPRS', 'BIMAS', 'KCHOL']) assert.ok(U.BIST30.includes(s), s);
  assert.ok(!U.BIST100.includes('KOZAL') && U.BIST30.includes('TRALT'), 'KOZAL -> TRALT kod degisikligi');
  assert.equal(NAMES.THYAO, 'Türk Hava Yolları'); assert.equal(NAMES.SISE, 'Şişecam');
});

test('MACRO, PRESETS ve TAGS sozlesmedeki kimliklerle', () => {
  assert.deepEqual(MACRO, [{ sym: 'XU100.IS', name: 'BIST 100' }, { sym: 'XU030.IS', name: 'BIST 30' }, { sym: 'USDTRY=X', name: 'Dolar/TL' }, { sym: 'EURTRY=X', name: 'Euro/TL' },
    { sym: 'GC=F', name: 'Altın ($/ons)' }, { sym: 'BZ=F', name: 'Brent' }, { sym: 'BTC-USD', name: 'Bitcoin' }]);
  assert.deepEqual(PRESETS.map(p => p.id), ['guclu-al', 'kirilim', 'sikisma', 'asiri-satim-donus', 'zirve52', 'hacim', 'uyumsuzluk', 'altin-kesisim', 'dusus-riski']);
  for (const p of PRESETS) assert.ok(p.name && p.desc, p.id);
  assert.deepEqual(Object.keys(TAGS).sort(), ['altin-kesisim', 'asiri-alim', 'asiri-satim', 'bayrak', 'dip52', 'guclu-trend', 'hacim-patlamasi', 'ikili-dip', 'ikili-tepe',
    'kirilim-asagi', 'kirilim-yukari', 'olum-kesisimi', 'sikisma', 'uyumsuzluk-negatif', 'uyumsuzluk-pozitif', 'zirve52']);
  for (const [id, t] of Object.entries(TAGS)) { assert.ok(t.name, id); assert.ok([-1, 0, 1].includes(t.dir), id); }
  assert.equal(TAGS['kirilim-yukari'].name, 'Yukarı kırılım'); assert.equal(TAGS['kirilim-yukari'].dir, 1); assert.equal(TAGS['ikili-tepe'].dir, -1);
});

// --- resampleWeekly -------------------------------------------------------------------------------------------------
test('resampleWeekly: Pazartesi baslangicli Istanbul haftasi, OHLCV dogru', () => {
  // 2026-10-05 Pazartesi .. 2026-10-16 Cuma (10 is gunu)
  const rows = []; for (let d = 5; d <= 16; d++) { const t = Date.UTC(2026, 9, d, 7); const wd = new Date(t).getUTCDay(); if (!wd || wd === 6) continue; rows.push({ t, o: d, h: d + 10, l: d - 1, c: d + 0.5, v: 100 }); }
  const w = resampleWeekly(rows);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { t: Date.UTC(2026, 9, 5, 7), o: 5, h: 19, l: 4, c: 9.5, v: 500 });
  assert.deepEqual(w[1], { t: Date.UTC(2026, 9, 12, 7), o: 12, h: 26, l: 11, c: 16.5, v: 500 });
  // Pazar 22:00 UTC = Pazartesi 01:00 TSI -> yeni hafta; Cumartesi 20:00 UTC (23:00 TSI) -> eski hafta
  const tz = [{ t: Date.UTC(2026, 9, 9, 7), o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }, { t: Date.UTC(2026, 9, 10, 20), o: 1.5, h: 3, l: 1, c: 2, v: 1 }, { t: Date.UTC(2026, 9, 11, 22), o: 2, h: 2.5, l: 1.8, c: 2.2, v: 1 }];
  const w2 = resampleWeekly(tz);
  assert.equal(w2.length, 2); assert.equal(w2[0].c, 2); assert.equal(w2[1].o, 2);
  // gecersiz satirlar atlanir; hacimsiz hafta null
  assert.deepEqual(resampleWeekly([null, { t: 1, o: NaN, h: 1, l: 1, c: 1 }, { t: Date.UTC(2026, 9, 5, 7), o: 1, h: 1, l: 1, c: 1 }]), [{ t: Date.UTC(2026, 9, 5, 7), o: 1, h: 1, l: 1, c: 1, v: null }]);
  for (const bad of [null, undefined, [], 'x', {}]) assert.deepEqual(resampleWeekly(bad), []);
  // 300 gunluk mum -> ~60 haftalik; tfTrend calisir
  const wk = resampleWeekly(SC.up());
  assert.ok(wk.length >= 59 && wk.length <= 61, String(wk.length));
  assert.ok(E.tfTrend(wk) && E.tfTrend(wk).dir === 1);
});

// --- search ----------------------------------------------------------------------------------------------------------
test('search: kod onek eslesmesi once, sonra ad; Turkce buyuk-kucuk harf duyarsiz', () => {
  const d = mk(fakeMarket()), syms = q => d.search(q).map(r => r.symbol);
  assert.equal(syms('thy')[0], 'THYAO');
  assert.deepEqual(d.search('THYAO')[0], { symbol: 'THYAO', name: 'Türk Hava Yolları' });
  assert.equal(syms('şişe')[0], 'SISE'); assert.equal(syms('ŞİŞECAM')[0], 'SISE'); assert.equal(syms('sisecam')[0], 'SISE');
  assert.equal(syms('türk hava')[0], 'THYAO'); assert.equal(syms('TÜRK HAVA YOLLARI')[0], 'THYAO');
  assert.equal(syms('İŞ BANKASI')[0], 'ISCTR'); assert.equal(syms('iş bankası')[0], 'ISCTR'); assert.equal(syms('is bankasi')[0], 'ISCTR');
  assert.equal(syms('garanti')[0], 'GARAN'); assert.equal(syms('ereğli')[0], 'EREGL');
  assert.equal(syms('kozal')[0], 'TRALT', 'eski kod takma adi'); assert.ok(syms('ipek').includes('TRENJ'));
  assert.equal(syms('xu100')[0], 'XU100'); assert.equal(d.search('xu100')[0].name, 'BIST 100 Endeksi');
  // onek eslesmeleri ad eslesmelerinden once
  const r = syms('tu'); const lastPrefix = r.map(s => s.startsWith('TU')).lastIndexOf(true), firstOther = r.findIndex(s => !s.startsWith('TU'));
  assert.ok(lastPrefix >= 2 && (firstOther === -1 || firstOther > lastPrefix), r.join());
  // sinir ve tekrarsizlik
  const a = d.search('a'); assert.equal(a.length, 12); assert.equal(new Set(a.map(x => x.symbol)).size, 12);
  for (const q of ['', '   ', null, undefined, '!!!', 42, {}]) assert.ok(Array.isArray(d.search(q)));
  assert.deepEqual(d.search(''), []); assert.deepEqual(d.search('!!!'), []); assert.deepEqual(d.search('zzzzqq'), []);
});

// --- stats -----------------------------------------------------------------------------------------------------------
test('stats: performans, 52 hafta, ATR, TL hacim, oynaklik', () => {
  const d = mk(fakeMarket());
  const rows = fromCloses(Array.from({ length: 300 }, (_, i) => 100 + i), { v: () => 2000 });
  const s = d.stats(rows, null);
  const c = rows.map(r => r.c), x = c[299], pct = n => +((x / c[299 - n] - 1) * 100).toFixed(2);
  assert.deepEqual(s.perf, { d1: pct(1), d5: pct(5), d20: pct(20), d60: pct(60), d120: pct(120), d250: pct(250) });
  const w = rows.slice(-252);
  assert.equal(s.hi52, Math.max(...w.map(r => r.h))); assert.equal(s.lo52, Math.min(...w.map(r => r.l)));
  assert.ok(s.lo52 > rows[0].l, 'ilk 48 mum 52 haftanin disinda');
  assert.equal(s.hi52Dist, +((x - s.hi52) / s.hi52 * 100).toFixed(2)); assert.ok(s.hi52Dist <= 0 && s.lo52Dist > 0);
  assert.equal(s.atrPct, +(E.atrS(rows, 14)[299] / x * 100).toFixed(2));
  assert.equal(s.avgVolTL20, Math.round(rows.slice(-20).reduce((a, r) => a + r.c * r.v, 0) / 20));
  assert.ok(s.volAnn > 0 && s.volAnn < 5, String(s.volAnn));
  assert.equal(s.beta, null); assert.equal(s.corr, null); assert.deepEqual(s.rs, { d20: null, d60: null });
  assert.equal(s.n, 300); assert.equal(s.last, x);
});

test('stats: beta/korelasyon/goreli guc endeksle tarih eslesmesiyle', () => {
  const d = mk(fakeMarket());
  const r = rng(11), ret = Array.from({ length: 300 }, () => (r() - 0.5) * 0.03);
  const bc = [1000], sc = [50]; for (let i = 1; i < 300; i++) { bc.push(bc[i - 1] * (1 + ret[i])); sc.push(sc[i - 1] * (1 + 2 * ret[i])); }
  const bench = fromCloses(bc), stock = fromCloses(sc);
  const same = d.stats(bench, bench);
  assert.equal(same.beta, 1); assert.equal(same.corr, 1); assert.deepEqual(same.rs, { d20: 0, d60: 0 });
  const s = d.stats(stock, bench);
  assert.equal(s.beta, 2); assert.equal(s.corr, 1);
  assert.equal(s.rs.d20, +(s.perf.d20 - (bc[299] / bc[279] - 1) * 100).toFixed(2));
  // Endekste eksik gunler (tatil) -> ilgili getiriler atlanir, rs en yakin onceki gune bakar
  const holey = bench.filter((_, i) => i % 7 !== 3 && i !== 279);
  const h = d.stats(stock, holey);
  assert.ok(Math.abs(h.beta - 2) < 0.05 && h.corr > 0.95, JSON.stringify(h));
  assert.equal(h.rs.d20, +(s.perf.d20 - (bc[299] / bc[278] - 1) * 100).toFixed(2));
  // Endeks yalniz eski tarihleri kapsiyorsa (cakisma yok) beta yok
  assert.equal(d.stats(stock, bench.slice(0, 10)).beta, null);
});

test('stats: bos/bozuk/kisa girdi cokmez, null alanlarla doner', () => {
  const d = mk(fakeMarket());
  for (const bad of [null, undefined, [], 'x', [null, { t: 1, o: 1, h: 1, l: 1, c: -1 }]]) {
    const s = d.stats(bad, bad);
    assert.equal(s.n, 0); assert.equal(s.hi52, null); assert.equal(s.perf.d1, null); assert.equal(s.beta, null); assert.equal(s.volAnn, null);
  }
  const s = d.stats(SC.up().slice(0, 10), SC.up());
  assert.notEqual(s.perf.d5, null); assert.equal(s.perf.d20, null); assert.equal(s.volAnn, null); assert.equal(s.atrPct, null); assert.equal(s.beta, null);
  const nov = d.stats(SC.up().map(r => ({ ...r, v: null })));
  assert.equal(nov.avgVolTL20, null);
});

// --- quotes ----------------------------------------------------------------------------------------------------------
test('quotes: sira korunur, gecersiz kod hata satiri, tekrar eden kod tek istek, en fazla 4 eszamanli', async () => {
  const m = fakeMarket({ delay: 5 }), d = mk(m);
  const syms = ['thyao', 'x!', 'GARAN', 'THYAO', ...U.BIST30.slice(3, 13)];
  const out = await d.quotes(syms);
  assert.equal(out.length, syms.length);
  assert.deepEqual(out.slice(0, 4).map(r => r.symbol), ['THYAO', 'X!', 'GARAN', 'THYAO']);
  assert.equal(out[1].error, 'Geçersiz kod.'); assert.equal(out[1].price, null); assert.deepEqual(out[1].spark, []);
  assert.equal(out[0].name, 'Türk Hava Yolları'); assert.equal(out[0].price, 10); assert.equal(out[0].chgPct, 25); assert.equal(out[0].chg, 2);
  for (const k of ['symbol', 'price', 'prev', 'chg', 'chgPct', 'dayHigh', 'dayLow', 'volume', 'time', 'name', 'currency', 'spark', 'stale', 'error']) assert.ok(k in out[0], k);
  assert.equal(m.calls.filter(c => c.fn === 'quote' && c.y === 'THYAO.IS').length, 1);
  assert.ok(m.maxIn <= 4 && m.maxIn >= 2, 'eszamanlilik ' + m.maxIn);
  assert.ok(d.sleeps.length > 0, 'ag isteginden sonra kisa bekleme');
  assert.deepEqual(await d.quotes(null), []); assert.deepEqual(await d.quotes('THYAO'), []);
});

test('quotes: spark son 30 gunluk kapanis; ayni gun canli fiyatla guncellenir, yeni gun eklenir; onbellek', async () => {
  const daily = SC.up(), lastT = daily[daily.length - 1].t;
  let qt = lastT + 3600000;
  const m = fakeMarket({ rows: () => daily, quote: y => ({ price: 999, prev: 990, time: qt, name: 'Q' }) }), d = mk(m);
  const [a] = await d.quotes(['THYAO']);
  assert.equal(a.spark.length, 30);
  assert.deepEqual(a.spark.slice(0, 29), daily.slice(-30, -1).map(r => r.c)); assert.equal(a.spark[29], 999);
  const n = m.calls.filter(c => c.fn === 'candles').length; assert.equal(n, 1);
  qt = lastT + 2 * DAYMS; // ertesi gun: eklenir, uzunluk 30 kalir
  const [b] = await d.quotes(['THYAO']);
  assert.equal(b.spark.length, 30); assert.equal(b.spark[29], 999); assert.equal(b.spark[28], daily[daily.length - 1].c);
  assert.equal(m.calls.filter(c => c.fn === 'candles').length, n, 'spark onbellekten');
  await d.quotes(['GARAN'], { spark: false });
  assert.equal(m.calls.filter(c => c.fn === 'candles').length, n, 'spark:false -> mum istegi yok');
});

test('quotes: sembol bazinda hata; ag hatasinda gunluk mum fiyati (stale); bulunamadi icin ek istek yok; spark hatasi fiyati bozmaz', async () => {
  const m = fakeMarket({ fail: {
    'NOPE.IS': () => new Error('NOPE.IS bulunamadı. Kodu ve borsa seçimini (BIST/ABD) kontrol et.'),
    'NET.IS': (y, tf, fn) => fn === 'quote' ? new Error('Bağlantı yok.') : null,
    'SPK.IS': (y, tf, fn) => fn === 'candles' ? new Error('HTTP 500') : null
  } }), d = mk(m);
  const [ok, nope, net, spk] = await d.quotes(['THYAO', 'NOPE', 'NET', 'SPK']);
  assert.equal(ok.error, null);
  assert.match(nope.error, /bulunamadı/); assert.equal(nope.price, null);
  assert.equal(m.calls.filter(c => c.y === 'NOPE.IS' && c.fn === 'candles').length, 0);
  assert.equal(net.error, null); assert.equal(net.stale, true); assert.ok(net.price > 0); assert.ok(Number.isFinite(net.chgPct));
  assert.equal(spk.error, null); assert.equal(spk.price, 10); assert.deepEqual(spk.spark, []);
  // spark hatasi 5 dk tekrar denenmez
  const before = m.calls.filter(c => c.y === 'SPK.IS' && c.fn === 'candles').length;
  await d.quotes(['SPK']); assert.equal(m.calls.filter(c => c.y === 'SPK.IS' && c.fn === 'candles').length, before);
});

test('quotes: ABD piyasasi ve market.quote olmayan eski market', async () => {
  const m = fakeMarket(), d = mk(m);
  const [a] = await d.quotes(['aapl'], { market: 'US' });
  assert.equal(a.symbol, 'AAPL'); assert.equal(a.name, 'Q AAPL'); assert.equal(m.calls[0].mkt, 'US');
  const old = fakeMarket(); delete old.quote;
  const [b] = await mk(old).quotes(['THYAO'], { spark: false });
  assert.equal(b.error, null); assert.ok(b.price > 0); assert.equal(b.name, 'Türk Hava Yolları');
});

test('overview: MACRO sirasiyla, sembol oldugu gibi US piyasasiyla, hata satiri', async () => {
  const m = fakeMarket({ fail: { 'BZ=F': (y, tf, fn) => fn === 'quote' ? new Error('BZ=F bulunamadı.') : null } }), d = mk(m);
  const o = await d.overview();
  assert.deepEqual(o.map(r => r.sym), MACRO.map(x => x.sym)); assert.deepEqual(o.map(r => r.name), MACRO.map(x => x.name));
  assert.ok(m.calls.filter(c => c.fn === 'quote').every(c => c.mkt === 'US'));
  assert.deepEqual(m.calls.filter(c => c.fn === 'quote').map(c => c.y).sort(), MACRO.map(x => x.sym).sort());
  const bz = o.find(r => r.sym === 'BZ=F'); assert.match(bz.error, /bulunamadı/); assert.equal(bz.price, null);
  const x = o[0]; for (const k of ['sym', 'name', 'price', 'chg', 'chgPct', 'spark', 'time', 'error']) assert.ok(k in x, k);
  assert.equal(x.price, 10); assert.equal(x.spark.length, 30); assert.equal(x.error, null);
});

// --- scan ------------------------------------------------------------------------------------------------------------
test('scan: satir alanlari, haftalik trend ek istek olmadan, skora gore sirali', async () => {
  const m = fakeMarket({ rows: (y) => y === 'ASELS.IS' ? SC.down() : y === 'GARAN.IS' ? SC.up() : SC.flat(y.length) }), d = mk(m);
  const r = await d.scan(['THYAO', 'GARAN', 'ASELS', 'garan'], { bench: null });
  assert.equal(r.total, 3); assert.equal(r.tf, '1g'); assert.equal(r.cancelled, false); assert.deepEqual(r.errors, []); assert.equal(r.at, 1e12);
  assert.equal(m.calls.length, 3, 'sembol basina tek istek (haftalik resample)');
  assert.ok(m.calls.every(c => c.tf === '1g'));
  assert.deepEqual(r.rows.map(x => x.symbol), ['GARAN', 'THYAO', 'ASELS']);
  const g = r.rows[0];
  for (const k of ['symbol', 'name', 'price', 'chgPct', 'verdict', 'rr', 'atrPct', 'volRatio', 'rsi', 'adx', 'trend', 'perf', 'rs20', 'hi52Dist', 'lo52Dist', 'plan', 'tags', 'score']) assert.ok(k in g, k);
  assert.equal(g.name, 'Garanti BBVA'); assert.equal(g.verdict.label, 'AL'); assert.equal(g.score, g.verdict.score);
  assert.deepEqual(Object.keys(g.verdict).sort(), ['confidence', 'dir', 'label', 'score']);
  assert.deepEqual(g.trend, { d: 1, w: 1 }); assert.equal(r.rows[2].trend.d, -1);
  assert.ok(g.plan && g.plan.entry.length === 2 && g.plan.stop < g.plan.entry[0] && g.plan.t1 > g.plan.entry[1]);
  assert.equal(g.rr, g.plan.rr);
  assert.ok(Object.values(g.perf).every(Number.isFinite)); assert.equal(g.rs20, null, 'bench null');
  assert.ok(Array.isArray(g.tags) && g.tags.every(t => TAGS[t]));
  const daily = SC.up(); assert.equal(g.price, daily[299].c); assert.equal(g.chgPct, +((daily[299].c / daily[298].c - 1) * 100).toFixed(2));
  // BEKLE satirinda plan yok
  for (const x of r.rows) if (x.verdict.label === 'BEKLE') { assert.equal(x.plan, null); assert.equal(x.rr, null); }
});

test('scan: bench verilmezse XU100 bir kez alinir (rs20); bench satirlariyla istek yok', async () => {
  const bench = SC.flat(77);
  const m = fakeMarket({ rows: y => y === 'XU100.IS' ? bench : SC.up() }), d = mk(m);
  const r = await d.scan(['THYAO', 'GARAN'], {});
  assert.equal(m.calls.filter(c => c.y === 'XU100.IS').length, 1);
  const st = d.stats(SC.up(), bench);
  assert.equal(r.rows[0].rs20, st.rs.d20); assert.ok(Number.isFinite(r.rows[0].rs20));
  const m2 = fakeMarket({ rows: () => SC.up() }), d2 = mk(m2);
  const r2 = await d2.scan(['THYAO'], { bench });
  assert.equal(m2.calls.filter(c => c.y === 'XU100.IS').length, 0); assert.equal(r2.rows[0].rs20, st.rs.d20);
  // XU100 alinamazsa tarama yine calisir
  const m3 = fakeMarket({ fail: { 'XU100.IS': () => new Error('Bağlantı yok.') } });
  const r3 = await mk(m3).scan(['THYAO'], {}); assert.equal(r3.rows.length, 1); assert.equal(r3.rows[0].rs20, null);
  // ABD taramasinda XU100 istenmez
  const m4 = fakeMarket(); await mk(m4).scan(['AAPL'], { market: 'US' }); assert.equal(m4.calls.filter(c => c.y === 'XU100.IS').length, 0);
});

test('scan: gun ici dilimde gunluk mumlar da alinir (trend.d, perf); gecersiz tf -> 1g', async () => {
  const m = fakeMarket({ rows: (y, tf) => tf === '1g' ? SC.up() : SC.flat(5) }), d = mk(m);
  const r = await d.scan(['THYAO'], { tf: '1s', bench: null });
  assert.equal(r.tf, '1s'); assert.deepEqual(m.calls.map(c => c.tf), ['1s', '1g']);
  assert.equal(r.rows[0].trend.d, 1); assert.equal(r.rows[0].trend.w, 1); assert.ok(Number.isFinite(r.rows[0].perf.d20));
  const w = await d.scan(['THYAO'], { tf: '1h', bench: null }); assert.equal(w.tf, '1h'); assert.equal(w.rows.length, 1);
  const bad = await d.scan(['THYAO'], { tf: 'xx', bench: null }); assert.equal(bad.tf, '1g');
});

test('scan: sembol bazinda hata dayanikliligi (istisna, az mum, gecersiz kod, bozuk cevap)', async () => {
  const m = fakeMarket({ rows: y => y === 'KISA.IS' ? SC.up().slice(0, 30) : y === 'BOS.IS' ? null : SC.up(), fail: { 'PATLA.IS': () => new Error('HTTP 500') } }), d = mk(m);
  const r = await d.scan(['THYAO', 'PATLA', 'KISA', 'x!', 'BOS', 'GARAN'], { bench: null });
  assert.deepEqual(r.rows.map(x => x.symbol).sort(), ['GARAN', 'THYAO']);
  const e = Object.fromEntries(r.errors.map(x => [x.symbol, x.error]));
  assert.equal(e.PATLA, 'HTTP 500'); assert.match(e.KISA, /Yeterli mum yok/); assert.equal(e['X!'], 'Geçersiz kod.'); assert.ok(e.BOS);
  assert.equal(r.total, 6); assert.equal(r.error, null);
});

test('scan: eszamanlilik siniri (en fazla 4), istekler arasi bekleme, onbellekte bekleme yok', async () => {
  const m = fakeMarket({ delay: 4, rows: () => SC.up() }), d = mk(m);
  const syms = U.BIST30.slice(0, 12);
  await d.scan(syms, { concurrency: 2, bench: null, gap: 250 });
  assert.equal(m.maxIn, 2);
  assert.equal(d.sleeps.filter(x => x === 250).length, 12);
  const m2 = fakeMarket({ delay: 4, rows: () => SC.up() }), d2 = mk(m2);
  await d2.scan(syms, { concurrency: 10, bench: null }); assert.ok(m2.maxIn <= 4, String(m2.maxIn));
  const m3 = fakeMarket({ rows: () => SC.up(), cached: true }), d3 = mk(m3);
  await d3.scan(syms, { bench: null }); assert.equal(d3.sleeps.length, 0);
  // sunucu hatasi veren sembollerden sonra da beklenir; gecersiz kodda (istek yok) beklenmez
  const m4 = fakeMarket({ fail: { 'AAAA.IS': () => new Error('HTTP 500'), 'BBBB.IS': () => new Error('HTTP 502') } }), d4 = mk(m4);
  await d4.scan(['AAAA', 'BBBB', 'x!'], { bench: null, concurrency: 1, gap: 300 });
  assert.deepEqual(d4.sleeps, [300, 300]);
});

test('scan: ilerleme bildirimi; hatali onProgress taramayi bozmaz', async () => {
  const m = fakeMarket({ rows: () => SC.up(), fail: { 'PATLA.IS': () => new Error('x') } }), d = mk(m);
  const ev = [];
  const r = await d.scan(['THYAO', 'PATLA', 'GARAN'], { bench: null, concurrency: 1, onProgress: e => { ev.push(e); if (ev.length === 2) throw new Error('ui'); } });
  assert.deepEqual(ev, [{ done: 0, total: 3, symbol: null }, { done: 1, total: 3, symbol: 'THYAO' }, { done: 2, total: 3, symbol: 'PATLA' }, { done: 3, total: 3, symbol: 'GARAN' }]);
  assert.equal(r.rows.length, 2);
});

test('scan: iptal edilince eldeki satirlarla hemen doner, yeni istek atilmaz', async () => {
  const ac = new AbortController();
  const m = fakeMarket({ rows: () => SC.up(), delay: (y) => y === 'SLOW.IS' ? 400 : 3 }), d = mk(m);
  let n = 0;
  const t0 = Date.now();
  const p = d.scan(['THYAO', 'GARAN', 'SLOW', 'ASELS', 'SISE', 'BIMAS'], { bench: null, concurrency: 1, signal: ac.signal, onProgress: e => { if (e.done === 2 && !n++) setTimeout(() => ac.abort(), 20); } });
  const r = await p;
  assert.ok(Date.now() - t0 < 300, 'SLOW beklenmeden doner');
  assert.equal(r.cancelled, true); assert.deepEqual(r.rows.map(x => x.symbol).sort(), ['GARAN', 'THYAO']);
  const calls = m.calls.length; await wait(450);
  assert.equal(m.calls.length, calls, 'iptalden sonra yeni istek yok'); assert.equal(r.rows.length, 2, 'gec gelen sonuc eklenmez');
  // XU100 (bench) beklenirken iptal: bench yanitini beklemeden doner, hisse istegi atilmaz
  const ac3 = new AbortController();
  const m3 = fakeMarket({ delay: y => y === 'XU100.IS' ? 400 : 1 }), t3 = Date.now();
  const p3 = mk(m3).scan(['THYAO', 'GARAN'], { signal: ac3.signal }); setTimeout(() => ac3.abort(), 10);
  const r3 = await p3;
  assert.ok(Date.now() - t3 < 300); assert.equal(r3.cancelled, true); assert.deepEqual(r3.rows, []);
  assert.deepEqual(m3.calls.map(c => c.y), ['XU100.IS']);
  // gecersiz signal nesnesi yok sayilir
  assert.equal((await mk(fakeMarket()).scan(['THYAO'], { bench: null, signal: { aborted: false } })).rows.length, 1);
  // zaten iptal edilmis sinyal
  const ac2 = new AbortController(); ac2.abort();
  const m2 = fakeMarket(); const r2 = await mk(m2).scan(['THYAO'], { signal: ac2.signal });
  assert.equal(r2.cancelled, true); assert.deepEqual(r2.rows, []); assert.equal(m2.calls.length, 0);
});

test('scan: 429 -> geri cekilip yeniden dener; uc kez ust uste 429 -> hata', async () => {
  const rate = 'Veri sağlayıcı çok sık istek uyarısı verdi; biraz bekle.';
  const m = fakeMarket({ rows: () => SC.up(), fail: { 'THYAO.IS': errOnce(rate), 'GARAN.IS': errOnce(rate, 3) } });
  // saat her beklemede ilerler (gercekci zaman)
  let t = 1e12; const sleeps = [];
  const d = createData({ market: m, engine: E, now: () => t, sleep: async ms => { sleeps.push(ms); t += ms; } });
  const r = await d.scan(['THYAO', 'GARAN', 'ASELS'], { bench: null, concurrency: 1, gap: 250 });
  assert.deepEqual(r.rows.map(x => x.symbol).sort(), ['ASELS', 'THYAO']);
  assert.deepEqual(r.errors, [{ symbol: 'GARAN', error: rate }]);
  // THYAO: 429 -> 5 sn, basari -> aralik 500 ms; GARAN: 5 sn, 10 sn (2 yeniden deneme), sonra hata -> 2 sn; ASELS -> 2 sn
  assert.deepEqual(sleeps, [5000, 500, 5000, 10000, 2000, 2000]);
});

test('scan: baglanti hic yoksa 6 hatadan sonra durur', async () => {
  const m = fakeMarket({ fail: new Proxy({}, { get: () => () => new Error('Bağlantı yok.') }) }), d = mk(m);
  const r = await d.scan(U.BIST100, { bench: null, concurrency: 1 });
  assert.equal(r.errors.length, 6); assert.equal(r.rows.length, 0); assert.match(r.error, /ulaşılamıyor/); assert.equal(m.calls.length, 6);
  assert.deepEqual(await mk(fakeMarket()).scan([], {}), { at: 1e12, tf: '1g', market: 'BIST', total: 0, rows: [], errors: [], cancelled: false, error: null });
  assert.equal((await mk(fakeMarket()).scan(null)).total, 0);
});

test('scan: etiketler ve hazir filtreler senaryolarla', async () => {
  const S = { UP: SC.up(), DOWN: SC.down(), BRK: SC.brk(), GOLD: SC.gold(), BOUNCE: SC.bounce() };
  const m = fakeMarket({ rows: y => S[y.replace('.IS', '')] }), d = mk(m);
  const r = await d.scan(Object.keys(S), { bench: null });
  assert.deepEqual(r.errors, []);
  const row = Object.fromEntries(r.rows.map(x => [x.symbol, x])), pre = s => PRESETS.filter(p => d.matches(row[s], p.id)).map(p => p.id);
  assert.ok(row.UP.tags.includes('guclu-trend') && row.UP.tags.includes('zirve52'), row.UP.tags.join());
  assert.ok(pre('UP').includes('guclu-al') && pre('UP').includes('zirve52') && !pre('UP').includes('dusus-riski'));
  assert.ok(['kirilim-asagi', 'asiri-satim', 'dip52'].every(t => row.DOWN.tags.includes(t)), row.DOWN.tags.join());
  assert.equal(row.DOWN.verdict.label, 'SAT'); assert.ok(pre('DOWN').includes('dusus-riski') && !pre('DOWN').includes('guclu-al'));
  assert.ok(['kirilim-yukari', 'hacim-patlamasi'].every(t => row.BRK.tags.includes(t)), row.BRK.tags.join());
  assert.ok(pre('BRK').includes('kirilim') && pre('BRK').includes('hacim'));
  assert.ok(row.GOLD.tags.includes('altin-kesisim'), row.GOLD.tags.join()); assert.ok(pre('GOLD').includes('altin-kesisim'));
  assert.ok(row.BOUNCE.rsiMin5 <= 30 && row.BOUNCE.turn === 1, JSON.stringify(row.BOUNCE));
  assert.ok(pre('BOUNCE').includes('asiri-satim-donus'));
  // etiketler TAGS sirasinda
  const order = Object.keys(TAGS); for (const x of r.rows) assert.deepEqual(x.tags, [...x.tags].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
});

test('tagsOf: formasyon, sikisma, uyumsuzluk ve guclu trend kurallari (saf)', () => {
  const rows = SC.flat(3), base = { structure: { breakouts: [], patterns: [] }, volatility: { bb: { squeeze: false } }, momentum: { rsi: 50, divergences: [] }, volume: { ratio: 1 }, trend: { primary: { adx: 30, dir: 1, pdi: 30, mdi: 10 } } };
  const T = (pro, extra = {}) => _util.tagsOf({ rows, pro: { ...base, ...pro }, st: null, tw: null, engine: E, ...extra }).filter(t => !/^kirilim/.test(t));
  assert.deepEqual(T({}), ['guclu-trend']);
  assert.deepEqual(T({}, { tw: -1 }), [], 'haftalik dususte guclu trend yok');
  assert.deepEqual(T({ trend: { primary: { adx: 30, dir: 1, pdi: 10, mdi: 30 } } }), []);
  assert.deepEqual(T({ trend: { primary: { adx: 18, dir: 1, pdi: 30, mdi: 10 } } }), []);
  // Ikili dip/tepe: onayli ya da boyna <= 1 ATR; uzak "olusan" formasyon etiketlenmez. Ayi bayragi etiket degil.
  const x = rows[rows.length - 1].c, vol = { bb: { squeeze: false }, atr: 2 };
  const pats = ps => T({ trend: {}, volatility: vol, structure: { breakouts: [], patterns: ps } });
  assert.deepEqual(pats([{ name: 'Boğa bayrağı', dir: 1 }, { name: 'İkili dip', dir: 1, confirmed: true, neck: x - 9 }, { name: 'İkili tepe', dir: -1, confirmed: false, neck: x - 1.5 }, { name: 'Ayı bayrağı', dir: -1 }]),
    ['bayrak', 'ikili-dip', 'ikili-tepe']);
  assert.deepEqual(pats([{ name: 'İkili dip', dir: 1, confirmed: false, neck: x + 2.5 }, { name: 'İkili tepe', dir: -1, confirmed: false, neck: x - 5 }]), []);
  assert.deepEqual(pats([{ name: 'İkili dip', dir: 1, confirmed: false, neck: x + 1.9 }]), ['ikili-dip']);
  // Uyumsuzluk baglamla: pozitif RSI <= 45, negatif RSI >= 55
  const div = rsi => T({ trend: {}, momentum: { rsi, divergences: [{ dir: 1 }, { dir: -1 }] } });
  assert.deepEqual(div(71), ['uyumsuzluk-negatif', 'asiri-alim']); assert.deepEqual(div(40), ['uyumsuzluk-pozitif']); assert.deepEqual(div(50), []);
  assert.deepEqual(T({ trend: {}, volatility: { bb: { squeeze: true } }, volume: { ratio: 2 } }), ['sikisma', 'hacim-patlamasi']);
  assert.deepEqual(T({ trend: {}, momentum: { rsi: 30, divergences: [] } }), ['asiri-satim']);
  assert.deepEqual(T({ trend: {} }, { st: { hi52Dist: -1.5, lo52Dist: 1 } }), ['zirve52', 'dip52']);
  assert.deepEqual(T({ trend: {} }, { st: { hi52Dist: -2.5, lo52Dist: 2.5 } }), []);
  // Bolge kirilimi: son 3 mum + kirilim mumunda hacim >= 1,5x; hacimsiz veride >= 3 temas ve son mum
  const flat = Array.from({ length: 60 }, (_, i) => ({ t: Date.UTC(2026, 0, 1) + i * DAYMS, o: 100, h: 101, l: 99, c: 100, v: 1000 }));
  const spike = flat.map((r, i) => i === 58 ? { ...r, v: 1600 } : r), novol = flat.map(r => ({ ...r, v: null }));
  const K = (rs, b) => _util.tagsOf({ rows: rs, pro: { structure: { breakouts: [b], patterns: [] } }, st: null, tw: null, engine: E });
  assert.deepEqual(K(flat, { dir: 1, ago: 1, touches: 3 }), [], 'hacim teyidi yok');
  assert.deepEqual(K(spike, { dir: 1, ago: 1, touches: 2 }), ['kirilim-yukari']);
  assert.deepEqual(K(spike, { dir: -1, ago: 1, touches: 2 }), ['kirilim-asagi']);
  assert.deepEqual(K(spike, { dir: 1, ago: 4, touches: 2 }), [], 'eski kirilim');
  assert.deepEqual(K(novol, { dir: 1, ago: 1, touches: 3 }), ['kirilim-yukari']); assert.deepEqual(K(novol, { dir: 1, ago: 2, touches: 3 }), []);
  assert.deepEqual(K(novol, { dir: 1, ago: 0, touches: 2 }), []);
  // Donchian 20: son kapanis onceki 20 mumun en yuksegi ustunde
  const don = flat.map((r, i) => i === 59 ? { ...r, c: 101.5, h: 102 } : r);
  assert.deepEqual(_util.tagsOf({ rows: don, pro: {}, st: null, tw: null, engine: E }), ['kirilim-yukari']);
  // bos/eksik pro cokmez
  assert.ok(Array.isArray(_util.tagsOf({ rows, pro: {}, st: null, tw: null, engine: E })));
});

test('matches: hazir filtre kurallari, bilinmeyen/bos filtre her seyi gecirir', () => {
  const d = mk(fakeMarket());
  const row = (o = {}) => ({ verdict: { label: 'BEKLE', dir: 0, score: 0, confidence: 50 }, trend: { d: 0, w: 0 }, tags: [], rsi: 50, rsiMin5: 50, turn: 0, ...o });
  const AL = { label: 'AL', dir: 1, score: 45, confidence: 60 };
  assert.equal(d.matches(row({ verdict: AL }), 'guclu-al'), true);
  assert.equal(d.matches(row({ verdict: { ...AL, score: 39 } }), 'guclu-al'), false);
  assert.equal(d.matches(row({ verdict: { ...AL, confidence: 49 } }), 'guclu-al'), false);
  assert.equal(d.matches(row({ verdict: AL, trend: { d: 1, w: -1 } }), 'guclu-al'), false);
  assert.equal(d.matches(row({ tags: ['kirilim-yukari'] }), 'kirilim'), true); assert.equal(d.matches(row({ tags: ['kirilim-asagi'] }), 'kirilim'), false);
  assert.equal(d.matches(row({ tags: ['sikisma'] }), 'sikisma'), true);
  assert.equal(d.matches(row({ rsi: 33, rsiMin5: 28, turn: 1 }), 'asiri-satim-donus'), true);
  assert.equal(d.matches(row({ rsi: 33, rsiMin5: 28, turn: 0 }), 'asiri-satim-donus'), false);
  assert.equal(d.matches(row({ rsi: 25, rsiMin5: 25, turn: -1 }), 'asiri-satim-donus'), false, 'hala dusuyor');
  assert.equal(d.matches(row({ rsi: 40, rsiMin5: 34, turn: 1, tags: ['uyumsuzluk-pozitif'] }), 'asiri-satim-donus'), true);
  assert.equal(d.matches(row({ rsi: 40, rsiMin5: 38, turn: 1, tags: ['uyumsuzluk-pozitif'] }), 'asiri-satim-donus'), false);
  assert.equal(d.matches(row({ tags: ['zirve52'] }), 'zirve52'), true);
  assert.equal(d.matches(row({ tags: ['hacim-patlamasi'] }), 'hacim'), true);
  assert.equal(d.matches(row({ tags: ['uyumsuzluk-negatif'] }), 'uyumsuzluk'), true);
  assert.equal(d.matches(row({ tags: ['altin-kesisim'] }), 'altin-kesisim'), true);
  assert.equal(d.matches(row({ verdict: { label: 'SAT', dir: -1, score: -45, confidence: 55 } }), 'dusus-riski'), true);
  assert.equal(d.matches(row({ verdict: { label: 'SAT', dir: -1, score: -30, confidence: 70 } }), 'dusus-riski'), false, 'zayif SAT');
  assert.equal(d.matches(row({ verdict: { label: 'SAT', dir: -1, score: -45, confidence: 40 } }), 'dusus-riski'), false, 'dusuk guven');
  for (const tg of ['olum-kesisimi', 'kirilim-asagi', 'ikili-tepe']) assert.equal(d.matches(row({ tags: [tg] }), 'dusus-riski'), true, tg);
  assert.equal(d.matches(row({ tags: ['uyumsuzluk-negatif'] }), 'dusus-riski'), false);
  assert.equal(d.matches(row({ tags: ['olum-kesisimi'], verdict: AL }), 'dusus-riski'), false);
  assert.equal(d.matches(row(), 'dusus-riski'), false);
  assert.equal(d.matches(row(), 'yok-boyle'), true); assert.equal(d.matches(row(), ''), true); assert.equal(d.matches(row(), null), true);
  for (const p of PRESETS) { assert.equal(d.matches(null, p.id), false); assert.equal(d.matches({}, p.id), false, p.id); }
});

test('breadth: yukselen/dusen/yatay, ortalama degisim, karar dagilimi', () => {
  const d = mk(fakeMarket());
  const b = d.breadth([{ chgPct: 2, verdict: { label: 'AL' } }, { chgPct: -1, verdict: { label: 'SAT' } }, { chgPct: 0, verdict: { label: 'BEKLE' } }, { chgPct: 1, verdict: { label: 'AL' } }, { chgPct: null }, null]);
  assert.deepEqual(b, { up: 2, down: 1, flat: 1, avgChg: 0.5, al: 2, sat: 1, bekle: 1, total: 5 });
  assert.deepEqual(d.breadth([]), { up: 0, down: 0, flat: 0, avgChg: null, al: 0, sat: 0, bekle: 0, total: 0 });
  assert.equal(d.breadth(null).total, 0);
});

test('createData varsayilan market/engine ile yuklenir (ag cagrisi yok)', () => {
  const d = createData();
  for (const k of ['quotes', 'scan', 'matches', 'stats', 'overview', 'breadth', 'search']) assert.equal(typeof d[k], 'function', k);
  assert.equal(d.search('aselsan')[0].symbol, 'ASELS');
});

test('quotes/scan: endeks kodu Turkce adla doner', async () => {
  const d = mk(fakeMarket({ rows: () => SC.up() }));
  const [q] = await d.quotes(['XU100'], { spark: false });
  assert.equal(q.symbol, 'XU100'); assert.equal(q.name, 'BIST 100 Endeksi');
  const r = await d.scan(['XU030'], { bench: null });
  assert.equal(r.rows[0].name, 'BIST 30 Endeksi');
});

// --- sektorler ve liderlik tablolari ---------------------------------------------------------------------------------
const { SECTORS, SECTOR_NAMES, sectorOf, sectorStats, factorRank, leaders } = D;

test('SECTORS: tum BIST100 kodlarinin sektoru var; her kod tek sektorde; isimler SECTOR_NAMES icinde', () => {
  const missing = U.BIST100.filter(c => !SECTORS[c] || sectorOf(c) === 'Diğer');
  assert.deepEqual(missing, [], 'sektorsuz: ' + missing.join());
  const all = Object.values(_util.SEC_LIST).join(' ').split(/\s+/).filter(Boolean);
  assert.equal(new Set(all).size, all.length, 'bir kod iki sektorde: ' + all.filter((c, i) => all.indexOf(c) !== i).join());
  for (const c of all) { assert.match(c, /^[A-Z][A-Z0-9]{3,4}$/, c); assert.equal(M.yahooSymbol(c), c + '.IS'); }
  for (const s of Object.values(SECTORS)) assert.ok(SECTOR_NAMES.includes(s), s);
  assert.ok(SECTOR_NAMES.includes('Diğer') && SECTOR_NAMES.includes('Endeks'));
  for (const s of Object.keys(_util.SEC_LIST)) assert.ok(all.some(c => SECTORS[c] === s), 'bos sektor ' + s);
  // NAMES'teki her hisse (endeks degil) de siniflandirilmis
  assert.deepEqual(Object.keys(NAMES).filter(c => sectorOf(c) === 'Diğer'), []);
  const exp = { THYAO: 'Havacılık', PGSUS: 'Havacılık', TAVHL: 'Havacılık', AKBNK: 'Bankacılık', GARAN: 'Bankacılık', ISCTR: 'Bankacılık', TSKB: 'Bankacılık',
    KCHOL: 'Holding', SAHOL: 'Holding', EREGL: 'Demir-Çelik', KRDMD: 'Demir-Çelik', FROTO: 'Otomotiv', TOASO: 'Otomotiv', TTRAK: 'Otomotiv',
    TUPRS: 'Enerji', AYGAZ: 'Enerji', AKSEN: 'Elektrik', ENJSA: 'Elektrik', ZOREN: 'Elektrik', ASTOR: 'Enerji Ekipmanları', BIMAS: 'Perakende',
    MGROS: 'Perakende', TCELL: 'Telekom', TTKOM: 'Telekom', CIMSA: 'Çimento-İnşaat', ENKAI: 'Çimento-İnşaat', PETKM: 'Kimya-Petrokimya',
    SASA: 'Kimya-Petrokimya', ASELS: 'Savunma', ALTNY: 'Savunma', ULKER: 'Gıda-İçecek', AEFES: 'Gıda-İçecek', SISE: 'Cam', TRALT: 'Madencilik',
    EKGYO: 'GYO', ANSGR: 'Sigorta', TURSG: 'Sigorta', MIATK: 'Teknoloji', PASEU: 'Ulaştırma-Lojistik', KARTN: 'Kağıt-Ambalaj',
    ARCLK: 'Beyaz Eşya-Elektronik', VESTL: 'Beyaz Eşya-Elektronik', MPARK: 'Sağlık', GUBRF: 'Tarım-Gübre', HEKTS: 'Tarım-Gübre',
    ISMEN: 'Finansal Hizmetler', FENER: 'Spor', VAKKO: 'Tekstil', MAALT: 'Turizm' };
  for (const [c, s] of Object.entries(exp)) assert.equal(sectorOf(c), s, c);
  // banka/holding/elektrik gruplari anlamli buyuklukte
  const n = s => U.BIST100.filter(c => SECTORS[c] === s).length;
  assert.ok(n('Bankacılık') >= 8 && n('Holding') >= 8 && n('Elektrik') >= 6, [n('Bankacılık'), n('Holding'), n('Elektrik')].join());
});

test('sectorOf: kod bicimleri, endeksler, kod sonu kurallari, bilinmeyen -> Diğer', () => {
  assert.equal(sectorOf('thyao'), 'Havacılık'); assert.equal(sectorOf(' THYAO.IS '), 'Havacılık'); assert.equal(sectorOf('şişe'), 'Cam', 'Ş/İ -> S/I (ysym gibi)');
  assert.equal(sectorOf('sise'), 'Cam'); assert.equal(sectorOf('ısctr'), 'Bankacılık', 'Turkce i -> I');
  assert.equal(sectorOf('XU100'), 'Endeks'); assert.equal(sectorOf('XU100.IS'), 'Endeks'); assert.equal(sectorOf('XBANK'), 'Endeks');
  assert.equal(sectorOf('ABGYO'), 'GYO'); assert.equal(sectorOf('XYZGY'), 'GYO'); assert.equal(sectorOf('QQBNK'), 'Bankacılık'); assert.equal(sectorOf('ZZHOL'), 'Holding');
  assert.equal(sectorOf('KOZAL'), 'Madencilik', 'eski kod');
  for (const x of ['ZZZZ', '', '   ', null, undefined, 42, {}, [], 'X!']) assert.equal(sectorOf(x), 'Diğer', String(x));
});

test('stats: mom12 = 12-1 ay momentumu; 253 mumdan azsa null', () => {
  const d = mk(fakeMarket());
  const rows = fromCloses(Array.from({ length: 300 }, (_, i) => 100 + i * (i % 2 ? 1.1 : 0.9)));
  const c = rows.map(r => r.c), N = c.length;
  assert.equal(d.stats(rows).mom12, +((c[N - 22] / c[N - 253] - 1) * 100).toFixed(2));
  assert.equal(d.stats(rows.slice(-253)).mom12, +((c[N - 22] / c[N - 253] - 1) * 100).toFixed(2));
  assert.equal(d.stats(rows.slice(-252)).mom12, null);
  assert.equal(d.stats(null).mom12, null);
  // son ayin hareketi mom12'yi etkilemez
  const jump = rows.map((r, i) => i >= N - 21 ? { ...r, c: r.c * 3, h: r.h * 3 } : r);
  assert.equal(d.stats(jump).mom12, d.stats(rows).mom12);
});

test('scan: satirlara sektor, perf.d120/d250, mom12 ve faktor puani eklenir', async () => {
  const m = fakeMarket({ rows: y => y === 'ASELS.IS' ? SC.down() : y === 'GARAN.IS' ? SC.up() : SC.flat(y.length) }), d = mk(m);
  const r = await d.scan(['THYAO', 'GARAN', 'ASELS', 'ZZZZ'], { bench: null });
  const row = Object.fromEntries(r.rows.map(x => [x.symbol, x]));
  assert.equal(row.THYAO.sector, 'Havacılık'); assert.equal(row.GARAN.sector, 'Bankacılık'); assert.equal(row.ASELS.sector, 'Savunma'); assert.equal(row.ZZZZ.sector, 'Diğer');
  const st = d.stats(SC.up(), null);
  assert.equal(row.GARAN.perf.d120, st.perf.d120); assert.equal(row.GARAN.perf.d250, st.perf.d250); assert.ok(Number.isFinite(row.GARAN.perf.d120));
  assert.equal(row.GARAN.mom12, st.mom12); assert.ok(Number.isFinite(row.GARAN.mom12), '300 gunluk veride mom12 var');
  assert.deepEqual(r.rows.map(x => x.symbol), [...r.rows].sort((a, b) => b.score - a.score || (a.symbol < b.symbol ? -1 : 1)).map(x => x.symbol), 'skor sirasi korunur');
  for (const x of r.rows) { assert.ok(x.factor && Number.isFinite(x.factor.total), x.symbol); assert.equal(x.factor.rs, null, 'bench yok'); }
  assert.equal(row.GARAN.factor.mom, 100); assert.equal(row.ASELS.factor.mom, 0); assert.equal(row.GARAN.factor.trend, 100);
  // Kisa veri: mom12 ve d250 null, tarama yine calisir
  const m2 = fakeMarket({ rows: () => SC.up().slice(-200) }), r2 = await mk(m2).scan(['THYAO'], { bench: null });
  assert.equal(r2.rows[0].mom12, null); assert.equal(r2.rows[0].perf.d250, null); assert.ok(Number.isFinite(r2.rows[0].perf.d120));
  // ABD taramasinda sektor bilinmez
  const r3 = await mk(fakeMarket({ rows: () => SC.up() })).scan(['LINK'], { market: 'US' });
  assert.equal(r3.rows[0].sector, 'Diğer');
  // createData ornegi de yeni fonksiyonlari verir
  for (const k of ['sectorOf', 'sectorStats', 'factorRank', 'leaders']) assert.equal(typeof d[k], 'function', k);
});

test('pctRank: 0-100, esitler ortalama sira, tek deger 50, null korunur', () => {
  const P = _util.pctRank;
  assert.deepEqual(P([3, 1, 2]), [100, 0, 50]);
  assert.deepEqual(P([5, null, 5, 1, NaN, 9]), [50, null, 50, 0, null, 100]);
  assert.deepEqual(P([7]), [50]); assert.deepEqual(P([null, undefined, 'x']), [null, null, null]); assert.deepEqual(P([]), []);
  assert.deepEqual(P([2, 2, 2, 2]), [50, 50, 50, 50]);
  assert.deepEqual(P([1, 2, 2, 3, 4]), [0, 37.5, 37.5, 75, 100]);
});

// Tarama satiri ureteci (faktor/sektor testleri icin)
const SR = (symbol, o = {}) => ({ symbol, sector: o.sector, chgPct: o.chg ?? null, score: o.score ?? null, verdict: o.label ? { label: o.label, score: o.score ?? null } : undefined,
  perf: { d20: o.d20 ?? null, d60: o.d60 ?? null, d120: o.d120 ?? null }, rs20: o.rs ?? null, atrPct: o.atr ?? null });

test('factorRank: yuzdelik faktorler, agirlikli toplam, eksik veriye dayaniklilik, girdi degismez', () => {
  const rows = [
    SR('AAAA', { d60: 30, d120: 50, rs: 10, score: 60, atr: 2 }),
    SR('BBBB', { d60: 10, d120: 20, rs: 0, score: 0, atr: 3 }),
    SR('CCCC', { d60: -5, d120: -10, rs: -8, score: -40, atr: 4 })
  ];
  const before = JSON.stringify(rows);
  const f = factorRank(rows);
  assert.equal(JSON.stringify(rows), before, 'girdi degismez'); assert.ok(!('factor' in rows[0]));
  assert.deepEqual(f.map(r => r.symbol), ['AAAA', 'BBBB', 'CCCC'], 'sira korunur');
  assert.deepEqual(f[0].factor, { mom: 100, rs: 100, trend: 100, lowVol: 100, total: 100, cov: 1 });
  assert.deepEqual(f[1].factor, { mom: 50, rs: 50, trend: 50, lowVol: 50, total: 50, cov: 1 });
  assert.deepEqual(f[2].factor, { mom: 0, rs: 0, trend: 0, lowVol: 0, total: 0, cov: 1 });
  // agirliklar: mom .35 rs .25 trend .25 lowVol .15
  const g = factorRank([SR('A', { d60: 1, d120: 1, rs: 0, score: 0, atr: 9 }), SR('B', { d60: 0, d120: 0, rs: 1, score: 1, atr: 1 })]);
  assert.equal(g[0].factor.total, 35); assert.equal(g[1].factor.total, 65);
  assert.equal(_util.FW.mom + _util.FW.rs + _util.FW.trend + _util.FW.lowVol, 1);
  // mom: d60 ve d120 yuzdeliklerinin ortalamasi yeniden siralanir; biri eksikse digeri
  const h = factorRank([SR('A', { d60: 10, d120: 0 }), SR('B', { d60: 0, d120: 10 }), SR('C', { d60: 20, d120: 30 })]);
  assert.equal(h[0].factor.mom, 25); assert.equal(h[1].factor.mom, 25, 'esit harman'); assert.equal(h[2].factor.mom, 100);
  const h2 = factorRank([SR('A', { d60: 10, d120: 0 }), SR('B', { d60: 0, d120: 10 }), SR('D', { d60: -9 }), SR('E', { d120: 99 })]);
  assert.equal(h2[2].factor.mom, 0, 'yalniz d60'); assert.equal(h2[3].factor.mom, 100, 'yalniz d120');
  // eksik faktor: agirlik kalanlara dagilir; kapsam < 0,5 -> total null
  const k = factorRank([SR('A', { d60: 5, score: 10, atr: 2 }), SR('B', { d60: 1, score: 20, atr: 1 }), SR('C', { score: 30 }), SR('D', {})]);
  assert.equal(k[0].factor.rs, null); assert.equal(k[0].factor.cov, 0.75);
  assert.equal(k[0].factor.total, +((100 * 0.35 + 0 * 0.25 + 0 * 0.15) / 0.75).toFixed(1));
  assert.equal(k[2].factor.cov, 0.25); assert.equal(k[2].factor.total, null, 'yalniz trend: yetersiz kapsam');
  assert.deepEqual(k[3].factor, { mom: null, rs: null, trend: null, lowVol: null, total: null, cov: 0 });
  // verdict.score yedegi; atrPct <= 0 yok sayilir
  const v = factorRank([{ symbol: 'A', verdict: { score: 5 }, atrPct: 0 }, { symbol: 'B', verdict: { score: -5 }, atrPct: -1 }]);
  assert.equal(v[0].factor.trend, 100); assert.equal(v[0].factor.lowVol, null);
  // bozuk girdiler
  for (const bad of [null, undefined, 'x', 5, {}]) assert.deepEqual(factorRank(bad), []);
  assert.deepEqual(factorRank([null, 3, 'x', []]), []);
  assert.equal(factorRank([null, SR('A', { d60: 1, score: 1 })]).length, 1);
  // tum degerler esit -> herkes 50
  assert.ok(factorRank([SR('A', { d60: 1, score: 1, atr: 1 }), SR('B', { d60: 1, score: 1, atr: 1 })]).every(r => r.factor.total === 50));
});

test('leaders: total/mom/rs/trend/lowVol/score, n, asc, faktor yoksa hesaplanir, degersiz satir disarida', () => {
  const rows = [
    SR('AAAA', { d60: 30, d120: 50, rs: -10, score: 60, atr: 5 }),
    SR('BBBB', { d60: 10, d120: 20, rs: 20, score: 10, atr: 1 }),
    SR('CCCC', { d60: -5, d120: -10, rs: 5, score: -40, atr: 3 }),
    SR('DDDD', { score: 80 }),
    SR('EEEE', {})
  ];
  const sy = a => a.map(r => r.symbol);
  assert.deepEqual(sy(leaders(rows, { by: 'score' })), ['DDDD', 'AAAA', 'BBBB', 'CCCC']);
  assert.deepEqual(sy(leaders(rows, { by: 'mom' })), ['AAAA', 'BBBB', 'CCCC']);
  assert.deepEqual(sy(leaders(rows, { by: 'rs' })), ['BBBB', 'CCCC', 'AAAA']);
  assert.deepEqual(sy(leaders(rows, { by: 'lowVol' })), ['BBBB', 'CCCC', 'AAAA']);
  assert.deepEqual(sy(leaders(rows, { by: 'rs', n: 2 })), ['BBBB', 'CCCC']);
  assert.deepEqual(sy(leaders(rows, { by: 'score', order: 'asc', n: 1 })), ['CCCC']);
  const t = leaders(rows); assert.ok(t.every(r => r.factor && Number.isFinite(r.factor.total)));
  // B: .35*50 + .25*100 + .25*33.3 + .15*100 = 65.8 > A: .35*100 + .25*66.7 = 51.7 > C; D yalniz trend (kapsam .25) -> yok
  assert.deepEqual(sy(t), ['BBBB', 'AAAA', 'CCCC']); assert.equal(t[0].factor.total, 65.8); assert.equal(t[1].factor.total, 51.7);
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].factor.total >= t[i].factor.total);
  // gecersiz secenekler: by -> total, n -> 10
  assert.deepEqual(sy(leaders(rows, { by: 'yok', n: -3 })), sy(t)); assert.deepEqual(sy(leaders(rows, null)), sy(t)); assert.deepEqual(sy(leaders(rows, { n: 'x' })), sy(t));
  assert.equal(leaders(Array.from({ length: 30 }, (_, i) => SR('S' + String(i).padStart(3, '0'), { score: i, d60: i, atr: 1 }))).length, 10);
  // esitlikte skor sonra kod
  const tie = leaders([SR('BBBB', { score: 5 }), SR('AAAA', { score: 5 }), SR('CCCC', { score: 5 })], { by: 'score' });
  assert.deepEqual(sy(tie), ['AAAA', 'BBBB', 'CCCC']);
  // faktoru olan satirlar yeniden hesaplanmaz
  const pre = rows.map(r => ({ ...r, factor: { total: r.symbol === 'EEEE' ? 99 : 1 } }));
  assert.equal(leaders(pre, { n: 1 })[0].symbol, 'EEEE');
  for (const bad of [null, undefined, 'x', {}]) assert.deepEqual(leaders(bad), []);
});

test('sectorStats: sektor ortalamalari, karar dagilimi, liderler, siralama, bozuk girdi', () => {
  const rows = [
    SR('AKBNK', { chg: 2, d20: 10, rs: 4, score: 50, label: 'AL' }),
    SR('GARAN', { chg: 1, d20: 6, rs: 2, score: 70, label: 'AL' }),
    SR('YKBNK', { chg: -1, d20: null, rs: null, score: 10, label: 'BEKLE' }),
    SR('HALKB', { chg: 0, d20: 2, score: -20, label: 'BEKLE' }),
    SR('THYAO', { chg: -2, d20: -5, rs: -6, score: -50, label: 'SAT', sector: 'Havacılık' }),
    SR('PGSUS', { chg: null, d20: null, score: null }),
    SR('ZZZZ', { chg: 3, score: 90, label: 'AL', sector: 'Özel' }),
    { ...SR('EREGL', { score: 5 }), symbol: undefined, sector: 'Demir-Çelik' },
    null, 'x'
  ];
  const s = sectorStats(rows), by = Object.fromEntries(s.map(x => [x.sector, x]));
  assert.deepEqual(s.map(x => x.sector), ['Özel', 'Bankacılık', 'Demir-Çelik', 'Havacılık']);
  const b = by['Bankacılık'];
  assert.equal(b.n, 4); assert.equal(b.avgChg, 0.5); assert.equal(b.avgD20, 6); assert.equal(b.avgRs20, 3); assert.equal(b.avgScore, 27.5);
  assert.equal(b.al, 2); assert.equal(b.bekle, 2); assert.equal(b.sat, 0); assert.equal(b.up, 2); assert.equal(b.down, 1);
  assert.deepEqual(b.leaders, ['GARAN', 'AKBNK', 'YKBNK']); assert.deepEqual(b.symbols, ['GARAN', 'AKBNK', 'YKBNK', 'HALKB']);
  assert.equal(b.avgTotal, null, 'faktor yok');
  const h = by['Havacılık'];
  assert.equal(h.n, 2); assert.equal(h.avgChg, -2); assert.equal(h.avgScore, -50); assert.deepEqual(h.leaders, ['THYAO']); assert.deepEqual(h.symbols, ['THYAO', 'PGSUS']);
  assert.equal(by['Demir-Çelik'].n, 1); assert.deepEqual(by['Demir-Çelik'].leaders, []);
  for (const x of s) for (const k of ['sector', 'n', 'avgChg', 'avgD20', 'avgRs20', 'avgScore', 'al', 'bekle', 'sat', 'leaders']) assert.ok(k in x, k);
  // skoru olmayan sektor sona; esit skorda hisse sayisi
  const z = sectorStats([SR('PGSUS', {}), SR('AKBNK', { score: 0 }), SR('GARAN', { score: 0 }), SR('TCELL', { score: 0 })]);
  assert.deepEqual(z.map(x => x.sector), ['Bankacılık', 'Telekom', 'Havacılık']);
  // faktorlu satirlarda ortalama toplam
  const f = sectorStats(factorRank(rows.filter(r => r && typeof r === 'object')));
  assert.ok(f.every(x => x.avgTotal === null || Number.isFinite(x.avgTotal)));
  for (const bad of [null, undefined, 'x', {}, [], [null, 1]]) assert.deepEqual(sectorStats(bad), []);
});
