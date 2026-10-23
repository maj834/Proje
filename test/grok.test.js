'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, mockFetch, offline } = require('./helpers/util.js');
const ai = require('../ai.js');

const KEY = 'xai-' + 'a'.repeat(40);
const IMG = Buffer.from('jpeg-bytes').toString('base64');
const isModels = /api\.x\.ai\/v1\/language-models$/;
const isChat = /api\.x\.ai\/v1\/chat\/completions$/;

const MODELS = {
  models: [
    { id: 'grok-3', input_modalities: ['text'] },
    { id: 'grok-2-vision-1212', input_modalities: ['text', 'image'] },
    { id: 'grok-4-heavy', input_modalities: ['text', 'image'] },
    { id: 'grok-4-0709', input_modalities: ['text', 'image'] }
  ]
};
const ANALYSIS = () => ({
  chart_found: true, symbol: 'THYAO', timeframe: '1g', last_price: 312.5, axis: [{ price: 320, y: 0.2 }],
  bias: 'yukselis', confidence: 70, trend: 'Yükselen trend', chart_box: { x1: 0, y1: 0, x2: 1, y2: 1 },
  resistances: [{ price: 320, y: 0.2 }], supports: [{ price: 300, y: 0.8 }],
  trendlines: [{ type: 'destek', x1: 0, y1: 1, x2: 1, y2: 0.5 }], breakout: null, patterns: [], comment: 'Test'
});
const chat = (content, extra = {}) => ({ id: 'c1', model: 'grok-4-0709', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1200, completion_tokens: 300 }, ...extra });

test('validKey', () => {
  const G = fresh('grok.js');
  assert.equal(G.validKey(KEY), true);
  assert.equal(G.validKey('  ' + KEY + ' '), true);
  assert.equal(G.validKey('grok_' + 'b'.repeat(24)), true);
  for (const k of ['', null, 'xai-short', 'sk-' + 'a'.repeat(40), 'xai-' + 'a'.repeat(19) + '!']) assert.equal(G.validKey(k), false, String(k));
});

test('analyze: gorsel destekli, heavy olmayan grok-4 secilir; json_schema istegi', async t => {
  const G = fresh('grok.js');
  const calls = mockFetch(t, [[isModels, () => ({ body: MODELS })], [isChat, () => ({ body: chat(JSON.stringify(ANALYSIS())) })]]);
  const a = await G.analyze({ key: KEY, img: IMG });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ' + KEY);
  const req = calls[1].body;
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(req.model, 'grok-4-0709');
  assert.equal(req.temperature, 0);
  assert.equal(req.response_format.type, 'json_schema');
  assert.equal(req.response_format.json_schema.strict, true);
  assert.deepEqual(req.response_format.json_schema.schema, ai.SCHEMA);
  assert.equal(req.messages[0].role, 'system');
  assert.equal(req.messages[0].content, ai.SYS);
  const img = req.messages[1].content.find(p => p.type === 'image_url');
  assert.equal(img.image_url.url, 'data:image/jpeg;base64,' + IMG);
  assert.equal(a.engine, 'grok');
  assert.equal(a.model, 'grok-4-0709');
  assert.deepEqual(a.tokens, { in: 1200, out: 300 });
  assert.equal(a.symbol, 'THYAO');
  // Model listesi onbellekte: ikinci analizde /language-models tekrar cagrilmaz.
  await G.analyze({ key: KEY, img: IMG });
  assert.equal(calls.filter(c => isModels.test(c.url)).length, 1);
});

test('analyze: model secimi — tercih edilen model, liste bos/hata -> grok-4', async t => {
  let G = fresh('grok.js');
  let models = { models: [] };
  const calls = mockFetch(t, [[isModels, () => models instanceof Error ? models : { body: models }], [isChat, () => ({ body: chat(JSON.stringify(ANALYSIS())) })]]);
  await G.analyze({ key: KEY, img: IMG, model: 'grok-x-custom' });
  assert.equal(calls.at(-1).body.model, 'grok-x-custom');
  assert.equal(calls.filter(c => isModels.test(c.url)).length, 0);
  await G.analyze({ key: KEY, img: IMG });
  assert.equal(calls.at(-1).body.model, G.FALLBACK_MODEL);
  G = fresh('grok.js'); models = offline();
  await G.analyze({ key: KEY, img: IMG });
  assert.equal(calls.at(-1).body.model, 'grok-4');
  G = fresh('grok.js'); models = { data: [{ id: 'grok-2-vision', input_modalities: ['image'] }] };
  await G.analyze({ key: KEY, img: IMG });
  assert.equal(calls.at(-1).body.model, 'grok-2-vision');
});

test('analyze: response_format desteklenmezse (400) duz JSON ile tekrar dener ve metinden JSON cikarir', async t => {
  const G = fresh('grok.js');
  let n = 0;
  const calls = mockFetch(t, [[isChat, () => ++n === 1
    ? { status: 400, body: { error: { message: 'Model does not support response_format of type json_schema' } } }
    : { body: chat('Analiz sonucu:\n```json\n' + JSON.stringify(ANALYSIS()) + '\n```\nUmarim yardimci olur.') }]]);
  const a = await G.analyze({ key: KEY, img: IMG, model: 'grok-2-vision' });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.response_format);
  assert.equal(calls[1].body.response_format, undefined);
  assert.match(calls[1].body.messages[0].content, /yalnizca gecerli JSON/);
  assert.equal(a.chart_found, true);
  assert.equal(a.supports[0].price, 300);
});

test('analyze: diger 400 hatalari tekrar denenmez; bozuk yanit SyntaxError', async t => {
  const G = fresh('grok.js');
  let body = { status: 400, body: { error: { message: 'Image too large' } } };
  const calls = mockFetch(t, [[isChat, () => body]]);
  await assert.rejects(G.analyze({ key: KEY, img: IMG, model: 'm' }), e => e.status === 400 && /Image too large/.test(e.message));
  assert.equal(calls.length, 1);
  body = { body: chat('json yok') };
  await assert.rejects(G.analyze({ key: KEY, img: IMG, model: 'm' }), SyntaxError);
  body = { body: { choices: [{ finish_reason: 'length', message: { content: '{"a":' } }] } };
  await assert.rejects(G.analyze({ key: KEY, img: IMG, model: 'm' }), /yarıda kesildi/);
  body = { body: { choices: [{ finish_reason: 'stop', message: { refusal: 'no', content: null } }] } };
  await assert.rejects(G.analyze({ key: KEY, img: IMG, model: 'm' }), /yanıtlamadı/);
  body = { body: { choices: [] } };
  await assert.rejects(G.analyze({ key: KEY, img: IMG, model: 'm' }), /boş yanıt/);
});

test('analyze: kirpma (crop) koordinatlari tam ekrana cevrilir', async t => {
  const G = fresh('grok.js');
  mockFetch(t, [[isChat, () => ({ body: chat(JSON.stringify(ANALYSIS())) })]]);
  const a = await G.analyze({ key: KEY, img: IMG, model: 'm', crop: { x: 0.5, y: 0.25, w: 0.5, h: 0.5 } });
  assert.deepEqual(a.chart_box, { x1: 0.5, y1: 0.25, x2: 1, y2: 0.75 });
  assert.equal(a.resistances[0].y, 0.35);
  assert.equal(a.supports[0].y, 0.65);
  assert.deepEqual(a.trendlines[0], { type: 'destek', x1: 0.5, y1: 0.75, x2: 1, y2: 0.5 });
  assert.equal(a.axis[0].y, 0.35);
});

test('ai.mapCrop: crop yoksa degismez, eksik alanlarda hata vermez', () => {
  const a = ANALYSIS();
  assert.deepEqual(ai.mapCrop(a, null), ANALYSIS());
  assert.deepEqual(ai.mapCrop({ chart_found: false }, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }), { chart_found: false });
  const b = ai.mapCrop({ supports: [{ y: 0 }], resistances: [{ y: 1 }] }, { x: 0, y: 0.2, w: 1, h: 0.4 });
  assert.equal(b.supports[0].y, 0.2);
  assert.ok(Math.abs(b.resistances[0].y - 0.6) < 1e-12);
});

test('analyzeDepth: DSCHEMA ile istek, maliyet 0', async t => {
  const G = fresh('grok.js');
  const d = { found: true, symbol: 'THYAO', last: 312.5, change: null, ceiling: null, floor: null, buyRatio: 60, bids: [{ price: 312.25, qty: 1000, orders: 5 }], asks: [], buyers: [], sellers: [], trades: [] };
  const calls = mockFetch(t, [[isChat, () => ({ body: chat([{ type: 'text', text: JSON.stringify(d) }]) })]]);
  const r = await G.analyzeDepth({ key: KEY, img: IMG, model: 'grok-4' });
  assert.deepEqual(calls[0].body.response_format.json_schema.schema, ai.DSCHEMA);
  assert.equal(calls[0].body.response_format.json_schema.name, 'derinlik');
  assert.equal(r.bids[0].qty, 1000);
  assert.equal(r.cost, 0);
  assert.equal(r.model, 'grok-4-0709');
});

test('test(): gorsel modelleri listeler; hata durumu', async t => {
  const G = fresh('grok.js');
  let ok = true;
  mockFetch(t, [[isModels, () => ok ? { body: MODELS } : { status: 401, body: { error: 'Incorrect API key provided' } }]]);
  assert.deepEqual(await G.test(KEY), { ok: true, visionModels: ['grok-2-vision-1212', 'grok-4-heavy', 'grok-4-0709'] });
  const G2 = fresh('grok.js');
  ok = false;
  await assert.rejects(G2.test(KEY), e => e.status === 401 && e.message === 'Incorrect API key provided');
});

test('errorText: 401, kredi 403, 404, 429, cevrimdisi, SyntaxError', async t => {
  const G = fresh('grok.js');
  const E = (status, message) => Object.assign(new Error(message), { status });
  assert.match(G.errorText(E(401, 'Incorrect API key provided')), /anahtarı geçersiz/);
  assert.match(G.errorText(E(403, 'Invalid auth token')), /anahtarı geçersiz/);
  assert.match(G.errorText(E(403, 'Your team does not have any credits yet')), /kredi yok/);
  assert.match(G.errorText(E(402, 'Payment required')), /kredi yok/);
  assert.match(G.errorText(E(500, 'spending limit reached')), /kredi yok/);
  assert.match(G.errorText(E(404, 'model not found')), /modeli bulunamadı/);
  assert.match(G.errorText(E(429, 'Too many requests')), /istek sınırı/);
  assert.match(G.errorText(new SyntaxError('json')), /okunamadı/);
  assert.equal(G.errorText(E(500, 'Internal')), 'Grok: Internal');
  // Cevrimdisi: fetch hatasi kullaniciya Turkce mesaj olarak gelir.
  mockFetch(t, [[() => true, () => offline()]]);
  const err = await G.analyze({ key: KEY, img: IMG, model: 'm' }).catch(e => e);
  assert.equal(err.message, 'Grok\'a bağlanılamadı.');
  assert.equal(G.errorText(err), 'Grok\'a bağlanılamadı.');
});

test('model listesi onbellegi anahtara bagli; test() onbellegi atlar (M2)', async t => {
  const G = fresh('grok.js');
  const KEY2 = 'xai-' + 'b'.repeat(40);
  let bad = false;
  const calls = mockFetch(t, [
    [isModels, (url, init) => (bad || init.headers.authorization !== 'Bearer ' + KEY) ? { status: 401, body: { error: 'Incorrect API key provided' } } : { body: MODELS }],
    [isChat, () => ({ body: chat(JSON.stringify(ANALYSIS())) })]
  ]);
  const models = () => calls.filter(c => isModels.test(c.url));
  assert.equal((await G.test(KEY)).ok, true);
  // Gecerli anahtardan sonra gecersiz anahtar onbellekten "gecerli" gorunmemeli.
  await assert.rejects(G.test(KEY2), e => e.status === 401);
  // Ayni anahtar ikinci kez denendiginde de sunucuya gidilir (anahtar iptal edilmis olabilir).
  bad = true;
  await assert.rejects(G.test(KEY), e => e.status === 401);
  assert.equal(models().length, 3);
  // analyze icin onbellek anahtar bazinda: KEY ile listelenir, KEY2 icin tekrar sorulur.
  bad = false;
  const G2 = fresh('grok.js');
  await G2.analyze({ key: KEY, img: IMG });
  await G2.analyze({ key: KEY, img: IMG });
  assert.equal(models().length, 4, 'ayni anahtar onbellekten');
  await G2.analyze({ key: KEY2, img: IMG });
  assert.equal(models().length, 5, 'farkli anahtar icin liste yeniden alinir');
  assert.equal(calls.at(-1).body.model, 'grok-4', 'KEY2 listesi alinamazsa yedek model');
});

test('analyze: kullanicinin hisse kodu ipucu olarak gider (fiyat gitmez); sema yeni alanlari ister; drawn_levels kirpmaya gore cevrilir', async t => {
  const G = fresh('grok.js');
  const body = { ...ANALYSIS(), visible_indicators: [{ name: 'EMA 50', value: null }], drawn_levels: [{ price: 300, y: 0.5 }], platform: 'TradingView' };
  const calls = mockFetch(t, [[isModels, () => ({ body: MODELS })], [isChat, () => ({ body: chat(JSON.stringify(body)) })]]);
  const a = await G.analyze({ key: KEY, img: IMG, hint: { symbol: 'asels<script>' }, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 } });
  const txt = calls[1].body.messages[1].content.find(p => p.type === 'text').text;
  assert.match(txt, /Kullanicinin sectigi hisse: aselsscript/);
  assert.doesNotMatch(txt, /fiyat/i);
  assert.equal(a.drawn_levels[0].y, 0.2 + 0.5 * 0.5);
  for (const k of ['visible_indicators', 'drawn_levels', 'platform']) assert.ok(ai.SCHEMA.required.includes(k), k);
  assert.equal(ai.userText(), 'Grafigi analiz et.');
});
