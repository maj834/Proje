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
  assert.ok(calls[0].url.includes('THYAO.IS') && calls[0].url.includes('interval=1d') && calls[0].url.includes('range=1y'));
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
