'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const BPChart = require('../bp-chart.js');
const U = BPChart._util;
const { rows: demo } = require('./visual/bp-demo-data.js');

test('Node\'da yalniz yardimcilar: create kutuphane yokken anlasilir hata verir', () => {
  assert.equal(typeof BPChart.create, 'function');
  assert.throws(() => BPChart.create({}), /Grafik kütüphanesi/);
});

test('zaman: Istanbul saati icin +3 saat, saniye', () => {
  const ms = Date.UTC(2026, 9, 19, 7, 0);          // 10:00 Istanbul
  const t = U.toTime(ms);
  assert.equal(t, ms / 1000 + 3 * 3600);
  assert.equal(U.fmtTime(t, true), '19 Eki 2026 10:00');
  assert.equal(U.fmtTime(t, false), '19 Eki 2026');
  assert.equal(U.fmtTick(t, 1), 'Eki');
  assert.equal(U.fmtTick(t, 3), '10:00');
  assert.equal(U.isIntraday('15dk'), true);
  assert.equal(U.isIntraday('1g'), false);
});

test('fiyat ve hacim bicimi tr-TR', () => {
  assert.equal(U.fmtPrice(1234.5), '1.234,50');
  assert.equal(U.fmtPrice(0.0123), '0,0123');
  assert.equal(U.fmtPrice(null), '—');
  assert.equal(U.fmtVol(2.5e6), '2,50 Mn');
  assert.equal(U.fmtVol(3.2e9), '3,20 Mr');
});

test('cleanRows: gecersizleri atar, siralar, ayni zamani tekiller', () => {
  const t = Date.UTC(2026, 0, 5);
  const r = U.cleanRows([{ t: t + 86400000, o: 2, h: 3, l: 1, c: 2 }, { t, o: 1, h: 2, l: 1, c: 1 }, { t, o: 9, h: 9, l: 9, c: 9 },
    { t: t + 2 * 86400000, o: null, h: 1, l: 1, c: 1 }, null]);
  assert.equal(r.length, 2);
  assert.ok(r[0].time < r[1].time);
  assert.equal(r[0].c, 9);                                    // ayni zamanda sonraki kazanir
});

test('pro indeks kaydirmasi, bolgeler, plan cizgileri, trend cizgileri, isaretler', () => {
  const rows = U.cleanRows(demo({ n: 420 }));
  const pro = E.proAnalyze({ '1g': rows }, { primary: '1g' });
  assert.ok(pro.ok);
  assert.equal(U.proOffset(rows, pro), 0);
  assert.equal(U.proOffset(rows.slice(0, -1), pro), null);   // son mum farkli: isaret cizilmez
  assert.equal(U.proOffset(rows.slice(20), pro), -20);        // bastan kirpilmis grafik
  const z = U.zones(pro);
  assert.ok(z.every(q => q.lo <= q.hi && (q.kind === 'R' || q.kind === 'S') && /^[RS]\d /.test(q.label)));
  const pl = U.planLines(pro);
  if (pro.plan && !pro.plan.wait) assert.ok(['stop', 't1', 't2'].every(k => pl.some(l => l.kind === k)));
  const segs = U.trendSegs(pro, rows);
  for (const s of segs) assert.ok(s.pts[0].time < s.pts[1].time);
  const sig = E.systemSignals(rows).map(s => ({ t: rows[s.i].t, dir: s.dir, why: s.why }));
  const trades = [{ t0: rows[100].t, t1: rows[120].t, ret: 3.2, dir: 1, exit: 'sinyal' }, { t0: rows[300].t, t1: rows[419].t, ret: -1, dir: 1, exit: 'son' }];
  const mk = U.markers({ rows, signals: sig, pro, trades, show: { trades: true } });
  for (let i = 1; i < mk.length; i++) assert.ok(mk[i - 1].time <= mk[i].time, 'zamana gore sirali');
  assert.equal(mk.filter(m => m.text === 'AL' || m.text === 'SAT').length, sig.length);
  assert.ok(mk.some(m => m.text === '+3,2%'));
  assert.ok(!mk.some(m => m.id === 'x' + rows[419].time), 'acik (son) islemin cikisi isaretlenmez');
  assert.equal(U.markers({ rows, signals: sig, pro, trades, show: { signals: false, patterns: false } }).length, 0);
});

test('BEKLE planinda tetik cizgileri; formasyon boyun ve onayli hedef', () => {
  const pro = { ok: true, plan: { wait: true, triggerUp: 12, triggerDown: 9 }, structure: { patterns: [{ name: 'İkili dip', neck: 11, target: 13, confirmed: true }, { name: 'Boğa bayrağı', trigger: 11.5, confirmed: false }] } };
  const k = U.planLines(pro).map(l => l.kind + ':' + l.price);
  assert.deepEqual(k, ['up:12', 'down:9', 'neck:11', 'target:13', 'neck:11.5']);
  assert.deepEqual(U.planLines({ ok: false }), []);
  assert.deepEqual(U.zones(null), []);
});

test('gostergeler engine ile ayni, isinmada null', () => {
  const rows = U.cleanRows(demo({ n: 120 }));
  const I = U.indicators(rows, E);
  assert.equal(I.ema200.filter(v => v != null).length, 0);
  assert.equal(I.ema20[18], null);
  assert.ok(Number.isFinite(I.ema20[19]));
  assert.ok(I.rsi.slice(15).every(v => v >= 0 && v <= 100));
  assert.equal(U.series(rows, I.ema20).length, 120 - 19);
  assert.deepEqual(U.indicators(rows, null), {});
});
