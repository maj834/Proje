'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const R = require('./helpers/raster.js');

const N = 60;
const rows = R.series(N, { seed: 7 });

function read(variant, opts = {}) {
  const im = R.render(rows, variant);
  const a = E.analyzeBitmap(im.buf, im.W, im.H, { format: 'rgba', ...opts });
  return { im, a };
}

function checkGeometry({ im, a }) {
  assert.equal(a.chart_found, true);
  assert.ok(Math.abs(a.candles - N) <= 2, 'mum sayisi ' + a.candles);
  const truthY = im.truth[im.truth.length - 1].closeY;
  assert.ok(Math.abs(a.last.y * im.H - truthY) <= 2, `son kapanis y=${a.last.y * im.H} beklenen ${truthY}`);
  assert.equal(a.rawCandles.length, a.candles);
}

// Kalibrasyon: ekrandaki mumlar + gercek seri -> y'den fiyat. Birkac fiyatta %0.5 icinde olmali.
function checkCalibration({ im, a }) {
  const cal = E.calibrateFromSeries(a.rawCandles, rows);
  assert.ok(cal, 'kalibrasyon bulunamadi');
  assert.ok(cal.r2 >= 0.99);
  for (const p of [im.pmin + 2, (im.pmin + im.pmax) / 2, im.pmax - 2, rows[rows.length - 1].c]) {
    const y = im.py(p) / im.H, got = cal.my + cal.k * (y - cal.mx);
    assert.ok(Math.abs(got - p) / p < 0.005, `fiyat ${p.toFixed(2)} -> ${got.toFixed(2)}`);
  }
}

test('yesil/kirmizi (varsayilan) mumlar: sayi, son kapanis, renk modu, kalibrasyon', () => {
  const r = read({});
  checkGeometry(r);
  assert.equal(r.a.colorMode, 'green-red');
  assert.equal(r.a.candleStyle, 'filled');
  checkCalibration(r);
});

test('BGRA girdi (varsayilan bicim) RGBA ile ayni sonucu verir', () => {
  const im = R.render(rows, {});
  const a = E.analyzeBitmap(R.toBGRA(im.buf), im.W, im.H);
  const b = E.analyzeBitmap(im.buf, im.W, im.H, { format: 'rgba' });
  assert.equal(a.candles, b.candles);
  assert.deepEqual(a.last, b.last);
  assert.equal(a.colorMode, 'green-red');
});

test('acik zemin uzerinde yesil/kirmizi', () => {
  const r = read({ bg: '#ffffff' });
  checkGeometry(r);
  assert.equal(r.a.colorMode, 'green-red');
});

test('mavi/kirmizi tema otomatik ton moduyla okunur', () => {
  const r = read({ up: '#2962ff', down: '#f23645' });
  checkGeometry(r);
  assert.equal(r.a.colorMode, 'auto-hue');
  checkCalibration(r);
});

test('mavi/kirmizi tema, colors:"green-red" ile zorlanirsa auto-hue kullanilmaz', () => {
  const { a } = read({ up: '#2962ff', down: '#f23645' }, { colors: 'green-red' });
  assert.notEqual(a.colorMode, 'auto-hue');
});

test('ozel renkler (colors {up,down}) custom modunda okunur', () => {
  const r = read({ up: '#2962ff', down: '#f23645' }, { colors: { up: '#2962ff', down: '#f23645', tol: 40 } });
  checkGeometry(r);
  assert.equal(r.a.colorMode, 'custom');
  checkCalibration(r);
});

test('gecersiz ozel renkte otomatik moda duser', () => {
  const { a } = read({}, { colors: { up: 'yesil', down: '#ef5350' } });
  assert.equal(a.colorMode, 'green-red');
});

test('ici bos (hollow) yukselis mumlari', () => {
  const r = read({ hollowUp: true });
  checkGeometry(r);
  assert.equal(r.a.candleStyle, 'hollow');
  checkCalibration(r);
});

test('mum yoksa chart_found false', () => {
  const W = 300, H = 200, buf = new Uint8Array(W * H * 4).fill(30);
  assert.equal(E.analyzeBitmap(buf, W, H, { format: 'rgba' }).chart_found, false);
});

test('analyzeSeries: gostergeler, skor ve geriye donuk test alanlari', () => {
  const rs = R.series(150, { seed: 3, drift: 0.05, vol: 2.5 });
  const a = E.analyzeSeries(rs);
  assert.equal(a.chart_found, true);
  assert.equal(a.engine, 'piyasa');
  assert.equal(a.candles, 150);
  assert.equal(a.last_price, rs[rs.length - 1].c);
  assert.ok(a.ind && 'rsi' in a.ind && 'macd' in a.ind && 'emaTrend' in a.ind && 'bb' in a.ind);
  assert.ok(a.ind.rsi >= 0 && a.ind.rsi <= 100);
  assert.ok(Number.isFinite(a.score) && a.score >= -100 && a.score <= 100);
  assert.ok(Array.isArray(a.factors));
  assert.ok(a.backtest && 'count' in a.backtest && a.backtest.horizon === 5 && a.backtest.cost === 0.2);
  for (const l of [...a.resistances, ...a.supports]) assert.ok(Number.isFinite(l.price));
  for (const s of a.signals) { assert.ok(Number.isFinite(s.t)); assert.ok(Number.isFinite(s.price)); }
  assert.equal(a.allSignals, undefined);
  assert.equal(a.lines, undefined);
});

test('analyzeSeries: 30 mumdan az veri reddedilir', () => {
  assert.equal(E.analyzeSeries(R.series(20)).chart_found, false);
  assert.equal(E.analyzeSeries(null).chart_found, false);
});

test('backtest: maliyet avgRet\'ten tam olarak dusulur; byRule ve ufuklar var', () => {
  // Kapanislar: 100, sinyalden 5 mum sonra 110 (al: +%10) ya da 95 (sat: +%5).
  const rs = Array.from({ length: 40 }, (_, i) => ({ c: 100 }));
  rs[15].c = 110; rs[25].c = 95; rs[13].c = 103; rs[23].c = 98; rs[30].c = 120;
  const sigs = [
    { i: 10, dir: 1, why: ['MACD↑', 'EMA20↑EMA50'] },
    { i: 20, dir: -1, why: ['MACD↓'] },
    { i: 37, dir: 1, why: ['MACD↑'] } // ufuk disinda kalir
  ];
  const g = E.backtest(rs, sigs, 5, { cost: 0 });
  const n = E.backtest(rs, sigs, 5, { cost: 0.3 });
  assert.equal(g.count, 2);
  assert.equal(g.avgRet, 7.5);
  assert.equal(n.avgRet, 7.2);
  assert.equal(n.avgRetGross, 7.5);
  assert.equal(n.cost, 0.3);
  assert.equal(n.winRate, 100);
  assert.deepEqual(n.byDir.map(d => d.count), [1, 1]);
  const macdUp = n.byRule.find(r => r.rule === 'MACD↑');
  assert.deepEqual({ count: macdUp.count, avgRet: macdUp.avgRet }, { count: 1, avgRet: 9.7 });
  assert.equal(n.byRule[0].count >= n.byRule[n.byRule.length - 1].count, true);
  assert.deepEqual(n.horizons.map(h => h.h), [3, 5, 10]);
  const h3 = n.horizons[0];
  assert.equal(h3.count, 2); // i=37+3=40 dizinin disinda
  assert.equal(h3.avgRet, +(((3 + 2) / 2) - 0.3).toFixed(2));
  // Varsayilan maliyet %0.2
  assert.equal(E.backtest(rs, sigs, 5).cost, 0.2);
  assert.deepEqual(E.backtest(rs, [], 5), { count: 0, horizon: 5, cost: 0.2 });
});

test('analyzeSeries: hareketsiz seri notr ve sonlu (F7)', () => {
  const flat = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 10, h: 10, l: 10, c: 10 }));
  const a = E.analyzeSeries(flat);
  assert.equal(a.ind.rsi, 50);
  assert.equal(a.score, 0);
  assert.ok(Number.isFinite(a.confidence));
  assert.ok(Number.isFinite(a.ind.bb.width));
  assert.equal(a.bias, 'notr');
});

test('analyzeSeries: risk/odul fiyat birimine gore kirpilmaz (F5)', () => {
  let s = 1; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const rows = []; let p = 10;
  for (let i = 0; i < 120; i++) { const o = p; p *= 1 + (rnd() - 0.5) * 0.04; rows.push({ t: i, o, h: Math.max(o, p) * (1 + rnd() * 0.005), l: Math.min(o, p) * (1 - rnd() * 0.005), c: p }); }
  const r = E.analyzeSeries(rows);
  assert.ok(r.rr != null);
  const last = r.last_price, R = r.resistances[0].price, S = r.supports[0].price;
  assert.ok(last - S < 1, 'destek 1 TL\'den yakin');
  assert.ok(Math.abs(r.rr - (R - last) / (last - S)) < 0.05, r.rr + ' ~ ' + (R - last) / (last - S));
});

test('analyzeSeries: sifir/eksi fiyatli mumlar elenir', () => {
  const rows = R.series(40, { seed: 3 }).map((r, i) => ({ t: i, o: r.o, h: r.h, l: r.l, c: r.c }));
  const bad = [...rows.slice(0, 20), { t: 99, o: 0, h: 0, l: 0, c: 0 }, ...rows.slice(20)];
  const a = E.analyzeSeries(bad);
  assert.equal(a.chart_found, true);
  assert.deepEqual(a.backtest, E.analyzeSeries(rows).backtest);
  assert.equal(a.candles, 40);
});

test('calibrateFromSeries: ekran gecikmeli veriden yeni mumlar icerirse eksi kayma (F4)', () => {
  let s = 3; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const rows = []; let p = 50;
  for (let i = 0; i < 100; i++) { const o = p; p *= 1 + (rnd() - 0.5) * 0.04; rows.push({ o, h: Math.max(o, p) * 1.004, l: Math.min(o, p) * 0.996, c: p }); }
  const scr = rows.map(r => ({ hi: (60 - r.h) / 20, lo: (60 - r.l) / 20 })).slice(-60);
  const c = E.calibrateFromSeries(scr, rows.slice(0, -2));
  assert.ok(c, 'uyum bulunur');
  assert.equal(c.shift, -2);
  assert.ok(Math.abs(c.k + 20) < 1e-6);
  assert.equal(E.calibrateFromSeries(scr, rows).shift, 0);
});
