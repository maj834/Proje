'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../bp-planner.js');
const { plan, RISK, MIN_RR, WEIGHTS, _util: U } = P;

// --- adaylar ------------------------------------------------------------------------------------------------------
// Varsayilan aday: giris 98-100 (referans ust uc 100), stop 95, H1 110, H2 118, R/O 2; olasilik ve aralik verisi var.
// Komisyon %0,2 (k = 0,002): hisse basina risk = 5 + 100*0,002 + 95*0,002 = 5,39 TL; 1 lot alis = 100*1,002 = 100,2 TL.
const PLAN = { dir: 1, entry: [98, 100], stop: 95, t1: 110, t2: 118, rr: 2, wait: false };
const ODDS = { p1: 55, pStop: 35, ev: 0.4, breakEven: 33.3, n: 120 };
const RANGES = { h5: { p16: 96, p50: 102, p84: 108 }, h20: { p16: 92, p50: 104, p84: 116 } };
function cand(symbol, o = {}) {
  return { symbol, name: symbol + ' A.Ş.', sector: 'Sektör ' + symbol, price: 99, verdict: { label: 'AL', score: 45, confidence: 65 }, rating: null,
    odds: { ...ODDS }, ranges: JSON.parse(JSON.stringify(RANGES)), liquidityTL: 50e6, radar: null, warnings: [], ...o, plan: o.plan === null ? null : { ...PLAN, ...(o.plan || {}) } };
}
const only = (c, opts = {}) => plan({ capital: 100000, candidates: [c], ...opts });
const why = (r, s) => (r.rejected.find(x => x.symbol === s) || {}).why;
const close = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, a + ' ~ ' + b);

// --- risk seviyeleri ve lot hesabi ----------------------------------------------------------------------------------
test('risk: temkinli %0,5 / dengeli %1 / atak %2 sermaye riski; lot = floor(butce / (giris - stop + komisyon payi))', () => {
  assert.deepEqual(RISK, { temkinli: 0.5, dengeli: 1, atak: 2 }); assert.equal(MIN_RR, 1.5);
  const t = only(cand('THYAO'), { risk: 'temkinli' }), d = only(cand('THYAO'), { risk: 'dengeli' }), a = only(cand('THYAO'), { risk: 'atak', maxPos: 1 });
  assert.equal(t.riskPct, 0.5); assert.equal(d.riskPct, 1); assert.equal(a.riskPct, 2);
  // 500 / 5,39 = 92,8 -> 92 ; 1000 / 5,39 = 185,5 -> 185 ; 2000 / 5,39 = 371,1 -> 371
  assert.equal(t.picks[0].lots, 92); assert.equal(d.picks[0].lots, 185); assert.equal(a.picks[0].lots, 371);
  const p = d.picks[0];
  assert.equal(p.ref, 100); assert.deepEqual(p.entry, [98, 100]); assert.equal(p.stop, 95); assert.equal(p.t1, 110); assert.equal(p.t2, 118);
  assert.equal(p.positionTL, 18537, '185 * 100,2 (alis komisyonu dahil)'); assert.equal(p.maxLossTL, 997.15, '185 * 5,39'); assert.equal(p.maxLossPct, 1);
  assert.equal(p.commissionTL, 74, 'gidis-donus: 185 * 100 * 0,002 * 2');
  assert.equal(t.picks[0].maxLossTL, 495.88); assert.equal(t.picks[0].maxLossPct, 0.5);
  for (const r of [t, d, a]) {
    const q = r.picks[0], budget = 100000 * r.riskPct / 100, per = 5.39;
    assert.ok(q.maxLossTL <= budget + 1e-6, 'risk butcesi asilmaz');
    assert.ok((q.lots + 1) * per > budget, 'bir lot fazlasi butceyi asar (lot en buyuk)');
    assert.ok(q.maxLossPct <= r.riskPct);
  }
  // sayi olarak risk yuzdesi; buyuk/kucuk harf duyarsiz ad
  assert.equal(only(cand('THYAO'), { risk: 1.5 }).picks[0].lots, 278, '1500 / 5,39');
  assert.equal(only(cand('THYAO'), { risk: '1.5' }).riskPct, 1.5);
  assert.equal(only(cand('THYAO'), { risk: 'Dengeli' }).riskPct, 1); assert.equal(only(cand('THYAO'), { risk: 'ATAK' }).riskPct, 2);
  assert.match(d.notes.join(' '), /Pozisyon başına risk: sermayenin %1 \(dengeli\) = 1\.000,00 TL/);
  assert.match(t.notes.join(' '), /sermayenin %0,5 \(temkinli\) = 500,00 TL/);
  assert.match(only(cand('THYAO'), { risk: 1.25 }).notes.join(' '), /sermayenin %1,25 = 1\.250,00 TL/);
});

test('komisyon: hisse basina riske alis ve satis komisyonu eklenir; 0 iken lot = butce / (giris - stop)', () => {
  const z = only(cand('THYAO'), { commission: 0 }).picks[0];
  assert.equal(z.lots, 200); assert.equal(z.maxLossTL, 1000); assert.equal(z.positionTL, 20000); assert.equal(z.commissionTL, 0);
  const k = only(cand('THYAO'), { commission: 0.2 }).picks[0];
  assert.ok(k.lots < z.lots);
  const h = only(cand('THYAO'), { commission: 1 }).picks[0];
  // 5 + 1 + 0,95 = 6,95 -> 1000 / 6,95 = 143,9 -> 143
  assert.equal(h.lots, 143); assert.equal(h.positionTL, 14443, '143 * 101');
  assert.equal(plan({ capital: 1e5, candidates: [cand('THYAO')], commission: null }).picks[0].lots, 185, 'null -> varsayilan %0,2');
  assert.match(only(cand('THYAO')).notes.join(' '), /komisyon alışta ve satışta ayrı ayrı %0,2 varsayıldı/);
});

test('pozisyon siniri: tutar sermaye/maxPos\'u asamaz, lot kisilir ve uyarilir; toplam yatirim + nakit = sermaye', () => {
  // atak, 3 pozisyon: 371 lot = 37.174,2 TL > 33.333,33 TL -> floor(33.333,33 / 100,2) = 332 lot
  const r = only(cand('THYAO'), { risk: 'atak' });
  const p = r.picks[0];
  assert.equal(p.lots, 332); assert.equal(p.positionTL, 33266.4); assert.equal(p.maxLossTL, 1789.48); assert.equal(p.maxLossPct, 1.79);
  assert.ok(p.positionTL <= 100000 / 3);
  assert.ok(p.warnings.some(w => /Pozisyon sınırı nedeniyle lot azaltıldı; stop riski sermayenin %1,79'i/.test(w)));
  // iki pozisyon, kucuk sermaye: her biri en fazla 5.000 TL; nakit = sermaye - yatirim
  // stop giris bolgesinin (99-100) altinda olmali; 98-100 bolgesi ile stop 98 gecersiz plan olurdu
  const two = plan({ capital: 10000, risk: 'atak', maxPos: 2, candidates: [cand('AAAA', { plan: { entry: [99, 100], stop: 98 } }), cand('BBBB', { plan: { entry: [99, 100], stop: 98 }, odds: { ...ODDS, ev: 0.3 } })] });
  // hisse basina risk 2 + 0,2 + 0,196 = 2,396 -> 200 / 2,396 = 83 lot (8.316,6 TL) > 5.000 -> 49 lot
  assert.deepEqual(two.picks.map(x => [x.symbol, x.lots, x.positionTL]), [['AAAA', 49, 4909.8], ['BBBB', 49, 4909.8]]);
  assert.equal(two.totals.invested, 9819.6); assert.equal(two.totals.cash, 180.4); assert.equal(two.totals.positions, 2);
  assert.match(two.notes.join(' '), /Kullanılmayan nakit: 180,40 TL/);
  assert.match(two.notes.join(' '), /Pozisyon üst sınırı: sermaye \/ 2 = 5\.000,00 TL; aynı sektörden en fazla bir hisse\./);
  // maxPos = 1: tum sermaye tek pozisyona acik
  assert.equal(only(cand('THYAO'), { risk: 'atak', maxPos: 1 }).picks[0].lots, 371);
  // maxPos 10 ile sinirli, kesirli deger asagi yuvarlanir
  const many = Array.from({ length: 14 }, (_, i) => cand('S' + String(i).padStart(3, '0')));
  assert.equal(plan({ capital: 1e6, maxPos: 50, candidates: many }).picks.length, 10);
  assert.equal(plan({ capital: 1e6, maxPos: 2.9, candidates: many }).picks.length, 2);
});

// --- secim kurallari ve Turkce red nedenleri -------------------------------------------------------------------------
test('red nedenleri: AL yok, plan yok/bekliyor/asagi, seviyeler, R/O, olasilik, likidite, fiyat stopta/hedefte, tekrar, gecersiz kod', () => {
  const cs = [
    cand('BEKLE', { verdict: { label: 'BEKLE', score: 5, confidence: 40 } }),
    cand('NOTR', { rating: { label: 'Nötr', confidence: 55 } }),
    cand('PLANYOK', { plan: null }),
    cand('WAIT', { plan: { wait: true } }),
    cand('SHORT', { plan: { dir: -1 } }),
    cand('NOENT', { plan: { entry: [] } }),
    cand('STOPUP', { plan: { stop: 99 } }),
    cand('T1LOW', { plan: { t1: 100 } }),
    cand('RRLOW', { plan: { rr: 1.2 } }),
    cand('NORR', { plan: { rr: null, t1: null } }),
    cand('ODDSLOW', { odds: { p1: 30, pStop: 60, ev: -0.2, breakEven: 33.3, n: 80 } }),
    cand('ILLIQ', { liquidityTL: 2e6 }),
    cand('UNDER', { price: 94 }),
    cand('ABOVE', { price: 111 }),
    cand('GOOD'),
    cand('good'),
    cand(''),
  ];
  const r = plan({ capital: 100000, candidates: cs });
  assert.equal(r.ok, true); assert.deepEqual(r.picks.map(p => p.symbol), ['GOOD']);
  assert.equal(why(r, 'BEKLE'), 'AL sinyali yok (karar: BEKLE).');
  assert.equal(why(r, 'NOTR'), 'AL sinyali yok (karar: Nötr).', 'analist notu teknik karardan once gelir');
  assert.equal(why(r, 'PLANYOK'), 'İşlem planı yok.');
  assert.equal(why(r, 'WAIT'), 'Plan giriş tetiği bekliyor; henüz alım bölgesinde değil.');
  assert.equal(why(r, 'SHORT'), 'Plan aşağı yönlü; planlayıcı yalnız alım yapar.');
  assert.equal(why(r, 'NOENT'), 'Plan seviyeleri eksik (giriş/stop).');
  assert.equal(why(r, 'STOPUP'), 'Plan seviyeleri geçersiz: stop giriş bölgesinin altında olmalı.', 'stop giris bolgesi icinde');
  assert.equal(why(r, 'T1LOW'), 'Plan seviyeleri geçersiz: hedef 1 girişin üstünde olmalı.');
  assert.equal(why(r, 'RRLOW'), 'Ödül/risk 1,20 (en az 1,5 gerekli).');
  assert.equal(why(r, 'NORR'), 'Ödül/risk hesaplanamadı (hedef yok).');
  assert.equal(why(r, 'ODDSLOW'), 'Hedefe stoptan önce ulaşma olasılığı %30, başabaş %33 üstünde değil.');
  assert.equal(why(r, 'ILLIQ'), 'Günlük işlem hacmi 2,0 mn TL (en az 5,0 mn TL gerekli).');
  assert.equal(why(r, 'UNDER'), 'Fiyat (94,00) stop seviyesinde ya da altında (95,00); plan bozulmuş.');
  assert.equal(why(r, 'ABOVE'), 'Fiyat (111,00) hedef 1\'e (110,00) ulaşmış; giriş fırsatı geçmiş.');
  assert.equal(why(r, 'GOOD'), 'Aday listesinde tekrar.', "'good' kodu GOOD ile ayni");
  assert.equal(why(r, '?'), 'Geçersiz hisse kodu.');
  assert.equal(r.rejected.length, cs.length - 1, 'her aday ya secilir ya da nedeniyle reddedilir');
  for (const x of r.rejected) assert.ok(typeof x.why === 'string' && x.why.length > 5 && /[ığüşöçİ]|\./.test(x.why));
});

test('AL tanimi: analist notu (Al/Güçlü Al) varsa o, yoksa teknik karar; R/O plan.rr yoksa hedef 1\'den; likidite esigi ayarlanabilir', () => {
  const r1 = only(cand('THYAO', { verdict: { label: 'BEKLE', score: 10, confidence: 50 }, rating: { label: 'Güçlü Al', confidence: 72 } }));
  assert.equal(r1.picks.length, 1); assert.match(r1.picks[0].reasons[0], /^Analist notu: Güçlü Al \(güven %72\), teknik skor \+10\.$/);
  assert.equal(only(cand('THYAO', { rating: { label: 'Al', confidence: 60 } })).picks.length, 1);
  assert.equal(only(cand('THYAO', { rating: { label: 'Sat', confidence: 60 } })).picks.length, 0);
  assert.equal(only(cand('THYAO', { verdict: { label: 'al' } })).picks.length, 1, 'kucuk harf karar');
  assert.match(only(cand('THYAO')).picks[0].reasons[0], /^Teknik karar: AL \(güven %65\), teknik skor \+45\.$/);
  const r2 = only(cand('THYAO', { plan: { rr: null } }));
  assert.equal(r2.picks[0].rr, 2, '(110 - 100) / (100 - 95)');
  assert.equal(only(cand('THYAO', { liquidityTL: 2e6 }), { minLiquidityTL: 1e6 }).picks.length, 1);
  assert.equal(only(cand('THYAO', { liquidityTL: 2e6 }), { minLiquidityTL: 0 }).picks.length, 1);
  // tek giris fiyati (dizi degil) ve Turkce kucuk harf kod
  const r3 = only(cand('isctr', { plan: { entry: 100 } }));
  assert.equal(r3.picks[0].symbol, 'ISCTR'); assert.deepEqual(r3.picks[0].entry, [100, 100]);
  assert.equal(only(cand('thyao.is')).picks[0].symbol, 'THYAO');
});

test('sektor: maxPos >= 2 iken ayni sektorden en fazla 1 (guclu olan); maxPos 1 iken kural uygulanmaz; sektorsuz serbest', () => {
  const cs = [cand('AKBNK', { sector: 'Bankacılık', odds: { ...ODDS, ev: 0.6 } }), cand('GARAN', { sector: 'bankacılık ', odds: { ...ODDS, ev: 0.3 } }),
    cand('THYAO', { sector: 'Ulaştırma', odds: { ...ODDS, ev: 0.2 } }), cand('X1', { sector: null, odds: { ...ODDS, ev: 0.1 } }), cand('X2', { sector: '', odds: { ...ODDS, ev: 0.05 } })];
  const r = plan({ capital: 1e6, maxPos: 5, candidates: cs });
  assert.deepEqual(r.picks.map(p => p.symbol), ['AKBNK', 'THYAO', 'X1', 'X2']);
  assert.equal(why(r, 'GARAN'), 'Aynı sektörden (bankacılık) daha güçlü aday seçildi: AKBNK.');
  assert.equal(r.picks.find(p => p.symbol === 'X1').sector, null);
  const one = plan({ capital: 1e6, maxPos: 1, candidates: cs });
  assert.deepEqual(one.picks.map(p => p.symbol), ['AKBNK']);
  assert.equal(why(one, 'GARAN'), 'Daha güçlü bir aday seçildi (en fazla 1 pozisyon).', 'sektor degil sayi nedeni');
  const two = plan({ capital: 1e6, maxPos: 2, candidates: cs });
  assert.deepEqual(two.picks.map(p => p.symbol), ['AKBNK', 'THYAO']); assert.equal(why(two, 'X1'), 'Daha güçlü iki aday seçildi (en fazla 2 pozisyon).');
  // sermaye yetmeyen hisse sektoru tutmaz: siradaki ayni sektorlu aday secilebilir
  const r4 = plan({ capital: 10000, maxPos: 3, candidates: [cand('PAHALI', { sector: 'Banka', plan: { entry: [4990, 5000], stop: 4950, t1: 5150, t2: 5300, rr: 3 }, price: 4995, odds: { ...ODDS, ev: 0.9 }, ranges: null }),
    cand('UCUZ', { sector: 'Banka' })] });
  assert.deepEqual(r4.picks.map(p => p.symbol), ['UCUZ']); assert.match(why(r4, 'PAHALI'), /^Sermaye bu hisse için yetersiz/);
});

test('siralama: puan = 0,40 EV + 0,30 guven + 0,15 aralik + 0,15 radar; esitlikte R/O, sonra kod', () => {
  assert.deepEqual(WEIGHTS, { ev: 0.40, conf: 0.30, range: 0.15, radar: 0.15 });
  const A = cand('AAAA', { odds: { ...ODDS, ev: 0.5 }, verdict: { label: 'AL', score: 30, confidence: 60 } });
  const B = cand('BBBB', { odds: { ...ODDS, ev: 0.1 }, verdict: { label: 'AL', score: 80, confidence: 70 } });
  const r = plan({ capital: 1e6, candidates: [B, A] });
  // A: 0,4*0,5 + 0,3*0,6 + 0,15*(102-100)/5 = 0,44 ; B: 0,04 + 0,21 + 0,06 = 0,31
  assert.deepEqual(r.picks.map(p => [p.symbol, p.score]), [['AAAA', 0.44], ['BBBB', 0.31]]);
  // radar konsensusu: skor * guven/100 (guven yoksa 0,5)
  const Rd = cand('RRRR', { odds: { ...ODDS, ev: 0.1 }, verdict: { label: 'AL', score: 80, confidence: 70 }, radar: { karar: 'AL', skor: 1, guven: 80 } });
  const r2 = plan({ capital: 1e6, candidates: [B, Rd] });
  assert.deepEqual(r2.picks.map(p => [p.symbol, p.score]), [['RRRR', 0.43], ['BBBB', 0.31]]);
  assert.ok(r2.picks[0].reasons.includes('Hisse Radar yapay zekâ konsensüsü AL (güven %80).'));
  const Rs = cand('SSSS', { radar: { karar: 'SAT', skor: -0.6 } });
  const r3 = only(Rs);
  assert.equal(r3.picks[0].score, Math.round((0.4 * 0.4 + 0.3 * 0.65 + 0.15 * 0.4 - 0.15 * 0.6 * 0.5) * 1000) / 1000);
  assert.ok(r3.picks[0].warnings.includes('Hisse Radar yapay zekâ konsensüsü SAT; teknik plan ile çelişiyor.'));
  // EV en fazla +-1 R sayilir; esit puanda yuksek R/O, sonra kod
  const big = only(cand('BIG', { odds: { ...ODDS, ev: 5 } }));
  assert.equal(big.picks[0].score, Math.round((0.4 + 0.3 * 0.65 + 0.06) * 1000) / 1000);
  const t1 = cand('ZZZZ', { plan: { rr: 3 } }), t2 = cand('YYYY', { plan: { rr: 2 } }), t3 = cand('XXXX', { plan: { rr: 2 } });
  assert.deepEqual(plan({ capital: 1e6, candidates: [t3, t2, t1] }).picks.map(p => p.symbol), ['ZZZZ', 'XXXX', 'YYYY']);
  // vade 1 ay: aralik bileseni h20 (p50 104 -> 0,8)
  assert.equal(only(cand('THYAO'), { horizon: '1a' }).picks[0].score, Math.round((0.16 + 0.195 + 0.15 * 0.8) * 1000) / 1000);
});

// --- beklenen araliklar, EV, toplamlar -----------------------------------------------------------------------------
test('beklenen haftalik/aylik TL araligi: (fiyat - giris) * lot - gidis-donus komisyonu; stop kaybiyla sinirli', () => {
  const p = only(cand('THYAO')).picks[0];                                                // 185 lot
  // hafta (96 / 102 / 108): -740 - 72,52 ; 370 - 74,74 ; 1480 - 76,96
  assert.deepEqual(p.expected.week, { lo: -812.52, mid: 295.26, hi: 1403.04 });
  // ay (92 / 104 / 116): -1480 - 71,04 = -1551,04 -> stop kaybi -997,15 ; 740 - 75,48 ; 2960 - 79,92
  assert.deepEqual(p.expected.month, { lo: -997.15, mid: 664.52, hi: 2880.08 });
  // EV: 0,4 R * 185 * 5 - 74 = 296 ; p1 olasilik verisinden
  assert.equal(p.evTL, 296); assert.equal(p.p1, 55);
  assert.ok(p.reasons.some(x => x === '1 haftalık olası fiyat aralığı (%16–%84): 96,00–108,00, ortanca 102,00.'));
  assert.ok(p.reasons.some(x => x === 'Geçmiş benzer kurulumlarda hedef 1 stoptan önce %55 (başabaş %33, 120 örnek); beklenen +0,40R.'));
  const m = only(cand('THYAO'), { horizon: '1a' });
  assert.equal(m.horizon, '1a'); assert.ok(m.picks[0].reasons.some(x => /^1 aylık olası fiyat aralığı/.test(x)));
  assert.deepEqual(m.picks[0].expected, p.expected, 'iki vade de her zaman hesaplanir');
  // bp-quant ranges() bicimi {horizons:[{h,p16,p50,p84}]} de kabul edilir
  const q = only(cand('THYAO', { ranges: { last: 99, horizons: [{ h: 5, p05: 94, p16: 96, p50: 102, p84: 108, p95: 110, n: 700 }, { h: 20, p16: 92, p50: 104, p84: 116, n: 700 }] } })).picks[0];
  assert.deepEqual(q.expected, p.expected);
  // gecersiz aralik (sirasiz / eksik) yok sayilir
  assert.equal(U.rangeOf({ h5: { p16: 110, p50: 100, p84: 120 } }, 5), null); assert.equal(U.rangeOf({ h5: { p16: 90, p50: 100 } }, 5), null);
  assert.equal(U.rangeOf(null, 5), null);
});

test('toplamlar: yatirim, nakit, en kotu zarar, haftalik/aylik aralik toplami; korelasyon notu', () => {
  const r = plan({ capital: 100000, candidates: [cand('AAAA', { odds: { ...ODDS, ev: 0.5 } }), cand('BBBB')] });
  assert.equal(r.picks.length, 2);
  const [a, b] = r.picks;
  assert.equal(a.lots, 185); assert.equal(b.lots, 185);
  assert.deepEqual(r.totals, { invested: 37074, cash: 62926, maxLoss: 1994.3, maxLossPct: 1.99,
    expWeek: { lo: -1625.04, mid: 590.52, hi: 2806.08 }, expMonth: { lo: -1994.3, mid: 1329.04, hi: 5760.16 }, positions: 2 });
  close(r.totals.invested + r.totals.cash, 100000, 1e-6);
  assert.ok(r.notes.some(n => /korelasyonu yok sayar, yaklaşıktır/.test(n)));
  assert.ok(r.notes.some(n => /^Yatırım tavsiyesi değildir\./.test(n)));
  assert.ok(r.notes.some(n => n === 'Kriterlere uyan 2 hisse çıktı; kalan sermaye nakitte bekler.'));
  assert.equal(r.capital, 100000); assert.equal(r.horizon, '1h'); assert.equal(r.ok, true); assert.equal(r.error, undefined);
});

// --- kenar durumlar --------------------------------------------------------------------------------------------------
test('kenar: kucuk sermaye (1 lotun riski butceyi asar), lot fiyati pozisyon sinirini/sermayeyi asar', () => {
  const tiny = plan({ capital: 500, candidates: [cand('THYAO')] });
  assert.equal(tiny.ok, true); assert.equal(tiny.picks.length, 0);
  assert.equal(why(tiny, 'THYAO'), 'Sermaye bu hisse için yetersiz: 1 lotun stop riski 5,39 TL, pozisyon başı risk bütçesi 5,00 TL.');
  assert.ok(tiny.notes.includes('Kriterlere uyan hisse çıkmadı; nakitte beklemek de bir karardır.'));
  assert.deepEqual(tiny.totals, { invested: 0, cash: 500, maxLoss: 0, maxLossPct: 0, expWeek: null, expMonth: null, positions: 0 });
  // 1.000 TL: 10 TL butce -> 1 lot
  const small = plan({ capital: 1000, candidates: [cand('THYAO')] });
  assert.equal(small.picks[0].lots, 1); assert.equal(small.picks[0].positionTL, 100.2);
  // 5.000 TL'lik hisse, 10.000 TL sermaye, 3 pozisyon: risk butcesi 2 lota yeter ama 1 lot 5.010 TL > 3.333,33 TL
  const exp = cand('PAHALI', { plan: { entry: [4990, 5000], stop: 4950, t1: 5150, t2: 5300, rr: 3 }, price: 4995, ranges: null });
  const r = plan({ capital: 10000, risk: 'atak', candidates: [exp] });
  assert.equal(why(r, 'PAHALI'), 'Sermaye bu hisse için yetersiz: 1 lot 5.010,00 TL, pozisyon sınırı 3.333,33 TL (sermaye / 3).');
  // tek pozisyon, lot fiyati sermayenin ustunde
  const r2 = plan({ capital: 3000, risk: 5, maxPos: 1, candidates: [exp] });
  assert.equal(why(r2, 'PAHALI'), 'Sermaye bu hisse için yetersiz: 1 lot 5.010,00 TL, pozisyon sınırı 3.000,00 TL (sermaye / 1).');
  assert.ok(r2.notes.some(n => /Pozisyon üst sınırı: sermaye \/ 1 = 3\.000,00 TL\.$/.test(n)));
});

test('kenar: aday yok, olasilik/aralik/likidite verisi eksik, oran bicimli olasilik, uyarilar', () => {
  for (const candidates of [[], undefined, null, 'x', [null, 5]]) {
    const r = plan({ capital: 50000, candidates });
    assert.equal(r.ok, true); assert.deepEqual(r.picks, []); assert.deepEqual(r.rejected, []);
    assert.ok(r.notes.includes('Aday yok: önce tarama yap ya da izleme listesine hisse ekle.'));
    assert.equal(r.totals.cash, 50000); assert.equal(r.totals.expWeek, null);
  }
  const bare = only(cand('THYAO', { odds: null, ranges: null, liquidityTL: null, price: null }));
  const p = bare.picks[0];
  assert.equal(p.p1, null); assert.equal(p.evTL, null); assert.deepEqual(p.expected, { week: null, month: null });
  assert.ok(p.warnings.includes('Olasılık verisi yok; seçim yalnız teknik plana dayanıyor.'));
  assert.ok(p.warnings.includes('Likidite bilinmiyor; emir öncesi işlem hacmini kontrol et.'));
  assert.equal(bare.totals.expWeek, null); assert.equal(bare.totals.expMonth, null);
  assert.ok(bare.notes.includes('1 hissede 1 haftalık aralık verisi yok; toplam aralık eksik hesaplandı.'));
  // olasilik oran bicimiyle (0-1) gelirse yuzdeye cevrilir; eksik olasilik (p1 yok) veri yok sayilir
  assert.deepEqual(U.oddsOf({ p1: 0.55, breakEven: 0.333, pStop: 0.35, ev: 0.4, n: 90 }), { p1: 55, breakEven: 33.3, ev: 0.4, pStop: 35, n: 90 });
  assert.deepEqual(U.oddsOf(ODDS), { p1: 55, breakEven: 33.3, ev: 0.4, pStop: 35, n: 120 });
  assert.equal(U.oddsOf({ ev: 0.4 }), null); assert.equal(U.oddsOf(null), null);
  assert.equal(only(cand('THYAO', { odds: { p1: 0.25, breakEven: 0.333 } })).picks.length, 0, '%25 < %33');
  assert.equal(only(cand('THYAO', { odds: { p1: 0.5, breakEven: 0.333 } })).picks[0].p1, 50);
  // uyarilar: fiyat bolgenin ustunde, stop cok yakin, hacme gore buyuk pozisyon, aday uyarilari tekrarsiz
  // (fiyat hedef 1'in altinda kalmali: 101 >= H1 olsaydi "firsat gecmis" diye reddedilirdi)
  const w = only(cand('THYAO', { price: 101, plan: { entry: [99.6, 100], stop: 99.5, t1: 102, t2: 103, rr: 4 }, liquidityTL: 1.5e6, warnings: ['Bilanço 3 gün içinde.', 'Bilanço 3 gün içinde.', '', 7] }),
    { minLiquidityTL: 1e6 }).picks[0];
  assert.ok(w.warnings.includes('Fiyat (101,00) giriş bölgesinin üstünde; bölgeye geri çekilme için limit emir gerekir.'));
  assert.ok(w.warnings.includes('Stop girişe çok yakın (%0,5); olağan dalgalanma stopu tetikleyebilir.'));
  assert.ok(w.warnings.some(x => /^Pozisyon günlük hacmin %\d+,\d'i; emir fiyatı etkileyebilir\.$/.test(x)));
  assert.equal(w.warnings.filter(x => x === 'Bilanço 3 gün içinde.').length, 1);
  // plan R/O girisin orta noktasindan verilip ust uctan 1,5'in altina dusuyorsa uyari
  const rr = only(cand('THYAO', { plan: { entry: [96, 100], stop: 94, t1: 108, rr: 1.6 } })).picks[0];
  assert.ok(rr.warnings.includes('Giriş bölgesinin üst ucundan alınırsa ödül/risk 1,33\'ye düşer.'));
});

test('gecersiz girdiler: Turkce hata, ok:false, bos secim', () => {
  const bad = [[{ capital: 0 }, 'Sermaye gir (TL, sıfırdan büyük).'], [{ capital: -5 }, 'Sermaye gir (TL, sıfırdan büyük).'], [{ capital: 'abc' }, 'Sermaye gir (TL, sıfırdan büyük).'],
    [{}, 'Sermaye gir (TL, sıfırdan büyük).'], [{ capital: 1e5, risk: 'cesur' }, 'Risk seçimi geçersiz (temkinli, dengeli, atak ya da yüzde).'],
    [{ capital: 1e5, risk: 0 }, 'Pozisyon başına risk %0 ile %5 arasında olmalı.'], [{ capital: 1e5, risk: 6 }, 'Pozisyon başına risk %0 ile %5 arasında olmalı.'],
    [{ capital: 1e5, horizon: '2h' }, 'Vade geçersiz (1h: 1 hafta, 1a: 1 ay).'], [{ capital: 1e5, maxPos: 0 }, 'En az 1 pozisyon olmalı.'],
    [{ capital: 1e5, commission: -0.1 }, 'Komisyon yüzdesi geçersiz (ör. 0,2 = binde 2).'], [{ capital: 1e5, commission: 5 }, 'Komisyon yüzdesi geçersiz (ör. 0,2 = binde 2).'],
    [{ capital: 1e5, minLiquidityTL: -1 }, 'Likidite sınırı geçersiz.']];
  for (const [o, msg] of bad) {
    const r = plan({ candidates: [cand('THYAO')], ...o });
    assert.equal(r.ok, false); assert.equal(r.error, msg); assert.deepEqual(r.picks, []); assert.equal(r.totals, null);
    assert.ok(r.notes.includes('Yatırım tavsiyesi değildir.'));
  }
  assert.equal(plan().ok, false);
  const s = plan({ capital: '100000', horizon: '', candidates: [cand('THYAO')] });
  assert.equal(s.ok, true); assert.equal(s.capital, 100000); assert.equal(s.horizon, '1h', 'bos vade -> 1 hafta');
});

test('degismezler: rastgele adaylarda risk/pozisyon sinirlari, nakit, sektor tekilligi, her aday bir kez; girdi degismez', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const SECT = ['Banka', 'Enerji', 'Ulaştırma', 'Perakende', null];
  for (let it = 0; it < 150; it++) {
    const n = 1 + Math.floor(rnd() * 12), cs = [];
    for (let i = 0; i < n; i++) {
      const ref = 5 + rnd() * 600, lo = ref * (1 - rnd() * 0.02), stop = lo * (1 - 0.005 - rnd() * 0.08), t1 = ref + (ref - stop) * (0.8 + rnd() * 3);
      cs.push(cand('H' + String(i).padStart(3, '0'), { sector: SECT[Math.floor(rnd() * SECT.length)], price: rnd() < 0.2 ? null : ref * (0.97 + rnd() * 0.06),
        verdict: { label: rnd() < 0.8 ? 'AL' : 'BEKLE', score: Math.round(rnd() * 100), confidence: Math.round(rnd() * 100) },
        plan: { entry: [lo, ref], stop, t1, t2: t1 * 1.05, rr: rnd() < 0.5 ? null : (t1 - ref) / (ref - stop) },
        odds: rnd() < 0.3 ? null : { p1: rnd() * 80, breakEven: 20 + rnd() * 30, ev: rnd() * 2 - 0.5, n: 50 },
        ranges: rnd() < 0.3 ? null : { h5: { p16: ref * 0.95, p50: ref * (0.99 + rnd() * 0.03), p84: ref * 1.06 }, h20: { p16: ref * 0.9, p50: ref * 1.01, p84: ref * 1.12 } },
        liquidityTL: rnd() < 0.2 ? null : rnd() * 50e6 }));
    }
    const snap = JSON.stringify(cs);
    const capital = Math.round(500 + rnd() * 500000), maxPos = 1 + Math.floor(rnd() * 5), risk = ['temkinli', 'dengeli', 'atak'][Math.floor(rnd() * 3)];
    const commission = rnd() < 0.2 ? 0 : 0.2;
    const r = plan({ capital, risk, maxPos, commission, candidates: cs });
    assert.equal(r.ok, true);
    assert.equal(JSON.stringify(cs), snap, 'adaylar degismez');
    const budget = capital * RISK[risk] / 100;
    assert.ok(r.picks.length <= maxPos);
    assert.equal(r.picks.length + r.rejected.length, n, 'her aday bir kez');
    const secs = r.picks.map(p => p.sector && p.sector.toLocaleLowerCase('tr-TR')).filter(Boolean);
    if (maxPos >= 2) assert.equal(new Set(secs).size, secs.length, 'ayni sektor iki kez');
    let inv = 0;
    for (const p of r.picks) {
      assert.ok(p.lots >= 1 && Number.isInteger(p.lots));
      assert.ok(p.maxLossTL <= budget + 0.01, 'risk butcesi: ' + p.maxLossTL + ' > ' + budget);
      assert.ok(p.positionTL <= capital / maxPos + 0.01, 'pozisyon siniri');
      assert.ok(p.stop < p.entry[0] && p.t1 > p.ref && p.rr >= 1.5);
      if (p.p1 != null) assert.ok(p.expected && 'week' in p.expected);
      for (const h of ['week', 'month']) if (p.expected[h]) {
        assert.ok(p.expected[h].lo <= p.expected[h].mid && p.expected[h].mid <= p.expected[h].hi);
        assert.ok(p.expected[h].lo >= -p.maxLossTL - 0.01, 'kayip stopla sinirli');
      }
      inv += p.positionTL;
    }
    close(r.totals.invested, inv, 0.05); assert.ok(r.totals.cash >= -0.01); close(r.totals.invested + r.totals.cash, capital, 0.02);
    assert.equal(JSON.stringify(plan({ capital, risk, maxPos, commission, candidates: cs })), JSON.stringify(r), 'deterministik');
  }
});

test('cikti JSON\'a cevrilebilir ve sozlesme alanlarini tasir', () => {
  const r = plan({ capital: 250000, risk: 'dengeli', horizon: '1a', maxPos: 3, candidates: [cand('THYAO'), cand('GARAN', { sector: 'Banka' })] });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.deepEqual(Object.keys(r).sort(), ['capital', 'horizon', 'notes', 'ok', 'picks', 'rejected', 'riskPct', 'totals']);
  for (const k of ['symbol', 'name', 'sector', 'lots', 'entry', 'ref', 'stop', 't1', 't2', 'positionTL', 'maxLossTL', 'maxLossPct', 'p1', 'evTL', 'expected', 'reasons', 'warnings'])
    assert.ok(k in r.picks[0], 'pick alani: ' + k);
  assert.deepEqual(Object.keys(r.totals).sort(), ['cash', 'expMonth', 'expWeek', 'invested', 'maxLoss', 'maxLossPct', 'positions']);
  // esit puan ve R/O: kod sirasi (GARAN once)
  assert.deepEqual(r.picks.map(p => p.symbol), ['GARAN', 'THYAO']);
  assert.equal(r.picks.find(p => p.symbol === 'THYAO').name, 'THYAO A.Ş.'); assert.equal(r.picks[0].sector, 'Banka');
});
