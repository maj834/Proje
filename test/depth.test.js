'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../depth.js');

test('num: Turkce ve Ingilizce sayi bicimleri', () => {
  const cases = [
    ['4.342.512', 4342512], ['12,13', 12.13], ['12.13', 12.13], ['1.234,56', 1234.56],
    ['%26,7', 26.7], ['26,7%', 26.7], ['1,2M', 1200000], ['15K', 15000], ['3b', 3000],
    ['1,234,567', 1234567], ['-3,5', -3.5], ['+7', 7], ['₺ 1.250 TL', 1250], ['0', 0]
  ];
  for (const [s, v] of cases) assert.equal(D.num(s), v, s);
  for (const s of ['abc', '', '  ', null, undefined, '12a', '--5']) assert.equal(D.num(s), null, String(s));
});

test('num: birden cok ondalik ayiraci olan bozuk girdi', () => {
  assert.equal(D.num('12.5.3'), null);
});

test('parseText: emoji basliklari olan tek tarafli bolumler ve ozet alanlari', () => {
  const t = `📊 THYAO Derinlik
Son: 312,50 ₺
Tavan: 343,75  Taban: 281,25
Değişim: %+2,35
Alış/Satış: %62
🟢 ALIŞ
312,25 | 45.200 | 120
312,00 | 182.300 | 410
311,75 | 12.000 | 33
🔴 SATIŞ
312,75 | 22.500 | 61
312,50 | 38.100 | 95
313,00 | 410.000 | 900`;
  const d = D.parseText(t);
  assert.equal(d.symbol, 'THYAO');
  assert.equal(d.last, 312.5);
  assert.equal(d.ceiling, 343.75);
  assert.equal(d.floor, 281.25);
  assert.equal(d.change, 2.35);
  assert.equal(d.buyRatio, 62);
  assert.deepEqual(d.bids, [
    { price: 312.25, qty: 45200, orders: 120 }, { price: 312, qty: 182300, orders: 410 }, { price: 311.75, qty: 12000, orders: 33 }]);
  // Satis dusukten yuksege siralanir.
  assert.deepEqual(d.asks.map(a => a.price), [312.5, 312.75, 313]);
  assert.equal(d.asks[2].qty, 410000);
  assert.equal(D.hasData(d), true);
});

test('parseText: "+%2,35" bicimindeki degisim', () => {
  assert.equal(D.parseText('ABCD\nDeğişim: +%2,35').change, 2.35);
});

test('parseText: degisim -1,25% ve %-0,8', () => {
  assert.equal(D.parseText('ABCD\nDeğişim: -1,25%').change, -1.25);
  assert.equal(D.parseText('ABCD\nFark %-0,8').change, -0.8);
});

test('parseText: iki tarafli "alis | satis" satirlari', () => {
  const t = `ASELS kademe
Alış                | Satış
120 82,10 4.342.512 | 82,15 1.250.000 95
88 82,05 950.000 | 82,20 300.000 40`;
  const d = D.parseText(t);
  assert.equal(d.symbol, 'ASELS');
  assert.deepEqual(d.bids, [{ price: 82.1, qty: 4342512, orders: 120 }, { price: 82.05, qty: 950000, orders: 88 }]);
  assert.deepEqual(d.asks, [{ price: 82.15, qty: 1250000, orders: 95 }, { price: 82.2, qty: 300000, orders: 40 }]);
});

test('parseText: kurum satirlari (%) ve gerceklesen islemler', () => {
  const t = `EREGL
En çok alan kurumlar
Bank of America 1.250.000 lot 52,30 %26,7
Ziraat Yatırım 800.000 52,10 %17,1
En çok satan kurumlar
İş Yatırım 900.000 52,25 %19,2
Gerçekleşen işlemler
52,30 15.000 BofA Ziraat 🟢
52,25 3.000 Gedik Ak 🔴`;
  const d = D.parseText(t, { now: Date.UTC(2026, 9, 20, 7, 5, 9) }); // 10:05:09 TSI
  assert.equal(d.symbol, 'EREGL');
  assert.deepEqual(d.buyers, [
    { name: 'Bank of America', net: 1250000, cost: 52.3, pct: 26.7 },
    { name: 'Ziraat Yatırım', net: 800000, cost: 52.1, pct: 17.1 }]);
  assert.deepEqual(d.sellers, [{ name: 'İş Yatırım', net: 900000, cost: 52.25, pct: 19.2 }]);
  assert.deepEqual(d.trades, [
    { time: '10:05:09', est: true, price: 52.3, qty: 15000, buyer: 'BofA', seller: 'Ziraat', side: 'buy' },
    { time: '10:05:09', est: true, price: 52.25, qty: 3000, buyer: 'Gedik', seller: 'Ak', side: 'sell' }]);
  assert.equal(d.bids.length + d.asks.length, 0);
});

test('parseText: bos ya da anlamsiz metin', () => {
  for (const t of ['', null, 'merhaba dunya', 'Lütfen bir hisse kodu yazın']) {
    const d = D.parseText(t);
    assert.equal(D.hasData(d), false, String(t));
  }
  assert.equal(D.hasData(null), false);
  assert.equal(D.parseText('', { symbol: 'KCHOL' }).symbol, 'KCHOL');
});

const book = (bids, asks, extra = {}) => ({ bids: bids.map(([price, qty]) => ({ price, qty })), asks: asks.map(([price, qty]) => ({ price, qty })), trades: [], buyers: [], sellers: [], buyRatio: null, ...extra });

test('walls: ortalamanin cok uzerindeki kademeler', () => {
  const bids = [[10, 1000], [9.99, 1200], [9.98, 50000], [9.97, 900], [9.96, 1100], [9.95, 1000]];
  const asks = Array.from({ length: 10 }, (_, i) => [10.01 + i / 100, 900 + i * 20]);
  const d = book(bids, asks);
  const w = D.walls(d);
  assert.equal(w.length, 1);
  assert.equal(w[0].side, 'bid');
  assert.equal(w[0].price, 9.98);
  assert.ok(w[0].ratio > 0.9);
  // Tek kademe: kendisi duvar sayilir (ratio 1).
  assert.deepEqual(D.walls(book([[5, 100]], [])), [{ price: 5, qty: 100, side: 'bid', ratio: 1 }]);
  assert.deepEqual(D.walls(book([], [])), []);
});

test('pressure: alis agirlikli derinlik pozitif, satis agirlikli negatif', () => {
  const buy = D.pressure(book([[10, 9000]], [[10.01, 1000]], { buyRatio: 70 }));
  const sell = D.pressure(book([[10, 1000]], [[10.01, 9000]], { buyRatio: 30 }));
  assert.ok(buy.score > 50, String(buy.score));
  assert.ok(sell.score < -50, String(sell.score));
  assert.equal(buy.score, -sell.score);
  assert.deepEqual(buy.parts.map(p => p.k), ['Derinlik dengesi', 'Alış/satış oranı']);
  assert.equal(D.pressure(book([], [])), null);
  // Islem tarafi bilinmiyorsa en iyi alis/satis fiyatina gore cikarilir.
  const tr = D.pressure({ ...book([[10, 0]], [[10.01, 0]]), trades: [{ price: 10.01, qty: 500 }, { price: 10, qty: 100 }] });
  assert.equal(tr.parts.find(p => p.k === 'Gerçekleşen işlemler').v, 67);
  assert.ok(tr.score <= 100 && tr.score >= -100);
});

test('trend: olcum gecmisinin egimi', () => {
  assert.equal(D.trend([{ p: 1 }, { p: 2 }]).dir, 0);
  const up = D.trend([0, 10, 20, 30, 40].map(p => ({ p })));
  assert.equal(up.dir, 1);
  assert.equal(up.slope, 10);
  assert.equal(up.text, 'Alış baskısı artıyor');
  const dn = D.trend([-10, -20, -30, -40].map(p => ({ p })));
  assert.equal(dn.dir, -1);
  assert.equal(dn.text, 'Satış baskısı artıyor');
  assert.equal(D.trend([40, 30, 20, 10].map(p => ({ p }))).text, 'Alış baskısı azalıyor');
  assert.equal(D.trend([5, 5, 6, 5].map(p => ({ p }))).text, 'Baskı yatay seyrediyor');
  // Yalnizca son 12 olcum kullanilir.
  const long = [...Array(20).fill(100), ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]].map(p => ({ p }));
  assert.equal(D.trend(long).dir, 0);
});

test('mergeTape / tapeFlow: islem akisi, tekrarlar atilir, yon ve agresif kurum', () => {
  const mk = (time, side, qty, price = 16.15, buyer = 'A', seller = 'B') => ({ time, price, qty, buyer, seller, side });
  let tape = D.mergeTape([], [mk('18:09:49', 'buy', 500), mk('18:09:41', 'buy', 300), mk('18:09:39', 'sell', 5273), mk('18:08:59', 'buy', 16147, 16.15, 'Yapi Kredi'), mk('bozuk', 'buy', 1)]);
  assert.equal(tape.length, 4, 'saatsiz satir atilir');
  tape = D.mergeTape(tape, [mk('18:09:49', 'buy', 500), mk('18:10:20', 'buy', 2000, 16.16, 'Marbas'), mk('18:10:30', 'buy', 100, 16.17)]);
  assert.equal(tape.length, 6, 'ayni islem iki kez sayilmaz');
  assert.equal(tape[0].time, '18:10:30', 'yeniden eskiye');
  const f = D.tapeFlow(tape);
  assert.equal(f.w5.buy, 19047); assert.equal(f.w5.sell, 5273);
  assert.equal(f.dir, 1); assert.ok(f.score >= 30);
  assert.deepEqual(f.top, { name: 'Yapi Kredi', net: 16147 });
  assert.match(f.why[0], /aktif alış %78/);
  // Agir aktif satis -> SAT
  const s = D.tapeFlow(D.mergeTape([], [1, 2, 3, 4, 5, 6].map(i => mk('10:0' + i + ':00', 'sell', 1000, 16 - i * 0.01, 'X', 'Y')).concat([mk('10:07:00', 'buy', 100, 15.93)])));
  assert.equal(s.dir, -1); assert.equal(s.top.name, 'Y');
  // Yetersiz veri -> yon yok
  assert.equal(D.tapeFlow([mk('10:00:00', 'buy', 5)]).dir, 0);
  assert.equal(D.tapeFlow([]), null);
});

test('num: isaretli binlik sayilar (F1)', () => {
  assert.equal(D.num('-4.342.512'), -4342512);
  assert.equal(D.num('-900.000'), -900000);
  assert.equal(D.num('+1.250.000'), 1250000);
  assert.equal(D.num('-1,234,567'), -1234567);
  assert.equal(D.num('-1.234,56'), -1234.56);
  assert.equal(D.num('--5'), null);
});

test('pressure: saticilarin eksi neti satis baskisi olur (F1)', () => {
  const d = D.parseText(`EREGL
En çok alan kurumlar
Bank of America 1.250.000 lot 52,30 %26,7
En çok satan kurumlar
İş Yatırım -900.000 52,25 %19,2
Gedik -4.342.512 52,20 %40,1`);
  assert.deepEqual(d.sellers.map(x => x.net), [-900000, -4342512]);
  const p = D.pressure(d);
  assert.ok(p.score < 0, 'saticilar baskin');
  const q = D.pressure({ bids: [], asks: [], trades: [], buyRatio: null, buyers: [{ net: 1000 }], sellers: [{ net: -3000 }] });
  assert.equal(q.score, -50);
});

test('parseText: islem saatleri ve tape birikimi (F2)', () => {
  const d = D.parseText(`THYAO
Gerçekleşen işlemler
10:15:30 312,50 1.500 BofA Ziraat 🟢
10:15:28 312,25 200 Gedik Ak 🔴`);
  assert.deepEqual(d.trades, [
    { time: '10:15:30', price: 312.5, qty: 1500, buyer: 'BofA', seller: 'Ziraat', side: 'buy' },
    { time: '10:15:28', price: 312.25, qty: 200, buyer: 'Gedik', seller: 'Ak', side: 'sell' }]);
  const tape = D.mergeTape([], d.trades);
  assert.equal(tape.length, 2);
  assert.equal(D.tapeFlow(tape).count, 2);
  // Saatsiz islemler alinma saatini (TSI) alir ve tape'e girer
  const e = D.parseText('Gerçekleşen işlemler\n312,50 1.500 BofA Ziraat', { now: Date.UTC(2026, 0, 2, 21, 30, 0) });
  assert.equal(e.trades[0].time, '00:30:00');
  assert.equal(D.mergeTape([], e.trades).length, 1);
});

test('parseText: son fiyat hacim satirindan alinmaz (F3)', () => {
  assert.equal(D.parseText('THYAO\nHacim: 1.234.567 TL\nSon: 312,50').last, 312.5);
  assert.equal(D.parseText('THYAO\nTutar 9.876.543 TL\n312,50 TL').last, 312.5);
});

test('parseText: binlik ayracli fiyat kademeleri (F8)', () => {
  const d = D.parseText(`🟢 ALIŞ
1.234,50 | 45.200 | 120
1.234,25 | 18.300 | 41`);
  assert.deepEqual(d.bids.map(b => [b.price, b.qty]), [[1234.5, 45200], [1234.25, 18300]]);
});

test('parseText: sembol basliklardan secilmez, Turkce harfte kesilmez (F10)', () => {
  assert.equal(D.parseText('KADEME DERİNLİĞİ\nGARAN\nAlış 12,13 4.500').symbol, 'GARAN');
  assert.equal(D.parseText('DERİNLİK - THYAO').symbol, 'THYAO');
  assert.equal(D.parseText('TOPLAM ADET\nAKBNK').symbol, 'AKBNK');
});

test('mergeTape: ortusen grupta gercek ikinci ayni islem korunur (F13)', () => {
  const t = (time, qty) => ({ time, price: 10, qty, buyer: 'A', seller: 'B', side: 'buy' });
  let tape = D.mergeTape([], [t('10:00:01', 5), t('10:00:00', 7)]);
  tape = D.mergeTape(tape, [t('10:00:01', 5), t('10:00:01', 5), t('10:00:00', 7)]);
  assert.equal(tape.length, 3, 'yalniz fazlalik eklenir');
  assert.equal(tape.filter(x => x.qty === 5).length, 2);
  assert.equal(D.mergeTape(tape, [t('10:00:01', 5), t('10:00:01', 5)]).length, 3);
});

test('mergeTape: saatsiz islem tekrar gelince ikinci kez sayilmaz', () => {
  const t = '🟢 52,30 15.000 BofA Ziraat';
  const a = D.parseText('Islemler\n' + t, { now: Date.UTC(2026, 9, 20, 7, 5, 0) }).trades;
  const b = D.parseText('Islemler\n' + t, { now: Date.UTC(2026, 9, 20, 7, 6, 0) }).trades;
  assert.equal(D.mergeTape(D.mergeTape([], a), b).length, a.length);
});

test('mergeTape: saatsiz islemler sirayla eslenir, gercek tekrar kaybolmaz', () => {
  const P = (lines, m) => D.parseText('Islemler\n' + lines.join('\n'), { now: Date.UTC(2026, 9, 20, 7, m, 0) }).trades;
  const a = '🟢 52,30 1.000 BofA Ziraat', b = '🔴 52,25 500 Gedik Ak', c = '🟢 52,35 2.000 Ak Is';
  let t = D.mergeTape([], P([b, a], 1));               // en yeni ustte: b, a
  t = D.mergeTape(t, P([a, b, a], 2));                  // yeni bir "a" geldi (ayni fiyat/adet/kurum), sonra eski b, a
  assert.equal(t.length, 3);
  t = D.mergeTape(t, P([c, a, b], 3));                  // pencere kaydi: yalniz c yeni
  assert.equal(t.length, 4);
  t = D.mergeTape(t, P([c, a, b], 4));                  // aynisi tekrar: yeni yok
  assert.equal(t.length, 4);
  // eskiden yeniye gonderen bot da dogru sayilir
  let u = D.mergeTape([], P([a, b], 1));
  u = D.mergeTape(u, P([a, b, c], 2));
  assert.equal(u.length, 3);
});
