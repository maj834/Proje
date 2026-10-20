'use strict';
// borsa-mcp-client.js: Render'daki Borsa MCP sunucusu istemcisi. Ag yok: fetch ve uyku sahte.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../borsa-mcp-client.js');
const { createBorsaMcp, parseBody, cleanUrl, sym, TOOLS } = M;

const T0 = Date.UTC(2026, 9, 20, 10);
const reply = (status, text, ctype = 'application/json') => ({ status, ok: status >= 200 && status < 300, headers: { get: k => (/content-type/i.test(k) ? ctype : null) }, text: async () => text });
const ok = (text, extra = {}) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }], isError: false, ...extra } });
const sse = j => reply(200, 'event: message\ndata: ' + j + '\n\n', 'text/event-stream');
const HEALTHY = JSON.stringify({ status: 'healthy', service: 'Borsa MCP Server', version: '0.9.0' });
const INTERSTITIAL = '<!DOCTYPE html><html><body>SERVICE WAKING UP ... APPLICATION LOADING <a href="https://render.com/">render</a></body></html>';

function setup(handler, o = {}) {
  const clock = { t: T0 }, calls = [];
  const fetch = async (url, init) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return handler(url, init, calls); };
  const api = createBorsaMcp({ fetch, now: () => clock.t, sleep: async ms => { clock.t += ms; }, ...o });
  return { api, clock, calls, mcp: () => calls.filter(c => c.url.endsWith('/mcp/')) };
}

test('parseBody: duz JSON, SSE, HTML uyaniyor sayfasi', () => {
  assert.equal(parseBody(ok('a'), 'application/json').result.content[0].text, 'a');
  assert.equal(parseBody('event: message\ndata: ' + ok('b') + '\n\n', 'text/event-stream').result.content[0].text, 'b');
  assert.deepEqual(parseBody(INTERSTITIAL, 'text/html; charset=utf-8'), { html: true });
  assert.equal(parseBody('', ''), null); assert.equal(parseBody('bozuk', 'text/plain'), null);
});

test('cagri: dogru JSON-RPC govdesi ve basliklar, SSE yaniti, onbellek ve tekillestirme', async () => {
  const s = setup(() => sse(ok('## THYAO KAP')));
  const [a, b] = await Promise.all([s.api.kapNews('thyao.is'), s.api.kapNews('THYAO')]);
  assert.equal(a.ok, true); assert.equal(a.text, '## THYAO KAP'); assert.equal(b.text, '## THYAO KAP');
  assert.equal(s.mcp().length, 1, 'es zamanli istekler tek');
  const c = s.calls[0];
  assert.equal(c.url, 'https://borsa-mcp-a07f.onrender.com/mcp/'); assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers.accept, 'application/json, text/event-stream');
  assert.deepEqual({ m: c.body.method, n: c.body.params.name, a: c.body.params.arguments }, { m: 'tools/call', n: 'get_news', a: { symbol: 'THYAO', limit: 10 } });
  assert.equal((await s.api.kapNews('THYAO')).cached, true); assert.equal(s.mcp().length, 1);
  s.clock.t += 11 * 60000; await s.api.kapNews('THYAO'); assert.equal(s.mcp().length, 2, '10 dk sonra yenilenir');
});

test('yardimcilar: sunucudaki arac ve parametre adlari', async () => {
  const s = setup(() => reply(200, ok('x')));
  await s.api.financials('ŞİŞE'); await s.api.ratios('AAPL', { market: 'US', set: 'buffett' }); await s.api.corporateActions('GARAN');
  await s.api.econCalendar({ country: 'US', period: 'next_week', importance: 'high' }); await s.api.bondYields(); await s.api.quote('THYAO');
  await s.api.fund('tte'); await s.api.econCalendar({ country: 'XX', period: 'yarin' });
  assert.deepEqual(s.calls.map(c => [c.body.params.name, c.body.params.arguments]), [
    ['get_financial_statements', { symbol: 'SISE', market: 'bist', statement_type: 'all', period: 'quarterly' }],
    ['get_financial_ratios', { symbol: 'AAPL', market: 'us', ratio_set: 'buffett' }],
    ['get_corporate_actions', { symbol: 'GARAN', market: 'bist' }],
    ['get_economic_calendar', { country: 'US', period: 'next_week', importance: 'high' }],
    ['get_bond_yields', { country: 'TR' }],
    ['get_quote', { symbol: 'THYAO', market: 'bist' }],
    ['get_fund_data', { symbol: 'TTE' }],
    ['get_economic_calendar', { country: 'TR', period: 'this_week' }]]);
  for (const t of ['get_news', 'get_financial_statements', 'get_financial_ratios', 'get_corporate_actions', 'get_economic_calendar', 'get_bond_yields', 'get_quote', 'get_fund_data']) assert.ok(TOOLS.includes(t));
});

test('Render uyku: HTML sayfasi -> /health yoklanir, saglikli olunca bir kez daha denenir', async () => {
  let up = false, n = 0;
  const s = setup((url) => {
    if (url.endsWith('/health')) { if (++n >= 3) up = true; return up ? reply(200, HEALTHY) : reply(200, INTERSTITIAL, 'text/html'); }
    return up ? reply(200, ok('tahvil')) : reply(200, INTERSTITIAL, 'text/html');
  });
  const p = s.api.bondYields();
  const r = await p;
  assert.equal(r.ok, true); assert.equal(r.text, 'tahvil');
  assert.equal(s.mcp().length, 2); assert.equal(n, 3);
  assert.equal(s.api.status().awake, true); assert.equal(s.api.status().waking, false);
});

test('Render uyanmazsa: ~90 sn sonra vazgecer, Turkce hata; eski onbellek varsa o doner', async () => {
  let asleep = false;
  const s = setup(url => (asleep ? (url.endsWith('/health') ? reply(503, 'x', 'text/plain') : reply(200, INTERSTITIAL, 'text/html')) : reply(200, ok('takvim'))));
  assert.equal((await s.api.econCalendar()).text, 'takvim');
  asleep = true; s.clock.t += 2 * 3600000;
  const r = await s.api.econCalendar();
  assert.equal(r.ok, true); assert.equal(r.stale, true); assert.equal(r.text, 'takvim'); assert.match(r.error, /uyanamadı/);
  const r2 = await s.api.bondYields();
  assert.equal(r2.ok, false); assert.match(r2.error, /uyanamadı/);
  assert.equal(s.api.status().awake, false);
});

test('arac hatasi (isError) ve JSON-RPC hatasi yeniden denenmez', async () => {
  const s = setup(url => url.includes('mcp') ? reply(200, ok('Sembol bulunamadı: XXXX', { isError: true })) : reply(200, HEALTHY));
  const r = await s.api.kapNews('XXXX');
  assert.equal(r.ok, false); assert.match(r.error, /Borsa MCP: Sembol bulunamadı/); assert.equal(s.calls.length, 1);
  const e = setup(() => reply(200, JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } })));
  assert.match((await e.api.quote('THYAO')).error, /Invalid params/);
});

test('girdi denetimi: arac listesi, sembol, fon kodu, adres', async () => {
  const s = setup(() => reply(200, ok('x')));
  assert.equal((await s.api.call('rm_rf', {})).ok, false);
  assert.equal((await s.api.kapNews('<script>')).ok, false); assert.equal((await s.api.fund('TOOLONG')).ok, false);
  assert.equal(s.calls.length, 0);
  assert.equal(sym('aapl.us'), 'AAPL'); assert.equal(sym(''), null); assert.equal(sym('a b'), null);
  assert.equal(cleanUrl('http://x.com'), null); assert.equal(cleanUrl('https://a:b@x.com'), null); assert.equal(cleanUrl('https://x.onrender.com/mcp/?q=1'), 'https://x.onrender.com');
  assert.equal(s.api.setUrl('ftp://x'), false); assert.equal(s.api.setUrl('https://yeni.onrender.com/'), true);
  await s.api.bondYields(); assert.equal(s.calls[0].url, 'https://yeni.onrender.com/mcp/'); assert.equal(s.api.status().url, 'https://yeni.onrender.com');
});

test('uzun metin kisaltilir; 502 uyku sayilir', async () => {
  let k = 0;
  const s = setup(url => url.endsWith('/health') ? reply(200, HEALTHY) : (k++ ? reply(200, ok('y'.repeat(30000))) : reply(502, 'Bad Gateway', 'text/plain')));
  const r = await s.api.financials('THYAO');
  assert.equal(r.ok, true); assert.ok(r.text.length < 20100); assert.match(r.text, /kısaltıldı/);
});
