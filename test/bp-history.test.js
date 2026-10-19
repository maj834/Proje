'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistory } = require('../bp-history.js');
const body = n => ({ chart: { result: [{ timestamp: Array.from({ length: n }, (_, i) => 1.6e9 + i * 86400), indicators: { quote: [{
  open: Array.from({ length: n }, (_, i) => 10 + i), high: Array.from({ length: n }, (_, i) => 11 + i), low: Array.from({ length: n }, (_, i) => 9 + i),
  close: Array.from({ length: n }, (_, i) => (i === 2 ? null : 10.5 + i)), volume: Array.from({ length: n }, () => 1000) }] } }] } });
const ok = j => ({ ok: true, status: 200, json: async () => j });

test('10 yillik gunluk veri: gecersiz satirlar atilir, 12 saat onbellek, eszamanli istek tek', async () => {
  let calls = 0, t = 0;
  const h = createHistory({ fetch: async url => { calls++; assert.match(url, /THYAO\.IS\?interval=1d&range=10y/); return ok(body(5)); }, now: () => t });
  const [a, b] = await Promise.all([h.get('thyao.is'), h.get('THYAO.IS')]);
  assert.equal(calls, 1);
  assert.equal(a.length, 4);                       // null kapanis atildi
  assert.equal(a, b);
  await h.get('THYAO.IS'); assert.equal(calls, 1);
  t += 12 * 3600000 + 1; await h.get('THYAO.IS'); assert.equal(calls, 2);
});

test('hata: eski kayit varsa o doner, yoksa Turkce hata; gecersiz sembol reddedilir', async () => {
  let fail = false, t = 0;
  const h = createHistory({ fetch: async () => { if (fail) throw new TypeError('fetch failed'); return ok(body(3)); }, now: () => t });
  await h.get('GARAN.IS'); fail = true; t += 13 * 3600000;
  assert.equal((await h.get('GARAN.IS')).length, 2);
  await assert.rejects(h.get('AKBNK.IS'), /Bağlantı yok/);
  await assert.rejects(h.get('<script>'), /Geçersiz sembol/);
});

test('en fazla 24 hisse tutulur', async () => {
  const h = createHistory({ fetch: async () => ok(body(3)) });
  for (let i = 0; i < 30; i++) await h.get('S' + i + '.IS');
  assert.equal(h.size(), 24);
});
