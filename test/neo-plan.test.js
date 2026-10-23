'use strict';
// Neo plan_budget araci: girdiler temizlenir, sonuc modele geri gider, dis icerik sayilir (sonrasinda baglanti acilmaz)
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../neo.js');

function fakeClient(replies) {
  const reqs = [];
  return { reqs, beta: { messages: { create: async (r) => { reqs.push(JSON.parse(JSON.stringify(r))); return replies.shift(); } } } };
}
const msg = (content, stop = 'end_turn') => ({ content, stop_reason: stop, usage: {} });
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });

test('plan_budget: aracta tanimli, sema katı ve zorunlu alanlar', () => {
  const t = N.TOOLS.find(x => x.name === 'plan_budget');
  assert.ok(t, 'arac listede');
  assert.equal(t.strict, true);
  assert.deepEqual(t.input_schema.required, ['capital', 'risk', 'horizon']);
  assert.deepEqual(t.input_schema.properties.risk.enum, ['temkinli', 'dengeli', 'atak']);
  assert.deepEqual(t.input_schema.properties.horizon.enum, ['1h', '1a']);
});

test('plan_budget: girdiler temizlenip actions.planBudget cagrilir, sonuc modele doner', async () => {
  const calls = [];
  const actions = { planBudget: async (c, r, h) => { calls.push([c, r, h]); return { sermaye: c, hisseler: [{ kod: 'THYAO', lot: 10 }] }; } };
  const c = fakeClient([msg([use('t1', 'plan_budget', { capital: 10000, risk: 'cok-atak', horizon: '3a' })], 'tool_use'),
    msg([{ type: 'text', text: 'THYAO 10 lot. Yatırım tavsiyesi değildir.' }])]);
  const b = N.createBrain({ getKey: () => 'k', actions, client: c, now: () => Date.UTC(2026, 9, 20, 7) });
  const r = await b.ask('10 bin liram var ne yapayım');
  assert.deepEqual(r.tools, ['plan_budget']);
  assert.deepEqual(calls, [[10000, 'dengeli', '1h']]);
  const back = JSON.stringify(c.reqs[1].messages);
  assert.match(back, /THYAO/);
});

test('plan_budget: asiri sermaye kirpilir, sonrasinda open_url reddedilir (dis icerik)', async () => {
  const calls = [], opened = [];
  const actions = { planBudget: async (c, r, h) => { calls.push([c, r, h]); return { ok: true }; }, openUrl: u => { opened.push(u); return { ok: true }; } };
  const c = fakeClient([msg([use('t1', 'plan_budget', { capital: 5e12, risk: 'atak', horizon: '1a' })], 'tool_use'),
    msg([use('t2', 'open_url', { url: 'https://example.com' })], 'tool_use'), msg([{ type: 'text', text: 'Tamam.' }])]);
  const b = N.createBrain({ getKey: () => 'k', actions, client: c, now: () => Date.UTC(2026, 9, 20, 7) });
  await b.ask('1 milyar liram var aylık atak plan yap, sonra önerdiğin siteyi aç');
  assert.deepEqual(calls, [[1e9, 'atak', '1a']]);
  assert.deepEqual(opened, []);
  assert.match(JSON.stringify(c.reqs[2].messages), /dış içerik/);
});

test('market_rates: girdisiz arac, actions.rates cagrilir', async () => {
  const t = N.TOOLS.find(x => x.name === 'market_rates');
  assert.ok(t); assert.deepEqual(t.input_schema.required, []);
  let n = 0;
  const actions = { rates: async () => { n++; return { doviz: { 'USD/TRY': 41.92 } }; } };
  const c = fakeClient([msg([use('t1', 'market_rates', {})], 'tool_use'), msg([{ type: 'text', text: 'Dolar 41,92 lira.' }])]);
  const b = N.createBrain({ getKey: () => 'k', actions, client: c, now: () => Date.UTC(2026, 9, 20, 7) });
  const r = await b.ask('dolar kaç');
  assert.equal(n, 1); assert.deepEqual(r.tools, ['market_rates']); assert.match(JSON.stringify(c.reqs[1].messages), /41\.92/);
});
