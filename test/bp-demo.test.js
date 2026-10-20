'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { fresh, tmpDir } = require('./helpers/util.js');

// 2026-10-20 Sali 12:00 TSI (BIST acik), ABD 05:00 NY (kapali)
const OPEN = Date.UTC(2026, 9, 20, 9, 0, 0);
const CLOSED = Date.UTC(2026, 9, 18, 9, 0, 0); // Pazar
const MIN = 60000;

function setup(t, { at = OPEN, file = true } = {}) {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const P = fresh('bp-demo.js');
  const clock = { now: at };
  const f = file ? path.join(dir, 'paper.json') : null;
  const B = P.create({ file: f, now: () => clock.now });
  return { P, B, clock, file: f, dir };
}
const q = (price, extra = {}) => ({ price, currency: 'TRY', time: OPEN, name: 'TEST', ...extra });
const bar = (t, o, h, l, c) => ({ t, o, h, l, c });
const acc = (B, m = 'BIST') => B.summary().accounts[m];

test('baslangic bakiyesi ve bos ozet', t => {
  const { B } = setup(t);
  const a = acc(B);
  assert.equal(a.ccy, 'TRY'); assert.equal(a.cash, 100000); assert.equal(a.equity, 100000); assert.equal(a.pnl, 0);
  assert.equal(acc(B, 'US').cash, 10000); assert.equal(acc(B, 'US').ccy, 'USD');
  assert.equal(a.session.open, true);
});

test('piyasa alis: komisyon kurus hassasiyetinde, ortalama maliyet komisyon dahil', t => {
  const { B } = setup(t);
  const r = B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 100 }, q(312.35));
  assert.equal(r.trade.value, 3123500); // kurus
  assert.equal(r.trade.fee, 6247);      // binde 2 = 62,47
  const a = acc(B);
  assert.equal(a.cash, 100000 - 31235 - 62.47);
  assert.equal(a.pos.length, 1);
  assert.equal(a.pos[0].qty, 100);
  assert.equal(a.pos[0].cost, 31297.47);
  assert.equal(a.pos[0].avg, 312.9747);
  // fiyat degismediyse oz sermaye = baslangic - komisyon
  assert.equal(a.equity, 100000 - 62.47);
});

test('kayan nokta birikmez: 1000 kucuk alis', t => {
  const { B } = setup(t);
  B.settings({ commission: 0 });
  for (let i = 0; i < 1000; i++) B.place({ symbol: 'ABC.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1 }, q(0.1));
  const a = acc(B);
  assert.equal(a.cash, 99900); assert.equal(a.pos[0].qty, 1000); assert.equal(a.pos[0].cost, 100);
});

test('satis: gerceklesen kar/zarar, kismi satista maliyet orantili duser, tam satista pozisyon kapanir', t => {
  const { B } = setup(t);
  B.settings({ commission: 0.001 });
  B.place({ symbol: 'SISE.IS', market: 'BIST', side: 'buy', type: 'market', qty: 300 }, q(50));
  // maliyet 15000 + 15 = 15015
  const s1 = B.place({ symbol: 'SISE.IS', market: 'BIST', side: 'sell', type: 'market', qty: 100 }, q(60));
  // gelir 6000 - 6 = 5994, maliyet payi 5005 -> kar 989
  assert.equal(s1.trade.pnl, 98900);
  let a = acc(B);
  assert.equal(a.pos[0].qty, 200); assert.equal(a.pos[0].cost, 100.1 * 100);
  const s2 = B.place({ symbol: 'SISE.IS', market: 'BIST', side: 'sell', type: 'market', qty: 200 }, q(40));
  // gelir 8000 - 8 = 7992, kalan maliyet 10010 -> zarar -2018
  assert.equal(s2.trade.pnl, -201800);
  a = acc(B);
  assert.equal(a.pos.length, 0);
  assert.equal(a.realized, 989 - 2018);
  assert.equal(a.cash, 100000 - 15015 + 5994 + 7992);
  assert.equal(a.equity, a.cash);
  assert.equal(a.pnl, a.realized); // tum pozisyonlar kapandi: toplam K/Z = gerceklesen
  assert.equal(a.closed, 2); assert.equal(a.winRate, 50);
});

test('yetersiz bakiye ve fazla satis reddedilir, durum degismez', t => {
  const { B } = setup(t);
  const before = JSON.stringify(B.raw());
  assert.throws(() => B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1000 }, q(312)), { code: 'CASH' });
  assert.throws(() => B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'sell', type: 'market', qty: 1 }, q(312)), { code: 'QTY' });
  assert.equal(JSON.stringify(B.raw()), before);
  B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 10 }, q(312));
  assert.throws(() => B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'sell', type: 'market', qty: 11 }, q(312)), { code: 'QTY' });
});

test('maksimum adet tam olarak alinabilir, bir fazlasi alinamaz', t => {
  const { B } = setup(t);
  const n = B.maxBuy('BIST', 312.35);
  assert.ok(n > 0);
  B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: n }, q(312.35));
  assert.ok(acc(B).cash >= 0);
  assert.throws(() => B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1 }, q(312.35)), { code: 'CASH' });
  assert.equal(B.maxBuy('BIST', 312.35), 0);
});

test('girdi dogrulama', t => {
  const { B } = setup(t);
  const base = { symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1 };
  for (const bad of [{ qty: 0 }, { qty: -5 }, { qty: 1.5 }, { qty: '10' }, { qty: NaN }, { qty: 1e12 }, { market: 'XX' }, { side: 'short' },
    { type: 'iceberg' }, { symbol: 'THY AO' }, { symbol: '' }, { symbol: '<script>' }, { type: 'stop', side: 'buy', price: 1 }])
    assert.throws(() => B.place({ ...base, ...bad }, q(10)), undefined, JSON.stringify(bad));
  for (const bad of [null, {}, { price: 0 }, { price: -1 }, { price: NaN }, { price: Infinity }])
    assert.throws(() => B.place(base, bad));
  assert.throws(() => B.place({ ...base, type: 'limit', price: 0 }, q(10)));
  assert.throws(() => B.place({ ...base, type: 'limit' }, q(10)));
  assert.equal(acc(B).cash, 100000);
});

test('para birimi uyusmazsa reddedilir (ABD hissesi BIST hesabinda)', t => {
  const { B } = setup(t);
  assert.throws(() => B.place({ symbol: 'BTC-USD', market: 'BIST', side: 'buy', type: 'market', qty: 1 }, q(10, { currency: 'USD' })), /para birimi USD/);
});

test('seans kapaliyken piyasa emri reddedilir, ayarla izin verilir', t => {
  const { B } = setup(t, { at: CLOSED });
  assert.throws(() => B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1 }, q(300)), { code: 'CLOSED' });
  assert.throws(() => B.place({ symbol: 'AAPL', market: 'US', side: 'buy', type: 'market', qty: 1 }, q(200, { currency: 'USD' })), { code: 'CLOSED' });
  B.settings({ anyTime: true });
  B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1 }, q(300));
  assert.equal(acc(B).pos[0].qty, 1);
});

test('seans kapaliyken gerceklesebilir limit emir bekler, hemen dolmaz', t => {
  const { B } = setup(t, { at: CLOSED });
  const r = B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'limit', qty: 10, price: 400 }, q(300));
  assert.ok(r.order); assert.equal(acc(B).pos.length, 0);
});

test('gerceklesebilir limit alis seans aciksa guncel fiyattan hemen dolar', t => {
  const { B } = setup(t);
  B.settings({ commission: 0 });
  const r = B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'limit', qty: 10, price: 320 }, q(312));
  assert.ok(r.trade); assert.equal(r.trade.price, 312);
  assert.equal(B.summary().orders.length, 0);
});

test('limit alis: bakiye ayrilir, mum dusugu degince limitten dolar, artan ayrilan iade edilir', t => {
  const { B, clock } = setup(t);
  B.settings({ commission: 0.001 });
  const r = B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'limit', qty: 100, price: 300 }, q(312));
  assert.equal(r.order.reserve, 3000000 + 3000);
  let a = acc(B);
  assert.equal(a.cash, 100000); assert.equal(a.reserved, 30030); assert.equal(a.available, 100000 - 30030);
  // ayrilan bakiye baska alista kullanilamaz
  assert.throws(() => B.place({ symbol: 'ASELS.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1000 }, q(70)), { code: 'CASH' });
  clock.now = OPEN + 10 * MIN;
  // emirden onceki mum sayilmaz (ileriye bakis yok)
  let p = B.process('THYAO.IS', [bar(OPEN - MIN, 305, 306, 290, 300)], q(312, { time: OPEN - MIN }));
  assert.equal(p.fills.length, 0);
  p = B.process('THYAO.IS', [bar(OPEN + MIN, 305, 306, 301, 302), bar(OPEN + 2 * MIN, 302, 303, 299, 300)], q(301, { time: OPEN + 2 * MIN }));
  assert.equal(p.fills.length, 1); assert.equal(p.fills[0].price, 300);
  a = acc(B);
  assert.equal(a.reserved, 0); assert.equal(a.cash, 100000 - 30030);
  assert.equal(a.pos[0].qty, 100); assert.equal(a.pos[0].last, 301);
  // ayni mumlarla tekrar islem dolmaz
  assert.equal(B.process('THYAO.IS', [bar(OPEN + 2 * MIN, 302, 303, 299, 300)], q(301)).fills.length, 0);
});

test('bosluklu acilis: limit alistan asagida acilan mum acilistan doldurur', t => {
  const { B, clock } = setup(t);
  B.settings({ commission: 0 });
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'limit', qty: 10, price: 100 }, q(110));
  clock.now += 5 * MIN;
  const p = B.process('X.IS', [bar(OPEN + MIN, 95, 97, 94, 96)], null);
  assert.equal(p.fills[0].price, 95);
  assert.equal(acc(B).cash, 100000 - 950);
});

test('limit satis ve zarar durdur; satis emri adetleri ayirir', t => {
  const { B, clock } = setup(t);
  B.settings({ commission: 0 });
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'market', qty: 100 }, q(100));
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'limit', qty: 60, price: 110 }, q(100));
  assert.throws(() => B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'stop', qty: 50, price: 90 }, q(100)), { code: 'QTY' });
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'stop', qty: 40, price: 90 }, q(100));
  assert.equal(acc(B).pos[0].free, 0);
  assert.throws(() => B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'market', qty: 1 }, q(100)), { code: 'QTY' });
  // zarar durdur guncel fiyatin ustunde olamaz
  assert.throws(() => B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'stop', qty: 1, price: 100 }, q(100)));
  clock.now += 2 * MIN;
  let p = B.process('X.IS', [bar(OPEN + MIN, 100, 112, 99, 111)], null);
  assert.equal(p.fills.length, 1); assert.equal(p.fills[0].price, 110); assert.equal(p.fills[0].qty, 60);
  p = B.process('X.IS', [bar(OPEN + 2 * MIN, 95, 96, 85, 86)], null); // asagi bosluk: stop 90, acilis 95 > 90 -> 90'dan
  assert.equal(p.fills.length, 1); assert.equal(p.fills[0].price, 90);
  const a = acc(B);
  assert.equal(a.pos.length, 0);
  assert.equal(a.cash, 100000 - 10000 + 6600 + 3600);
  assert.equal(a.realized, 600 - 400);
});

test('zarar durdur asagi bosluklu acilista acilis fiyatindan (kayma ile) dolar', t => {
  const { B, clock } = setup(t);
  B.settings({ commission: 0, slippage: 10 }); // 10 baz puan
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'market', qty: 10 }, q(100)); // 100,1
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'stop', qty: 10, price: 95 }, q(100));
  clock.now += MIN;
  const p = B.process('X.IS', [bar(OPEN + MIN, 90, 91, 88, 89)], null);
  assert.equal(p.fills[0].price, 89.91);
  assert.equal(acc(B).pos.length, 0);
});

test('kayma: alis yukari, satis asagi', t => {
  const { B } = setup(t);
  B.settings({ commission: 0, slippage: 50 });
  assert.equal(B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1 }, q(100)).trade.price, 100.5);
  assert.equal(B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'market', qty: 1 }, q(100)).trade.price, 99.5);
});

test('mum yoksa emirden sonraki seans fiyatiyla dolar; eski ya da seans disi fiyat sayilmaz', t => {
  const { B, clock } = setup(t);
  B.settings({ commission: 0 });
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'limit', qty: 1, price: 100 }, q(105));
  clock.now += MIN;
  assert.equal(B.process('X.IS', [], q(99, { time: OPEN - MIN })).fills.length, 0);           // emirden once
  assert.equal(B.process('X.IS', [], q(99, { time: CLOSED + 7 * 86400000 - 3600000 * 10 })).fills.length, 0); // seans disi (Pazar)
  assert.equal(B.process('X.IS', [], q(99, { time: OPEN + MIN })).fills[0].price, 99);
});

test('iptal: ayrilan bakiye ve adet serbest kalir', t => {
  const { B } = setup(t);
  const r = B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'limit', qty: 10, price: 50 }, q(60));
  assert.ok(acc(B).reserved > 0);
  B.cancel(r.order.id);
  assert.equal(acc(B).reserved, 0); assert.equal(acc(B).available, 100000);
  assert.throws(() => B.cancel(r.order.id));
});

test('komisyon artisi rezervi asarsa ayar geri alinir; eski emir guvenle dolar', t => {
  const { B, clock } = setup(t);
  B.settings({ commission: 0 });
  const n = B.maxBuy('BIST', 100);
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'limit', qty: n, price: 100 }, q(110));
  assert.throws(() => B.settings({ commission: 0.01 }), /bakiyeyi aşıyor/);
  assert.equal(B.summary().set.commission, 0);assert.equal(acc(B).available, 0);
  clock.now += MIN;
  const p = B.process('X.IS', [bar(OPEN + MIN, 100, 100, 99, 99)], null);
  assert.equal(p.fills.length, 1); assert.equal(p.failed.length, 0);
  assert.equal(acc(B).cash, 0);assert.equal(acc(B).pos[0].qty, n);
});

test('hesaplar birbirinden ayri; sifirlama yalnizca o hesabi temizler', t => {
  const { B } = setup(t, { at: Date.UTC(2026, 9, 20, 15, 0, 0) }); // BIST 18:00 acik, NY 11:00 acik
  B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 10 }, q(300));
  B.place({ symbol: 'AAPL', market: 'US', side: 'buy', type: 'market', qty: 5 }, q(200, { currency: 'USD' }));
  B.place({ symbol: 'AAPL', market: 'US', side: 'buy', type: 'limit', qty: 1, price: 150 }, q(200, { currency: 'USD' }));
  B.reset('US', 50000);
  const s = B.summary();
  assert.equal(s.accounts.US.cash, 50000); assert.equal(s.accounts.US.start, 50000); assert.equal(s.accounts.US.pos.length, 0);
  assert.equal(s.orders.length, 0); assert.ok(s.trades.every(x => x.market === 'BIST'));
  assert.equal(s.accounts.BIST.pos.length, 1);
  assert.throws(() => B.reset('BIST', 10)); assert.throws(() => B.reset('BIST', NaN)); assert.throws(() => B.reset('XX', 5000));
  B.reset('BIST'); assert.equal(acc(B).cash, 100000);
});

test('ayar dogrulama', t => {
  const { B } = setup(t);
  for (const bad of [{ commission: -0.1 }, { commission: 0.5 }, { commission: NaN }, { slippage: -1 }, { slippage: 1000 }])
    assert.throws(() => B.settings(bad));
  B.settings({ commission: 0.0004, slippage: 5, anyTime: true });
  assert.deepEqual(B.summary().set, { commission: 0.0004, slippage: 5, anyTime: true, usFrac: false });
});

test('kalicilik: dosyaya yazilir, yeniden yuklenir; bozuk dosya yedeklenir', t => {
  const { P, B, file, dir, clock } = setup(t);
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'market', qty: 10 }, q(100));
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'limit', qty: 5, price: 120 }, q(100));
  const B2 = P.create({ file, now: () => clock.now });
  assert.deepEqual(B2.summary(), B.summary());
  assert.equal((fs.statSync(file).mode & 0o777), 0o600);
  fs.writeFileSync(file, '{bozuk');
  const B3 = P.create({ file });
  assert.equal(acc(B3).cash, 100000);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith('paper.json.bozuk-')));
});

test('sanitize: elle bozulmus alanlar atilir, fazla ayrilmis satis emri dusurulur', t => {
  const { P } = setup(t);
  const s = P.sanitize({
    acc: { BIST: { cash: 1.5, start: 100 }, US: { cash: 500, start: 1000 } },
    pos: { 'X.IS': { market: 'BIST', qty: 10, cost: 1000 }, 'BAD SYM': { market: 'BIST', qty: 1, cost: 1 }, 'Y.IS': { market: 'BIST', qty: -1, cost: 0 } },
    orders: [{ id: 'o1', sym: 'X.IS', market: 'BIST', side: 'sell', type: 'limit', qty: 8, price: 1, reserve: 0, at: 1 },
      { id: 'o2', sym: 'X.IS', market: 'BIST', side: 'sell', type: 'stop', qty: 5, price: 1, reserve: 0, at: 2 },
      { id: 'o3', sym: 'Z.IS', market: 'BIST', side: 'sell', type: 'limit', qty: 1, price: 1, reserve: 0, at: 3 },
      { id: 'o4', sym: 'Z.IS', market: 'BIST', side: 'buy', type: 'stop', qty: 1, price: 1, reserve: 0, at: 3 }],
    set: { commission: 5, slippage: 3, anyTime: 'evet' }
  });
  assert.equal(s.acc.BIST.cash, 10000000); // gecersiz -> varsayilan
  assert.equal(s.acc.US.cash, 500);
  assert.deepEqual(Object.keys(s.pos), ['X.IS']);
  assert.deepEqual(s.orders.map(o => o.id), ['o1']);
  assert.equal(s.set.commission, 0.002); assert.equal(s.set.slippage, 3); assert.equal(s.set.anyTime, false);
});

test('dosyaya yazilamazsa islem geri alinir', t => {
  const { P, dir } = setup(t, { file: false });
  const ro = path.join(dir, 'yok', 'paper.json'); // klasor yok -> yazma hatasi
  const B = P.create({ file: ro, now: () => OPEN });
  assert.throws(() => B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1 }, q(100)));
  assert.equal(acc(B).cash, 100000); assert.equal(acc(B).pos.length, 0);
});

test('tahmin ve maksimum adet', t => {
  const { B } = setup(t);
  assert.deepEqual(B.estimate('buy', 100, 312.35), { price: 312.35, value: 31235, fee: 62.47, total: 31297.47 });
  assert.deepEqual(B.estimate('sell', 100, 312.35), { price: 312.35, value: 31235, fee: 62.47, total: 31172.53 });
  assert.equal(B.estimate('buy', 0, 10), null); assert.equal(B.estimate('buy', 1, 0), null);
  assert.equal(B.maxBuy('XX', 10), 0); assert.equal(B.maxBuy('BIST', 0), 0);
});

test('seans: BIST takvimi ve ABD saatleri', t => {
  const { P } = setup(t);
  assert.equal(P.session('BIST', new Date(OPEN)).open, true);
  assert.equal(P.session('BIST', new Date(CLOSED)).open, false);
  assert.equal(P.session('BIST', new Date(Date.UTC(2026, 9, 29, 9))).open, false); // 29 Ekim
  assert.equal(P.session('US', new Date(Date.UTC(2026, 9, 20, 14, 0))).open, true);  // 10:00 NY (EDT)
  assert.equal(P.session('US', new Date(Date.UTC(2026, 9, 20, 13, 29))).open, false); // 09:29 NY
  assert.equal(P.session('US', new Date(Date.UTC(2026, 9, 20, 20, 0))).open, false);  // 16:00 NY
  assert.equal(P.session('US', new Date(Date.UTC(2026, 9, 24, 15, 0))).open, false);  // Cumartesi
});

test('ozet: guncel fiyatla gerceklesmemis kar/zarar', t => {
  const { B, clock } = setup(t);
  B.settings({ commission: 0 });
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'market', qty: 100 }, q(50));
  clock.now += MIN;
  B.process('X.IS', [], q(55, { time: OPEN + MIN }));
  const a = acc(B);
  assert.equal(a.pos[0].last, 55); assert.equal(a.unrealized, 500); assert.equal(a.pos[0].pnlPct, 10);
  assert.equal(a.equity, 100500); assert.equal(a.pnlPct, 0.5);
  // farkli para biriminde gelen fiyat pozisyonu guncellemez
  B.process('X.IS', [], q(1, { currency: 'USD', time: OPEN + 2 * MIN }));
  assert.equal(acc(B).pos[0].last, 55);
});

test('demo: gelecekteki mum ve eski veri dolum yaratmaz; zaman damgasi mumdan gelir',t=>{
  const {B,clock}=setup(t);B.place({symbol:'THYAO.IS',market:'BIST',side:'buy',type:'limit',qty:1,price:90},q(100));
  assert.equal(B.process('THYAO.IS',[bar(clock.now+MIN,88,100,87,99)],q(100)).fills.length,0);
  clock.now+=MIN;assert.equal(B.process('THYAO.IS',[bar(clock.now,88,100,87,99)],q(100,{stale:true})).fills.length,0);
  const r=B.process('THYAO.IS',[bar(clock.now,88,100,87,99)],q(100));assert.equal(r.fills[0].at,clock.now);assert.equal(r.fills[0].price,88);
});
test('demo: takvim enjeksiyonu ve guvenli tam sayi siniri',t=>{
  const {P}=setup(t);const B=P.create({now:()=>OPEN,calendar:{status:()=>({open:false,reason:'Test tatili'})}});
  assert.throws(()=>B.place({symbol:'THYAO.IS',market:'BIST',side:'buy',type:'market',qty:1},q(100)),/Test tatili/);
  assert.throws(()=>B.place({symbol:'THYAO.IS',market:'BIST',side:'buy',type:'limit',qty:100000000,price:10000000},q(100)),/güvenli işlem/);
});

test('demo: 500 islem sinirindan sonra da omur boyu komisyon ve K/Z korunur',t=>{
  const {B,P}=setup(t);for(let i=0;i<260;i++){B.place({symbol:'X.IS',market:'BIST',side:'buy',qty:1},q(100));B.place({symbol:'X.IS',market:'BIST',side:'sell',qty:1},q(100))}
  const a=B.summary().accounts.BIST;assert.equal(B.raw().trades.length,500);assert.equal(a.closed,260);assert.equal(a.fees,104);assert.equal(a.realized,-104);assert.equal(a.pnl,-104);
  assert.equal(P.sanitize(B.raw()).acc.BIST.fees,10400);
});

// --- kripto hesap, kesirli miktar, sermaye egrisi, istatistik, gecmis ----------------------------------------
const qu = (price, extra = {}) => q(price, { currency: 'USD', ...extra });
const DAY = 86400000;

test('kripto: ayri USD hesabi, 7/24 seans (pazar da acik), kesirli miktar', t => {
  const { B, P } = setup(t, { at: CLOSED });
  const a = acc(B, 'CRYPTO');
  assert.equal(a.ccy, 'USD'); assert.equal(a.cash, 10000); assert.equal(a.session.open, true); assert.equal(a.qtyDec, 8);
  assert.equal(P.session('CRYPTO', new Date(CLOSED)).open, true);
  B.settings({ commission: 0.001 });
  const r = B.place({ symbol: 'BTC-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.0005 }, qu(108250));
  assert.equal(r.trade.qty, 0.0005); assert.equal(r.trade.value, 5413); assert.equal(r.trade.fee, 5); // 54,125 $ -> 54,13 $; komisyon 0,05 $
  assert.equal(acc(B, 'CRYPTO').cash, 10000 - 54.18);
  assert.equal(acc(B, 'CRYPTO').pos[0].qty, 0.0005);
  assert.equal(acc(B).cash, 100000, 'BIST hesabi etkilenmez');
  // ayni kod BIST/ABD hesabina gecmez; kripto hesabi yalniz -USD ciftleri
  assert.throws(() => B.place({ symbol: 'BTC-USD', market: 'US', side: 'buy', type: 'market', qty: 1 }, qu(10)), /Kripto hesabını kullan/);
  assert.throws(() => B.place({ symbol: 'AAPL', market: 'CRYPTO', side: 'buy', type: 'market', qty: 1 }, qu(10)), /USD çiftleri/);
  assert.throws(() => B.place({ symbol: 'THYAO.IS', market: 'US', side: 'buy', type: 'market', qty: 1 }, qu(10)), /BIST hesabını/);
  assert.throws(() => B.place({ symbol: 'ETH-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 1 }, q(3900)), /para birimi TRY/);
});

test('kesirli miktar yuvarlama, en kucuk adim ve en kucuk tutar (1 $)', t => {
  const { B } = setup(t);
  B.settings({ commission: 0 });
  const r = B.place({ symbol: 'ETH-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.123456789 }, qu(100));
  assert.equal(r.trade.qty, 0.12345679, '8 ondalik basamaga yuvarlanir');
  assert.throws(() => B.place({ symbol: 'ETH-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.000000001 }, qu(100)), /en az 0,00000001/);
  assert.throws(() => B.place({ symbol: 'ETH-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.005 }, qu(100)), /En küçük işlem tutarı 1,00 USD/);
  // kayan nokta: 0,1 + 0,2 kez alis -> tam 0,3 (yuvarlanmis toplam), tamami satilabilir
  B.place({ symbol: 'SOL-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.1 }, qu(150));
  B.place({ symbol: 'SOL-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.2 }, qu(150));
  assert.equal(acc(B, 'CRYPTO').pos.find(p => p.sym === 'SOL-USD').qty, 0.3);
  assert.throws(() => B.place({ symbol: 'SOL-USD', market: 'CRYPTO', side: 'sell', type: 'market', qty: 0.30000001 }, qu(150)), { code: 'QTY' });
  // pozisyonun tamamini kapatan satis 1 $ altinda olsa da yapilir
  B.place({ symbol: 'SOL-USD', market: 'CRYPTO', side: 'sell', type: 'market', qty: 0.3 }, qu(2));
  assert.ok(!acc(B, 'CRYPTO').pos.some(p => p.sym === 'SOL-USD'));
  // cok kucuk fiyatli coin: fiyat sifira yuvarlanmaz, maliyet korunur
  const pe = B.place({ symbol: 'PEPE24478-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 1000000 }, qu(0.00001034));
  assert.equal(pe.trade.price, 0.00001034); assert.equal(pe.trade.value, 1034);
  assert.equal(acc(B, 'CRYPTO').pos.find(p => p.sym === 'PEPE24478-USD').avg, 0.00001034);
  // kripto maksimum alis: kesirli, bakiye asilmaz
  const n = B.maxBuy('CRYPTO', 108250);
  assert.ok(n > 0 && !Number.isInteger(n));
  B.place({ symbol: 'BTC-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: n }, qu(108250));
  assert.ok(acc(B, 'CRYPTO').cash >= 0 && acc(B, 'CRYPTO').cash < 1.1);
});

test('ABD: kesirli hisse varsayilan kapali, ayarla acilir (0,0001 adim); kapatilinca eldeki kesirli pozisyon satilabilir', t => {
  const { B } = setup(t, { at: Date.UTC(2026, 9, 20, 15, 0, 0) }); // NY 11:00
  B.settings({ commission: 0 });
  assert.equal(acc(B, 'US').qtyDec, 0);
  assert.throws(() => B.place({ symbol: 'AAPL', market: 'US', side: 'buy', type: 'market', qty: 1.5 }, qu(200)), /kesirli ABD hissesi Ayarlar/);
  assert.throws(() => B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1.5 }, q(200)), /BIST'te kesirli hisse yok/);
  B.settings({ usFrac: true });
  assert.equal(acc(B, 'US').qtyDec, 4); assert.equal(B.summary().limits.qty.US, 4);
  B.place({ symbol: 'AAPL', market: 'US', side: 'buy', type: 'market', qty: 1.23456 }, qu(200));
  assert.equal(acc(B, 'US').pos[0].qty, 1.2346);
  B.settings({ usFrac: false });
  assert.throws(() => B.place({ symbol: 'AAPL', market: 'US', side: 'buy', type: 'market', qty: 0.5 }, qu(200)), { code: 'QTY' });
  B.place({ symbol: 'AAPL', market: 'US', side: 'sell', type: 'market', qty: 1.2346 }, qu(210));
  assert.equal(acc(B, 'US').pos.length, 0);
  // dosyadan yuklemede kesirli ABD pozisyonu gecerli, kesirli BIST pozisyonu atilir
  const { P } = setup(t);
  const s = P.sanitize({ pos: { AAPL: { market: 'US', qty: 0.5, cost: 100 }, 'X.IS': { market: 'BIST', qty: 0.5, cost: 100 }, 'BTC-USD': { market: 'CRYPTO', qty: 0.00012345, cost: 1300 }, 'ETH-USD': { market: 'CRYPTO', qty: 0.123456789, cost: 1 } } });
  assert.deepEqual(Object.keys(s.pos).sort(), ['AAPL', 'BTC-USD']);
});

test('kripto limit/stop emirleri pazar gunu de mumla dolar', t => {
  const { B, clock } = setup(t, { at: CLOSED });
  B.settings({ commission: 0 });
  B.place({ symbol: 'BTC-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.01 }, qu(100000));
  B.place({ symbol: 'BTC-USD', market: 'CRYPTO', side: 'sell', type: 'stop', qty: 0.004, price: 95000 }, qu(100000));
  const lim = B.place({ symbol: 'BTC-USD', market: 'CRYPTO', side: 'buy', type: 'limit', qty: 0.002, price: 97000 }, qu(100000));
  assert.ok(lim.order); assert.equal(lim.order.reserve, 19400);
  assert.equal(acc(B, 'CRYPTO').pos[0].free, 0.006);
  clock.now += 2 * MIN;
  const p = B.process('BTC-USD', [bar(CLOSED + MIN, 99000, 99000, 94000, 94500)], null);
  assert.equal(p.fills.length, 2);
  assert.deepEqual(p.fills.map(f => [f.side, f.type, f.price, f.qty]), [['sell', 'stop', 95000, 0.004], ['buy', 'limit', 97000, 0.002]]);
  assert.equal(acc(B, 'CRYPTO').pos[0].qty, 0.008);
  // tum emirler ve pozisyonlar ayni kripto hesabinda; emir sinirlari BIST'i etkilemez
  assert.equal(acc(B).reserved, 0);
});

test('sermaye egrisi: gunluk anlik goruntu, bugunku K/Z, en buyuk dusus; sifirlamada temizlenir', t => {
  const { B, clock, P, file } = setup(t);
  B.settings({ commission: 0 });
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1000 }, q(50)); // 50.000 TL pozisyon
  clock.now += DAY; B.process('X.IS', [], q(55, { time: clock.now }));      // +5.000
  clock.now += DAY; B.process('X.IS', [], q(45, { time: clock.now }));      // -10.000 (zirveden)
  clock.now += DAY; B.process('X.IS', [], q(48, { time: clock.now }));
  const raw = B.raw().eq.BIST;
  assert.equal(raw.length, 4); assert.deepEqual(raw.map(x => x[1]), [10000000, 10500000, 9500000, 9800000]);
  const a = acc(B);
  assert.equal(a.curve.length, 4, '3 gecmis gun (ilki baslangic gunu) + bugun');
  assert.equal(a.curve[0].v, 100000); assert.equal(a.curve.at(-1).v, 98000);
  assert.equal(a.dayPnl, 3000); assert.equal(a.dayPct, 3.16);
  assert.equal(a.stats.maxDD, 9.52); assert.equal(a.stats.maxDDAmt, 10000);
  // ayni gun icinde ikinci goruntu ustune yazilir
  B.process('X.IS', [], q(49, { time: clock.now }));
  assert.equal(B.raw().eq.BIST.length, 4); assert.equal(B.raw().eq.BIST.at(-1)[1], 9900000);
  // kalicilik
  assert.deepEqual(P.create({ file, now: () => clock.now }).raw().eq.BIST, B.raw().eq.BIST);
  // sanitize: bozuk/yinelenen gunler atilir
  const s = P.sanitize({ eq: { BIST: [['2026-10-02', 5], ['2026-10-01', 4], ['2026-10-01', 3], ['bozuk', 1], ['2026-10-03', 1.5]] } });
  assert.deepEqual(s.eq.BIST, [['2026-10-01', 3], ['2026-10-02', 5]]);
  B.reset('BIST', 20000);
  assert.deepEqual(B.raw().eq.BIST, []); assert.equal(acc(B).curve.length, 1); assert.equal(acc(B).dayPnl, 0);
});

test('performans: kazanma orani, ortalama kazanc/kayip, en iyi/en kotu, kar faktoru', t => {
  const { B } = setup(t);
  B.settings({ commission: 0 });
  const buy = (s, n, p) => B.place({ symbol: s, market: 'BIST', side: 'buy', type: 'market', qty: n }, q(p));
  const sell = (s, n, p) => B.place({ symbol: s, market: 'BIST', side: 'sell', type: 'market', qty: n }, q(p));
  buy('A.IS', 100, 10); sell('A.IS', 100, 12);   // +200
  buy('B.IS', 100, 10); sell('B.IS', 100, 9);    // -100
  buy('C.IS', 100, 10); sell('C.IS', 100, 14);   // +400
  const st = acc(B).stats;
  assert.deepEqual({ trades: st.trades, buys: st.buys, sells: st.sells, wins: st.wins, losses: st.losses, winRate: st.winRate },
    { trades: 6, buys: 3, sells: 3, wins: 2, losses: 1, winRate: 67 });
  assert.equal(st.avgWin, 300); assert.equal(st.avgLoss, -100); assert.equal(st.best, 400); assert.equal(st.worst, -100); assert.equal(st.profitFactor, 6);
  assert.equal(acc(B, 'US').stats.winRate, null); assert.equal(acc(B, 'US').stats.avgWin, null);
  assert.equal(acc(B).fills, 6);
  // agirlik: pozisyon degeri / toplam deger
  buy('D.IS', 100, 100);
  assert.equal(acc(B).pos[0].weight, +(10000 / acc(B).equity * 100).toFixed(2));
});

test('gecmis (Borsa Okulu gorevleri): emir/iptal kayitlari, dolumlar, pozisyon sayilari; reddedilen emir kaydedilmez', t => {
  const { B, P, file, clock } = setup(t);
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'buy', type: 'market', qty: 10 }, q(100));
  const o = B.place({ symbol: 'Y.IS', market: 'BIST', side: 'buy', type: 'limit', qty: 1, price: 90 }, q(100));
  B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'stop', qty: 5, price: 95 }, q(100));
  B.cancel(o.order.id);
  assert.throws(() => B.place({ symbol: 'X.IS', market: 'BIST', side: 'sell', type: 'market', qty: 50 }, q(100)));
  B.place({ symbol: 'BTC-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.001 }, qu(100000));
  const h = B.history();
  assert.deepEqual(h.events.map(e => [e.m, e.ev, e.side, e.type]), [['BIST', 'order', 'buy', 'market'], ['BIST', 'order', 'buy', 'limit'], ['BIST', 'order', 'sell', 'stop'], ['BIST', 'cancel', 'buy', 'limit'], ['CRYPTO', 'order', 'buy', 'market']]);
  assert.deepEqual(h.trades.map(x => [x.m, x.side, x.type]), [['BIST', 'buy', 'market'], ['CRYPTO', 'buy', 'market']]);
  assert.deepEqual(h.positions, { BIST: 1, US: 0, CRYPTO: 1 });
  assert.ok(!('price' in h.trades[0]) && !('value' in h.trades[0]), 'tutar/fiyat yok');
  assert.deepEqual(P.create({ file, now: () => clock.now }).history().events, h.events);
});

test('kripto hesabi sifirlama ve baslangic bakiyesi', t => {
  const { B } = setup(t);
  B.place({ symbol: 'BTC-USD', market: 'CRYPTO', side: 'buy', type: 'market', qty: 0.01 }, qu(100000));
  B.place({ symbol: 'THYAO.IS', market: 'BIST', side: 'buy', type: 'market', qty: 1 }, q(300));
  B.reset('CRYPTO', 2500);
  const c = acc(B, 'CRYPTO');
  assert.equal(c.cash, 2500); assert.equal(c.start, 2500); assert.equal(c.pos.length, 0); assert.equal(c.fills, 0);
  assert.equal(acc(B).pos.length, 1);
  assert.throws(() => B.reset('CRYPTO', 10), /1.000 ile 1.000.000.000 USD/);
});

test('sembol tablosu: kripto Yahoo kodlari tek tabloda, kullanici yazisi normallesir, arama', () => {
  const S = require('../bp-symbols.js');
  assert.ok(S.CRYPTO.length >= 50 && S.US.length >= 100);
  assert.equal(new Set(S.CRYPTO.map(x => x.symbol)).size, S.CRYPTO.length);
  assert.equal(new Set(S.CRYPTO.map(x => x.code)).size, S.CRYPTO.length);
  for (const x of S.CRYPTO) assert.match(x.symbol, /^[A-Z0-9]{2,15}-USD$/);
  for (const [i, o] of [['btc', 'BTC-USD'], ['BTC-USD', 'BTC-USD'], ['btc/usdt', 'BTC-USD'], ['BTCUSD', 'BTC-USD'], ['ton', 'TON11419-USD'], ['SUI', 'SUI20947-USD'],
    ['apt-usd', 'APT21794-USD'], ['pepe', 'PEPE24478-USD'], ['xyz', 'XYZ-USD'], ['eth-usdc', 'ETH-USD'], ['', null], ['<>', null]]) assert.equal(S.cryptoSymbol(i), o, i);
  assert.equal(S.display('TON11419-USD'), 'TON'); assert.equal(S.display('ABC-USD'), 'ABC'); assert.equal(S.display('THYAO.IS'), 'THYAO');
  assert.equal(S.marketOf('AAPL'), 'US'); assert.equal(S.marketOf('spy'), 'US'); assert.equal(S.marketOf('btc'), 'CRYPTO'); assert.equal(S.marketOf('THYAO'), null); assert.equal(S.marketOf('THYAO.IS'), 'BIST');
  assert.equal(S.search('CRYPTO', 'eth')[0].code, 'ETH'); assert.equal(S.search('US', 'nvidia')[0].symbol, 'NVDA'); assert.equal(S.search('US', 'qqq')[0].symbol, 'QQQ');
  assert.ok(['SPY', 'QQQ', 'VOO', 'TUR'].every(s => S.US.some(x => x.symbol === s)));
});
