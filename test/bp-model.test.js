'use strict';
// bp-model.js: ozellikler yalniz gecmis veriyle, eksik gecmiste null, model tahmini -1..1 ve kalibrasyon kovasi.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../bp-model.js');
const E = require('../engine.js');

function seri(n, drift, seed = 1) {
  let p = 100, b = 1000, s = seed; const rows = [], bench = [], t0 = Date.UTC(2022, 0, 3);
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) {
    const r = drift + rnd() * 0.03, rb = rnd() * 0.015; p *= 1 + r; b *= 1 + rb; const t = t0 + i * 864e5;
    rows.push({ t, o: p / (1 + r / 2), h: p * 1.01, l: p * 0.99, c: p, v: 1e6 * (1 + rnd()) });
    bench.push({ t, o: b, h: b * 1.005, l: b * 0.995, c: b, v: 0 });
  }
  return { rows, bench };
}

test('ozellikler: gelecek veriye bakmaz (son mumu degistirmek onceki degerleri degistirmez)', () => {
  const { rows, bench } = seri(400, 0.001);
  const a = M.series(rows, bench), rows2 = rows.slice(); rows2[399] = { ...rows[399], c: rows[399].c * 1.5, h: rows[399].h * 1.5 };
  const b = M.series(rows2, bench);
  for (const k of M.NAMES) for (let i = 0; i < 399; i++) { const x = a.col[k][i], y = b.col[k][i]; assert.ok(Number.isNaN(x) ? Number.isNaN(y) : x === y, k + ' ' + i); }
});

test('model: yetersiz gecmis ya da endeks yoksa null; varsa -1..1 ve kova', () => {
  const { rows, bench } = seri(400, 0.002);
  assert.equal(M.score(rows.slice(-200), bench), null);
  assert.equal(M.score(rows, null), null);
  const r = M.score(rows, bench);
  assert.ok(r && r.v >= -1 && r.v <= 1); assert.ok(r.kova.n > 1000 && r.kova.up20 > 0 && r.kova.up20 < 1);
});

test('motor: gunluk dilim + endeks ile model bileseni ve olculmus kalibrasyon; endeks yoksa eski davranis', () => {
  const { rows, bench } = seri(400, 0.002);
  const a = E.proAnalyze({ '1g': rows }, { bench });
  const m = a.verdict.components.find(c => c.key === 'model');
  assert.ok(m && m.weight >= 80); assert.equal(a.verdict.calib.model, true); assert.ok(a.verdict.model);
  const b = E.proAnalyze({ '1g': rows });
  assert.ok(!b.verdict.components.some(c => c.key === 'model')); assert.ok(!b.verdict.model);
});
