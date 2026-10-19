'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { fresh, tmpDir, mockFetch, offline } = require('./helpers/util.js');

const NOW = Date.UTC(2026, 9, 20, 9, 0, 0); // 2026-10-20 12:00 TSI
const DAY = '2026-10-20';

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const M = fresh('market.js');
  M.init(dir);
  return { M, dir };
}

function yahooChart(symbol, n = 40, { currency = 'TRY' } = {}) {
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  for (let i = 0; i < n; i++) {
    ts.push(Math.floor(NOW / 1000) - (n - i) * 86400);
    const base = 300 + i;
    o.push(base); h.push(base + 3); l.push(base - 2); c.push(base + 1); v.push(1e6 + i);
  }
  // Yahoo bazen null mum dondurur; elenmeli.
  o.push(null); h.push(null); l.push(null); c.push(null); v.push(null); ts.push(Math.floor(NOW / 1000));
  return {
    chart: {
      result: [{
        meta: { currency, symbol, exchangeName: 'IST', regularMarketPrice: 341.5, chartPreviousClose: 339.0, shortName: 'TURK HAVA YOLLARI',
          regularMarketTime: Math.floor(NOW / 1000), regularMarketDayHigh: 345, regularMarketDayLow: 338, regularMarketVolume: 12345678 },
        timestamp: ts,
        indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] }
      }],
      error: null
    }
  };
}
const yahooNews = () => ({
  news: [
    { uuid: '1', title: 'THY yolcu sayisini acikladi', publisher: 'AA', link: 'https://example.com/a', providerPublishTime: 1760950000 },
    { uuid: '2', title: 'Kotu link', publisher: 'X', link: 'javascript:alert(1)', providerPublishTime: 1760950000 },
    { uuid: '3', title: 'Duz http', publisher: 'Y', link: 'http://example.com/b', providerPublishTime: 1760950000 },
    { uuid: '4', title: '', publisher: 'Z', link: 'https://example.com/c' }
  ]
});
const avNewsBody = sym => ({
  items: '3', feed: [
    { title: 'Apple beats', url: 'https://news.example/1', source: 'Reuters', time_published: '20261019T143000', overall_sentiment_score: 0.1,
      overall_sentiment_label: 'Neutral', ticker_sentiment: [{ ticker: sym, ticker_sentiment_score: '0.45', ticker_sentiment_label: 'Bullish' }] },
    { title: 'Evil', url: 'javascript:alert(1)', source: 'X', time_published: '20261019T120000', overall_sentiment_score: -0.9 },
    { title: 'Apple dips', url: 'https://news.example/2', source: 'Bloomberg', time_published: '20261018T090000', overall_sentiment_score: -0.15, overall_sentiment_label: 'Neutral' }
  ]
});
const AV_KEY = 'DEMOKEY12345';

const isChart = /query1\.finance\.yahoo\.com\/v8\/finance\/chart\//;
const isNews = /query2\.finance\.yahoo\.com\/v1\/finance\/search/;
const isAV = /alphavantage\.co\/query/;

test('yahooSymbol: BIST, Turkce karakterler, ABD, ozel kodlar ve gecersiz girdiler', t => {
  const { M } = setup(t);
  assert.equal(M.yahooSymbol('thyao'), 'THYAO.IS');
  assert.equal(M.yahooSymbol(' thyao ', 'BIST'), 'THYAO.IS');
  assert.equal(M.yahooSymbol('şişe'), 'SISE.IS');
  assert.equal(M.yahooSymbol('isctr'), 'ISCTR.IS');
  assert.equal(M.yahooSymbol('ereğl'), 'EREGL.IS');
  assert.equal(M.yahooSymbol('aapl', 'US'), 'AAPL');
  assert.equal(M.yahooSymbol('intc', 'US'), 'INTC'); // tr-TR buyuk harfte i -> İ -> I
  assert.equal(M.yahooSymbol('BTC-USD'), 'BTC-USD');
  assert.equal(M.yahooSymbol('xu100.is'), 'XU100.IS');
  assert.equal(M.yahooSymbol('EURTRY=X'), 'EURTRY=X');
  assert.equal(M.yahooSymbol('^GSPC', 'US'), '^GSPC');
  for (const bad of ['', '   ', null, undefined, 'a b!', '<script>', 'x'.repeat(21), 'TH/YAO']) assert.equal(M.yahooSymbol(bad), null, String(bad));
});

test('load: Yahoo mumlari + haberler; javascript:/http linkler elenir', async t => {
  const { M } = setup(t);
  const calls = mockFetch(t, [[isChart, () => ({ body: yahooChart('THYAO.IS') })], [isNews, () => ({ body: yahooNews() })]]);
  const out = await M.load('thyao');
  assert.deepEqual(out.errors, []);
  assert.equal(out.symbol, 'THYAO');
  assert.equal(out.yahoo, 'THYAO.IS');
  assert.equal(out.chart.rows.length, 40); // null mum atildi
  assert.deepEqual(Object.keys(out.chart.rows[0]).sort(), ['c', 'h', 'l', 'o', 't', 'v']);
  assert.equal(out.chart.quote.price, 341.5);
  assert.equal(out.chart.quote.prev, 339);
  assert.equal(out.chart.quote.name, 'TURK HAVA YOLLARI');
  assert.equal(out.chart.cached, undefined);
  assert.deepEqual(out.news.items.map(n => n.url), ['https://example.com/a']);
  assert.ok(calls[0].url.includes('THYAO.IS') && calls[0].url.includes('interval=1d') && calls[0].url.includes('range=2y'));
  assert.ok(calls[0].init.headers['user-agent']);
  // BIST'te AV anahtari olsa bile haber icin AV cagrilmaz (kota korunur).
  assert.equal(calls.filter(c => isAV.test(c.url)).length, 0);
  assert.equal(out.avLeft, 25);
});

test('load: ikinci cagri onbellekten gelir (fetch yok), dosyaya yazilir', async t => {
  const { M, dir } = setup(t);
  const calls = mockFetch(t, [[isChart, () => ({ body: yahooChart('THYAO.IS') })], [isNews, () => ({ body: yahooNews() })]]);
  await M.load('THYAO', { tf: '1g' });
  const n = calls.length;
  const again = await M.load('thyao', { tf: '1g' });
  assert.equal(calls.length, n);
  assert.equal(again.chart.cached, true);
  assert.equal(again.news.cached, true);
  M.flush();                                          // diske yazma kisilir (ilk hemen, sonrakiler toplu); kapanista flush
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'market-cache.json'), 'utf8'));
  assert.ok(disk['yc:THYAO.IS:1g'] && disk['yn:THYAO.IS']);
  // Baska zaman dilimi ayri anahtar -> yeni istek; TTL dolunca yeniden istek.
  await M.load('THYAO', { tf: '5dk', news: false });
  assert.equal(calls.length, n + 1);
  assert.ok(calls[n].url.includes('interval=5m'));
  t.mock.timers.setTime(NOW + 1801 * 1000);
  await M.load('THYAO', { tf: '1g', news: false });
  assert.equal(calls.length, n + 2);
});

test('load: cevrimdisi iken eski onbellek "stale" olarak doner', async t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const old = { at: NOW - 3 * 3600 * 1000, v: { source: 'yahoo', symbol: 'THYAO.IS', tf: '1g', rows: [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }], quote: { price: 1.5 } } };
  fs.writeFileSync(path.join(dir, 'market-cache.json'), JSON.stringify({ 'yc:THYAO.IS:1g': old }));
  const M = fresh('market.js');
  M.init(dir);
  mockFetch(t, [[() => true, () => offline()]]);
  const out = await M.load('THYAO');
  assert.equal(out.chart.stale, true);
  assert.equal(out.chart.cached, true);
  assert.equal(out.chart.staleReason, 'Bağlantı yok.');
  assert.equal(out.chart.quote.price, 1.5);
  assert.deepEqual(out.errors, ['Yahoo haber: Bağlantı yok.']);
});

test('load: onbellek yokken cevrimdisi ve 404 / 429 mesajlari', async t => {
  const { M } = setup(t);
  let mode = 'off';
  mockFetch(t, [[() => true, () => mode === 'off' ? offline() : { status: mode, body: { chart: { result: null, error: { description: 'No data found' } } } }]]);
  let out = await M.load('THYAO', { news: false });
  assert.deepEqual(out.errors, ['Mum verisi: Bağlantı yok.']);
  assert.equal(out.chart, undefined);
  mode = 404;
  out = await M.load('XYZQ', { news: false });
  assert.deepEqual(out.errors, ['Mum verisi: XYZQ.IS bulunamadı. Kodu ve borsa seçimini (BIST/ABD) kontrol et.']);
  mode = 429;
  out = await M.load('ABCD', { news: false });
  assert.match(out.errors[0], /çok sık istek/);
  mode = 200; // result:null + error.description
  out = await M.load('EFGH', { news: false });
  assert.deepEqual(out.errors, ['Mum verisi: Yahoo: No data found']);
  out = await M.load('???', { news: false });
  assert.deepEqual(out.errors, ['Mum verisi: Geçerli bir hisse kodu yaz (ör. THYAO).']);
});

test('ABD: Alpha Vantage haber + duygu skoru, kota sayaci azalir', async t => {
  const { M, dir } = setup(t);
  const calls = mockFetch(t, [
    [isChart, () => ({ body: yahooChart('AAPL', 40, { currency: 'USD' }) })],
    [isNews, () => ({ body: { news: [] } })],
    [isAV, url => ({ body: avNewsBody(new URL(url).searchParams.get('tickers')) })]
  ]);
  const out = await M.load('aapl', { market: 'US', avKey: AV_KEY });
  assert.deepEqual(out.errors, []);
  assert.equal(out.yahoo, 'AAPL');
  const av = calls.find(c => isAV.test(c.url));
  const q = new URL(av.url).searchParams;
  assert.equal(q.get('function'), 'NEWS_SENTIMENT');
  assert.equal(q.get('tickers'), 'AAPL');
  assert.equal(q.get('apikey'), AV_KEY);
  assert.deepEqual(out.avNews.items.map(n => n.title), ['Apple beats', 'Apple dips']);
  assert.equal(out.avNews.items[0].sentiment, 0.45);
  assert.equal(out.avNews.items[0].label, 'Bullish');
  assert.equal(out.avNews.items[0].time, Date.UTC(2026, 9, 19, 14, 30));
  assert.equal(out.avNews.sentiment, 0.15);
  assert.equal(out.avLeft, 24);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'av-usage.json'), 'utf8')), { day: DAY, n: 1 });
  // Onbellekten gelen AV cevabi kota harcamaz.
  const again = await M.load('aapl', { market: 'US', avKey: AV_KEY });
  assert.equal(again.avLeft, 24);
});

test('ABD: Yahoo basarisizsa AV GLOBAL_QUOTE; gecersiz AV anahtari', async t => {
  const { M } = setup(t);
  const calls = mockFetch(t, [
    [isChart, () => ({ status: 404, body: {} })],
    [isAV, () => ({ body: { 'Global Quote': { '01. symbol': 'MSFT', '03. high': '420.10', '04. low': '411.00', '05. price': '418.50', '06. volume': '20000000',
      '07. latest trading day': '2026-10-19', '08. previous close': '415.00', '10. change percent': '0.8434%' } } })]
  ]);
  const out = await M.load('msft', { market: 'US', avKey: AV_KEY, news: false });
  assert.deepEqual(out.errors, ['Mum verisi: MSFT bulunamadı. Kodu ve borsa seçimini (BIST/ABD) kontrol et.']);
  assert.deepEqual(out.quote, { source: 'alphavantage', price: 418.5, prev: 415, change: 0.8434, dayHigh: 420.1, dayLow: 411, volume: 20000000, time: '2026-10-19' });
  assert.equal(new URL(calls.find(c => isAV.test(c.url)).url).searchParams.get('function'), 'GLOBAL_QUOTE');
  const bad = await M.load('ibm', { market: 'US', avKey: 'x!', news: false });
  assert.deepEqual(bad.errors.slice(-1), ['Alpha Vantage anahtarı geçersiz.']);
});

test('Alpha Vantage: "Information" sinir mesaji hata olarak doner', async t => {
  const { M } = setup(t);
  mockFetch(t, [
    [isChart, () => ({ body: yahooChart('AAPL') })], [isNews, () => ({ body: { news: [] } })],
    [isAV, () => ({ body: { Information: 'We have detected your API key as DEMOKEY12345 and our standard API rate limit is 25 requests per day.' } })]
  ]);
  const out = await M.load('aapl', { market: 'US', avKey: AV_KEY });
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /^Alpha Vantage: We have detected/);
  assert.ok(out.errors[0].length <= 'Alpha Vantage: '.length + 140);
  assert.equal(out.avNews, undefined);
});

test('Alpha Vantage: gunluk 25 istek dolunca istek atilmaz; ertesi gun sifirlanir', async t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  fs.writeFileSync(path.join(dir, 'av-usage.json'), JSON.stringify({ day: DAY, n: 24 }));
  const M = fresh('market.js');
  M.init(dir);
  assert.equal(M.avLeft(), 1);
  const calls = mockFetch(t, [
    [isChart, () => ({ body: yahooChart('X') })], [isNews, () => ({ body: { news: [] } })],
    [isAV, url => ({ body: avNewsBody(new URL(url).searchParams.get('tickers')) })]
  ]);
  const a = await M.load('aapl', { market: 'US', avKey: AV_KEY });
  assert.deepEqual(a.errors, []);
  assert.equal(a.avLeft, 0);
  const avCalls = () => calls.filter(c => isAV.test(c.url)).length;
  assert.equal(avCalls(), 1);
  const b = await M.load('nvda', { market: 'US', avKey: AV_KEY });
  assert.deepEqual(b.errors, ['Alpha Vantage günlük ücretsiz sınırı (25) doldu; yarın sıfırlanır.']);
  assert.equal(avCalls(), 1);
  assert.equal(b.avLeft, 0);
  t.mock.timers.setTime(NOW + 86400 * 1000);
  assert.equal(M.avLeft(), 25);
});

test('candles: Yahoo bos quote nesnesi TypeError vermez (F12)', async t => {
  const { M } = setup(t);
  mockFetch(t, [[() => true, () => ({ body: { chart: { result: [{ meta: { regularMarketPrice: 10 }, timestamp: [1, 2], indicators: { quote: [{}] } }] } } })]]);
  const out = await M.load('THYAO', { news: false });
  assert.ok(!out.errors.some(e => /Cannot read|undefined/.test(e)), out.errors.join());
  const c = await M.candles('GARAN');
  assert.deepEqual(c.rows, []);
  assert.equal(c.quote.price, 10);
});

test('prev: chartPreviousClose (araligin basi) degil, bir onceki gunun kapanisi; regularMarketPreviousClose oncelikli', async (t) => {
  const body = yahooChart('THYAO.IS'); body.chart.result[0].meta.chartPreviousClose = 200;   // bir yil onceki kapanis
  const M = fresh('market.js'); M.init({ dir: tmpDir() });
  mockFetch(t, [[isChart, () => ({ body })], [isNews, () => ({ body: yahooNews() })]]);
  const out = await M.load('THYAO', { news: false });
  assert.equal(out.chart.quote.prev, 339, 'dunun kapanisi (mumlardan)');
  const b2 = yahooChart('ASELS.IS'); b2.chart.result[0].meta.regularMarketPreviousClose = 338.5;
  const M2 = fresh('market.js'); M2.init({ dir: tmpDir() });
  mockFetch(t, [[isChart, () => ({ body: b2 })]]);
  assert.equal((await M2.load('ASELS', { news: false })).chart.quote.prev, 338.5);
});

test('multi: ana ve ust zaman dilimleri ayri ayri yuklenir; hatali dilim atlanir', async t => {
  const { M } = setup(t);
  const calls = mockFetch(t, [[u => /interval=60m/.test(u), () => ({ status: 500, body: {} })], [u => /v8\/finance\/chart/.test(u), u => ({ body: yahooChart('THYAO.IS') })]]);
  const r = await M.multi('thyao', { tf: '1g' });
  assert.deepEqual(Object.keys(r.frames).sort(), ['1g', '1h']);
  assert.equal(r.frames['1g'].length, 40);
  assert.equal(r.errors.length, 1); assert.match(r.errors[0], /^1s: /);
  assert.ok(calls.some(c => /interval=1wk/.test(c.url)) && calls.some(c => /interval=1d&range=2y/.test(c.url)));
  assert.deepEqual(M.MTF['1g'], ['1h', '1s']);
});

// --- quote(): anlik fiyat (gun ici 5 dk, range=1d) ---------------------------------------------------------------
// Bugunun (NOW gunu) 5 dk mumlari; istege bagli dunden mumlar (Yahoo bazen iki gun dondurur) ve meta alanlari.
function yahooIntraday(symbol, { meta = {}, n = 12, yesterday = 0, nulls = true } = {}) {
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  const day0 = Date.UTC(2026, 9, 20, 7, 0, 0) / 1000; // 10:00 TSI
  for (let i = 0; i < yesterday; i++) { ts.push(day0 - 86400 + i * 300); o.push(330); h.push(331); l.push(329); c.push(330 + i); v.push(500); }
  for (let i = 0; i < n; i++) { ts.push(day0 + i * 300); o.push(340 + i); h.push(342 + i); l.push(339 + i); c.push(341 + i); v.push(1000); }
  if (nulls) { ts.push(day0 + n * 300); o.push(null); h.push(null); l.push(null); c.push(null); v.push(null); }
  return { chart: { result: [{ meta: { currency: 'TRY', symbol, exchangeName: 'IST', shortName: 'TURK HAVA YOLLARI', ...meta }, timestamp: ts,
    indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }], error: null } };
}
const fullMeta = { regularMarketPrice: 352.25, chartPreviousClose: 339, regularMarketTime: Math.floor(NOW / 1000), regularMarketDayHigh: 355, regularMarketDayLow: 338.5, regularMarketVolume: 9876543 };

test('quote: 5 dk / 1 gun istegi, anlik fiyat, onceki kapanis, degisim', async t => {
  const { M, dir } = setup(t);
  const calls = mockFetch(t, [[isChart, () => ({ body: yahooIntraday('THYAO.IS', { meta: fullMeta }) })]]);
  const q = await M.quote('thyao');
  assert.ok(calls[0].url.includes('/chart/THYAO.IS?') && calls[0].url.includes('interval=5m') && calls[0].url.includes('range=1d'), calls[0].url);
  assert.ok(calls[0].init.headers['user-agent']);
  assert.equal(q.symbol, 'THYAO.IS'); assert.equal(q.price, 352.25); assert.equal(q.prev, 339);
  assert.equal(q.chg, 13.25); assert.equal(q.chgPct, 3.91);
  assert.equal(q.dayHigh, 355); assert.equal(q.dayLow, 338.5); assert.equal(q.volume, 9876543); assert.equal(q.time, NOW);
  assert.equal(q.name, 'TURK HAVA YOLLARI'); assert.equal(q.currency, 'TRY');
  assert.equal(q.intraday.length, 12); assert.equal(q.intraday[11], 352); // null mum elendi
  assert.equal(q.cached, undefined);
  // diske yazilmaz (izleme listesi her dakika yeniler)
  assert.ok(!fs.existsSync(path.join(dir, 'market-cache.json')) || !Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'market-cache.json'), 'utf8'))).some(k => /THYAO/.test(k)));
});

test('quote: prev onceligi regularMarketPreviousClose > previousClose > dunun son mumu > chartPreviousClose', async t => {
  const { M } = setup(t);
  let meta;
  mockFetch(t, [[isChart, url => ({ body: yahooIntraday(new URL(url).pathname.split('/').pop(), meta) })]]);
  meta = { meta: { ...fullMeta, regularMarketPreviousClose: 345, previousClose: 344 } };
  assert.equal((await M.quote('AAAA')).prev, 345);
  meta = { meta: { ...fullMeta, previousClose: 344 } };
  assert.equal((await M.quote('BBBB')).prev, 344);
  meta = { meta: { ...fullMeta }, yesterday: 3 }; // dunden 3 mum: son kapanis 332
  const c = await M.quote('CCCC'); assert.equal(c.prev, 332); assert.equal(c.intraday.length, 12, 'yalniz son gunun mumlari');
  meta = { meta: { ...fullMeta } };
  assert.equal((await M.quote('DDDD')).prev, 339);
  meta = { meta: { regularMarketPrice: 10 } };
  const e = await M.quote('EEEE'); assert.equal(e.prev, null); assert.equal(e.chg, null); assert.equal(e.chgPct, null);
});

test('quote: meta eksikse fiyat/gun ici yuksek-dusuk/hacim mumlardan', async t => {
  const { M } = setup(t);
  mockFetch(t, [[isChart, () => ({ body: yahooIntraday('X.IS', { meta: { shortName: undefined, chartPreviousClose: 340 }, yesterday: 2 }) })]]);
  const q = await M.quote('GARAN');
  assert.equal(q.price, 352); assert.equal(q.dayHigh, 353); assert.equal(q.dayLow, 339); assert.equal(q.volume, 12000);
  assert.equal(q.prev, 331, 'dunun son mumu'); assert.equal(q.time, Date.UTC(2026, 9, 20, 7, 55)); assert.equal(q.name, null);
});

test('quote: 60 sn onbellek; ayni anda gelen istekler tek istege iner', async t => {
  const { M } = setup(t);
  const calls = mockFetch(t, [[isChart, () => ({ body: yahooIntraday('THYAO.IS', { meta: fullMeta }) })]]);
  const [a, b, c] = await Promise.all([M.quote('THYAO'), M.quote('thyao'), M.quote('THYAO')]);
  assert.equal(calls.length, 1); assert.equal(a.price, 352.25); assert.equal(b.price, 352.25); assert.equal(c.price, 352.25);
  const again = await M.quote('THYAO'); assert.equal(calls.length, 1); assert.equal(again.cached, true);
  t.mock.timers.setTime(NOW + 59 * 1000); await M.quote('THYAO'); assert.equal(calls.length, 1);
  t.mock.timers.setTime(NOW + 61 * 1000); const fresh2 = await M.quote('THYAO'); assert.equal(calls.length, 2); assert.equal(fresh2.cached, undefined);
  // gunluk mum onbellegi ayri; quote onu kullanmaz/bozmaz
  await M.quote('GARAN'); assert.equal(calls.length, 3);
});

test('quote: cevrimdisi -> son bilinen fiyat ya da gunluk mum onbellegi (stale); hicbiri yoksa hata', async t => {
  const { M } = setup(t);
  let off = false;
  mockFetch(t, [[isChart, url => off ? offline() : /interval=1d/.test(url) ? { body: yahooChart('ASELS.IS') } : { body: yahooIntraday('THYAO.IS', { meta: fullMeta }) }]]);
  await M.quote('THYAO'); await M.candles('ASELS', '1g');
  off = true; t.mock.timers.setTime(NOW + 120 * 1000);
  const a = await M.quote('THYAO');
  assert.equal(a.stale, true); assert.equal(a.cached, true); assert.equal(a.staleReason, 'Bağlantı yok.'); assert.equal(a.price, 352.25);
  const b = await M.quote('ASELS');
  assert.equal(b.stale, true); assert.equal(b.price, 341.5); assert.equal(b.prev, 339); assert.equal(b.chgPct, 0.74); assert.equal(b.symbol, 'ASELS.IS');
  await assert.rejects(M.quote('GARAN'), /Bağlantı yok\./);
});

test('quote: gecersiz kod, 404, bos sonuc ve fiyatsiz cevap mesajlari; ABD/ozel semboller', async t => {
  const { M } = setup(t);
  let mode = 404;
  const calls = mockFetch(t, [[isChart, url => mode === 404 ? { status: 404, body: {} } : mode === 'empty' ? { body: { chart: { result: null, error: { description: 'No data found' } } } }
    : mode === 'noprice' ? { body: { chart: { result: [{ meta: {}, timestamp: [], indicators: { quote: [{}] } }] } } } : { body: yahooIntraday('USDTRY=X', { meta: { ...fullMeta, currency: 'TRY' } }) }]]);
  await assert.rejects(M.quote('???'), /Geçerli bir hisse kodu/);
  assert.equal(calls.length, 0);
  await assert.rejects(M.quote('XYZQ'), /XYZQ\.IS bulunamadı/);
  mode = 'empty'; await assert.rejects(M.quote('ABCD'), /Yahoo: No data found/);
  mode = 'noprice'; await assert.rejects(M.quote('EFGH'), /fiyat döndürmedi/);
  mode = 'ok';
  const u = await M.quote('USDTRY=X', 'US'); assert.equal(u.symbol, 'USDTRY=X'); assert.ok(calls[calls.length - 1].url.includes('/chart/USDTRY%3DX?'));
  const a = await M.quote('aapl', 'US'); assert.equal(a.symbol, 'AAPL');
  // hata sonrasi bekleyen istek kaydi temizlenir: yeni cagri yeniden dener
  mode = 404; await assert.rejects(M.quote('IJKL'), /bulunamadı/); mode = 'ok'; assert.equal((await M.quote('IJKL')).price, 352.25);
});

test('onbellek diske kisilarak yazilir; yenilenen kayit sona tasinir, en fazla 220 kayit', async t => {
  const { M, dir } = setup(t);
  mockFetch(t, [[isChart, url => ({ body: yahooChart(decodeURIComponent(url.split('/chart/')[1].split('?')[0])) })]]);
  await M.candles('THYAO', '1g');
  const f = path.join(dir, 'market-cache.json');
  assert.ok(JSON.parse(fs.readFileSync(f, 'utf8'))['yc:THYAO.IS:1g'], 'ilk yazma hemen');
  for (let i = 0; i < 230; i++) await M.candles('S' + String(i).padStart(3, '0') + 'X', '1g');
  M.flush();
  const disk = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(Object.keys(disk).length, 220);
  assert.ok(!disk['yc:THYAO.IS:1g'], 'en eski dusar');
  assert.ok(disk['yc:S229X.IS:1g']);
});
