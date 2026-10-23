'use strict';
// Gercekci ekran sahneleri: grafik disi renkli ogeler, fiyat etiketi, hacim paneli, kucuk grafik, secili alan (ROI), cozunurluk.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const S = require('./helpers/scene.js');

const rows = S.series(80, { seed: 7 });
function check(o, { calib = true, tolY = 2 } = {}) {
  const im = S.scene(rows, o), a = E.analyzeBitmap(im.buf, im.W, im.H, { format: 'rgba', ...(o.engine || {}) });
  assert.equal(a.chart_found, true);
  assert.equal(a.candles, im.truth.length, 'mum sayisi');
  const ly = im.truth[im.truth.length - 1].closeY;
  assert.ok(Math.abs(a.last.y * im.H - ly) <= tolY, `son kapanis ${a.last.y * im.H} ~ ${ly}`);
  if (calib) { const c = E.calibrateFromSeries(a.rawCandles, rows); assert.ok(c && c.r2 >= 0.99, 'kalibrasyon ' + (c && c.r2)); }
  return { im, a };
}

test('fiyat eksenindeki son fiyat kutusu mum sayilmaz (son kapanis etikete kaymaz)', () => {
  const { a, im } = check({ priceLabel: true, priceLine: true });
  assert.ok(a.chart_box.x2 * im.W < im.plot.x1 + 2, 'grafik kutusu etiketi icermez');
});

test('ayri paneldeki dolu hacim cubuklari mumlarin altini bozmaz', () => {
  const { a, im } = check({ volume: { h: 110, gap: 10 } });
  assert.ok(a.chart_box.y2 * im.H < im.plot.y1 - 100, 'grafik kutusu hacim panelini icermez');
});

test('mumlara bitisik (bosluksuz) dolu hacim cubuklari temizlenir', () => {
  check({ volume: { h: 110, gap: 0 } });
});

test('tam ekran: ust cubuk Al/Sat dugmeleri, izleme listesi, etiket, hacim (koyu ve acik tema)', () => {
  check({ toolbar: true, watchlist: true, priceLabel: true, priceLine: true, volume: { h: 110, gap: 10 } });
  check({ bg: '#ffffff', toolbar: true, watchlist: true, priceLabel: true, priceLine: true, volume: { h: 110, gap: 10 } });
  check({ hollowUp: true, priceLabel: true, watchlist: true });
});

test('genis ekranin kucuk bir bolumundeki grafikte kesikli son fiyat cizgisi mumlari birlestirmez', () => {
  // 2880 genislik, grafik ~430 px: cizgi tum ekranin %12'sinden kisa ama grafigin cogunu kaplar
  check({ W: 2880, H: 1800, plot: { x0: 200, y0: 200, x1: 680, y1: 900 }, body: 4, step: 6, priceLine: true }, { calib: true });
});

test('secili alan (roi): yalniz o bolge okunur, koordinatlar tum ekrana gore', () => {
  const im = S.scene(rows, { toolbar: true, watchlist: true });
  const roi = { x: 100 / im.W, y: 100 / im.H, w: 1160 / im.W, h: 680 / im.H };
  const a = E.analyzeBitmap(im.buf, im.W, im.H, { format: 'rgba', roi });
  const b = E.analyzeBitmap(im.buf, im.W, im.H, { format: 'rgba' });
  assert.equal(a.candles, 80);
  assert.ok(Math.abs(a.last.y - b.last.y) < 1e-3 && Math.abs(a.last.x - b.last.x) < 1e-3, JSON.stringify([a.last, b.last]));
  assert.deepEqual(a.roi, roi);
  for (let i = 0; i < 80; i++) assert.ok(Math.abs(a.rawCandles[i].hi - b.rawCandles[i].hi) < 1e-4);
  // grafigi disarida birakan alan: grafik bulunamaz
  assert.equal(E.analyzeBitmap(im.buf, im.W, im.H, { format: 'rgba', roi: { x: 0.8, y: 0.6, w: 0.19, h: 0.39 } }).chart_found, false);
  // gecersiz/cok kucuk alan yok sayilir
  assert.equal(E.analyzeBitmap(im.buf, im.W, im.H, { format: 'rgba', roi: { x: 0, y: 0, w: 0.01, h: 0.01 } }).candles, 80);
});

test('cozunurluk: Retina ekrani yari boyutta yakalamak kalibrasyonu bozar; captureSize fiziksel boyutu verir', () => {
  const rs = S.series(120, { seed: 11 });
  const full = S.scene(rs, { body: 6, step: 8 }), half = S.downscale(full, 0.54);
  const f = E.analyzeBitmap(full.buf, full.W, full.H, { format: 'rgba' }), h = E.analyzeBitmap(half.buf, half.W, half.H, { format: 'rgba' });
  assert.ok(E.calibrateFromSeries(f.rawCandles, rs).r2 > 0.99);
  const ch = h.chart_found ? E.calibrateFromSeries(h.rawCandles, rs) : null;
  assert.equal(ch, null, 'dusuk cozunurlukte eslesme olmamali (eski 1568 px davranisi)');
  assert.deepEqual(E.captureSize({ size: { width: 1440, height: 900 }, scaleFactor: 2 }), { width: 2880, height: 1800 });
  assert.deepEqual(E.captureSize({ size: { width: 1920, height: 1080 }, scaleFactor: 1 }), { width: 1920, height: 1080 });
  assert.deepEqual(E.captureSize({ size: { width: 2560, height: 1440 }, scaleFactor: 2 }), { width: 4096, height: 2304 });
});
