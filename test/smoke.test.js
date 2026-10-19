'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

// Her testte taze modul: gate listesi modul duzeyinde tutulur
function fresh() { delete require.cache[require.resolve('../smoke.js')]; return require('../smoke.js'); }
function fakeApp() { const a = new EventEmitter(); a.whenReady = () => Promise.resolve(); a.getVersion = () => '2.0.9'; return a; }
function run(smoke, o = {}) {
  return new Promise(ok => {
    const lines = [];
    smoke(fakeApp(), { env: { CEM_SMOKE: '1' }, proc: new EventEmitter(), delay: 5, getWindows: () => [1, 2],
      out: s => lines.push(s), err: s => lines.push(s), exit: c => ok({ code: c, lines }), ...o });
  });
}

test('CEM_SMOKE yokken hicbir sey yapmaz', () => {
  const smoke = fresh();
  assert.equal(smoke(fakeApp(), { env: {} }), false);
});

test('kontrol yokken OK yazar', async () => {
  const r = await run(fresh());
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /^CEM_SMOKE_OK version=2\.0\.9 windows=2$/);
});

test('gecen kontrol sonucu OK satirina eklenir', async () => {
  const smoke = fresh();
  smoke.gate('borsapro', () => new Promise(ok => setTimeout(() => ok('grafik'), 20)));
  const r = await run(smoke);
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /^CEM_SMOKE_OK .* borsapro=grafik$/);
});

test('reddedilen kontrol FAIL ve 1 ile cikar', async () => {
  const smoke = fresh();
  smoke.gate('borsapro', Promise.reject(new Error('LightweightCharts yuklenemedi')));
  const r = await run(smoke);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /^CEM_SMOKE_FAIL gate: .*LightweightCharts yuklenemedi/);
});

test('bitmeyen kontrol zaman asimiyla FAIL', async () => {
  const smoke = fresh();
  smoke._gateMs(30);
  smoke.gate('asili', new Promise(() => {}));
  const r = await run(smoke);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /zaman asimi/);
});
