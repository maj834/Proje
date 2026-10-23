'use strict';
// Gelismis analiz (engine.js proAnalyze ve indikatorleri): elle hesaplanmis degerler ve bagimsiz referans uygulamalarla.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const R = require('./helpers/raster.js');

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` ${a} != ${b}`);
// Kapanis dizisinden mum satirlari: o = onceki kapanis, h/l = govdenin 0.2 disi.
function mk(cl, pad = 0.2, v = 1000) {
  return cl.map((c, i) => { const o = i ? cl[i - 1] : c; return { t: 1700000000000 + i * 86400000, o, h: Math.max(o, c) + pad, l: Math.min(o, c) - pad, c, v: typeof v === 'function' ? v(i) : v }; });
}
const lin = (n, a, b) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
const weekly = rows => { const w = []; for (let i = 0; i < rows.length; i += 5) { const s = rows.slice(i, i + 5);
  w.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map(r => r.h)), l: Math.min(...s.map(r => r.l)), c: s[s.length - 1].c, v: s.reduce((a, r) => a + r.v, 0) }); } return w; };

test('SMA / EMA (SMA tohumlu) / Wilder: elle hesaplanan degerler', () => {
  assert.deepEqual(E.smaS([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  // Dogrusal seride EMA_n degeri (n-1)/2 mum geride kalir: [1..10], n=3 -> ema[i] = i
  const e = E.emaS([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  for (let i = 2; i < 10; i++) near(e[i], i);
  const w = E.wilder([1, 2, 3, 4, 5], 3);
  near(w[2], 2); near(w[3], 8 / 3); near(w[4], 31 / 9);
  // Bastaki null'lar atlanir
  assert.deepEqual(E.emaS([null, null, 2, 4, 6], 2).map(v => v == null ? null : +v.toFixed(6)), [null, null, null, 3, 5]);
});

test('RSI (Wilder): n=3 elle hesap', () => {
  // degisimler +1 +1 -1 +1 +1; ilk ort. kazanc 2/3, kayip 1/3 -> RS 2 -> 66.67; sonra 7/9:2/9 -> 77.78; 23/27:4/27 -> 85.19
  const r = E.rsi([1, 2, 3, 2, 3, 4], 3);
  assert.deepEqual(r.slice(0, 3), [null, null, null]);
  near(r[3], 100 - 100 / 3, 1e-9); near(r[4], 100 - 100 / 4.5, 1e-9); near(r[5], 100 - 100 / 6.75, 1e-9);
});

test('MACD: dogrusal seride MACD = egim*7, sinyal = MACD, histogram 0; sabit seride 0', () => {
  const c = lin(60, 10, 10 + 2 * 59); // egim 2
  const m = E.macdS(c);
  assert.equal(m.macd[24], null); assert.equal(m.signal[32], null);
  for (let i = 25; i < 60; i++) near(m.macd[i], 14, 1e-9);
  for (let i = 33; i < 60; i++) { near(m.signal[i], 14, 1e-9); near(m.hist[i], 0, 1e-9); }
  const f = E.macdS(new Array(40).fill(5));
  assert.equal(f.hist[39], 0);
});

test('Stokastik ve Stokastik RSI', () => {
  assert.deepEqual(E.stoch([1, 2, 3, 2, 1], 3), [null, null, 100, 0, 0]);
  assert.deepEqual(E.stoch([4, 4, 4], 3), [null, null, 50]);
  const s = E.stochRsi(lin(60, 1, 60)); // surekli yukselis: RSI hep 100 -> stokastik 50
  assert.equal(s.st[27], 50); assert.equal(s.st[26], null);
  near(s.k[29], 50); near(s.d[31], 50); assert.equal(s.d[30], null);
});

test('True range ve ATR (Wilder): elle hesap', () => {
  const rows = [{ h: 10, l: 8, c: 9 }, { h: 11, l: 9, c: 10.5 }, { h: 12, l: 10, c: 11 }, { h: 13, l: 9, c: 10 }, { h: 10.5, l: 9.5, c: 10 }];
  assert.deepEqual(E.trueRange(rows), [2, 2, 2, 4, 1]);
  const a = E.atrS(rows, 3);
  assert.deepEqual(a.slice(0, 2), [null, null]); near(a[2], 2); near(a[3], 8 / 3); near(a[4], 19 / 9);
});

// Ders kitabi ADX (Wilder 1978), ayri ve duz yazilmis referans.
function refAdx(rows, n) {
  const N = rows.length, TR = [], P = [], M = [];
  for (let i = 1; i < N; i++) {
    const r = rows[i], p = rows[i - 1];
    TR.push(Math.max(r.h - r.l, Math.abs(r.h - p.c), Math.abs(r.l - p.c)));
    const up = r.h - p.h, dn = p.l - r.l; P.push(up > dn && up > 0 ? up : 0); M.push(dn > up && dn > 0 ? dn : 0);
  }
  let t = 0, pp = 0, mm = 0; for (let i = 0; i < n; i++) { t += TR[i]; pp += P[i]; mm += M[i]; }
  const dx = [], pdi = [], mdi = [];
  for (let i = n - 1; i < TR.length; i++) {
    if (i > n - 1) { t = t - t / n + TR[i]; pp = pp - pp / n + P[i]; mm = mm - mm / n + M[i]; }
    const a = 100 * pp / t, b = 100 * mm / t; pdi.push(a); mdi.push(b); dx.push(100 * Math.abs(a - b) / (a + b));
  }
  let adx = dx.slice(0, n).reduce((x, y) => x + y, 0) / n; const out = [adx];
  for (let i = n; i < dx.length; i++) { adx = (adx * (n - 1) + dx[i]) / n; out.push(adx); }
  return { adx: out[out.length - 1], pdi: pdi[pdi.length - 1], mdi: mdi[mdi.length - 1], first: 2 * n - 1 };
}

test('ADX/DI: ders kitabi referansiyla ayni; tek yonlu yukseliste ADX 100', () => {
  const rows = R.series(80, { seed: 4, vol: 2 });
  for (const n of [3, 14]) {
    const a = E.adxS(rows, n), ref = refAdx(rows, n);
    near(a.adx[79], ref.adx, 1e-9, 'adx n=' + n); near(a.pdi[79], ref.pdi, 1e-9); near(a.mdi[79], ref.mdi, 1e-9);
    assert.equal(a.adx[ref.first - 1], null); assert.ok(Number.isFinite(a.adx[ref.first]));
  }
  // n=2 elle: TR=[2,2,2], +DM=[1,1,1], -DM=0 -> +DI 50, -DI 0, DX 100, ADX 100
  const up = [{ h: 10, l: 8, c: 9 }, { h: 11, l: 9, c: 10 }, { h: 12, l: 10, c: 11 }, { h: 13, l: 11, c: 12 }];
  const u = E.adxS(up, 2);
  near(u.pdi[3], 50); near(u.mdi[3], 0); near(u.adx[3], 100);
});

test('Bollinger, OBV, VWAP, hacim orani: elle hesap', () => {
  const b = E.bollinger(lin(20, 1, 20), 20, 2);
  near(b.mid[19], 10.5); near(b.up[19], 10.5 + 2 * Math.sqrt(33.25)); near(b.lo[19], 10.5 - 2 * Math.sqrt(33.25));
  near(b.bw[19], 4 * Math.sqrt(33.25) / 10.5);
  const rows = [10, 11, 11, 10, 12].map((c, i) => ({ c, v: (i + 1) * 100 }));
  assert.deepEqual(E.obvS(rows), [0, 200, 200, -200, 300]);
  const d0 = Date.UTC(2026, 0, 5, 7), d1 = Date.UTC(2026, 0, 6, 7);
  const vw = E.vwapS([{ t: d0, h: 11, l: 9, c: 10, v: 100 }, { t: d0 + 3600000, h: 14, l: 12, c: 13, v: 300 }, { t: d1, h: 21, l: 19, c: 20, v: 50 }]);
  assert.deepEqual(vw, [10, 12.25, 20]);
  const vr = E.volRatio([10, 20, 30, 60].map(v => ({ v })), 2);
  assert.deepEqual(vr, [null, null, 2, 2.4]);
});

test('Fraktal tepe/dip, hacim profili (POC, deger alani), max dusus', () => {
  const rows = [1, 3, 2, 4, 1].map(h => ({ h, l: h - 0.5 }));
  const s = E.swings(rows, 1);
  assert.deepEqual(s.hi.map(x => x.i), [1, 3]); assert.deepEqual(s.lo.map(x => x.i), [2]);
  // 12 mum 10-11 araliginda (yuksek hacim), 3 mum 19-20 (dusuk): POC 10-11 arasi
  const pr = [...Array(12).fill({ h: 11, l: 10, v: 1000 }), ...Array(3).fill({ h: 20, l: 19, v: 10 })];
  const p = E.volumeProfile(pr, 10);
  assert.ok(p.poc >= 10 && p.poc <= 11, 'poc ' + p.poc);
  assert.ok(p.val <= p.poc && p.vah >= p.poc && p.vah <= 12, JSON.stringify(p));
  assert.equal(E.volumeProfile(pr.map(r => ({ ...r, v: 0 }))), null);
  assert.equal(E.maxDrawdown([10, -50, 20]), 50);
  assert.equal(E.maxDrawdown([-10, -10]), 19);
  assert.equal(E.maxDrawdown([5, 5]), 0);
});

test('Islem plani: yapi stopu, hedefler sonraki bolgeler, R/O ve pozisyon', () => {
  const p = E.tradePlan(1, 100, 2, [{ lo: 95, hi: 96 }], [{ lo: 106, hi: 107 }, { lo: 112, hi: 113 }], 1);
  assert.deepEqual(p.entry, [99, 100]);
  assert.equal(p.stop, 94.6); assert.equal(p.stopType, 'yapı');
  assert.equal(p.t1, 106); assert.equal(p.t2, 112);
  assert.equal(p.rr, +(6 / 5.4).toFixed(2));
  assert.equal(p.positionPct, +(100 / 5.4).toFixed(1));
  assert.match(p.note, /tavsiyesi değildir/);
  // Yapi stopu cok uzaksa (>3 ATR) 2 ATR stop; bolge yoksa ATR hedefleri
  const q = E.tradePlan(1, 100, 1, [{ lo: 80, hi: 81 }], [], 1);
  assert.equal(q.stopType, '2 ATR'); assert.equal(q.stop, 98); assert.equal(q.t1, 102); assert.equal(q.t2, 103.5);
  // SAT plani: stop direncin ustunde, hedef destek
  const s = E.tradePlan(-1, 100, 2, [{ lo: 90, hi: 91 }], [{ lo: 103, hi: 104 }], 1);
  assert.deepEqual(s.entry, [100, 101]); assert.equal(s.stop, 104.4); assert.equal(s.t1, 91); assert.equal(s.dir, -1);
  assert.equal(E.tradePlan(1, 100, null, [], []), null);
});

test('Karar: agirlikli skor, esikler, eksik bilesen yeniden olcekleme, gerekceler', () => {
  const v = E.verdictOf([{ key: 'a', name: 'A', w: 0.5, v: 1, why: ['A guclu'] }, { key: 'b', name: 'B', w: 0.5, v: 0, why: ['B notr'] }, { key: 'c', name: 'C', w: 0.3, v: NaN }]);
  assert.equal(v.score, 50); assert.equal(v.label, 'AL');
  assert.deepEqual(v.components.map(c => c.weight), [50, 50]);
  assert.deepEqual(v.reasons, ['A guclu']);
  assert.equal(E.verdictOf([{ w: 1, v: -0.25 }]).label, 'SAT');
  assert.equal(E.verdictOf([{ w: 1, v: 0.19 }]).label, 'BEKLE');
  const all = E.verdictOf([{ w: 1, v: 0.8 }, { w: 1, v: 0.6 }], 1), mixed = E.verdictOf([{ w: 1, v: 1 }, { w: 1, v: -0.4 }], 1);
  assert.ok(all.confidence > mixed.confidence, all.confidence + ' > ' + mixed.confidence);
  assert.ok(all.confidence >= 0 && all.confidence <= 100);
});

test('Ikili tepe: esit tepeler + boyun kirilimi onaylanir; kirilmadiysa olusuyor', () => {
  const cl = [...lin(20, 100, 110), ...lin(8, 109, 103).slice(0), ...lin(8, 104, 110), ...lin(6, 109, 101)];
  const rows = mk(cl), atr = E.atrS(rows)[rows.length - 1];
  const p = E.patterns(rows, E.swings(rows, 3), atr);
  const dt = p.find(x => x.name === 'İkili tepe');
  assert.ok(dt, JSON.stringify(p)); assert.equal(dt.dir, -1); assert.equal(dt.confirmed, true);
  assert.ok(dt.target < dt.neck);
  const rows2 = mk([...cl.slice(0, -4), 108, 107.5, 107, 106.5]);
  const d2 = E.patterns(rows2, E.swings(rows2, 3), E.atrS(rows2)[rows2.length - 1]).find(x => x.name === 'İkili tepe');
  assert.ok(d2 && d2.confirmed === false);
  // Esit olmayan tepeler (fark > 0.6 ATR) formasyon sayilmaz
  const rows3 = mk([...lin(20, 100, 110), ...lin(8, 109, 103), ...lin(8, 104, 116), ...lin(6, 115, 108)]);
  assert.equal(E.patterns(rows3, E.swings(rows3, 3), E.atrS(rows3)[rows3.length - 1]).some(x => x.name === 'İkili tepe'), false);
});

test('Boga bayragi: guclu direk + dar konsolidasyon; tetik ustunde kapanis onay', () => {
  const base = lin(30, 100, 101), pole = lin(6, 101.5, 112), cons = [111.5, 111, 111.3, 110.8, 111.2, 110.9];
  const rows = mk([...base, ...pole, ...cons, 113]);
  const atr = E.atrS(rows)[rows.length - 1];
  const f = E.patterns(rows, E.swings(rows, 3), atr).find(x => x.name === 'Boğa bayrağı');
  assert.ok(f, 'bayrak'); assert.equal(f.confirmed, true);
  const rows2 = mk([...base, ...pole, ...cons, 111]);
  const f2 = E.patterns(rows2, E.swings(rows2, 3), E.atrS(rows2)[rows2.length - 1]).find(x => x.name === 'Boğa bayrağı');
  assert.ok(f2 && !f2.confirmed);
});

test('Kirilim ve tekrar test: iki temasli direncin ustunde kapanis', () => {
  // 105'te iki tepe (direnc), sonra kirilim ve 105'e geri cekilme
  const cl = [...lin(10, 100, 105), ...lin(6, 104.5, 101), ...lin(6, 101.5, 105), ...lin(6, 104.5, 101), ...lin(5, 102, 104), 106.5, 105.3, 106.8];
  const rows = mk(cl), atr = E.atrS(rows)[rows.length - 1], sw = E.swings(rows, 3);
  const zs = E.zones(rows, sw, atr, null);
  const b = E.breakouts(rows, zs, atr);
  assert.ok(b.length && b[0].dir === 1, JSON.stringify(b));
  assert.equal(b[0].retest, true);
  assert.ok(b[0].zone.hi >= 105 && b[0].zone.lo <= 105.3);
});

test('RSI uyumsuzlugu: fiyat daha dusuk dip, RSI daha yuksek dip', () => {
  const cl = [...lin(15, 120, 100), ...lin(5, 101, 106), ...lin(4, 104, 99.5), 101, 102, 103, 103.5];
  const rows = mk(cl), sw = E.swings(rows, 2), r = E.rsi(rows.map(x => x.c), 14);
  const d = E.divergence(sw, r, rows.length, 'RSI');
  assert.ok(d && d.dir === 1, JSON.stringify({ d, lo: sw.lo }));
});

test('Trend cizgisi: yukselen dipler destek cizgisi; kirilinca broken', () => {
  const cl = [];
  for (let k = 0; k < 4; k++) cl.push(...lin(6, 100 + k * 3, 106 + k * 3), ...lin(5, 105.5 + k * 3, 103 + k * 3));
  cl.push(113, 114);
  const rows = mk(cl), atr = E.atrS(rows)[rows.length - 1];
  const t = E.trendlines(rows, E.swings(rows, 2), atr).find(x => x.type === 'destek');
  assert.ok(t && t.slopePct > 0 && !t.broken, JSON.stringify(t));
  const rows2 = mk([...cl, 104]);
  const t2 = E.trendlines(rows2, E.swings(rows2, 2), E.atrS(rows2)[rows2.length - 1]).find(x => x.type === 'destek');
  assert.ok(t2 && t2.broken);
});

test('proAnalyze: yukselen seri AL, dusen seri SAT; coklu zaman dilimi, plan, geriye donuk test', () => {
  const up = R.series(260, { seed: 5, drift: 0.4, vol: 1.5 }), dn = R.series(260, { seed: 5, drift: -0.35, vol: 1.5, start: 200 });
  const a = E.proAnalyze({ '1g': up, '1h': weekly(up) });
  assert.equal(a.ok, true); assert.equal(a.verdict.label, 'AL');
  assert.ok(a.verdict.confidence >= 50 && a.verdict.confidence <= 100);
  assert.equal(a.verdict.reasons.length, 3);
  assert.ok(a.verdict.components.some(c => c.key === 'mtf'));
  near(a.verdict.components.reduce((s, c) => s + c.weight, 0), 100, 2);
  assert.equal(a.trend.frames['1g'].dir, 1); assert.equal(a.trend.frames['1h'].dir, 1);
  assert.ok(a.plan.stop < a.last && a.plan.t1 > a.last);
  assert.ok(a.momentum.rsi > 50 && Number.isFinite(a.volatility.atr));
  assert.ok('maxDD' in a.backtest && 'rules' in a.backtest && a.backtest.system);
  const b = E.proAnalyze({ '1g': dn, '1h': weekly(dn) });
  assert.equal(b.verdict.label, 'SAT'); assert.equal(b.plan.dir, -1); assert.ok(b.plan.stop > b.last);
  assert.equal(E.proAnalyze({ '1g': up.slice(0, 30) }).ok, false);
});

test('proAnalyze: derinlik ve haber bilesenleri agirlikla eklenir ve skoru etkiler', () => {
  const rows = R.series(260, { seed: 9, drift: 0, vol: 2 });
  const base = E.proAnalyze({ '1g': rows });
  const plus = E.proAnalyze({ '1g': rows }, { depth: { pressure: 80, flow: 5000, live: 1 }, news: [{ score: 3 }, { score: 2 }], sentiment: 0.3 });
  const keys = plus.verdict.components.map(c => c.key);
  assert.ok(keys.includes('derinlik') && keys.includes('haber'));
  assert.ok(plus.verdict.score > base.verdict.score);
  assert.ok(!base.verdict.components.some(c => c.key === 'derinlik'));
});

test('BEKLE: plan tetikleri; sistem sinyalleri yukseliste AL ile baslar', () => {
  const rows = mk(Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 3) * 1.5));
  const a = E.proAnalyze({ '1g': rows });
  if (a.verdict.label === 'BEKLE') assert.equal(a.plan.wait, true);
  const up = R.series(150, { seed: 2, drift: 0.5, vol: 1 });
  const s = E.systemSignals(up);
  assert.ok(s.length && s[0].dir === 1);
});

test('crossCheckVision: yanlis sembol/fiyat uyarilir, seviyeler olcekten yeniden fiyatlanir', () => {
  const a = { symbol: 'BIST:THYAO', last_price: 300, resistances: [{ y: 0.2, price: 999 }], supports: [{ y: 0.8, price: 90 }] };
  const cal = { mx: 0.5, my: 100, k: -100 }; // y=0.2 -> 130, y=0.8 -> 70
  const r = E.crossCheckVision(a, { symbol: 'ASELS', lastPrice: 100, cal });
  assert.equal(r.fixed.symbol, 'ASELS'); assert.equal(r.fixed.last_price, 100);
  assert.equal(r.fixed.resistances[0].price, 130); assert.equal(r.fixed.supports[0].price, 70);
  assert.equal(r.warnings.length, 3);
  const ok = E.crossCheckVision({ symbol: 'THYAO.IS', last_price: 100.5 }, { symbol: 'THYAO', lastPrice: 100 });
  assert.equal(ok.warnings.length, 0);
});

test('backtest: max dusus, ornek esigi ve gizlenen kurallar', () => {
  const rs = Array.from({ length: 40 }, () => ({ c: 100 }));
  rs[15].c = 110; rs[25].c = 90;
  const b = E.backtest(rs, [{ i: 10, dir: 1, why: ['X'] }, { i: 20, dir: 1, why: ['X'] }], 5, { cost: 0, minSamples: 2 });
  assert.equal(b.maxDD, 10); assert.equal(b.rules.length, 1); assert.equal(b.hiddenRules, 0); assert.equal(b.reliable, true);
  const c = E.backtest(rs, [{ i: 10, dir: 1, why: ['X'] }], 5, { cost: 0 });
  assert.equal(c.rules.length, 0); assert.equal(c.hiddenRules, 1); assert.equal(c.reliable, false);
});

test('projectPro: bolgeler ve plan ekran y koordinatina cevrilir; screenVerdict yerel skordan', () => {
  const pro = { ok: true, verdict: { label: 'AL' }, levels: { resistance: [{ lo: 110, hi: 112, touches: 2 }, { lo: 500, hi: 510, touches: 2 }], support: [{ lo: 90, hi: 92, touches: 3 }] },
    plan: { dir: 1, entry: [99, 100], stop: 95, t1: 110, t2: 120 } };
  const cal = { mx: 0.5, my: 100, k: -100 }; // fiyat 100 -> y 0.5, 110 -> 0.4
  const s = E.projectPro(pro, cal, { x1: 0.1, x2: 0.8 });
  assert.equal(s.zones.length, 2, 'ekran disindaki bolge atilir');
  assert.deepEqual([s.zones[0].y1, s.zones[0].y2], [0.38, 0.4]);
  assert.deepEqual(s.plan.entry, [0.51, 0.5]); assert.equal(s.plan.stop, 0.55); assert.equal(s.plan.t1, 0.4);
  assert.equal(E.projectPro(pro, null), null);
  const v = E.screenVerdict({ chart_found: true, score: -40, confidence: 60, factors: [{ v: -12, t: 'EMA20 < EMA50' }, { v: 6, t: 'RSI' }, { v: -8, t: 'MACD negatif' }] });
  assert.equal(v.label, 'SAT'); assert.deepEqual(v.reasons, ['EMA20 < EMA50', 'MACD negatif']);
  assert.equal(E.screenVerdict({ chart_found: false }), null);
});
