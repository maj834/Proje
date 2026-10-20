'use strict';
// ext-apis.js: NewsAPI / ExchangeRate-API / CoinGecko Demo istemcisi. Ag yok: fetch sahte, saat sahte, sayac dosyasi gecici dizinde.
// Anahtarlar SAHTEDIR (gercek anahtar asla koda/teste yazilmaz); yalniz bicim denetimini gecsin diye uzunluklari uygun.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const X = require('../ext-apis.js');
const { createExtApis, newsQuery, crosses, message, scrub, validKey, fold, clean, period, LIMITS, NEWS_NOTE, COINS } = X;

const KEYS = { news: 'fakeNewsKeyForTests0000000000001', fx: 'fakeFxKeyForTests0000001', gecko: 'CG-fakeGeckoKeyForTests01' };
const ALLKEYS = Object.values(KEYS);
const T0 = Date.UTC(2026, 9, 20, 10, 0, 0);   // 20 Ekim 2026 10:00 UTC
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

// --- sahte ag ------------------------------------------------------------------------------------------------------
const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => headers[String(k).toLowerCase()] ?? null },
  text: async () => typeof body === 'string' ? body : JSON.stringify(body),
});
const hang = () => new Promise(() => {});
const ART = (i, o = {}) => ({ source: { id: null, name: 'Kaynak ' + i }, author: null, title: 'Başlık ' + i + ' - Kaynak ' + i,
  description: '<p>Açıklama &amp; ayrıntı ' + i + '</p>', url: 'https://ornek.com.tr/haber/' + i, urlToImage: null,
  publishedAt: new Date(T0 - i * HOUR).toISOString(), content: null, ...o });
const okNews = () => res(200, { status: 'ok', totalResults: 3, articles: [ART(1), ART(2), ART(3)] });
const fxBody = (base = 'USD', next = T0 + 5 * HOUR) => ({ result: 'success', documentation: 'https://www.exchangerate-api.com/docs', terms_of_use: 'x',
  time_last_update_unix: Math.floor((T0 - HOUR) / 1000), time_next_update_unix: Math.floor(next / 1000), base_code: base,
  conversion_rates: { USD: 1, TRY: 41.8, EUR: 0.8, GBP: 0.76, JPY: 150, CHF: 0.8, BAD: 'x', XYZ: -1 } });
const okFx = url => res(200, fxBody(url.split('/').pop()));
const okQuota = () => res(200, { result: 'success', plan_quota: 1500, requests_remaining: 1234, refresh_day_of_month: 17 });
const PRICES = { bitcoin: { usd: 65432.1, try: 2735000 }, ethereum: { usd: 2500.5, try: 104500 }, solana: { usd: 150.25, try: 6280 },
  binancecoin: { usd: 600, try: 25080 }, ripple: { usd: 0.55, try: 23 } };
function okGecko(url) {
  const u = new URL(url);
  if (u.pathname.endsWith('/simple/price')) return res(200, { bitcoin: { usd: 65432.1 } });
  const vs = u.searchParams.get('vs_currency'), ids = u.searchParams.get('ids').split(','), sp = u.searchParams.get('sparkline') === 'true';
  return res(200, ids.filter(id => PRICES[id]).map((id, i) => ({ id, symbol: id.slice(0, 3), name: id[0].toUpperCase() + id.slice(1),
    current_price: PRICES[id][vs], market_cap: 1e9 * (10 - i), market_cap_rank: i + 1,
    price_change_percentage_24h: 1.234, price_change_percentage_24h_in_currency: vs === 'usd' ? 2.345 : 9.9,
    sparkline_in_7d: sp ? { price: Array.from({ length: 168 }, (_, k) => 100 + k) } : undefined })));
}
function router(over = {}) {
  return (url, opts, calls) => {
    if (url.startsWith('https://newsapi.org/v2/everything')) return (over.news || okNews)(url, opts, calls);
    if (url.startsWith('https://v6.exchangerate-api.com/v6/')) return url.endsWith('/quota') ? (over.quota || okQuota)(url, opts, calls) : (over.fx || okFx)(url, opts, calls);
    if (url.startsWith('https://api.coingecko.com/api/v3/')) return (over.gecko || okGecko)(url, opts, calls);
    throw new Error('beklenmeyen adres ' + url);
  };
}
const tmpdirs = [];
const mkdir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-apis-test-')); tmpdirs.push(d); return d; };
test.after(() => { for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true }); });

function setup({ keys = KEYS, dir = mkdir(), handler = router(), timeoutMs = 2000, t0 = T0 } = {}) {
  const clock = { t: t0 }, calls = [];
  const fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return handler(String(url), opts, calls); };
  const api = createExtApis({ fetch, now: () => clock.t, dir, timeoutMs,
    keys: { news: () => keys.news, fx: () => keys.fx, gecko: () => keys.gecko } });
  const only = pre => calls.filter(c => c.url.startsWith(pre));
  return { api, clock, calls, dir, only, file: path.join(dir, 'ext-apis.json') };
}
const NEWS = 'https://newsapi.org/', FXU = 'https://v6.exchangerate-api.com/', CG = 'https://api.coingecko.com/';
const noKey = (v, label = '') => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  for (const k of ALLKEYS) { assert.ok(!s.includes(k), label + ' anahtar sizdi: ' + s.slice(0, 200)); assert.ok(!s.includes(k.slice(0, 8)), label + ' anahtar parcasi sizdi: ' + s.slice(0, 300)); }
};
const readState = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeState = (file, s) => fs.writeFileSync(file, JSON.stringify(s));

// ============================================================================================================================
// Saf yardimcilar
// ============================================================================================================================
test('newsQuery: Türkçe şirket adı, ASCII yazımı, basındaki kısa ad ve bağlamlı kod', () => {
  const q = newsQuery('thyao.is', 'Türk Hava Yolları');
  assert.ok(q.includes('"Türk Hava Yolları"'));
  assert.ok(q.includes('"Turk Hava Yollari"'), 'Türkçe karakter yazmayan kaynaklar için ASCII yazımı');
  assert.ok(q.includes('("THY" AND (hisse OR hissesi OR hisseleri OR borsa OR BIST))'), 'kısa ad yalnız borsa bağlamında');
  assert.ok(q.endsWith('(THYAO AND (hisse OR hissesi OR hisseleri OR borsa OR BIST))'), '.IS atılır, kod büyük harf ve bağlamlı');
  assert.ok(!/(^|[^A-Z"(])THYAO OR/.test(q), 'kod tek başına aranmaz');
  // Ereğli -> basın "Erdemir" der
  assert.ok(newsQuery('EREGL', 'Ereğli Demir Çelik').includes('"Erdemir"'));
  // Türkçe büyük İ/ı ve Ş/ş katlanır
  assert.equal(fold('İŞ Bankası ığüşöç ÇĞÜŞÖ'), 'IS Bankasi igusoc CGUSO');
});

test('newsQuery: ad bilinmiyorsa (ad = kod) yalnız bağlamlı kod; "MAVI" tırnakla aranmaz', () => {
  for (const c of ['MAVI', 'LOGO', 'KONYA', 'FENER']) {
    assert.equal(newsQuery(c, c), '(' + c + ' AND (hisse OR hissesi OR hisseleri OR borsa OR BIST))');
    assert.equal(newsQuery(c, ''), newsQuery(c, c));
    assert.equal(newsQuery(c, null), newsQuery(c, c));
  }
  // Kodla aynı yazılan gerçek ad (küçük harfli / Türkçe harfli) kalır
  assert.ok(newsQuery('AYGAZ', 'Aygaz').startsWith('"Aygaz" OR '));
  assert.ok(newsQuery('CIMSA', 'Çimsa').startsWith('"Çimsa" OR "Cimsa" OR '));
  assert.ok(newsQuery('ISGYO', 'İş GYO').startsWith('"İş GYO" OR "Is GYO" OR '));
  // Kodu olmayan çağrı: yalnız ad; çok kısa kod (tek harf) bağlam terimi üretmez
  assert.equal(newsQuery('', 'Aselsan'), '"Aselsan"');
  assert.equal(newsQuery('X', ''), '');
  assert.equal(newsQuery(null, null), '');
});

test('newsQuery: unvan ekleri atılır, yaygın kısa ad kullanılır, parantez içi ikinci ad', () => {
  const a = newsQuery('ASELS', 'ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş.');
  assert.ok(a.startsWith('"ASELSAN ELEKTRONİK" OR "ASELSAN ELEKTRONIK" OR '), a);
  assert.ok(!/SANAY|TİCARET|A\.Ş/.test(a));
  assert.ok(newsQuery('THYAO', 'TÜRK HAVA YOLLARI A.O.').startsWith('"TÜRK HAVA YOLLARI" OR '));
  assert.ok(newsQuery('SOKM', 'Şok Marketler Ticaret A.Ş.').startsWith('"Şok Marketler" OR "Sok Marketler" OR (SOKM'));
  // "Yapı Kredi Bankası" -> "Yapı Kredi" (uzun ifade kısa ifadenin alt kümesi)
  const y = newsQuery('YKBNK', 'Yapı Kredi Bankası');
  assert.ok(y.startsWith('"Yapı Kredi" OR "Yapi Kredi" OR '), y);
  assert.ok(!y.includes('Bankası'));
  assert.ok(newsQuery('TOASO', 'Tofaş Oto').startsWith('"Tofaş" OR "Tofas" OR '));
  // tek harfli kısa ad üretilmez: "İş" yerine tam ad
  const i = newsQuery('ISCTR', 'İş Bankası (C)');
  assert.ok(i.startsWith('"İş Bankası" OR "Is Bankasi" OR (ISCTR'), i);
  assert.ok(!i.includes('"C"'), 'pay grubu harfi aranmaz');
  const m = newsQuery('MPARK', 'MLP Sağlık (Medical Park)');
  assert.ok(m.includes('"MLP Sağlık"') && m.includes('"MLP Saglik"') && m.includes('"Medical Park"'));
});

test('newsQuery: genel anlamlı / yabancı şirketle karışan adlar borsa bağlamıyla aranır', () => {
  assert.ok(newsQuery('PGSUS', 'Pegasus').startsWith('("Pegasus" AND (hisse'), 'Pegasus casus yazılımı haberleri gelmesin');
  assert.ok(newsQuery('FENER', 'Fenerbahçe').startsWith('(("Fenerbahçe" OR "Fenerbahce") AND (hisse'));
  assert.ok(newsQuery('MGROS', 'Migros').startsWith('("Migros" AND '));
  // Kısa ad bağlamlı halde kodla aynıysa tekrarlanmaz
  assert.equal(newsQuery('MAVI', 'Mavi Giyim'), '"Mavi Giyim" OR (MAVI AND (hisse OR hissesi OR hisseleri OR borsa OR BIST))');
  // Ayırt edici tek kelime bağlamsız aranır
  assert.ok(newsQuery('ASELS', 'Aselsan').startsWith('"Aselsan" OR '));
});

test('newsQuery: sorgu sözdizimi enjekte edilemez, 500 karakteri aşmaz, kod terimi korunur', () => {
  const q = newsQuery('EVIL"', '"Foo" OR (bar) AND NOT baz* -x +y ~z ^q {a} [b] \\ | ! <x> = & ? : , ;');
  assert.equal((q.match(/"/g) || []).length % 2, 0, 'tırnaklar dengeli');
  let depth = 0; for (const ch of q) { if (ch === '(') depth++; if (ch === ')') depth--; assert.ok(depth >= 0); } assert.equal(depth, 0, 'parantezler dengeli');
  for (const ph of q.match(/"[^"]*"/g)) assert.ok(!/\b(AND|OR|NOT)\b|[()*~^{}[\]\\|!<>=&?:]/.test(ph.slice(1, -1)), 'tırnak içinde işleç yok: ' + ph);
  assert.ok(q.endsWith('(EVIL AND (hisse OR hissesi OR hisseleri OR borsa OR BIST))'));
  const long = newsQuery('UZUN', ('Çok Uzun Şirket Adı ').repeat(20) + '(' + 'İkinci Ad '.repeat(30) + ')');
  assert.ok(long.length <= 500, String(long.length));
  assert.ok(long.endsWith('(UZUN AND (hisse OR hissesi OR hisseleri OR borsa OR BIST))'), 'kısaltmada kod terimi kalır');
});

test('newsQuery: uygulamadaki tüm BIST adları için geçerli ve sınırlı sorgu', () => {
  const { NAMES } = require('../bp-data.js');
  assert.ok(Object.keys(NAMES).length > 50);
  for (const [code, name] of Object.entries(NAMES)) {
    const q = newsQuery(code, name);
    assert.ok(q.length > 0 && q.length <= 500, code);
    assert.ok(q.includes('(' + code + ' AND (hisse'), code + ' kod terimi');
    assert.equal((q.match(/"/g) || []).length % 2, 0, code + ' tırnak');
    assert.equal((q.match(/\(/g) || []).length, (q.match(/\)/g) || []).length, code + ' parantez');
    assert.ok(!/""|\(\)|  /.test(q), code + ' boş terim yok: ' + q);
  }
});

test('message: her hata Türkçe ve arayüzün 200 karakter sınırına sığar', () => {
  let n = 0;
  for (const p of ['news', 'fx', 'gecko'])
    for (const c of ['input', 'nokey', 'badkey', 'timeout', 'net', 'https', 'parse', 'server', 'key', 'plan', 'limit', 'budget', 'bad',
      'inactive', 'quota', 'reserve', 'unsupported', 'minute', 'month', 'http'])
      for (const status of [undefined, 400, 401, 403, 426, 429, 500]) {
        const m = message(p, c, { status, detail: 'ayrıntı '.repeat(100), left: 12345, wait: 30, base: 'XYZ' });
        assert.ok(typeof m === 'string' && m.length > 10 && m.length <= 200, p + '/' + c + ' ' + m.length); n++;
      }
  assert.ok(n > 300);
  assert.match(message('news', 'key', { status: 401 }), /^NewsAPI anahtarı geçersiz/);
  assert.match(message('news', 'plan', { status: 426 }), /ücretsiz planda kabul etmedi \(HTTP 426\)/);
  assert.match(message('news', 'limit', { status: 429 }), /istek sınırı doldu .*günde 100 istek/);
  assert.match(message('gecko', 'limit', { status: 429, wait: 45 }), /dakikada 30 istek\)\. 45 sn sonra tekrar dene/);
  assert.match(message('fx', 'http', { status: 426 }), /mevcut planda kabul etmedi \(HTTP 426\)/);
  assert.equal(message('fx', 'timeout', { timeoutMs: 12000 }), 'ExchangeRate-API 12 sn içinde yanıt vermedi. Tekrar dene.');
  assert.ok(NEWS_NOTE.length < 120);
});

test('scrub: anahtar, URL-kodlu anahtar, /v6/ yolu ve apiKey parametresi maskelenir', () => {
  const k = 'abc+def/ghi=123';
  const s = scrub('x ' + k + ' y ' + encodeURIComponent(k) + ' https://v6.exchangerate-api.com/v6/SECRETSECRET/latest/USD ?apiKey=QQQQQQ&x=1 X-Api-Key: ZZZZZZ', [k]);
  assert.ok(!s.includes(k) && !s.includes(encodeURIComponent(k)) && !s.includes('SECRETSECRET') && !s.includes('QQQQQQ') && !s.includes('ZZZZZZ'), s);
  assert.ok(s.includes('/v6/***/latest/USD') && s.includes('apiKey=***&x=1'));
  assert.equal(scrub(null), '');
});

test('crosses, period, validKey, clean', () => {
  const c = crosses({ USD: 1, TRY: 40, EUR: 0.8, JPY: 160, XXX: 0 });
  assert.equal(c['USD/TRY'], 40); assert.equal(c['EUR/TRY'], 50); assert.equal(c['JPY/TRY'], 0.25); assert.ok(!('TRY/TRY' in c));
  assert.deepEqual(crosses({ USD: 1 }), {});
  assert.equal(period(Date.UTC(2026, 9, 20)), '2026-10');
  assert.equal(period(Date.UTC(2026, 9, 20), 17), '2026-10@17');
  assert.equal(period(Date.UTC(2026, 9, 16), 17), '2026-09@17');
  assert.equal(period(Date.UTC(2026, 0, 5), 17), '2025-12@17');
  assert.equal(period(Date.UTC(2026, 9, 20), null), '2026-10', 'null yenilenme günü 1 sayılır');
  assert.ok(validKey('news', KEYS.news) && validKey('fx', KEYS.fx) && validKey('gecko', KEYS.gecko) && validKey('kripto', KEYS.gecko));
  assert.ok(!validKey('news', 'kısa') && !validKey('news', 'a b c d e f g h i j k l m n o p') && !validKey('fx', KEYS.fx + '/../x') && !validKey('yok', KEYS.news));
  assert.equal(clean('<b>Merhaba</b> &amp; &#252;&#x15F; &quot;x&quot;\n\t son'), 'Merhaba & üş "x" son');
  const long = clean('kelime '.repeat(100), 50);
  assert.ok(long.length <= 50 && long.endsWith('…'));
});

// ============================================================================================================================
// NewsAPI
// ============================================================================================================================
test('news: istek biçimi — https, anahtar yalnız X-Api-Key başlığında, yönlendirme yok, Türkçe için language gönderilmez', async () => {
  const s = setup();
  const r = await s.api.news('"Aselsan" OR ASELS', { days: 7, max: 5 });
  assert.equal(r.ok, true);
  assert.equal(s.calls.length, 1);
  const { url, opts } = s.calls[0], u = new URL(url);
  assert.equal(u.protocol, 'https:'); assert.equal(u.host, 'newsapi.org'); assert.equal(u.pathname, '/v2/everything');
  assert.ok(!url.includes(KEYS.news), 'anahtar URL\'de değil');
  assert.equal(opts.headers['X-Api-Key'], KEYS.news);
  assert.equal(opts.redirect, 'error', 'başlıktaki anahtar başka adrese yönlenmesin');
  assert.equal(opts.method, 'GET');
  assert.ok(opts.signal && typeof opts.signal.aborted === 'boolean');
  assert.equal(u.searchParams.get('q'), '"Aselsan" OR ASELS');
  assert.equal(u.searchParams.get('language'), null, 'NewsAPI dil listesinde Türkçe yok');
  assert.equal(u.searchParams.get('searchIn'), 'title,description');
  assert.equal(u.searchParams.get('sortBy'), 'publishedAt');
  assert.equal(u.searchParams.get('from'), '2026-10-13');
  assert.equal(u.searchParams.get('pageSize'), '15');
  await s.api.news('borsa', { lang: 'en', days: null, max: null, searchIn: 'title,bogus' });
  const u2 = new URL(s.calls[1].url);
  assert.equal(u2.searchParams.get('language'), 'en');
  assert.equal(u2.searchParams.get('from'), '2026-10-13', 'days null -> varsayılan 7 gün (alt sınır 1 değil)');
  assert.equal(u2.searchParams.get('pageSize'), '20', 'max null -> varsayılan 10');
  assert.equal(u2.searchParams.get('searchIn'), 'title');
});

test('news: haberler yalnız https bağlantılı, temiz, tekrarsız ve yeniden eskiye', async () => {
  const arts = [
    ART(5), ART(1),
    ART(2, { url: 'http://duz.com/a' }), ART(3, { url: 'javascript:alert(1)' }), ART(4, { url: 'data:text/html,x' }),
    ART(6, { url: 'https://removed.com', title: '[Removed]' }), ART(7, { title: '[Removed]', url: 'https://ornek.com/7' }),
    ART(8, { url: 'https://kul:sifre@ornek.com/8' }), ART(9, { url: 'ftp://ornek.com/9' }), ART(10, { url: '//ornek.com/10' }),
    ART(11, { url: 'https://ornek.com.tr/haber/1?utm=x' }),    // ayni haber (sorgu parametresi farkli)
    ART(12, { title: 'Başlık 5 - Kaynak 12', url: 'https://baska.com/5' }),   // ayni baslik baska adres
    ART(13, { publishedAt: 'bozuk', description: null, source: null, title: '  <i>Etiketli</i>   &amp; boşluklu  ' }),
    null, 'x', { title: 'adres yok' },
  ];
  const s = setup({ handler: router({ news: () => res(200, { status: 'ok', totalResults: 99, articles: arts }) }) });
  const r = await s.api.news('borsa', { max: 10 });
  assert.equal(r.ok, true); assert.equal(r.total, 99); assert.equal(r.note, NEWS_NOTE); assert.equal(r.error, null); assert.equal(r.cached, false);
  for (const it of r.items) assert.ok(new URL(it.url).protocol === 'https:' && !it.url.includes('@'), it.url);
  assert.deepEqual(r.items.map(i => i.title), ['Başlık 1', 'Başlık 5', 'Etiketli & boşluklu']);
  assert.deepEqual(r.items[0], { title: 'Başlık 1', source: 'Kaynak 1', url: 'https://ornek.com.tr/haber/1', time: T0 - HOUR, desc: 'Açıklama & ayrıntı 1' });
  assert.equal(r.items[2].time, null); assert.equal(r.items[2].source, null); assert.equal(r.items[2].desc, null);
  const s2 = setup({ handler: router({ news: () => res(200, { status: 'ok', totalResults: 30, articles: Array.from({ length: 30 }, (_, i) => ART(i + 1)) }) }) });
  assert.equal((await s2.api.news('borsa', { max: 4 })).items.length, 4);
});

test('news: sorgu başına 30 dk önbellek, fresh atlar, eş zamanlı çağrılar tek isteğe iner', async () => {
  const s = setup();
  const a = await s.api.news('borsa');
  assert.equal(a.cached, false); assert.equal(a.left, 89);
  const b = await s.api.news('borsa');
  assert.equal(b.cached, true); assert.equal(s.calls.length, 1); assert.deepEqual(b.items, a.items); assert.equal(b.left, 89);
  await s.api.news('altın');
  assert.equal(s.calls.length, 2, 'başka sorgu ayrı istek');
  s.clock.t += 30 * MIN - 1;
  assert.equal((await s.api.news('borsa')).cached, true);
  assert.equal(s.calls.length, 2);
  s.clock.t += 1;
  const c = await s.api.news('borsa');
  assert.equal(c.cached, false); assert.equal(s.calls.length, 3);
  assert.equal((await s.api.news('borsa', { fresh: true })).cached, false);
  assert.equal(s.calls.length, 4);
  const [x, y, z] = await Promise.all([s.api.news('eşzamanlı'), s.api.news('eşzamanlı'), s.api.news('eşzamanlı')]);
  assert.equal(s.calls.length, 5, 'aynı sorgu tek istek');
  assert.deepEqual(x.items, y.items); assert.deepEqual(y.items, z.items);
  assert.equal(s.api.status().news.left, 85);
});

test('news: hata anında eski önbellek stale:true ile döner; önbellek yoksa ok:false', async () => {
  let fail = false;
  const s = setup({ handler: router({ news: () => fail ? res(503, '<html>bakım</html>') : okNews() }) });
  await s.api.news('borsa');
  s.clock.t += 31 * MIN; fail = true;
  const r = await s.api.news('borsa');
  assert.equal(r.ok, true); assert.equal(r.stale, true); assert.equal(r.cached, true); assert.equal(r.items.length, 3);
  assert.equal(r.error, 'NewsAPI şu an yanıt vermiyor (HTTP 503). Biraz sonra tekrar dene.');
  const n = await s.api.news('başka');
  assert.equal(n.ok, false); assert.deepEqual(n.items, []); assert.equal(n.error, r.error);
  assert.equal(s.api.status().news.lastError, r.error);
  fail = false; s.clock.t += 1;
  assert.equal((await s.api.news('başka')).ok, true);
  assert.equal(s.api.status().news.lastError, null, 'başarı hatayı temizler');
  assert.equal(s.api.status().news.lastOk, s.clock.t);
});

test('news: günlük 90 istek bütçesi diske yazılır, yeniden başlatmada korunur, UTC gününde sıfırlanır', async () => {
  const dir = mkdir();
  const s = setup({ dir });
  for (let i = 0; i < 90; i++) assert.equal((await s.api.news('sorgu ' + i)).ok, true, 'istek ' + i);
  assert.equal(s.calls.length, 90);
  assert.equal(s.api.status().news.left, 0);
  const r = await s.api.news('sorgu 90');
  assert.equal(r.ok, false); assert.equal(s.calls.length, 90, 'bütçe bitince istek atılmaz'); assert.equal(r.left, 0);
  assert.equal(r.error, 'NewsAPI günlük istek bütçesi doldu (uygulama günde 90 istek atar; ücretsiz plan 100). Yarın (UTC 00:00) sıfırlanır.');
  assert.equal((await s.api.news('sorgu 89')).cached, true, 'önbellekteki sorgu bütçe bitse de gelir (bellekte son 60 sorgu)');
  // yeniden baslatma: ayni dizin -> sayac korunur
  const s2 = setup({ dir });
  s2.clock.t = s.clock.t;
  assert.equal(s2.api.status().news.left, 0);
  assert.equal((await s2.api.news('yeni')).ok, false);
  assert.equal(s2.calls.length, 0);
  // ertesi UTC gunu
  s2.clock.t = Date.UTC(2026, 9, 21, 0, 0, 1);
  assert.equal(s2.api.status().news.left, 90);
  assert.equal((await s2.api.news('yeni')).ok, true);
  assert.equal(s2.api.status().news.left, 89);
  // anahtar degisince sayac o anahtar icin sifirdan baslar; dosyada anahtar degil yalniz kisa parmak izi var
  const st = fs.readFileSync(path.join(dir, 'ext-apis.json'), 'utf8');
  noKey(st, 'durum dosyası');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'ext-apis.json')).mode & 0o777, 0o600);
  const s3 = setup({ dir, keys: { ...KEYS, news: 'otherFakeNewsKey000000000000002' } });
  s3.clock.t = s2.clock.t;
  assert.equal(s3.api.status().news.left, 90);
});

test('news: 401/426/429/400 ve okunamayan yanıt Türkçe hata verir; 429 günü kapatır', async () => {
  const cases = [
    [() => res(401, { status: 'error', code: 'apiKeyInvalid', message: 'Your API key is invalid or incorrect.' }), /^NewsAPI anahtarı geçersiz ya da devre dışı/],
    [() => res(200, { status: 'error', code: 'apiKeyDisabled', message: 'disabled' }), /^NewsAPI anahtarı geçersiz ya da devre dışı/],
    [() => res(426, { status: 'error', code: 'parameterInvalid', message: 'You are trying to request results too far in the past.' }), /^NewsAPI bu isteği ücretsiz planda kabul etmedi \(HTTP 426\)\. Ücretsiz Developer planı/],
    [() => res(400, { status: 'error', code: 'parameterInvalid', message: 'The q parameter is too long.' }), /^NewsAPI isteği geçersiz buldu: The q parameter is too long\.$/],
    [() => res(200, 'bu json değil'), /^NewsAPI yanıtı okunamadı\. Tekrar dene\.$/],
    [() => res(418, { status: 'error', message: 'çaydanlık' }), /^NewsAPI isteği başarısız \(HTTP 418\): çaydanlık$/],
  ];
  for (const [h, re] of cases) {
    const s = setup({ handler: router({ news: h }) });
    const r = await s.api.news('borsa');
    assert.equal(r.ok, false); assert.match(r.error, re); assert.ok(r.error.length <= 200);
    assert.equal(s.api.status().news.lastError, r.error);
    assert.equal(s.api.status().news.left, 89, 'gönderilen istek sayılır');
  }
  const s = setup({ handler: router({ news: () => res(429, { status: 'error', code: 'rateLimited', message: 'You have made too many requests recently.' }) }) });
  const r = await s.api.news('borsa');
  assert.equal(r.error, 'NewsAPI istek sınırı doldu (ücretsiz Developer planı: günde 100 istek); yarın tekrar dene.');
  assert.equal(r.left, 0, '429 sonrası günün kalanı kapanır');
  const r2 = await s.api.news('başka');
  assert.equal(s.calls.length, 1, 'yeni istek atılmaz'); assert.match(r2.error, /günlük istek bütçesi doldu/);
});

test('news: zaman aşımı (yanıt ya da gövde gelmezse) Türkçe hata ve isteği iptal eder', async () => {
  let sig = null;
  const s = setup({ timeoutMs: 30, handler: router({ news: (u, o) => { sig = o.signal; return hang(); } }) });
  const t = Date.now();
  const r = await s.api.news('borsa');
  assert.ok(Date.now() - t < 2000);
  assert.equal(r.ok, false); assert.equal(r.error, 'NewsAPI 1 sn içinde yanıt vermedi. Tekrar dene.');
  assert.equal(sig.aborted, true, 'fetch iptal edildi');
  const s2 = setup({ timeoutMs: 30, handler: router({ news: () => ({ ok: true, status: 200, headers: { get: () => null }, text: hang }) }) });
  assert.equal((await s2.api.news('borsa')).error, 'NewsAPI 1 sn içinde yanıt vermedi. Tekrar dene.');
  const s3 = setup({ timeoutMs: 12000, handler: router({ news: () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; } }) });
  assert.equal((await s3.api.news('borsa')).error, 'NewsAPI 12 sn içinde yanıt vermedi. Tekrar dene.');
});

test('news: ağ hatası, anahtar yok, bozuk anahtar, boş sorgu', async () => {
  const s = setup({ handler: router({ news: url => { throw new TypeError('fetch failed: ' + url + ' key=' + KEYS.news); } }) });
  const r = await s.api.news('borsa');
  assert.equal(r.error, 'NewsAPI sunucusuna bağlanılamadı. İnternet bağlantını kontrol et.');
  noKey(r);
  const n = setup({ keys: { ...KEYS, news: '  ' } });
  const rn = await n.api.news('borsa');
  assert.equal(rn.error, "NewsAPI anahtarı girilmemiş. Ayarlar'dan ekle."); assert.equal(n.calls.length, 0);
  assert.equal(n.api.status().news.configured, false);
  const b = setup({ keys: { ...KEYS, news: 'bozuk anahtar ! ' + 'x'.repeat(20) } });
  const rb = await b.api.news('borsa');
  assert.match(rb.error, /anahtarı geçersiz görünüyor/); assert.equal(b.calls.length, 0);
  const th = setup({ keys: {} });
  const rt = await createExtApis({ fetch: async () => { throw new Error('olmamalı'); }, keys: { news: () => { throw new Error('keychain'); } } }).news('borsa');
  assert.match(rt.error, /anahtarı girilmemiş/); void th;
  const e = setup();
  const re = await e.api.news('   ');
  assert.equal(re.ok, false); assert.equal(re.error, 'Haber araması için sorgu boş.'); assert.equal(e.calls.length, 0);
  assert.equal(e.api.status().news.lastError, null, 'giriş hatası servis hatası sayılmaz');
});

test('newsFor: hisse kodu + şirket adından Türkçe sorgu, ad bilinmiyorsa bağlamlı kod', async () => {
  const s = setup();
  const r = await s.api.newsFor('THYAO', 'Türk Hava Yolları');
  assert.equal(r.ok, true);
  assert.equal(new URL(s.calls[0].url).searchParams.get('q'), newsQuery('THYAO', 'Türk Hava Yolları'));
  assert.equal(r.query, newsQuery('THYAO', 'Türk Hava Yolları'));
  assert.equal(r.lang, 'tr');
  // borsa-pro-main ad bilinmezse kodu ad olarak gecer
  await s.api.newsFor('MAVI', 'MAVI');
  assert.equal(new URL(s.calls[1].url).searchParams.get('q'), '(MAVI AND (hisse OR hissesi OR hisseleri OR borsa OR BIST))');
  // ayni hisse ikinci kez: onbellek
  assert.equal((await s.api.newsFor('THYAO', 'Türk Hava Yolları')).cached, true);
  assert.equal(s.calls.length, 2);
  const e = await s.api.newsFor('', '');
  assert.equal(e.ok, false); assert.equal(e.error, 'Haber araması için hisse kodu ya da şirket adı gerekli.'); assert.equal(s.calls.length, 2);
  assert.ok(Number.isFinite(e.left));
});

// ============================================================================================================================
// ExchangeRate-API
// ============================================================================================================================
test('fx: v6 latest isteği, USD bazlı kurlar ve TL çaprazları', async () => {
  const s = setup();
  const r = await s.api.fx('usd');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, 'https://v6.exchangerate-api.com/v6/' + KEYS.fx + '/latest/USD');
  assert.equal(s.calls[0].opts.redirect, 'error');
  assert.equal(r.ok, true); assert.equal(r.base, 'USD'); assert.equal(r.cached, false); assert.equal(r.error, null);
  assert.equal(r.rates.TRY, 41.8); assert.equal(r.rates.USD, 1);
  assert.ok(!('BAD' in r.rates) && !('XYZ' in r.rates), 'sayı olmayan/negatif kur atılır');
  assert.equal(r.crosses['USD/TRY'], 41.8); assert.equal(r.crosses['EUR/TRY'], 52.25);
  assert.equal(r.time, Math.floor((T0 - HOUR) / 1000) * 1000); assert.equal(r.next, Math.floor((T0 + 5 * HOUR) / 1000) * 1000);
  assert.equal(r.left, 1499);
  noKey(r);
  const bad = await s.api.fx('US');
  assert.equal(bad.ok, false); assert.equal(bad.error, 'Para birimi kodu geçersiz (ör. USD).'); assert.equal(s.calls.length, 1);
});

test('fx: önbellek time_next_update_unix\'e kadar (en az 1 saat, en çok 26 saat)', async () => {
  let next = T0 + 5 * HOUR;
  const s = setup({ handler: router({ fx: url => res(200, fxBody(url.split('/').pop(), next)) }) });
  await s.api.fx('USD');
  s.clock.t = T0 + 5 * HOUR - 1000;
  assert.equal((await s.api.fx('USD')).cached, true);
  assert.equal(s.calls.length, 1);
  s.clock.t = T0 + 5 * HOUR + 1000;
  next = s.clock.t + 10 * MIN;    // sunucu 10 dk sonra guncelleyecek -> en az 1 saat beklenir
  assert.equal((await s.api.fx('USD')).cached, false);
  assert.equal(s.calls.length, 2);
  const t1 = s.clock.t;
  s.clock.t = t1 + 59 * MIN; assert.equal((await s.api.fx('USD')).cached, true);
  s.clock.t = t1 + 61 * MIN; next = s.clock.t - DAY;   // gecmis tarih -> 1 saat
  assert.equal((await s.api.fx('USD')).cached, false);
  assert.equal(s.calls.length, 3);
  const t2 = s.clock.t;
  s.clock.t = t2 + HOUR + 1; next = s.clock.t + 40 * HOUR;   // cok uzak -> en cok 26 saat
  await s.api.fx('USD');
  const t3 = s.clock.t;
  s.clock.t = t3 + 26 * HOUR - 1; assert.equal((await s.api.fx('USD')).cached, true);
  s.clock.t = t3 + 26 * HOUR; assert.equal((await s.api.fx('USD')).cached, false);
  // baz basina ayri onbellek
  await s.api.fx('EUR');
  assert.ok(s.calls[s.calls.length - 1].url.endsWith('/latest/EUR'));
  // fresh onbellegi atlar
  const n = s.calls.length; await s.api.fx('USD', { fresh: true }); assert.equal(s.calls.length, n + 1);
});

test('fx: kurlar diske yazılır, yeniden başlatmada kota harcanmaz; bozuk önbellek yok sayılır', async () => {
  const dir = mkdir();
  const s = setup({ dir });
  await s.api.fx('USD');
  const s2 = setup({ dir });
  const r = await s2.api.fx('USD');
  assert.equal(r.cached, true); assert.equal(r.rates.TRY, 41.8); assert.equal(s2.calls.length, 0);
  noKey(fs.readFileSync(path.join(dir, 'ext-apis.json'), 'utf8'), 'durum dosyası');
  // elle bozulmus dosya: rates metin -> yok sayilir, istek atilir
  const st = readState(s.file); st.fxc.USD.v.rates = 'bozuk'; writeState(s.file, st);
  const s3 = setup({ dir });
  const r3 = await s3.api.fx('USD');
  assert.equal(r3.cached, false); assert.equal(s3.calls.length, 1); assert.equal(r3.rates.TRY, 41.8);
  // tamamen bozuk JSON
  fs.writeFileSync(s.file, '{bozuk');
  const s4 = setup({ dir });
  assert.equal((await s4.api.fx('USD')).ok, true);
  assert.equal(s4.api.status().fx.left, 1499);
});

test('fx: aylık 1500 kota diske yazılır, 20 istekten az kalınca yeni istek atılmaz', async () => {
  const dir = mkdir();
  const s = setup({ dir });
  await s.api.fx('USD');
  const st = readState(s.file); st.fx.n = 1480; writeState(s.file, st);   // kalan 20
  const s2 = setup({ dir });
  assert.equal(s2.api.status().fx.left, 20);
  const a = await s2.api.fx('USD', { fresh: true });
  assert.equal(a.ok, true); assert.equal(a.cached, false); assert.equal(a.left, 19); assert.equal(s2.calls.length, 1);
  const b = await s2.api.fx('USD', { fresh: true });
  assert.equal(s2.calls.length, 1, 'yedek korunur');
  assert.equal(b.ok, true); assert.equal(b.stale, true); assert.equal(b.rates.TRY, 41.8, 'eski kur döner');
  assert.equal(b.error, 'ExchangeRate-API aylık kotasında 19 istek kaldı; 20 isteklik yedek korunuyor, yeni istek atılmadı.');
  const c = await s2.api.fx('GBP');
  assert.equal(c.ok, false); assert.equal(s2.calls.length, 1); assert.deepEqual(c.rates, {});
  // yeni ay -> sayac sifirlanir
  s2.clock.t = Date.UTC(2026, 10, 1, 0, 0, 1);
  assert.equal(s2.api.status().fx.left, 1500);
  assert.equal((await s2.api.fx('GBP')).ok, true);
  assert.equal(s2.calls.length, 2);
});

test('fx: hata türleri Türkçe; quota-reached ayı kapatır', async () => {
  const cases = [
    [{ result: 'error', 'error-type': 'invalid-key' }, 403, /^ExchangeRate-API anahtarı geçersiz\. Ayarlar'dan kontrol et\.$/],
    [{ result: 'error', 'error-type': 'inactive-account' }, 403, /hesabı etkin değil; kayıt e-postasındaki/],
    [{ result: 'error', 'error-type': 'unsupported-code' }, 404, /^ExchangeRate-API bu para birimini desteklemiyor: USD\.$/],
    [{ result: 'error', 'error-type': 'malformed-request' }, 400, /^ExchangeRate-API isteği hatalı buldu\.$/],
    ['Unauthorized', 401, /^ExchangeRate-API anahtarı geçersiz/],
    ['Upgrade', 426, /^ExchangeRate-API bu isteği mevcut planda kabul etmedi \(HTTP 426\)\.$/],
    ['', 502, /^ExchangeRate-API şu an yanıt vermiyor \(HTTP 502\)/],
    [{ result: 'success', conversion_rates: {} }, 200, /^ExchangeRate-API yanıtı okunamadı/],
  ];
  for (const [body, status, re] of cases) {
    const s = setup({ handler: router({ fx: () => res(status, body) }) });
    const r = await s.api.fx('USD');
    assert.equal(r.ok, false, String(status)); assert.match(r.error, re); noKey(r);
    assert.equal(s.api.status().fx.lastError, r.error);
  }
  for (const [body, status] of [[{ result: 'error', 'error-type': 'quota-reached' }, 200], ['Too Many Requests', 429]]) {
    const s = setup({ handler: router({ fx: () => res(status, body) }) });
    const r = await s.api.fx('USD');
    assert.equal(r.error, 'ExchangeRate-API aylık istek sınırı (1.500) doldu; kota yenilenince tekrar dene.');
    assert.equal(r.left, 0);
    const r2 = await s.api.fx('EUR');
    assert.equal(s.calls.length, 1, 'kota dolunca istek atılmaz'); assert.match(r2.error, /0 istek kaldı/);
  }
  const t = setup({ timeoutMs: 25, handler: router({ fx: hang }) });
  assert.equal((await t.api.fx('USD')).error, 'ExchangeRate-API 1 sn içinde yanıt vermedi. Tekrar dene.');
});

// ============================================================================================================================
// CoinGecko Demo
// ============================================================================================================================
test('crypto: Demo uç noktası, anahtar başlıkta, para birimi başına bir istek, arayüz biçimi', async () => {
  const s = setup();
  const r = await s.api.crypto({});
  assert.equal(r.ok, true); assert.equal(r.cached, false); assert.deepEqual(r.vs, ['usd', 'try']);
  assert.equal(s.calls.length, 2);
  for (const c of s.calls) {
    const u = new URL(c.url);
    assert.equal(u.origin + u.pathname, 'https://api.coingecko.com/api/v3/coins/markets');
    assert.equal(c.opts.headers['x-cg-demo-api-key'], KEYS.gecko);
    assert.ok(!c.url.includes(KEYS.gecko));
    assert.equal(c.opts.redirect, 'error');
    assert.equal(u.searchParams.get('ids'), COINS.join(','));
  }
  const [u0, u1] = s.calls.map(c => new URL(c.url).searchParams);
  assert.equal(u0.get('vs_currency'), 'usd'); assert.equal(u0.get('sparkline'), 'true');
  assert.equal(u1.get('vs_currency'), 'try'); assert.equal(u1.get('sparkline'), 'false', '7 günlük seri yalnız ilk istekte');
  assert.equal(r.coins.length, 5);
  const btc = r.coins[0];
  assert.equal(btc.id, 'bitcoin'); assert.equal(btc.symbol, 'BIT'); assert.equal(btc.name, 'Bitcoin');
  assert.deepEqual(btc.price, { usd: 65432.1, try: 2735000 });
  assert.equal(btc.chg24h, 2.35, '24s değişim ana para biriminde, 2 hane');
  assert.ok(Array.isArray(btc.spark7d) && btc.spark7d.length === 56);
  assert.equal(btc.spark7d[0], 100); assert.equal(btc.spark7d[55], 267, 'ilk ve son nokta korunur');
  assert.equal(r.left, 9998); assert.equal(r.minuteLeft, 28);
  const bad = await s.api.crypto({ ids: ['BİT COİN', '../x', ''] });
  assert.equal(bad.ok, false); assert.match(bad.error, /Geçerli coin kimliği yok/); assert.equal(s.calls.length, 2);
  const one = await s.api.crypto({ ids: 'Bitcoin, ethereum', vs: ['EUR'] });
  assert.equal(one.coins.length, 2); assert.deepEqual(Object.keys(one.coins[0].price), ['eur']);
});

test('crypto: 2 dk önbellek', async () => {
  const s = setup();
  await s.api.crypto({});
  s.clock.t += 2 * MIN - 1;
  assert.equal((await s.api.crypto({})).cached, true);
  assert.equal(s.calls.length, 2);
  s.clock.t += 1;
  assert.equal((await s.api.crypto({})).cached, false);
  assert.equal(s.calls.length, 4);
});

test('crypto: dakikada 30 istek koruması (kayan 60 sn), sonra yeniden açılır', async () => {
  const s = setup();
  for (let i = 0; i < 15; i++) { assert.equal((await s.api.crypto({ fresh: true })).ok, true); s.clock.t += 1000; }
  assert.equal(s.calls.length, 30);
  assert.equal(s.api.status().gecko.minuteLeft, 0);
  const r = await s.api.crypto({ fresh: true });
  assert.equal(s.calls.length, 30, 'sınırda istek atılmaz');
  assert.equal(r.ok, true); assert.equal(r.stale, true, 'önbellekteki veri döner');
  assert.match(r.error, /^CoinGecko dakikalık istek sınırı \(30\) dolmak üzere; \d+ sn sonra tekrar dene\.$/);
  const t = await s.api.test('gecko');
  assert.equal(t.ok, false); assert.match(t.msg, /dakikalık istek sınırı/); assert.equal(s.calls.length, 30);
  s.clock.t = T0 + 60 * 1000;   // T0'daki iki istek 60 sn'lik pencereden cikti
  assert.equal(s.api.status().gecko.minuteLeft, 2);
  assert.equal((await s.api.crypto({ fresh: true })).stale, undefined);
  assert.equal(s.calls.length, 32);
});

test('crypto: 429 Retry-After kadar bekletir; aylık kota diske yazılır ve 100 yedek korunur', async () => {
  let limited = true;
  const s = setup({ handler: router({ gecko: url => limited ? res(429, { status: { error_code: 429, error_message: "You've exceeded the Rate Limit." } }, { 'retry-after': '45' }) : okGecko(url) }) });
  const r = await s.api.crypto({});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'CoinGecko istek sınırı aşıldı (Demo plan: dakikada 30 istek). 45 sn sonra tekrar dene.');
  limited = false;
  s.clock.t += 30 * 1000;
  const r2 = await s.api.crypto({});
  assert.equal(s.calls.length, 2, 'bekleme bitmeden istek yok'); assert.match(r2.error, /15 sn sonra tekrar dene/);
  s.clock.t += 16 * 1000;
  assert.equal((await s.api.crypto({})).ok, true);
  // aylik kota: kalan 101, istek 2 -> 99 < 100 yedek
  const st = readState(s.file); st.gecko.n = 10000 - 102; writeState(s.file, st);
  const s2 = setup({ dir: s.dir }); s2.clock.t = s.clock.t;
  assert.equal(s2.api.status().gecko.left, 102);
  assert.equal((await s2.api.crypto({})).ok, true);
  assert.equal(s2.calls.length, 2);
  const r3 = await s2.api.crypto({ fresh: true });
  assert.equal(s2.calls.length, 2);
  assert.equal(r3.error, 'CoinGecko aylık istek kotası dolmak üzere (Demo plan: ayda 10.000, 100 kaldı); yeni istek atılmadı.');
  s2.clock.t = Date.UTC(2026, 10, 1, 0, 0, 1);
  assert.equal(s2.api.status().gecko.left, 10000);
});

test('crypto: TL isteği düşerse kısmi sonuç (önbelleğe girmez); 401 Türkçe anahtar hatası', async () => {
  const s = setup({ handler: router({ gecko: url => new URL(url).searchParams.get('vs_currency') === 'try' ? res(500, 'x') : okGecko(url) }) });
  const r = await s.api.crypto({});
  assert.equal(r.ok, true); assert.equal(r.partial, true); assert.equal(r.coins[0].price.usd, 65432.1); assert.equal(r.coins[0].price.try, null);
  assert.equal(r.error, 'CoinGecko şu an yanıt vermiyor (HTTP 500). Biraz sonra tekrar dene.');
  await s.api.crypto({});
  assert.equal(s.calls.length, 4, 'kısmi sonuç önbelleğe alınmaz');
  const k = setup({ handler: router({ gecko: () => res(401, { status: { error_code: 10002, error_message: 'API Key Missing' } }) }) });
  const rk = await k.api.crypto({});
  assert.equal(rk.ok, false); assert.match(rk.error, /^CoinGecko anahtarı geçersiz ya da Demo anahtarı değil/);
  const u = setup({ handler: router({ gecko: () => res(426, 'Upgrade Required') }) });
  assert.equal((await u.api.crypto({})).error, 'CoinGecko bu isteği mevcut planda kabul etmedi (HTTP 426).');
  const t = setup({ timeoutMs: 25, handler: router({ gecko: hang }) });
  assert.equal((await t.api.crypto({})).error, 'CoinGecko 1 sn içinde yanıt vermedi. Tekrar dene.');
});

// ============================================================================================================================
// status() ve test(provider)
// ============================================================================================================================
test('status: arayüzün okuduğu biçim', async () => {
  const s = setup({ keys: { news: KEYS.news, fx: null, gecko: KEYS.gecko } });
  const st = s.api.status();
  assert.deepEqual(Object.keys(st).sort(), ['fx', 'gecko', 'news']);
  for (const p of ['news', 'fx', 'gecko']) {
    const x = st[p];
    for (const k of ['name', 'configured', 'valid', 'left', 'cap', 'unit', 'lastOk', 'lastError', 'lastErrorAt']) assert.ok(k in x, p + '.' + k);
    assert.equal(typeof x.configured, 'boolean'); assert.ok(Number.isFinite(x.left)); assert.equal(x.lastOk, null); assert.equal(x.lastError, null);
  }
  assert.equal(st.news.configured, true); assert.equal(st.fx.configured, false); assert.equal(st.fx.valid, false);
  assert.deepEqual([st.news.cap, st.fx.cap, st.gecko.cap], [90, 1500, 10000]);
  assert.deepEqual([st.news.unit, st.fx.unit, st.gecko.unit], ['day', 'month', 'month']);
  assert.deepEqual([st.news.name, st.fx.name, st.gecko.name], ['NewsAPI', 'ExchangeRate-API', 'CoinGecko']);
  assert.equal(st.gecko.minuteLeft, 30); assert.equal(st.news.note, NEWS_NOTE);
  assert.deepEqual(LIMITS.fx, { cap: 1500, reserve: 20, unit: 'month' });
  await s.api.news('borsa');
  assert.equal(s.api.status().news.lastOk, T0);
  const f = await s.api.fx('USD');
  assert.equal(f.error, "ExchangeRate-API anahtarı girilmemiş. Ayarlar'dan ekle."); assert.equal(s.calls.length, 1);
  assert.equal(s.api.status().fx.lastError, f.error); assert.equal(s.api.status().fx.lastErrorAt, T0);
  noKey(s.api.status());
});

test('test(news): tek ucuz istek, kalan sayı; hata Türkçe', async () => {
  const s = setup();
  const r = await s.api.test('news');
  assert.deepEqual(r, { ok: true, msg: 'NewsAPI anahtarı çalışıyor. Bugün kalan istek: 89. ' + NEWS_NOTE });
  assert.ok(r.msg.length <= 200);
  assert.equal(s.calls.length, 1);
  const u = new URL(s.calls[0].url).searchParams;
  assert.equal(u.get('pageSize'), '1'); assert.equal(s.calls[0].opts.headers['X-Api-Key'], KEYS.news);
  assert.equal(s.api.status().news.lastOk, T0);
  assert.equal((await s.api.test('haber')).ok, true, 'Türkçe takma ad');
  const k = setup({ handler: router({ news: () => res(401, { status: 'error', code: 'apiKeyInvalid', message: 'Your API key ' + KEYS.news + ' is invalid.' }) }) });
  const rk = await k.api.test('news');
  assert.equal(rk.ok, false); assert.match(rk.msg, /^NewsAPI anahtarı geçersiz/); noKey(rk);
  const l = setup({ handler: router({ news: () => res(429, { status: 'error', code: 'rateLimited' }) }) });
  assert.match((await l.api.test('news')).msg, /istek sınırı doldu/);
  assert.equal(l.api.status().news.left, 0);
  assert.deepEqual(await s.api.test('yok'), { ok: false, msg: 'Bilinmeyen sağlayıcı.' });
  assert.deepEqual(await setup({ keys: {} }).api.test('news'), { ok: false, msg: "NewsAPI anahtarı girilmemiş. Ayarlar'dan ekle." });
});

test('test(fx): /quota ile sunucudaki kalan sayı ve yenilenme günü eşitlenir', async () => {
  const s = setup();
  const r = await s.api.test('fx');
  assert.deepEqual(r, { ok: true, msg: 'ExchangeRate-API anahtarı çalışıyor. Bu ay kalan istek: 1.234 / 1.500.' });
  assert.equal(s.calls[0].url, 'https://v6.exchangerate-api.com/v6/' + KEYS.fx + '/quota');
  assert.equal(s.api.status().fx.left, 1234);
  // yenilenme gunu 17: 17 Kasim'da donem degisir
  s.clock.t = Date.UTC(2026, 10, 16, 12); assert.equal(s.api.status().fx.left, 1234);
  s.clock.t = Date.UTC(2026, 10, 17, 0, 0, 1); assert.equal(s.api.status().fx.left, 1500);
  // ucretli plan: kota buyuk
  const p = setup({ handler: router({ quota: () => res(200, { result: 'success', plan_quota: 30000, requests_remaining: 29000, refresh_day_of_month: 3 }) }) });
  assert.match((await p.api.test('fx')).msg, /29\.000 \/ 30\.000/);
  assert.equal(p.api.status().fx.cap, 30000);
  // /quota yoksa (404) latest ile denenir
  const f = setup({ handler: router({ quota: () => res(404, 'Not Found') }) });
  const rf = await f.api.test('doviz');
  assert.equal(rf.ok, true); assert.match(rf.msg, /^ExchangeRate-API anahtarı çalışıyor \(1 USD = 41,8 TL\)\. Bu ay kalan istek: 1\.498\.$/);
  // latest de basarisiz ama eski kur varsa: "çalışıyor" denmez
  let down = false;
  const g = setup({ handler: router({ quota: () => res(404, 'Not Found'), fx: url => down ? res(403, { result: 'error', 'error-type': 'invalid-key' }) : okFx(url) }) });
  await g.api.fx('USD'); down = true;
  const rg = await g.api.test('fx');
  assert.equal(rg.ok, false); assert.match(rg.msg, /^ExchangeRate-API anahtarı geçersiz/);
  const k = setup({ handler: router({ quota: () => res(403, { result: 'error', 'error-type': 'invalid-key' }) }) });
  const rk = await k.api.test('fx');
  assert.equal(rk.ok, false); assert.match(rk.msg, /anahtarı geçersiz/); noKey(rk);
});

test('test(gecko): BTC fiyatıyla doğrular', async () => {
  const s = setup();
  const r = await s.api.test('kripto');
  assert.deepEqual(r, { ok: true, msg: 'CoinGecko Demo anahtarı çalışıyor (BTC 65.432 $). Bu ay kalan istek: 9.999.' });
  const u = new URL(s.calls[0].url);
  assert.equal(u.pathname, '/api/v3/simple/price'); assert.equal(s.calls[0].opts.headers['x-cg-demo-api-key'], KEYS.gecko);
  const l = setup({ handler: router({ gecko: () => res(429, {}, { 'retry-after': '20' }) }) });
  assert.match((await l.api.test('gecko')).msg, /20 sn sonra tekrar dene/);
  assert.match((await l.api.crypto({})).error, /20 sn sonra/, 'test sonrası bekleme crypto için de geçerli');
  assert.equal(l.calls.length, 1);
});

// ============================================================================================================================
// Anahtar sızıntısı: dönen hiçbir metinde, durumda, dosyada ya da konsolda anahtar yok
// ============================================================================================================================
test('anahtar hiçbir dönüşe, duruma, dosyaya ya da loga sızmaz', async t => {
  const logs = [];
  for (const m of ['log', 'error', 'warn', 'info', 'debug']) t.mock.method(console, m, (...a) => logs.push(a.map(String).join(' ')));
  const echo = (url, opts) => JSON.stringify({ url, headers: opts.headers });   // sunucu istegi aynen geri yansitiyor
  const scen = [
    { news: (u, o) => res(400, { status: 'error', code: 'parameterInvalid', message: 'bad ' + echo(u, o) }),
      fx: (u, o) => res(400, { result: 'error', 'error-type': echo(u, o) }),
      gecko: (u, o) => res(400, { error: 'bad ' + echo(u, o) }) },
    { news: (u, o) => res(418, { status: 'error', message: KEYS.news.slice(0, 5) + ' ' + encodeURIComponent(KEYS.news) + ' ' + KEYS.news }),
      fx: (u) => res(418, { result: 'error', 'error-type': u }),
      gecko: (u, o) => res(403, { status: { error_code: 1, error_message: 'x'.repeat(90) + o.headers['x-cg-demo-api-key'] } }) },
    // anahtar ayrintinin 100. karakterinde kesilecek yerde: kesilmeden once maskelenmeli (yarim anahtar kalmasin)
    { news: (u, o) => res(400, { status: 'error', code: 'parameterInvalid', message: 'x'.repeat(92) + o.headers['X-Api-Key'] }),
      fx: () => res(418, { result: 'error', 'error-type': 'x'.repeat(92) + KEYS.fx }),
      gecko: (u, o) => res(404, { error: 'x'.repeat(92) + o.headers['x-cg-demo-api-key'] }) },
    { news: u => { throw new Error('getaddrinfo ' + u + ' ' + KEYS.news); }, fx: u => { throw new Error(u); }, gecko: (u, o) => { throw new Error(JSON.stringify(o)); } },
    { news: (u, o) => res(200, 'not json ' + o.headers['X-Api-Key']), fx: u => res(200, '<html>' + u), gecko: (u, o) => res(200, '{' + o.headers['x-cg-demo-api-key']) },
    { news: (u, o) => res(500, { status: 'error', code: 'unexpectedError', message: o.headers['X-Api-Key'] }), fx: u => res(500, u), gecko: () => res(503, KEYS.gecko) },
  ];
  for (const sc of scen) {
    const s = setup({ handler: router({ ...sc, quota: sc.fx }) });
    const out = [];
    out.push(await s.api.news('borsa'), await s.api.newsFor('THYAO', 'Türk Hava Yolları'), await s.api.fx('USD'), await s.api.crypto({}),
      await s.api.test('news'), await s.api.test('fx'), await s.api.test('gecko'), s.api.status());
    for (const o of out) noKey(o);
    for (const o of out.slice(0, 7)) {
      const m = o.error || o.msg;
      assert.ok(typeof m === 'string' && m.length > 0 && m.length <= 200, m);
    }
    if (fs.existsSync(s.file)) noKey(fs.readFileSync(s.file, 'utf8'), 'dosya');
  }
  noKey(logs.join('\n'), 'log');
  assert.equal(logs.length, 0, 'modül konsola yazmaz');
});
