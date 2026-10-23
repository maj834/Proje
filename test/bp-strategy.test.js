'use strict';
// Strateji Lab (bp-strategy.js): elle hesaplanmis kucuk ornekler (simulasyon, stop, bosluk, aciga satis, SuperTrend, Donchian,
// metrikler), kurallarin bagimsiz kahini, ileriye bakma yok (onek degismezligi) ve dejenere veri.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const L = require('../bp-strategy.js');
const U = L._util;

const DAY = 864e5, YEAR = 365.25 * DAY;
const T0 = Date.UTC(2024, 0, 1, 7); // Pazartesi 10:00 (Istanbul)
const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= eps, `${msg} ${a} != ${b}`);
const r4 = v => Math.round(v * 1e4) / 1e4;
// Is gunu zaman damgalari (hafta sonu atlanir)
function bdays(n, t0 = T0) { const o = []; let t = t0; while (o.length < n) { const w = new Date(t + 3 * 3600e3).getUTCDay(); if (w !== 0 && w !== 6) o.push(t); t += DAY; } return o; }
// [o,h,l,c] listesinden gunluk mumlar
const mk = (a, t0 = T0) => a.map(([o, h, l, c], i) => ({ t: t0 + i * DAY, o, h, l, c, v: 1000 }));
// Tohumlu rastgele yuruyus (mulberry32): acilis boslugu, govde ve fitiller
function walk(n, seed = 1, { start = 100, vol = 0.025, drift = 0.0003, gap = 0.012, ts = null } = {}) {
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const T = ts || bdays(n), out = []; let c = start;
  for (let i = 0; i < n; i++) {
    const o = c * (1 + (rnd() - 0.5) * 2 * gap); c = o * (1 + drift + (rnd() - 0.5) * 2 * vol);
    out.push({ t: T[i], o, h: Math.max(o, c) * (1 + rnd() * vol / 2), l: Math.min(o, c) * (1 - rnd() * vol / 2), c, v: 1000 + Math.floor(rnd() * 9000) });
  }
  return out;
}
// Salinimli seri: cok kesisim, RSI/Bollinger uclari
function wave(n, seed = 3, period = 36) {
  const w = walk(n, seed, { vol: 0.006, gap: 0.003, drift: 0 });
  return w.map((r, i) => { const k = 1 + 0.18 * Math.sin(2 * Math.PI * i / period); return { ...r, o: r.o * k, h: r.h * k, l: r.l * k, c: r.c * k }; })
    .map((r, i, a) => i ? { ...r, o: a[i - 1].c * (r.o / r.c > 1.004 ? 1.004 : r.o / r.c < 0.996 ? 0.996 : r.o / r.c), h: Math.max(r.h, a[i - 1].c * 1.004), l: Math.min(r.l, a[i - 1].c * 0.996) } : r);
}
const sim = (rows, s, { ex = null, atr = null, ...o } = {}) => { const R = U.clean(rows); return U.simulate(R, { s, ex }, U.norm(o), atr || new Array(R.length).fill(null)); };
const RET = (p0, p1, dir = 1, cost = 0.2) => dir * (p1 / p0 - 1) * 100 - cost;

// El ornegi H1 (6 mum)
const H1 = [[10, 10.5, 9.5, 10], [10, 10.6, 9.8, 10.4], [10.5, 11, 10.2, 10.8], [10.8, 11.5, 10.6, 11.2], [11.2, 11.4, 10.4, 10.6], [10.5, 10.8, 10.0, 10.2]];

test('STRATEGIES: 7 strateji, sozlesmedeki id/ad sirasi ve aciklama', () => {
  assert.deepEqual(L.STRATEGIES.map(s => [s.id, s.name]), [['sistem', 'Sistem (trend+momentum)'], ['ema', 'EMA 20/50 kesişimi'], ['rsi', 'RSI 30/70 dönüşü'],
    ['donchian', 'Donchian 20 kırılımı'], ['macd', 'MACD kesişimi'], ['bb', 'Bollinger dönüşü'], ['supertrend', 'SuperTrend (10, 3)']]);
  for (const s of L.STRATEGIES) assert.ok(typeof s.desc === 'string' && s.desc.length > 20, s.id);
  for (const f of ['run', 'compare', 'signalsFor']) assert.equal(typeof L[f], 'function');
});

test('clean: gecersiz satirlar atilir, eksik o/h/l onarilir, siralanir, ayni zaman tekillesir, orijinal indeks korunur', () => {
  const rows = [null, { t: 1, o: 10, h: 11, l: 9, c: 10.5 }, {}, { t: 2, c: NaN }, { t: 3, c: -1 }, { t: 4, c: '10' }, { t: 5, c: 11 },
    { t: 6, o: 12, h: 11, l: 13, c: 11.5, v: -5 }, { t: NaN, c: 5 }, 'x', { t: 7, o: 0, h: null, l: undefined, c: 12, v: 300 }];
  const R = U.clean(rows);
  assert.deepEqual(R, [
    { t: 1, o: 10, h: 11, l: 9, c: 10.5, v: 0, k: 1 },
    { t: 5, o: 10.5, h: 11, l: 10.5, c: 11, v: 0, k: 6 },          // acilis = onceki kapanis, h/l govdeden
    { t: 6, o: 12, h: 12, l: 11.5, c: 11.5, v: 0, k: 7 },          // tutarsiz h/l duzeltildi, eksi hacim 0
    { t: 7, o: 11.5, h: 12, l: 11.5, c: 12, v: 300, k: 10 }]);
  // ters sira + tekrar eden zaman: siralanir, ayni t'den sonuncusu kalir
  const S = U.clean([{ t: 3, o: 3, h: 3, l: 3, c: 3 }, { t: 1, o: 1, h: 1, l: 1, c: 1 }, { t: 2, o: 2, h: 2, l: 2, c: 2 }, { t: 2, o: 2.5, h: 2.5, l: 2.5, c: 2.5 }]);
  assert.deepEqual(S.map(r => [r.t, r.c, r.k]), [[1, 1, 1], [2, 2.5, 3], [3, 3, 0]]);
  assert.deepEqual(U.clean(undefined), []); assert.deepEqual(U.clean('abc'), []); assert.deepEqual(U.clean([]), []);
});

test('flips: isaret degisimi olaylari; ilk kesin durum olay degil, null atlanir, eps bandi gurultuyu yutar', () => {
  assert.deepEqual(U.flips([1e-15, -1e-15, 1e-15, 2, -2, -3, 4], 1e-9), [0, 0, 0, 0, -1, 0, 1]);
  assert.deepEqual(U.flips([1e-15, -1e-15, 1e-15, 2, -2], 0), [0, -1, 1, 0, -1]);       // bandsiz: gurultu sahte olay uretir
  assert.deepEqual(U.flips([null, 5, null, -5, 0, 5], 0), [0, 0, 0, -1, 0, 1]);
  assert.deepEqual(U.flips([3, 0.5, -0.5, -3], [1, 1, 1, 1]), [0, 0, 0, -1]);          // mum basina esik dizisi
  assert.deepEqual(U.flips([], 0), []); assert.deepEqual(U.flips([NaN, undefined, null], 0), [0, 0, 0]);
});

test('tarayici (UMD): window.Engine ile BPStrategy ayni sonucu verir; engine yoksa atmaz, hata doner', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), rows = walk(300, 41);
  const ctx = vm.createContext({}); vm.runInContext(src('engine.js'), ctx); vm.runInContext(src('bp-strategy.js'), ctx);
  const J = v => JSON.parse(JSON.stringify(v));
  assert.deepEqual(J(ctx.BPStrategy.compare(rows)), J(L.compare(rows)));
  assert.deepEqual(J(ctx.BPStrategy.signalsFor(rows, 'ema')), J(L.signalsFor(rows, 'ema')));
  const bare = vm.createContext({}); vm.runInContext(src('bp-strategy.js'), bare);
  const r = bare.BPStrategy.run(rows, 'ema'); assert.match(r.error, /engine\.js/); assert.equal(r.trades.length, 0);
  const c = bare.BPStrategy.compare(rows); assert.equal(c.best, null); assert.match(c.note, /engine\.js/);
  assert.equal(bare.BPStrategy.signalsFor(rows, 'ema').length, 0);
});

test('simulate: elle hesaplanmis uzun islem, sermaye egrisi ve al-tut (maliyet %0,2)', () => {
  const m = sim(mk(H1), [0, 1, 0, -1, 0, 0], { atrStop: 0 });
  assert.equal(m.T.length, 1); assert.equal(m.open, null);
  const t = m.T[0];
  assert.deepEqual([t.i0, t.i1, t.p0, t.p1, t.bars, t.exit, t.dir, t.stop], [2, 4, 10.5, 11.2, 2, 'sinyal', 1, null]);
  near(t.ret, (11.2 / 10.5 - 1) * 100 - 0.2); near(t.ret, 6.466666666666667, 1e-9);
  const e2 = 100 * (1 + RET(10.5, 10.8) / 100), e3 = 100 * (1 + RET(10.5, 11.2) / 100);
  [100, 100, e2, e3, e3, e3].forEach((v, i) => near(m.eq[i], v, 1e-9, 'eq' + i));
  [100, 104, 108, 112, 106, 102].forEach((v, i) => near(m.bh[i], v, 1e-9, 'bh' + i));
  // maliyetsiz: brut getiri
  near(sim(mk(H1), [0, 1, 0, -1, 0, 0], { atrStop: 0, cost: 0 }).T[0].ret, (11.2 / 10.5 - 1) * 100);
  // sermaye olcegi: egriler orantili, getiri ayni
  const m2 = sim(mk(H1), [0, 1, 0, -1, 0, 0], { atrStop: 0, capital: 2500 });
  near(m2.eq[5], e3 * 25, 1e-6); near(m2.T[0].ret, t.ret);
});

test('simulate: stop giris mumunda, sonraki mumda, bosluk acilisinda; stop sonrasi yeni sinyalle yeniden giris', () => {
  const atr = [null, 0.25, 0.25, 0.25, 0.25, 0.25];
  // giris mumunda dusuk 9.9 <= stop 10.0 (10.5 - 2*0.25): stop fiyatindan, 1 mum
  const A = H1.map(r => r.slice()); A[2] = [10.5, 11, 9.9, 10.8];
  let m = sim(mk(A), [0, 1, 0, 0, 0, 0], { atr });
  assert.equal(m.T.length, 1);
  assert.deepEqual([m.T[0].i0, m.T[0].i1, m.T[0].p1, m.T[0].bars, m.T[0].exit, m.T[0].stop], [2, 2, 10, 1, 'stop', 10]);
  near(m.T[0].ret, RET(10.5, 10)); near(m.eq[2], 100 * (1 + RET(10.5, 10) / 100)); near(m.eq[5], m.eq[2]);
  // bosluk: 4. mum 9.8'den acilir (stop 10.0'in altinda) -> acilistan cikis, mum sayisi 4-2=2
  const B = H1.map(r => r.slice()); B[4] = [9.8, 10.0, 9.6, 9.9];
  m = sim(mk(B), [0, 1, 0, 0, 0, 0], { atr });
  assert.deepEqual([m.T[0].i1, m.T[0].p1, m.T[0].bars, m.T[0].exit], [4, 9.8, 2, 'stop']); near(m.T[0].ret, RET(10.5, 9.8));
  // gun ici stop (3. mum dusugu 9.95) + ayni mumun kapanisinda yeni AL -> 4. acilista 11.2'den giris, stop 10.7, 4. mumda tekrar stop
  const C = H1.map(r => r.slice()); C[3] = [10.8, 11.5, 9.95, 11.2];
  m = sim(mk(C), [0, 1, 0, 1, 0, 0], { atr });
  assert.equal(m.T.length, 2);
  assert.deepEqual([m.T[0].i1, m.T[0].p1, m.T[0].bars, m.T[0].exit], [3, 10, 2, 'stop']);
  assert.deepEqual([m.T[1].i0, m.T[1].p0, m.T[1].i1, m.T[1].bars, m.T[1].exit], [4, 11.2, 4, 1, 'stop']);
  near(m.T[1].stop, 10.7, 1e-12); near(m.T[1].p1, 10.7, 1e-12);
  near(m.eq[5], 100 * (1 + RET(10.5, 10) / 100) * (1 + RET(11.2, 10.7) / 100), 1e-9);
  // atrStop=0 ya da ATR yok/0 -> stop yok
  assert.equal(sim(mk(A), [0, 1, 0, 0, 0, 0], { atr, atrStop: 0 }).T[0].exit, 'son');
  assert.equal(sim(mk(A), [0, 1, 0, 0, 0, 0], { atr: [null, 0, 0, 0, 0, 0] }).T[0].stop, null);
  // giris anindaki ATR = sinyal mumunun ATR'si (atr[i0-1]); giris mumunun ATR'si (gelecek) kullanilmaz
  const m3 = sim(mk(H1), [0, 1, 0, 0, 0, 0], { atr: [null, 0.1, 99, 99, 99, 99] });
  near(m3.T[0].stop, 10.3, 1e-12);
});

test('simulate: aciga satis, ters cevirme (ayni acilista), son mum kapanisi ve openTrade', () => {
  const m = sim(mk(H1), [0, -1, 0, 1, 0, 0], { atrStop: 0, longOnly: false });
  assert.equal(m.T.length, 2);
  const [a, b] = m.T;
  assert.deepEqual([a.dir, a.i0, a.p0, a.i1, a.p1, a.bars, a.exit], [-1, 2, 10.5, 4, 11.2, 2, 'sinyal']);
  near(a.ret, -(11.2 / 10.5 - 1) * 100 - 0.2);
  assert.deepEqual([b.dir, b.i0, b.p0, b.i1, b.p1, b.bars, b.exit], [1, 4, 11.2, 5, 10.2, 2, 'son']);
  near(b.ret, RET(11.2, 10.2));
  const cash1 = 100 * (1 + a.ret / 100);
  near(m.eq[2], 100 * (1 + RET(10.5, 10.8, -1) / 100)); near(m.eq[3], cash1);
  near(m.eq[4], cash1 * (1 + RET(11.2, 10.6) / 100)); near(m.eq[5], cash1 * (1 + b.ret / 100));
  assert.deepEqual({ ...m.open, ret: undefined }, { i0: 4, p0: 11.2, ret: undefined, dir: 1, stop: null, bars: 2 }); near(m.open.ret, b.ret);
  // yalniz alis: SAT sinyali duzken yok sayilir, AL ile 4'te girilir
  const n = sim(mk(H1), [0, -1, 0, 1, 0, 0], { atrStop: 0 });
  assert.equal(n.T.length, 1); assert.equal(n.T[0].dir, 1); assert.equal(n.T[0].i0, 4);
  // aciga satista stop yukarida: 10.5 + 2*0.3 = 11.1; 2. mum yuksegi 11 (degmez), 3. mum 11.5 -> 11.1'den cikis (acilis 10.8, bosluk yok)
  const s = sim(mk(H1), [0, -1, 0, 0, 0, 0], { longOnly: false, atr: [null, 0.3, 0.3, 0.3, 0.3, 0.3] });
  assert.deepEqual([s.T[0].i1, s.T[0].exit, s.T[0].bars], [3, 'stop', 2]); near(s.T[0].stop, 11.1, 1e-12); near(s.T[0].p1, 11.1, 1e-12);
  near(s.T[0].ret, -(11.1 / 10.5 - 1) * 100 - 0.2, 1e-9);
  // esitlik de deger: stop tam 11.0 iken 2. mumun yuksegi 11 -> giris mumunda stop
  const s2 = sim(mk(H1), [0, -1, 0, 0, 0, 0], { longOnly: false, atr: [null, 0.25, 0.25, 0.25, 0.25, 0.25] });
  assert.deepEqual([s2.T[0].i1, s2.T[0].p1, s2.T[0].exit, s2.T[0].bars], [2, 11, 'stop', 1]);
});

test('simulate: son mumdaki sinyal uygulanmaz; sondan bir onceki sinyal son mumda girip kapanir', () => {
  let m = sim(mk(H1), [0, 0, 0, 0, 0, 1], { atrStop: 0 });
  assert.equal(m.T.length, 0); assert.equal(m.open, null); assert.deepEqual(m.eq, [100, 100, 100, 100, 100, 100]);
  m = sim(mk(H1), [0, 0, 0, 0, 1, 0], { atrStop: 0 });
  assert.deepEqual([m.T[0].i0, m.T[0].i1, m.T[0].p0, m.T[0].p1, m.T[0].bars, m.T[0].exit], [5, 5, 10.5, 10.2, 1, 'son']);
  assert.ok(m.open && m.open.i0 === 5);
});

test('simulate: iflas (sermaye 0) sonrasi yeni islem acilmaz, sermaye eksiye dusmez', () => {
  const rows = mk([[10, 10, 10, 10], [10, 10, 10, 10], [10, 26, 10, 25], [25, 32, 25, 30], [30, 31, 29, 30], [30, 31, 29, 30]]);
  const m = sim(rows, [0, -1, 0, 1, 0, 0], { atrStop: 0, longOnly: false });
  assert.equal(m.T.length, 1); assert.equal(m.T[0].exit, 'sinyal'); near(m.T[0].ret, -200.2, 1e-9);
  assert.deepEqual(m.eq, [100, 100, 0, 0, 0, 0]); assert.equal(m.open, null);
  const p = U.perf(m.eq, 100, { years: 0.01, barsPerYear: 252 });
  near(p.totalRet, -100); near(p.maxDD, 100); assert.equal(p.cagr, null);
});

test('tradeStats: kazanma orani, ortalamalar, kar faktoru (kayipsiz=Infinity, islemsiz=null, hep kayip=0)', () => {
  let s = U.tradeStats([{ ret: 10, bars: 2 }, { ret: 5, bars: 3 }, { ret: -5, bars: 1 }], 10);
  near(s.winRate, 200 / 3); near(s.avgRet, 10 / 3); near(s.avgWin, 7.5); near(s.avgLoss, -5); near(s.pf, 3); near(s.exposure, 60); near(s.avgBars, 2);
  assert.equal(U.tradeStats([{ ret: 2, bars: 1 }, { ret: 0.5, bars: 1 }], 5).pf, Infinity);
  s = U.tradeStats([], 10);
  assert.deepEqual(s, { n: 0, winRate: null, avgRet: null, avgWin: null, avgLoss: null, pf: null, exposure: 0, avgBars: null });
  s = U.tradeStats([{ ret: -1, bars: 1 }, { ret: -2, bars: 1 }], 4); assert.equal(s.pf, 0); assert.equal(s.winRate, 0); assert.equal(s.avgWin, null);
  s = U.tradeStats([{ ret: 0, bars: 1 }], 4); assert.equal(s.pf, null); assert.equal(s.winRate, 0);
});

test('perf: maks. dusus sermaye egrisinden, CAGR gercek zaman araligindan, Sharpe bar sikligiyla yilliklandirilir', () => {
  const tm = { years: 0, barsPerYear: 252 };
  let p = U.perf([100, 120, 90, 110, 80, 130], 100, tm);
  near(p.maxDD, 100 / 3); near(p.totalRet, 30); assert.equal(p.cagr, null);
  // getiriler +%1, -%1, +%2: ort 1/150, orneklem sapma sqrt(7/30000) -> Sharpe = sqrt(4/21)*sqrt(252) = sqrt(48)
  p = U.perf([100, 101, 99.99, 101.9898], 100, tm); near(p.sharpe, Math.sqrt(48), 1e-9);
  near(U.perf([100, 101, 99.99, 101.9898], 100, { years: 0, barsPerYear: YEAR / (7 * DAY) }).sharpe, Math.sqrt(4 / 21) * Math.sqrt(YEAR / (7 * DAY)), 1e-9);
  // 2 yilda 2 kat: CAGR = sqrt(2)-1
  p = U.perf([100, 150, 200], 100, { years: 2, barsPerYear: 252 }); near(p.cagr, (Math.SQRT2 - 1) * 100, 1e-9);
  near(U.perf([100, 50], 100, { years: 0.5, barsPerYear: 252 }).cagr, -75, 1e-9);           // (0.5)^(2) - 1
  assert.equal(U.perf([100, 200], 100, { years: 30 / 365.25, barsPerYear: 252 }).cagr, null); // 60 gunden kisa
  // duz egri: Sharpe tanimsiz, dusus 0
  p = U.perf([100, 100, 100, 100], 100, tm); assert.equal(p.sharpe, null); assert.equal(p.maxDD, 0); assert.equal(p.totalRet, 0);
  // al-tut ilk acilistan: ilk kapanis sermayenin altindaysa dusus sayilir
  near(U.perf([95, 100], 100, tm).maxDD, 5);
  assert.deepEqual(U.perf([], 100, tm), { totalRet: null, cagr: null, maxDD: null, sharpe: null });
});

test('timing: bar sikligi zaman damgalarindan (gunluk 252 / 7 gun 365, haftalik ~52,2, aylik ~12, gun ici bar/gun x 252)', () => {
  let t = U.timing(bdays(300)); assert.equal(t.kind, 'gun'); assert.equal(t.barsPerYear, 252);
  const b = bdays(300); near(t.years, (b[299] - b[0]) / YEAR);
  t = U.timing(Array.from({ length: 400 }, (_, i) => T0 + i * DAY)); assert.equal(t.barsPerYear, 365); // kripto: hafta sonu dahil
  t = U.timing(Array.from({ length: 100 }, (_, i) => T0 + i * 7 * DAY)); assert.equal(t.kind, 'hafta'); near(t.barsPerYear, YEAR / (7 * DAY));
  t = U.timing(Array.from({ length: 40 }, (_, i) => T0 + i * 30 * DAY)); assert.equal(t.kind, 'ay'); near(t.barsPerYear, YEAR / (30 * DAY));
  // 5 dk: 5 is gunu x 96 bar (10:00-18:00), gece/hafta sonu bosluklari
  const m5 = bdays(5).flatMap(d => Array.from({ length: 96 }, (_, k) => d + k * 300e3));
  t = U.timing(m5); assert.equal(t.kind, 'gunici'); assert.equal(t.barMs, 300e3); assert.equal(t.barsPerYear, 252 * 96);
  const h1 = bdays(20).flatMap(d => Array.from({ length: 9 }, (_, k) => d + k * 3600e3));
  assert.equal(U.timing(h1).barsPerYear, 252 * 9);
  assert.deepEqual(U.timing([T0]), { barMs: null, barsPerYear: 252, years: 0, kind: '?' });
  assert.equal(U.timing([T0, T0, T0]).barsPerYear, 252); assert.deepEqual(U.timing([]).years, 0);
});

test('supertrend: elle hesaplanmis ornek (ATR 2, carpan 1) - TradingView tanimi', () => {
  // TR: 2 2 2 4 3 3.5 2.5 ; Wilder ATR(2): -,2,2,3,3,3.25,2.875 ; hl2: 9,8,7,9,11.5,10.75,8.25
  const rows = [[9, 10, 8, 9], [9, 9, 7, 8], [8, 8, 6, 7], [7, 11, 7, 10.8], [10.8, 13, 10, 12.5], [12.5, 12.5, 9, 9.2], [9.2, 9.5, 7, 7.2]].map(([o, h, l, c], i) => ({ t: i, o, h, l, c }));
  const st = U.supertrend(rows, 2, 1);
  assert.deepEqual(st.dir, [null, -1, -1, 1, 1, 1, -1]);
  assert.deepEqual(st.st, [null, 10, 9, 6, 8.5, 8.5, 11.125]);
  assert.deepEqual(st.up, [null, 10, 9, 9, 14.5, 14, 11.125]);
  assert.deepEqual(st.lo, [null, 6, 6, 6, 8.5, 8.5, 8.5]);
  // strateji sinyalleri = yon degisimleri (10, 3)
  const w = walk(300, 11), x = U.prep(w), d = U.supertrend(x.R, 10, 3).dir, s = U.sigs(x, 'supertrend').s;
  let n = 0; for (let i = 1; i < w.length; i++) { const e = d[i] != null && d[i - 1] != null && d[i] !== d[i - 1] ? d[i] : 0; assert.equal(s[i], e, 'i' + i); if (e) n++; }
  assert.ok(n >= 4, 'yeterli donus olmali: ' + n);
});

// Donchian el ornegi: 0-19 yatay 10 (h 10.5 l 9.5), 20-29 12 (h 12.3 l 11.8), 30 dusus 11.5, 31 11.4 acilis, 32-59 yatay 11.3
function donchianRows() {
  const a = [];
  for (let i = 0; i < 20; i++) a.push([10, 10.5, 9.5, 10]);
  for (let i = 20; i < 30; i++) a.push([12, 12.3, 11.8, 12]);
  a.push([12, 12, 11.4, 11.5]); a.push([11.4, 11.6, 11.2, 11.3]);
  for (let i = 32; i < 60; i++) a.push([11.3, 11.4, 11.2, 11.3]);
  return mk(a);
}

test('Donchian: 20 mumluk kirilimda al, 10 mumluk dip kirilimda cik (el ornegi, uctan uca run)', () => {
  const rows = donchianRows(), x = U.prep(rows), S = U.sigs(x, 'donchian');
  assert.deepEqual(S.s.map((v, i) => v ? [i, v] : null).filter(Boolean), [[20, 1]]);   // 21+ hala kanal ustunde ama taze degil
  assert.deepEqual(S.ex.map((v, i) => v ? [i, v] : null).filter(Boolean), [[20, 1], [30, -1]]);
  const ev = L.signalsFor(rows, 'donchian');
  assert.deepEqual(ev.map(e => [e.i, e.dir, e.price, e.t]), [[20, 1, 12, rows[20].t], [30, -1, 11.5, rows[30].t]]);
  assert.deepEqual(ev.map(e => e.why), [['Kapanış 20 mumluk zirveyi aştı'], ['Kapanış 10 mumluk dibin altına indi (çık)']]);
  const r = L.run(rows, 'donchian', { atrStop: 0 });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.trades, [{ i0: 21, i1: 31, t0: rows[21].t, t1: rows[31].t, p0: 12, p1: 11.4, ret: -5.2, bars: 10, exit: 'sinyal', dir: 1, stop: null }]);
  const st = r.stats;
  assert.deepEqual([st.trades, st.winRate, st.avgRet, st.avgWin, st.avgLoss, st.profitFactor, st.totalRet, st.bhRet, st.maxDD, st.exposure, st.avgBars, st.inPosition, st.openTrade],
    [1, 0, -5.2, null, -5.2, 0, -5.2, 13, 5.2, 16.7, 10, false, null]);
  assert.deepEqual(st.lastSignal, { dir: -1, t: rows[30].t, price: 11.5, i: 30, ago: 29, why: 'Kapanış 10 mumluk dibin altına indi (çık)' });
  near(r.equity[30].v, r4(100 * (1 + RET(12, 11.5) / 100)), 1e-9); assert.equal(r.equity[59].v, 94.8);
  assert.equal(r.bh[59].v, 113); assert.equal(r.equity.length, 60);
  // 2 ATR stop (ATR sinyal mumunda ~1.09) uzakta kalir: ayni islem, stop 12 - 2*ATR[20]
  const a = E.atrS(U.clean(rows), 14)[20], r2 = L.run(rows, 'donchian');
  near(r2.trades[0].stop, r4(12 - 2 * a), 1e-9); assert.equal(r2.trades[0].exit, 'sinyal');
  assert.match(r.warning, /Az veri \(60 mum\)/);
});

// Klasik kesisim tanimlari (engine indikatorleriyle bagimsiz referans)
function classic(x, id) {
  const c = x.c, N = x.N, s = new Array(N).fill(0), F = Number.isFinite, crossUp = (a, b, i) => F(a[i]) && F(a[i - 1]) && F(b[i]) && F(b[i - 1]) && a[i] > b[i] && a[i - 1] <= b[i - 1];
  const crossDn = (a, b, i) => F(a[i]) && F(a[i - 1]) && F(b[i]) && F(b[i - 1]) && a[i] < b[i] && a[i - 1] >= b[i - 1];
  const K = v => new Array(N).fill(v);
  if (id === 'ema') { const a = E.emaS(c, 20), b = E.emaS(c, 50); for (let i = 1; i < N; i++)s[i] = crossUp(a, b, i) ? 1 : crossDn(a, b, i) ? -1 : 0; }
  if (id === 'macd') { const h = E.macdS(c).hist, z = K(0); for (let i = 1; i < N; i++)s[i] = crossUp(h, z, i) ? 1 : crossDn(h, z, i) ? -1 : 0; }
  if (id === 'rsi') { const r = E.rsi(c, 14); for (let i = 1; i < N; i++)s[i] = crossUp(r, K(30), i) ? 1 : crossDn(r, K(70), i) ? -1 : 0; }
  if (id === 'bb') { const B = E.bollinger(c, 20, 2); for (let i = 1; i < N; i++)s[i] = crossUp(c, B.lo, i) ? 1 : crossDn(c, B.up, i) ? -1 : 0; }
  if (id === 'sistem') for (const g of E.systemSignals(x.R)) s[g.i] = g.dir;
  return s;
}

test('EMA/MACD/RSI/Bollinger/Sistem sinyalleri klasik kesisim tanimiyla birebir (engine indikatorleri)', () => {
  for (const rows of [wave(500, 3), walk(500, 5), walk(400, 9, { vol: 0.04 })]) {
    const x = U.prep(rows);
    for (const id of ['ema', 'macd', 'rsi', 'bb', 'sistem']) assert.deepEqual(U.sigs(x, id).s, classic(x, id), id);
  }
  const x = U.prep(wave(500, 3));
  for (const id of ['ema', 'macd', 'rsi', 'bb', 'sistem']) {
    const s = U.sigs(x, id).s; assert.ok(s.filter(v => v > 0).length >= 2 && s.filter(v => v < 0).length >= 2, id + ' iki yonde sinyal uretmeli');
  }
});

// Kurallarin bagimsiz kahini: her islem ve her sinyal kurallara gore dogrulanir.
function oracle(rows, id, opts = {}) {
  const o = U.norm(opts), x = U.prep(rows), S = U.sigs(x, id), R = x.R, N = x.N, atr = E.atrS(R, 14), r = L.run(rows, id, opts), T = r.trades;
  const exitSig = (d, j) => d > 0 ? S.s[j] < 0 || (S.ex && S.ex[j] < 0) : S.s[j] > 0 || (S.ex && S.ex[j] > 0);
  const hit = (t, j) => t.stop != null && (t.dir > 0 ? R[j].l <= t.stop + 1e-9 : R[j].h >= t.stop - 1e-9);
  const pos = new Array(N).fill(0);
  let fin = o.capital;
  for (const t of T) {
    assert.ok(t.i0 >= 1 && t.i1 >= t.i0 && t.i1 <= N - 1, id + ' indeks');
    const p0 = R[t.i0].o, a = atr[t.i0 - 1], sp = o.atrStop > 0 && a > 0 ? p0 - t.dir * o.atrStop * a : null; // kesin (yuvarlanmamis) degerler
    near(t.p0, r4(p0), 1e-9, id + ' giris = sinyalden sonraki acilis');
    assert.equal(S.s[t.i0 - 1], t.dir, id + ' giris sinyali bir onceki mumda');
    if (sp != null) near(t.stop, r4(sp), 1e-9, id + ' stop = giris -/+ k*ATR(sinyal mumu)'); else assert.equal(t.stop, null);
    for (let j = t.i0; j < t.i1; j++) assert.ok(!hit({ ...t, stop: sp }, j), id + ' stop erken degmemeli j=' + j);
    const last = t.exit === 'sinyal' ? t.i1 - 2 : t.i1 - 1;
    for (let j = t.i0; j <= Math.min(last, N - 2); j++) assert.ok(!exitSig(t.dir, j), id + ' cikis sinyali kacirilmamali j=' + j);
    let px;
    if (t.exit === 'sinyal') { px = R[t.i1].o; assert.ok(exitSig(t.dir, t.i1 - 1), id + ' cikis sinyali'); assert.equal(t.bars, t.i1 - t.i0); }
    else if (t.exit === 'stop') {
      assert.ok(hit({ ...t, stop: sp }, t.i1)); const gap = t.dir > 0 ? R[t.i1].o <= sp : R[t.i1].o >= sp;
      px = gap ? R[t.i1].o : sp; assert.equal(t.bars, t.i1 - t.i0 + (gap ? 0 : 1));
    } else { assert.equal(t.exit, 'son'); assert.equal(t.i1, N - 1); px = R[N - 1].c; assert.equal(t.bars, N - t.i0); }
    near(t.p1, r4(px), 1e-9, id + ' cikis fiyati ' + t.exit);
    const ret = t.dir * (px / p0 - 1) * 100 - o.cost;
    near(t.ret, Math.round(ret * 100) / 100, 1e-9, id + ' getiri');
    fin = Math.max(0, fin * (1 + ret / 100));
    for (let j = t.i0; j < t.i1; j++) pos[j] = t.dir;
  }
  for (let j = 0; j < N - 1; j++) if (!pos[j]) { const sg = S.s[j]; if (sg > 0 || (sg < 0 && !o.longOnly)) assert.ok(T.some(t => t.i0 === j + 1 && t.dir === sg), id + ' sinyal kacirildi j=' + j); }
  if (o.longOnly) assert.ok(T.every(t => t.dir === 1));
  // sermaye: islem getirilerinin bilesigi = son deger
  near(r.equity[N - 1].v, Math.round(fin * 1e4) / 1e4, 1e-9, id + ' bilesik');
  near(r.stats.totalRet, Math.round((fin / o.capital - 1) * 1e4) / 100, 0.011);
  return r;
}

test('kahin: tum stratejilerde islemler kurallara birebir uyar (yalniz alis / aciga satis, stoplu / stopsuz)', () => {
  let total = 0, stops = 0, gaps = 0, shorts = 0;
  for (const rows of [walk(600, 21), wave(500, 4), walk(400, 8, { vol: 0.045, gap: 0.03 })])
    for (const id of L.STRATEGIES.map(s => s.id))
      for (const opts of [{}, { longOnly: false }, { atrStop: 0, cost: 0 }, { atrStop: 1, cost: 0.5, longOnly: false }]) {
        const r = oracle(rows, id, opts); total += r.trades.length;
        stops += r.trades.filter(t => t.exit === 'stop').length; shorts += r.trades.filter(t => t.dir < 0).length;
        gaps += r.trades.filter(t => t.exit === 'stop' && t.p1 !== t.stop).length;
      }
  assert.ok(total > 300 && stops > 30 && gaps > 0 && shorts > 50, `kapsam: ${total} islem, ${stops} stop, ${gaps} bosluk, ${shorts} aciga satis`);
});

test('ileriye bakma yok: onek degismezligi ve gelecegi bozma (sinyaller, islemler, sermaye egrisi)', () => {
  const rows = walk(420, 33, { vol: 0.03 });
  for (const s of L.STRATEGIES) for (const opts of [{}, { longOnly: false, atrStop: 1.5 }]) {
    const full = L.run(rows, s.id, opts), sigs = L.signalsFor(rows, s.id, opts);
    // gelecekteki mumlar coker/ucarsa gecmis kararlar degismemeli
    const k0 = 300, bent = rows.map((r, i) => i < k0 ? r : { ...r, o: r.o * (i % 2 ? 3 : 0.3), h: r.h * 3, l: r.l * 0.3, c: r.c * (i % 2 ? 0.3 : 3) });
    const fb = L.run(bent, s.id, opts);
    assert.deepEqual(fb.equity.slice(0, k0), full.equity.slice(0, k0), s.id + ' bozulmus gelecek');
    assert.deepEqual(fb.trades.filter(t => t.i1 < k0), full.trades.filter(t => t.i1 < k0));
    for (const k of [60, 151, 222, 333, 419]) {
      const pre = L.run(rows.slice(0, k), s.id, opts);
      assert.deepEqual(pre.equity, full.equity.slice(0, k), `${s.id} egri k=${k}`);
      assert.deepEqual(pre.trades.filter(t => t.exit !== 'son'), full.trades.filter(t => t.i1 <= k - 1), `${s.id} islemler k=${k}`);
      assert.deepEqual(L.signalsFor(rows.slice(0, k), s.id, opts), sigs.filter(e => e.i < k), `${s.id} sinyaller k=${k}`);
      const ls = pre.stats.lastSignal, fe = sigs.filter(e => e.i < k).pop();
      assert.deepEqual(ls && [ls.i, ls.dir, ls.t], fe ? [fe.i, fe.dir, fe.t] : null);
      // acik islem: onekte 'son' ile kapanan islem, tam seride ayni giris
      const o = pre.stats.openTrade;
      if (o) assert.ok(full.trades.some(t => t.i0 === o.i0 && t.p0 === o.p0 && t.i1 >= k - 1), `${s.id} acik islem k=${k}`);
    }
  }
});

test('signalsFor: orijinal indeks (bozuk satirlar arada), t/fiyat/why; bilinmeyen id ve bos veri', () => {
  const base = wave(300, 6), junk = [];
  base.forEach((r, i) => { junk.push(r); if (i % 37 === 5) junk.push(null, { t: r.t + 1, c: NaN }); });
  const a = L.signalsFor(base, 'macd'), b = L.signalsFor(junk, 'macd');
  assert.ok(a.length > 4);
  assert.deepEqual(b.map(e => [e.t, e.dir, e.price]), a.map(e => [e.t, e.dir, e.price]));
  for (const e of b) { assert.equal(junk[e.i].t, e.t); assert.equal(e.price, r4(junk[e.i].c)); assert.ok(Array.isArray(e.why) && e.why[0].length > 5); }
  // islem indeksleri de orijinal satirlari gosterir
  for (const t of L.run(junk, 'macd').trades) { near(t.p0, r4(junk[t.i0].o)); assert.equal(junk[t.i1].t, t.t1); }
  assert.deepEqual(L.signalsFor(base, 'yok'), []); assert.deepEqual(L.signalsFor([], 'ema'), []); assert.deepEqual(L.signalsFor(null, 'ema'), []);
  // ardisik ayni yon mumkun (RSI 30'u iki kez yukari kesebilir); yalniz-cikis olayi yalniz AL'dan sonra
  const d = L.signalsFor(walk(800, 4, { vol: 0.03 }), 'donchian');
  for (let i = 0; i < d.length; i++) if (/çık\)/.test(d[i].why[0])) assert.equal(d[i - 1].dir, 1);
});

test('dejenere: duz seri (kayan nokta gurultusu sahte sinyal uretmez), NaN yok', () => {
  for (const p of [10.1, 3.37, 123.45]) {
    const rows = bdays(300).map(t => ({ t, o: p, h: p, l: p, c: p, v: 100 }));
    for (const s of L.STRATEGIES) {
      const r = L.run(rows, s.id);
      assert.equal(r.error, undefined);
      assert.deepEqual([r.stats.trades, r.stats.totalRet, r.stats.maxDD, r.stats.sharpe, r.stats.exposure, r.stats.bhRet, r.stats.cagr],
        [0, 0, 0, null, 0, 0, 0], s.id + ' ' + p);
      assert.ok(r.equity.every(e => e.v === 100) && r.bh.every(e => e.v === 100));
      const ls = L.run(rows, s.id, { longOnly: false });
      assert.ok(ls.stats.trades <= 1 && ls.stats.totalRet >= -0.2 - 1e-9, s.id + ' aciga satis duz seride en fazla maliyet kadar');
      if (s.id !== 'sistem') assert.equal(ls.stats.trades, 0, s.id);
    }
  }
});

test('dejenere: <50 mum, bos/gecersiz girdi, bilinmeyen strateji ve opts - atmaz, tutarli bos sonuc', () => {
  const shape = r => {
    assert.ok(Array.isArray(r.trades) && Array.isArray(r.equity) && Array.isArray(r.bh) && r.stats && typeof r.stats === 'object');
    for (const k of ['trades', 'winRate', 'avgRet', 'avgWin', 'avgLoss', 'profitFactor', 'totalRet', 'bhRet', 'cagr', 'maxDD', 'sharpe', 'exposure', 'avgBars', 'lastSignal', 'inPosition', 'openTrade'])
      assert.ok(k in r.stats, k);
  };
  const r30 = L.run(walk(30, 2), 'rsi');
  shape(r30); assert.match(r30.error, /en az 50 mum gerekli \(şu an 30\)/); assert.equal(r30.stats.trades, 0); assert.equal(r30.stats.n, 30);
  assert.equal(r30.name, 'RSI 30/70 dönüşü'); assert.equal(r30.stats.inPosition, false);
  assert.ok(Array.isArray(L.signalsFor(walk(30, 2), 'rsi')));
  for (const bad of [undefined, null, [], 'x', 42, {}, [null, null], [{ t: 1, c: 1 }]]) {
    const r = L.run(bad, 'ema'); shape(r); assert.ok(r.error);
    const c = L.compare(bad); assert.equal(c.best, null); assert.equal(c.results.length, 7); assert.ok(c.note && c.error);
  }
  const u = L.run(walk(200, 2), 'yok'); shape(u); assert.match(u.error, /Bilinmeyen strateji/);
  assert.match(L.run(walk(200, 2), undefined).error, /Bilinmeyen/);
  // tam 50 mum calisir
  assert.equal(L.run(walk(50, 2), 'rsi').error, undefined);
  // opts ayristirma
  assert.deepEqual(U.norm(null), { cost: 0.2, atrStop: 2, longOnly: true, capital: 100 });
  assert.deepEqual(U.norm('x'), { cost: 0.2, atrStop: 2, longOnly: true, capital: 100 });
  assert.deepEqual(U.norm({ cost: '0,5', atrStop: 'abc', longOnly: false, capital: '1000' }), { cost: 0.5, atrStop: 2, longOnly: false, capital: 1000 });
  assert.deepEqual(U.norm({ cost: -3, atrStop: -1, capital: 0, longOnly: 'false' }), { cost: 0, atrStop: 0, longOnly: false, capital: 100 });
  assert.deepEqual(U.norm({ cost: 99, atrStop: NaN, capital: -5 }), { cost: 10, atrStop: 2, longOnly: true, capital: 100 });
  assert.deepEqual(L.run(walk(200, 2), 'ema', { cost: 0.5 }).opts, { cost: 0.5, atrStop: 2, longOnly: true, capital: 100 });
});

test('dejenere: sirasiz veri ve tekrar eden zaman ayni sonucu verir; maliyet ve sermaye tutarliligi', () => {
  const rows = walk(400, 12, { vol: 0.03 }), rev = rows.slice().reverse(), dup = rows.flatMap((r, i) => i % 50 ? [r] : [{ ...r, c: 1 }, r]);
  for (const id of ['ema', 'donchian', 'supertrend']) {
    const a = L.run(rows, id), b = L.run(rev, id), c = L.run(dup, id);
    assert.deepEqual(b.stats, { ...a.stats, lastSignal: b.stats.lastSignal && a.stats.lastSignal && { ...a.stats.lastSignal, i: b.stats.lastSignal.i },
      openTrade: a.stats.openTrade && { ...a.stats.openTrade, i0: b.stats.openTrade.i0 } });
    assert.deepEqual(b.trades.map(t => [t.t0, t.t1, t.ret]), a.trades.map(t => [t.t0, t.t1, t.ret]));
    assert.deepEqual(c.trades.map(t => [t.t0, t.t1, t.ret]), a.trades.map(t => [t.t0, t.t1, t.ret]));
    // maliyet islemleri degistirmez, her islemden ayni miktarda duser
    const z = L.run(rows, id, { cost: 0 }), h = L.run(rows, id, { cost: 0.5 });
    assert.equal(z.trades.length, h.trades.length);
    z.trades.forEach((t, i) => near(t.ret - h.trades[i].ret, 0.5, 0.011));
    // sermaye olcegi: getiri istatistikleri ayni, egri orantili
    const k = L.run(rows, id, { capital: 1000 });
    assert.deepEqual(k.stats, a.stats); near(k.equity[399].v, a.equity[399].v * 10, 0.01);
  }
});

test('metrikler run icinde: CAGR gercek zaman araligi, Sharpe bar sikligi; gun ici kisa aralikta CAGR null', () => {
  // haftalik 260 mum (~5 yil)
  const wk = walk(260, 14, { ts: Array.from({ length: 260 }, (_, i) => T0 + i * 7 * DAY), vol: 0.05, drift: 0.003 });
  const r = L.run(wk, 'supertrend'), yrs = (wk[259].t - wk[0].t) / YEAR;
  near(r.stats.years, Math.round(yrs * 1000) / 1000, 1e-9); near(r.stats.barsPerYear, 52.2, 1e-9);
  const eq = r.equity.map(e => e.v);
  near(r.stats.cagr, ((eq[259] / 100) ** (1 / yrs) - 1) * 100, 0.006);
  near(r.stats.bhCagr, ((r.bh[259].v / 100) ** (1 / yrs) - 1) * 100, 0.006);
  const rs = eq.slice(1).map((v, i) => v / eq[i] - 1), m = rs.reduce((a, b) => a + b, 0) / rs.length, sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1));
  near(r.stats.sharpe, m / sd * Math.sqrt(YEAR / (7 * DAY)), 0.006);
  let pk = 100, dd = 0; for (const v of eq) { pk = Math.max(pk, v); dd = Math.max(dd, (pk - v) / pk); } near(r.stats.maxDD, dd * 100, 0.006);
  // 5 dk, 5 gun: yilliklandirilmis CAGR yaniltici -> null; Sharpe 252*96 ile
  const m5 = bdays(5).flatMap(d => Array.from({ length: 96 }, (_, k) => d + k * 300e3));
  const ri = L.run(walk(480, 15, { ts: m5, vol: 0.004, gap: 0.001 }), 'ema');
  assert.equal(ri.stats.cagr, null); assert.equal(ri.stats.barsPerYear, 24192); assert.equal(ri.stats.bhCagr, null);
  assert.ok(ri.stats.sharpe === null || Number.isFinite(ri.stats.sharpe));
});

test('thinIdx (LTTB): uclar korunur, sinir asilmaz, artan sira, sivri tepe korunur', () => {
  const v = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 50) * 10 + (i % 7) * 0.1); v[537] = 500; v[821] = -400;
  const idx = U.thinIdx(v, 100);
  assert.equal(idx.length, 100); assert.equal(idx[0], 0); assert.equal(idx[99], 999);
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1]);
  assert.ok(idx.includes(537) && idx.includes(821));
  assert.deepEqual(U.thinIdx([1, 2, 3], 10), [0, 1, 2]); assert.deepEqual(U.thinIdx([], 10), []); assert.deepEqual(U.thinIdx([1, 2, 3, 4], 2), [0, 3]);
  assert.deepEqual(U.mergeIdx([0, 5, 9], [0, 3, 9]), [0, 3, 5, 9]);
});

test('scoreOf / pickBest: az islem ve zararli stratejiler elenir, dusus cezalanir, Infinity PF sinirlanir', () => {
  const st = (trades, profitFactor, maxDD, totalRet = 10) => ({ trades, profitFactor, maxDD, totalRet });
  assert.equal(U.scoreOf(st(4, 9, 1)), null);           // < 5 islem
  assert.equal(U.scoreOf(st(20, 1, 1)), null);          // PF 1 kar degil
  assert.equal(U.scoreOf(st(20, 1.5, 5, -2)), null);    // bilesik getiri eksi
  assert.equal(U.scoreOf(st(20, null, 5)), null); assert.equal(U.scoreOf(null), null);
  near(U.scoreOf(st(15, 2, 20)), (2 - 1) / 2 * 15 / 20, 1e-4);
  near(U.scoreOf(st(5, Infinity, 0)), (4 - 1) * 0.5, 1e-4);
  const res = [{ id: 'a', stats: st(30, 2.2, 40) }, { id: 'b', stats: st(30, 1.8, 8) }, { id: 'c', stats: st(3, Infinity, 0) }, { id: 'd', stats: st(50, 0.8, 5) }];
  res.forEach(r => { r.score = U.scoreOf(r.stats); });
  assert.equal(U.pickBest(res), 'b');                   // a: 1.2/3 ~ 0.34 ; b: 0.8/1.4 ~ 0.49
  assert.equal(U.pickBest(res.filter(r => r.id !== 'b')), 'a');
  assert.equal(U.pickBest([res[2], res[3]]), null); assert.equal(U.pickBest([]), null); assert.equal(U.pickBest(null), null);
  // esit skor: toplam getirisi yuksek olan; stats'siz/bozuk girdide atmaz
  assert.equal(U.pickBest([{ id: 'x', score: 0.5, stats: { totalRet: 5 } }, { id: 'y', score: 0.5, stats: { totalRet: 9 } }]), 'y');
  assert.equal(U.pickBest([{ id: 'z', score: 0.3 }, null, { id: 'w', score: 0.3 }, { id: 'q', score: NaN }]), 'z');
  assert.equal(U.pickBest('x'), null);
});

test('compare: 7 sonuc, seyreltilmis egriler (<=400, ortak zamanlar), en yeni 50 islem, en iyi secimi ve not', () => {
  const rows = wave(800, 7, 12), cmp = L.compare(rows);
  assert.deepEqual(cmp.results.map(r => r.id), L.STRATEGIES.map(s => s.id));
  assert.equal(cmp.n, 800); assert.deepEqual(cmp.opts, U.norm({}));
  let many = 0;
  for (const r of cmp.results) {
    const full = L.run(rows, r.id);
    assert.ok(r.equity.length <= 400 && r.equity.length >= 200, r.id + ' ' + r.equity.length);
    assert.deepEqual(r.equity[0], full.equity[0]); assert.deepEqual(r.equity[r.equity.length - 1], full.equity[799]);
    assert.deepEqual(r.equity.map(p => p.t), r.bh.map(p => p.t));
    for (let i = 1; i < r.equity.length; i++) assert.ok(r.equity[i].t > r.equity[i - 1].t);
    assert.deepEqual(r.stats, full.stats);
    assert.deepEqual(r.trades, full.trades.slice(-50)); assert.equal(r.tradesOmitted, Math.max(0, full.trades.length - 50));
    if (full.trades.length > 50) many++;
    assert.equal(r.score, U.scoreOf(r.stats));
  }
  assert.ok(many >= 1, 'en az bir stratejide 50+ islem olmali');
  const sc = cmp.results.filter(r => r.score != null);
  if (cmp.best) {
    const b = cmp.results.find(r => r.id === cmp.best);
    assert.ok(b.stats.trades >= 5 && b.stats.profitFactor > 1 && b.stats.totalRet > 0);
    assert.ok(sc.every(r => r.score <= b.score)); assert.match(cmp.note, new RegExp('^En iyi: ' + b.name.replace(/[()+]/g, '\\$&')));
  } else assert.equal(sc.length, 0);
  assert.equal(cmp.bh.ret, L.run(rows, 'ema').stats.bhRet); assert.ok(cmp.bh.curve.length <= 200 && cmp.bh.curve.length > 100);
  assert.match(cmp.note, /yatırım tavsiyesi değildir/); assert.match(cmp.note, /maliyet %0,2 gidiş-dönüş; stop 2 ATR; yalnız alış/);
  assert.match(L.compare(rows, { cost: 0.15, atrStop: 0, longOnly: false }).note, /maliyet %0,15 gidiş-dönüş; stop yok; alış ve açığa satış/);
  // hicbiri sartlari saglamiyorsa best null ve aciklayici not
  const down = bdays(300).map((t, i) => { const c = 100 * 0.995 ** i; return { t, o: c / 0.995, h: c / 0.995 * 1.001, l: c * 0.999, c, v: 1 }; });
  const cd = L.compare(down); assert.equal(cd.best, null); assert.match(cd.note, /^Hiçbir strateji en az 5 işlem/);
  // <50 mum
  const c30 = L.compare(walk(30, 1)); assert.equal(c30.best, null); assert.match(c30.note, /en az 50 mum/); assert.equal(c30.bh.ret, null);
});

test('JSON/IPC guvenligi: NaN yok, Infinity yalniz profitFactor; tum sayilar sonlu ya da null', () => {
  const walkNums = (o, path, out) => {
    if (typeof o === 'number') { if (!Number.isFinite(o)) out.push(path + '=' + o); return; }
    if (o && typeof o === 'object') for (const k of Object.keys(o)) walkNums(o[k], path + '.' + k, out);
  };
  for (const rows of [wave(600, 2), walk(300, 3, { vol: 0.05 }), bdays(120).map(t => ({ t, o: 5, h: 5, l: 5, c: 5 })), walk(49, 1)]) {
    const bad = []; walkNums(L.compare(rows), '', bad); walkNums(L.compare(rows, { longOnly: false }), '', bad);
    assert.deepEqual(bad.filter(p => !/\.profitFactor=Infinity$/.test(p)), []);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(L.compare(rows))));
  }
});

test('performans: 800 mumda compare hizli', () => {
  const rows = walk(800, 77); L.compare(rows);
  const t0 = performance.now(); for (let i = 0; i < 5; i++) L.compare(rows); const ms = (performance.now() - t0) / 5;
  assert.ok(ms < 150, 'compare ' + ms.toFixed(1) + ' ms');
});
