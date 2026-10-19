'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../bp-fund.js');

const NOW = Date.UTC(2026, 9, 19, 9, 0, 0);
const DAY = 86400000;
// market.fundamentals() bicimi (yuzdeler %, debtToEquity oran)
const IND = () => ({ symbol: 'THYAO.IS', currency: 'TRY', financialCurrency: 'TRY', sector: 'Industrials', industry: 'Airlines', marketCap: 420e9,
  pe: 4.12, fwdPe: 3.8, pb: 0.95, ps: 0.55, evEbitda: 5.68, divYield: 3.45, payout: 12, roe: 25.12, roa: 8.1, grossMargin: 21, opMargin: 11.5, netMargin: 14.2,
  revenueGrowth: 38.5, earningsGrowth: -12, debtToEquity: 1.234, currentRatio: 1.15, beta: 1.234,
  target: { mean: 420.5, high: 520, low: 330, n: 14, rec: 'strong_buy' }, nextEarnings: NOW + 16 * DAY, at: NOW });
const BANK = () => ({ symbol: 'AKBNK.IS', currency: 'TRY', financialCurrency: 'TRY', sector: 'Financial Services', industry: 'Banks - Regional',
  pe: 4.5, pb: 0.85, roe: 35, roa: 3.1, revenueGrowth: 60, earningsGrowth: 20, target: { mean: 80, n: 12, rec: 'buy' } });
const run = (f, o = {}) => F.scoreFundamentals(f, { now: NOW, ...o });
const has = (arr, re) => arr.some(x => re.test(x));
const PILLARS = ['valuation', 'quality', 'growth', 'health'];

test('lin: parcali dogrusal egri, uclarda sabit; real: enflasyondan arindirma', () => {
  const c = [[0, -1], [10, 0], [20, 1]];
  assert.equal(F.lin(-5, c), -1); assert.equal(F.lin(0, c), -1); assert.equal(F.lin(5, c), -0.5); assert.equal(F.lin(15, c), 0.5); assert.equal(F.lin(99, c), 1);
  assert.equal(F.lin(null, c), null); assert.equal(F.lin(NaN, c), null); assert.equal(F.lin(5, []), null);
  assert.ok(Math.abs(F.real(38.5, 25) - 10.8) < 1e-9);
  assert.equal(F.real(25, 25), 0); assert.equal(F.real(null, 25), null);
  // her egri artan x ile tanimli ve puanlar -1..1
  const walk = o => { for (const v of Object.values(o)) if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { assert.ok(v[i][1] >= -1 && v[i][1] <= 1); if (i) assert.ok(v[i][0] > v[i - 1][0]); } } else walk(v); };
  walk(F.CURVES);
  for (const k of Object.values(F.KINDS)) { const s = o => Object.values(o).reduce((a, b) => a + b, 0); assert.ok(Math.abs(s(k.val) - 1) < 1e-9 && Math.abs(s(k.qual) - 1) < 1e-9, k.name); }
});

test('sanayi: ucuz carpanlar, guclu marj; satirlar sayilarla, nominal/reel buyume, hedef potansiyeli', () => {
  const r = run(IND(), { last: 310 });
  assert.equal(r.ok, true); assert.equal(r.kind, 'genel');
  assert.equal(r.valuation.label, 'Ucuz'); assert.ok(r.valuation.score > 0.5);
  assert.equal(r.quality.label, 'Güçlü');
  assert.ok(['Orta', 'Zayıf', 'Güçlü'].includes(r.growth.label));
  assert.equal(r.health.label, 'Orta');
  assert.ok(r.score >= -1 && r.score <= 1 && r.score > 0.2, String(r.score));
  assert.deepEqual(r.target, { mean: 420.5, upside: 35.6, realUpside: 8.5, n: 14, rec: 'strong_buy', label: 'Güçlü Al', high: 520, low: 330 });
  assert.ok(has(r.lines, /^Değerleme: Ucuz — F\/K 4,1 · İleri F\/K 3,8 · PD\/DD 0,95 · FD\/FAVÖK 5,7 · F\/S 0,55$/), r.lines[0]);
  assert.ok(has(r.lines, /satışlar \+%38,5 nominal → reel \+%10,8/));
  assert.ok(has(r.lines, /net kâr −%12,0 nominal → reel −%29,6/));
  assert.ok(has(r.lines, /enflasyon %25 varsayımı/));
  assert.ok(has(r.lines, /^Analist hedefi: 420,50 TL \(\+%35,6; reel ≈ \+%8,5\) · aralık 330,00–520,00 · 14 analist · Güçlü Al$/));
  assert.ok(has(r.lines, /Piyasa değeri 420,0 milyar TL · beta 1,23/));
  assert.ok(has(r.lines, /^Sonraki bilanço: .*2026 \(16 gün\)$/));
  assert.ok(has(r.flags, /Yüksek enflasyon: nominal TL/), 'enflasyon uyarisi');
  assert.ok(!has(r.flags, /Bilanço \d+ gün içinde/), '16 gun uzak');
  assert.deepEqual(r.assumptions, { inflation: 25, priceInflation: 25, coe: 33, region: 'tr' });
  assert.match(r.note, /Yatırım tavsiyesi değildir/);
});

test('pahali sanayi: yuksek carpanlar Pahali; enflasyon varsayimi buyume etiketini degistirir', () => {
  const f = { ...IND(), pe: 38, fwdPe: 30, pb: 8, ps: 6, evEbitda: 25 };
  const r = run(f, { last: 310 });
  assert.equal(r.valuation.label, 'Pahalı'); assert.ok(r.valuation.score <= -0.7);
  assert.ok(r.score < run(IND(), { last: 310 }).score);
  // %38,5 nominal satis: %10 enflasyonda guclu, %60 enflasyonda zayif (reel daralma)
  const g = { currency: 'TRY', revenueGrowth: 38.5, earningsGrowth: 38.5 };
  assert.equal(run(g, { inflation: 10 }).growth.label, 'Güçlü');
  assert.equal(run(g, { inflation: 60 }).growth.label, 'Zayıf');
  assert.equal(run(g, { inflation: 60 }).assumptions.inflation, 60);
});

test('banka: PD/DD ve ROE odakli; FD/FAVOK ve F/S yok sayilir; bilanco oranlari anlamsiz', () => {
  const r = run({ ...BANK(), evEbitda: 60, ps: 20, debtToEquity: 9, currentRatio: 0.2 }, { last: 60 });
  assert.equal(r.ok, true); assert.equal(r.kind, 'banka'); assert.equal(r.kindName, 'Banka');
  assert.equal(r.valuation.label, 'Ucuz');
  assert.deepEqual(r.valuation, run(BANK(), { last: 60 }).valuation, 'FD/FAVOK ve F/S bankada etkisiz');
  assert.equal(r.health.label, 'Belirsiz'); assert.equal(r.health.score, null);
  assert.ok(has(r.lines, /^Değerleme \(banka, PD\/DD odaklı\): Ucuz — PD\/DD 0,85 · hak edilen ≈ 1,06 \(ROE %35,0 \/ özkaynak maliyeti %33\) · F\/K 4,5$/), r.lines[0]);
  assert.ok(has(r.lines, /ROE %35,0 \(özkaynak maliyeti %33: \+2,0 puan\)/));
  assert.ok(has(r.lines, /bankacılıkta borç\/özkaynak ve cari oran anlamlı değil/));
  assert.ok(!has(r.flags, /Borç\/özkaynak yüksek|Cari oran/), 'banka icin borc uyarisi yok');
  // Ayni PD/DD: yuksek ROE'li banka daha ucuz, ROE < COE olan pahali + uyari
  const hi = run({ ...BANK(), pb: 1, roe: 45 }), lo = run({ ...BANK(), pb: 1, roe: 15 });
  assert.ok(hi.valuation.score > lo.valuation.score);
  assert.ok(has(lo.flags, /özkaynak maliyetinin \(%33\) altında/));
  assert.ok(lo.quality.score < hi.quality.score);
  // Ayni veriyi sanayi say: F/K 4,5 ile cok daha ucuz gorunurdu (bankada F/K ikincil)
  const asInd = run({ ...BANK(), pb: 1.6, roe: 30 }, { kind: 'genel' }), asBank = run({ ...BANK(), pb: 1.6, roe: 30 });
  assert.ok(asInd.valuation.score > asBank.valuation.score, asInd.valuation.score + ' > ' + asBank.valuation.score);
  // ozkaynak maliyeti elle verilebilir
  assert.equal(run(BANK(), { coe: 40 }).assumptions.coe, 40);
});

test('sektor turu: banka, sigorta, GYO, holding, diger finans, genel (Ingilizce ve Turkce)', () => {
  const k = (sector, industry) => F.kindOf({ sector, industry });
  assert.equal(k('Financial Services', 'Banks—Regional'), 'banka');
  assert.equal(k('Bankacılık', null), 'banka');
  assert.equal(k('Financial Services', 'Insurance - Diversified'), 'sigorta');
  assert.equal(k(null, 'Sigorta'), 'sigorta');
  assert.equal(k('Real Estate', 'REIT - Diversified'), 'gyo');
  assert.equal(k('Gayrimenkul Yatırım Ortaklığı', null), 'gyo');
  assert.equal(k('Industrials', 'Conglomerates'), 'holding');
  assert.equal(k('Financial Services', 'Credit Services'), 'finans');
  assert.equal(k('Financial Services', 'Capital Markets'), 'finans');
  assert.equal(k('Basic Materials', 'Steel'), 'genel');
  assert.equal(k(null, null), 'genel');
  const ins = run({ currency: 'TRY', sector: 'Financial Services', industry: 'Insurance - Property & Casualty', pb: 2, roe: 50, pe: 5, debtToEquity: 0.1 });
  assert.equal(ins.kind, 'sigorta'); assert.equal(ins.health.label, 'Belirsiz'); assert.match(ins.lines[0], /^Değerleme \(sigorta, PD\/DD odaklı\)/);
  const gyo = run({ currency: 'TRY', sector: 'Real Estate', industry: 'Real Estate - Development', pb: 0.45, pe: 2.1, evEbitda: 40, debtToEquity: 0.3, currentRatio: 2 });
  assert.equal(gyo.kind, 'gyo'); assert.equal(gyo.valuation.label, 'Ucuz', 'PD/DD 0,45 = NAD iskontosu; FD/FAVOK 40 etkisiz');
  assert.ok(has(gyo.flags, /F\/K çok düşük \(2,1\)/), 'GYO karinda degerleme kazanci olabilir');
  assert.ok(!has(gyo.lines, /FD\/FAVÖK/), 'GYO degerleme satirinda FD/FAVOK yok');
  // gecersiz kind (prototip anahtari) cokertmez
  assert.equal(run(IND(), { kind: 'toString' }).kind, 'genel');
  assert.equal(run(IND(), { kind: '__proto__' }).kind, 'genel');
});

test('zarar eden sirket, negatif FAVOK, cok dusuk F/K, baz etkisi ve bilanco uyarilari', () => {
  const loss = run({ currency: 'TRY', pe: -4, pb: 1, evEbitda: -3, netMargin: -6, opMargin: -2, debtToEquity: 2.6, currentRatio: 0.8, payout: 140, beta: 1.9 });
  assert.equal(loss.ok, true);
  assert.notEqual(loss.valuation.label, 'Ucuz');
  assert.ok(has(loss.flags, /zarar ediyor/)); assert.ok(has(loss.flags, /FAVÖK negatif/));
  assert.ok(has(loss.flags, /Borç\/özkaynak yüksek \(2,60\)/)); assert.ok(has(loss.flags, /Cari oran 1'in altında \(0,80\)/));
  assert.ok(has(loss.flags, /Dağıtım oranı %100 üstü \(%140\)/)); assert.ok(has(loss.flags, /Beta yüksek \(1,90\)/));
  assert.equal(loss.health.label, 'Zayıf');
  assert.ok(has(loss.lines, /F\/K — \(zarar\)/)); assert.ok(has(loss.lines, /FD\/FAVÖK — \(FAVÖK negatif\)/));
  // pe yok ama net marj negatif -> yine zarar
  assert.ok(has(run({ currency: 'TRY', netMargin: -3, pb: 1 }).flags, /zarar ediyor/));
  const cheap = run({ currency: 'TRY', pe: 2.1, pb: 0.8, earningsGrowth: 800, revenueGrowth: 30 });
  assert.ok(has(cheap.flags, /F\/K çok düşük \(2,1\): tek seferlik kazanç/));
  assert.ok(has(cheap.flags, /Kâr büyümesi aşırı \(\+%800\): düşük baz etkisi/));
  const neg = run({ currency: 'TRY', pe: 10, debtToEquity: -0.5 });
  assert.equal(neg.health.label, 'Zayıf'); assert.ok(has(neg.flags, /Özkaynak negatif/));
  const holding = run({ currency: 'TRY', sector: 'Industrials', industry: 'Conglomerates', pb: 0.6, pe: 6, debtToEquity: 3.5 });
  assert.ok(has(holding.flags, /holding konsolide/));
  // ROE enflasyonun altinda (TL, sanayi)
  assert.ok(has(run({ currency: 'TRY', roe: 12, pe: 10 }).flags, /ROE \(%12,0\) enflasyon varsayımının \(%25\) altında/));
});

test('analist hedefi: az analist, fiyat yok, uzak/supheli hedef puana katilmaz', () => {
  const base = { currency: 'TRY', pe: 8, pb: 1.2 };
  const few = run({ ...base, target: { mean: 130, n: 2, rec: 'buy' } }, { last: 100 });
  assert.equal(few.target.upside, 30); assert.equal(few.target.n, 2); assert.equal(few.target.label, 'Al');
  assert.ok(has(few.flags, /Az analist \(2\)/));
  const many = run({ ...base, target: { mean: 160, n: 9, rec: 'buy' } }, { last: 100 }), none = run(base, { last: 100 });
  assert.ok(many.score > none.score, 'yuksek reel potansiyel puani artirir');
  assert.equal(few.score, none.score, 'az analist puana katilmadi');
  const nolast = run({ ...base, target: { mean: 130, n: 8, rec: 'hold' } });
  assert.equal(nolast.target.upside, null); assert.equal(nolast.target.realUpside, null); assert.equal(nolast.target.label, 'Tut');
  assert.ok(has(nolast.lines, /^Analist hedefi: 130,00 TL · 8 analist · Tut$/));
  const far = run({ ...base, target: { mean: 400, n: 10, rec: 'buy' } }, { last: 100 });
  assert.ok(has(far.flags, /fiyattan çok uzak \(\+%300,0\).*bedelsiz/)); assert.equal(far.score, none.score);
  // bilinmeyen/prototip rec etiketi
  const odd = run({ ...base, target: { mean: 110, n: 5, rec: 'constructor' } }, { last: 100 });
  assert.equal(odd.target.rec, null); assert.equal(odd.target.label, null);
  // %30 nominal potansiyel %25 enflasyonda reel ~ %4
  assert.equal(run({ ...base, target: { mean: 130, n: 5 } }, { last: 100 }).target.realUpside, 4);
});

test('TL disi (ABD): gelismis piyasa egrileri, %3 enflasyon; doviz uyumsuzlugu uyarisi', () => {
  const us = { symbol: 'AAPL', currency: 'USD', financialCurrency: 'USD', sector: 'Technology', pe: 18, fwdPe: 16, pb: 3, evEbitda: 13, ps: 3,
    roe: 25, revenueGrowth: 8, earningsGrowth: 10 };
  const r = run(us);
  assert.equal(r.assumptions.region, 'dev'); assert.equal(r.assumptions.inflation, 3);
  assert.equal(r.valuation.label, 'Makul', 'F/K 18 ABD icin notr');
  assert.equal(run({ ...us, currency: 'TRY', financialCurrency: 'TRY', symbol: 'X.IS' }).valuation.label, 'Pahalı', 'ayni carpanlar BIST icin pahali');
  assert.ok(has(r.lines, /Büyüme \(reel, USD enflasyon %3 varsayımı\)/));
  assert.ok(!has(r.flags, /Yüksek enflasyon/));
  const mix = run({ currency: 'TRY', financialCurrency: 'USD', pe: 8, revenueGrowth: 10 });
  assert.ok(has(mix.flags, /Finansal tablolar USD, fiyat TRY/));
  assert.equal(mix.assumptions.inflation, 3, 'USD tablolar TL enflasyonuyla arindirilmaz');
  assert.equal(mix.assumptions.priceInflation, 25);
});

test('supheli degerler yok sayilir; eski veri, yakin bilanco ve sinirli veri uyarilari', () => {
  const r = run({ currency: 'TRY', pe: 0.02, pb: 4500, roe: 900, revenueGrowth: 12, divYield: 80, nextEarnings: NOW + 2 * DAY, stale: true });
  assert.ok(has(r.flags, /Şüpheli değer yok sayıldı: F\/K 0,02, PD\/DD 4\.500,00, ROE %900,0, temettü verimi %80,0\./), r.flags.join(' | '));
  assert.ok(has(r.flags, /eski veri/)); assert.ok(has(r.flags, /Bilanço 2 gün içinde/)); assert.ok(has(r.flags, /Temel veri sınırlı/));
  assert.equal(r.valuation.label, 'Belirsiz'); assert.equal(r.valuation.score, null);
  assert.equal(r.ok, true, 'buyume var');
  assert.ok(has(r.lines, /^Sonraki bilanço: .* \(2 gün\)$/));
  // kapsam kucultmesi: ayni olumlu puan az veriyle daha temkinli
  const full = run({ currency: 'TRY', pe: 5, pb: 0.8, evEbitda: 4, roe: 30, opMargin: 15, netMargin: 12, revenueGrowth: 50, earningsGrowth: 50, debtToEquity: 0.3, currentRatio: 2 });
  const thin = run({ currency: 'TRY', pe: 5, pb: 0.8, evEbitda: 4 });
  assert.ok(thin.coverage < full.coverage && thin.score < thin.valuation.score);
  // tum degerler supheli -> ok:false ama cokmeden uyari doner
  const allBad = run({ currency: 'TRY', pe: 0.5, pb: 999 });
  assert.equal(allBad.ok, false); assert.equal(allBad.error, 'Yeterli temel veri yok.'); assert.ok(has(allBad.flags, /Şüpheli/));
});

test('bos/garip girdiler cokmez; sekil hep ayni; puan -1..1 (rastgele bulanik test)', () => {
  for (const bad of [null, undefined, 0, 'x', [], {}, { pe: 'abc' }, { target: 'x' }, { target: { mean: -5 } }, { sector: 42, industry: {} }, { nextEarnings: 'yarin' }]) {
    const r = F.scoreFundamentals(bad, bad && bad.opts);
    assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(typeof r.error, 'string');
    for (const k of PILLARS) assert.deepEqual(r[k], { label: 'Belirsiz', score: null });
    assert.ok(Array.isArray(r.lines) && Array.isArray(r.flags));
  }
  assert.equal(F.scoreFundamentals(IND(), null).ok, true, 'opts null');
  assert.equal(F.scoreFundamentals(IND(), 'x').ok, true, 'opts metin');
  assert.equal(run({ currency: 'TRY', pe: '8.5', pb: '1.1' }).valuation.score != null, true, 'sayisal metin kabul');
  // bulanik test: rastgele (null, negatif, dev, NaN, Infinity) degerler
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = () => { const u = rnd(); return u < 0.15 ? null : u < 0.2 ? NaN : u < 0.23 ? Infinity : u < 0.3 ? -rnd() * 50 : u < 0.35 ? rnd() * 1e6 : rnd() * 60; };
  const keys = ['pe', 'fwdPe', 'pb', 'ps', 'evEbitda', 'divYield', 'payout', 'roe', 'roa', 'grossMargin', 'opMargin', 'netMargin', 'revenueGrowth', 'earningsGrowth', 'debtToEquity', 'currentRatio', 'beta', 'marketCap'];
  const sectors = [['Financial Services', 'Banks - Regional'], ['Industrials', 'Airlines'], ['Real Estate', 'REIT'], ['Financial Services', 'Insurance'], [null, null], ['Industrials', 'Conglomerates'], ['Financial Services', 'Credit Services']];
  for (let i = 0; i < 400; i++) {
    const f = { currency: rnd() < 0.8 ? 'TRY' : 'USD', financialCurrency: rnd() < 0.9 ? null : 'USD' };
    for (const k of keys) f[k] = pick();
    [f.sector, f.industry] = sectors[i % sectors.length];
    if (rnd() < 0.6) f.target = { mean: pick(), n: rnd() < 0.8 ? Math.floor(rnd() * 20) : null, rec: ['buy', 'hold', 'sell', 'none', null][i % 5], high: pick(), low: pick() };
    if (rnd() < 0.3) f.nextEarnings = NOW + (rnd() - 0.3) * 60 * DAY;
    const r = run(f, { last: rnd() < 0.8 ? rnd() * 500 : null, inflation: rnd() < 0.2 ? rnd() * 80 : undefined });
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) { assert.ok(r.score >= -1 && r.score <= 1, String(r.score)); for (const k of PILLARS) assert.ok(r[k].score === null || (r[k].score >= -1 && r[k].score <= 1)); }
    for (const l of [...r.lines, ...r.flags]) { assert.equal(typeof l, 'string'); assert.ok(!/NaN|undefined|Infinity|null|\[object/.test(l), l); }
  }
});
