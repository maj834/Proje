// bp-quant.js bagimsiz dogrulama: ileriye bakma yok (onek / mutasyon), el hesabi ornekler, kenar durumlar, rapor metni, performans.
// Ag yok: tum veri deterministik uretilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../bp-quant.js');
const E = require('../engine.js');
const U = Q._util;

const DAY = 86400000;
// Deterministik fiyat serisi (LCG + yaklasik normal); hafta sonu atlanir. Rejim degisimi icin drift parcali.
function gen(n, { seed = 7, drift = 0.0004, vol = 0.018, t0 = Date.UTC(2016, 0, 4, 7), p0 = 50, vbase = 1e6 } = {}) {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const g = () => { let u = 0; for (let k = 0; k < 12; k++) u += rnd(); return u - 6; };
  const out = []; let p = p0, t = t0;
  for (let i = 0; i < n; i++) {
    const d = Array.isArray(drift) ? drift[Math.floor(i / (n / drift.length))] : drift;
    const r = d + vol * g(), o = p, c = p * Math.exp(r), h = Math.max(o, c) * (1 + Math.abs(g()) * 0.004), l = Math.min(o, c) * (1 - Math.abs(g()) * 0.004);
    out.push({ t, o, h, l, c, v: vbase * (1 + 0.3 * Math.abs(g())) }); p = c; t += DAY;
    const wd = new Date(t).getUTCDay(); if (wd === 6) t += 2 * DAY; if (wd === 0) t += DAY;
  }
  return out;
}
const flat = (cs, t0 = Date.UTC(2020, 0, 1)) => cs.map((c, i) => ({ t: t0 + i * DAY, o: c, h: c, l: c, c, v: 1000 }));
const near = (a, b, eps = 1e-9, m) => assert.ok(Math.abs(a - b) <= eps, (m || '') + ' ' + a + ' != ' + b);

const ROWS = gen(1500, { drift: [0.002, -0.0015, 0.0008, -0.001, 0.0015] });
const BENCH = gen(1500, { seed: 99, drift: 0.0003, vol: 0.012 });
const textOk = s => { assert.equal(typeof s, 'string'); for (const bad of ['NaN', 'undefined', 'null', '[object', 'Infinity']) assert.ok(!s.includes(bad), 'metinde ' + bad + ': ' + s); };

// ---------- istatistik yardimcilari (el hesabi) ----------
test('neff: ortusme duzeltmeli etkin n (el hesabi)', () => {
  assert.equal(U.neff([], 5), 0);
  near(U.neff([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5), 1 + 9 / 5);  // 10 ardisik gun, h=5 -> 2,8
  near(U.neff([0, 5, 10], 5), 3);                               // aralar >= h: bagimsiz
  near(U.neff([0, 1], 5), 1.2);                                 // ayni pencerede iki gun
  near(U.neff([0, 1, 20, 40, 41, 42], 5), 1.2 + 1 + 1.4);
  near(U.neff([3, 7], 1), 2);                                   // h=1: her gun bagimsiz
  // Surekli L gunluk seride ~ L/h
  const L = Array.from({ length: 1000 }, (_, i) => i); near(U.neff(L, 20), 1 + 999 / 20);
});
test('wilson ve buzulme (el hesabi)', () => {
  const w = U.wilson(0.5, 100); near(w[0], 0.4038, 1e-4); near(w[1], 0.5962, 1e-4);
  assert.equal(U.wilson(0.5, 0), null); assert.equal(U.wilson(NaN, 10), null);
  const w0 = U.wilson(0, 10); assert.equal(w0[0], 0); assert.ok(w0[1] > 0.2 && w0[1] < 0.35);   // %0 isabette bile ust sinir genis
  near(U.shrink(0.8, 10, 0.5, 30), (8 + 15) / 40);
  near(U.shrink(0.8, 0, 0.5), 0.5); near(U.shrink(NaN, 50, 0.42), 0.42);
  near(U.shrinkN(4, 2, 0, 2), 2);   // tau = se -> yari yola
  near(U.shrinkN(4, 0, 0, 2), 4); assert.equal(U.shrinkN(NaN, 1, 0, 1), null);
});

// ---------- karne: el hesabi ----------
test('karne: el hesabi kucuk ornek (enjekte skor serisi, h=5)', () => {
  const N = 130, c = new Array(N).fill(100); c[65] = 110; c[66] = 90; c[85] = 95; c[106] = 101;
  const rows = flat(c), S = new Array(N).fill(null);
  for (let i = 50; i < N; i++) S[i] = 0;
  S[60] = 0.5; S[61] = 0.4; S[100] = 0.35;   // AL (esik dahil)
  S[80] = -0.5; S[101] = -0.35;              // SAT (esik dahil)
  S[127] = 0.9;                               // sonucu belli degil (127+5 >= 130): sayilmaz
  S[129] = 0.1;
  const k = Q.karne(rows, { horizons: [5], recent: 40 }, S), h = k.horizons[0];
  assert.equal(k.bars, N); assert.equal(h.h, 5); assert.equal(h.gun, 75);  // i = 50..124
  // AL: 60 -> 65 +%10 (dogru), 61 -> 66 -%10 (yanlis), 100 -> 105 %0 (yanlis: yukselmedi)
  assert.equal(h.al.n, 3); assert.equal(h.al.isabet, 33.3); assert.equal(h.al.ortGetiri, 0); near(h.al.neff, 2.2, 1e-9);
  // SAT: 80 -> 85 -%5 (dogru), 101 -> 106 +%1 (yanlis); ort (-5+1)/2
  assert.equal(h.sat.n, 2); assert.equal(h.sat.isabet, 50); assert.equal(h.sat.ortGetiri, -2); assert.equal(h.sat.neff, 2);
  // Taban: 75 gunden 4 yukselis (60,66,85,101), 4 dusus (61,65,80,106)
  assert.equal(h.al.baz, 5.3); assert.equal(h.sat.baz, 5.3); assert.equal(h.al.fark, 28);
  // Genel: 2/5; etkin n birlesik gunlerden {60,61}=1,2 + {80}=1 + {100,101}=1,2 = 3,4 (AL+SAT toplami degil)
  assert.equal(h.n, 5); assert.equal(h.genel.n, 5); assert.equal(h.genel.isabet, 40); near(h.genel.neff, 3.4, 1e-9);
  assert.equal(h.genel.baz, 5.3); assert.equal(h.genel.fark, 34.7);
  const ci = U.wilson(0.4, 3.4); assert.equal(h.genel.lo, Math.round(ci[0] * 1000) / 10); assert.equal(h.genel.hi, Math.round(ci[1] * 1000) / 10);
  // Son donem (recent=40 -> i >= 90): yalniz 100 (AL) ve 101 (SAT)
  assert.equal(h.son250.n, 2); assert.equal(h.son250.al.n, 1); assert.equal(h.son250.al.isabet, 0); assert.equal(h.son250.sat.n, 1); assert.equal(h.son250.sat.isabet, 0);
  assert.equal(k.now.score, 0.1); assert.equal(k.now.sinyal, null);
  // Ic alanlar sizmasin
  assert.ok(!('_hit' in h.al) && !('_ne' in h.sat));
});
test('karne: varsayilan ufuklar 5/10/20, sinyal yoksa null alanlar, kisa seri null', () => {
  assert.equal(Q.karne([]), null); assert.equal(Q.karne(ROWS.slice(0, 119)), null); assert.equal(Q.karne(null), null);
  const k = Q.karne(ROWS); assert.deepEqual(k.horizons.map(h => h.h), [5, 10, 20]); assert.equal(k.th, 0.35);
  for (const h of k.horizons) {
    for (const s of [h.al, h.sat, h.genel, h.son250.al, h.son250.genel]) {
      if (s.n) { assert.ok(s.isabet >= 0 && s.isabet <= 100); assert.ok(s.lo <= s.isabet + 0.1 && s.hi >= s.isabet - 0.1); assert.ok(s.neff > 0 && s.neff <= s.n + 1e-9); }
    }
    assert.equal(h.genel.n, h.al.n + h.sat.n);
    assert.ok(h.genel.neff <= h.al.neff + h.sat.neff + 0.11, 'birlesik etkin n toplamdan buyuk olamaz');
    assert.ok(h.genel.neff <= 1 + (h.gun - 1) / h.h + 0.11, 'etkin n gun/h ust sinirini asamaz');
    assert.ok(h.son250.gun <= 250 && h.son250.n <= h.n);
  }
  const N = 130, S = new Array(N).fill(0); const z = Q.karne(flat(new Array(N).fill(100)), { horizons: [5] }, S).horizons[0];
  assert.equal(z.n, 0); assert.equal(z.al.isabet, null); assert.equal(z.genel.isabet, null); assert.equal(z.al.neff, 0);
});
test('karne: brute force ile ayni (skor serisi + kapanislar), onekte de', () => {
  const S = Q.scoreSeries(ROWS), c = ROWS.map(r => r.c);
  for (const M of [400, 900, ROWS.length]) {
    const k = Q.karne(ROWS.slice(0, M));
    for (const h of k.horizons) {
      let al = 0, alHit = 0, sat = 0, satHit = 0;
      for (let i = 50; i + h.h < M; i++) {
        if (S[i] == null) continue; const r = c[i + h.h] / c[i] - 1;
        if (S[i] >= 0.35) { al++; if (r > 0) alHit++; } else if (S[i] <= -0.35) { sat++; if (r < 0) satHit++; }
      }
      assert.equal(h.al.n, al, 'M=' + M + ' h=' + h.h); assert.equal(h.sat.n, sat);
      if (al) assert.equal(h.al.isabet, Math.round(alHit / al * 1000) / 10);
      if (sat) assert.equal(h.sat.isabet, Math.round(satHit / sat * 1000) / 10);
    }
  }
});

// ---------- ileriye bakma yok ----------
test('scoreSeries nedensel: her gunun skoru yalniz o gune kadarki mumlarla ayni', () => {
  const S = Q.scoreSeries(ROWS);
  for (const i of [50, 51, 120, 199, 200, 201, 640, 1100, ROWS.length - 1]) {
    const P = Q.scoreSeries(ROWS.slice(0, i + 1)); assert.equal(P[i], S[i], 'i=' + i);
  }
  for (let i = 0; i < 50; i++) assert.equal(S[i], null);
});
test('mutasyon: son mum degisince sinyal siniflamasi (AL/SAT sayilari) degismez; yalniz sonuc okunur', () => {
  const a = Q.karne(ROWS), mut = ROWS.map((r, i) => i === ROWS.length - 1 ? { ...r, c: r.c * 1.6, h: r.h * 1.6 } : r), b = Q.karne(mut);
  for (let j = 0; j < a.horizons.length; j++) {
    assert.equal(a.horizons[j].al.n, b.horizons[j].al.n); assert.equal(a.horizons[j].sat.n, b.horizons[j].sat.n); assert.equal(a.horizons[j].gun, b.horizons[j].gun);
  }
  // Gecmisteki bir gunu degistirmek ancak o gunden sonraki skorlari etkiler
  const k = 700, m2 = ROWS.map((r, i) => i === k ? { ...r, c: r.c * 1.3, h: r.h * 1.3 } : r), S1 = Q.scoreSeries(ROWS), S2 = Q.scoreSeries(m2);
  for (let i = 0; i < k; i++) assert.equal(S1[i], S2[i], 'i=' + i);
});
test('sansur: benzer skor calismasinda her ufkun n degeri ayni (sonucu belli olmayan gun yok)', () => {
  const s = Q.scoreStudy(ROWS); assert.ok(s && s.n >= 10);
  for (const h of s.horizons) {
    assert.equal(h.n, s.n);
    assert.ok(h.neff > 0 && h.neff <= h.n);
    // Buzulme: fark ham farktan buyuk olamaz; buzulmus oran ham oran ile taban arasinda
    if (h.edge != null) assert.ok(Math.abs(h.edgeShr) <= Math.abs(h.edge) + 0.011);
    const p0 = h.baseWinReg != null ? h.baseWinReg : h.baseWin;
    assert.ok(h.winShr >= Math.min(h.win, p0) - 0.11 && h.winShr <= Math.max(h.win, p0) + 0.11, JSON.stringify(h));
  }
  const u = Q.setupStudy(ROWS); if (u) for (const h of u.horizons) assert.equal(h.n, u.n);
});
test('plan olasiligi: yalniz tam gozlenen pencereler sayilir; buzulmus oran basabasa dogru', () => {
  const N = ROWS.length, last = ROWS[N - 1].c, atr = E.atrS(ROWS, 14)[N - 1];
  const plan = { dir: 1, entry: [last * 0.99, last], stop: last - 1.5 * atr, t1: last + 3 * atr, t2: last + 5 * atr };
  const o = Q.planOdds(ROWS, plan, { minN: 1e9 });
  assert.equal(o.cond, 'tum'); assert.equal(o.n, N - 60);        // i = 20 .. N-41
  near(o.p1 + o.pStop + o.pNone, 100, 0.2);
  assert.equal(o.breakEven, Math.round(1 / (1 + 2) * 1000) / 10); assert.equal(o.rr, 2);
  const be = 1.5 / (1.5 + 3) * 100, raw = o.p1 / (o.p1 + o.pStop) * 100, adj = o.p1Adj / (o.p1Adj + o.pStopAdj) * 100;
  assert.ok(adj >= Math.min(raw, be) - 0.2 && adj <= Math.max(raw, be) + 0.2);
  // Son 40 mum degisse de sayilan gun sayisi ayni
  const mut = ROWS.map((r, i) => i > N - 40 && i < N - 1 ? { ...r, c: r.c * 0.7, l: r.l * 0.7, o: r.o * 0.7 } : r);
  assert.equal(Q.planOdds(mut, plan, { minN: 1e9 }).n, o.n);
  assert.equal(Q.planOdds(ROWS, { ...plan, wait: true }), null); assert.equal(Q.planOdds(ROWS.slice(0, 100), plan), null);
});

// ---------- kalibre guven (el hesabi) ----------
test('calibrate: benzer skor ve karne etkin n agirlikli, taban orana buzulur', () => {
  const score = { horizons: [{ h: 20, win: 60, n: 100, neff: 20, baseWinReg: 50, baseWin: 52 }] };
  const kr = { horizons: [{ h: 20, al: { n: 50, isabet: 70, neff: 10, baz: 50 }, sat: { n: 5, isabet: 90, neff: 2 } }], now: { sinyal: 'AL' } };
  // benzer: (0,6*20+0,5*30)/50 = 0,54; karne: (0,7*10+0,5*30)/40 = 0,55; harman (0,54*20+0,55*10)/30
  let c = Q.calibrate({ dir: 1, score, karne: kr }); near(c.p, 0.5433, 1e-4); assert.equal(c.base, 0.5); assert.equal(c.method, 'beta-harman');
  assert.deepEqual(c.inputs.map(x => x.kaynak), ['benzerSkor', 'karne']); assert.equal(c.inputs[1].buzulmus, 55); assert.equal(c.neff, 20);
  // Bugun sistem AL demiyorsa karne yari agirlik: (0,7*5+15)/35 = 0,52857
  c = Q.calibrate({ dir: 1, score, karne: { ...kr, now: { sinyal: null } } }); near(c.p, (0.54 * 20 + (18.5 / 35) * 5) / 25, 1e-4); assert.equal(c.inputs[1].agirlik, 0.5);
  // Sat yonu: karne SAT satiri n < 10 -> kullanilmaz; olasilik = 1 - P(yukselis)
  c = Q.calibrate({ dir: -1, score, karne: kr }); near(c.p, 0.46, 1e-4); assert.equal(c.inputs.length, 1);
  // Tut: yon iddiasi yok, daha olasi yon
  c = Q.calibrate({ dir: 0, score, karne: kr }); near(c.p, 0.54, 1e-4);
  assert.equal(Q.calibrate({ dir: 1 }), null); assert.equal(Q.calibrate(), null);
  // Cok kucuk etkin n: taban orandan neredeyse ayrilmaz (uc deger guveni sisirmez)
  c = Q.calibrate({ dir: 1, score: { horizons: [{ h: 20, win: 100, n: 12, neff: 1.5, baseWin: 45 }] } }); assert.ok(c.p < 0.48, String(c.p));
});

// ---------- analist notu ----------
const PRO = (score, wdir, extra) => ({ ok: true, tf: '1g', last: 100, verdict: { score, label: score > 0 ? 'AL' : score < 0 ? 'SAT' : 'BEKLE', dir: Math.sign(score) },
  trend: wdir == null ? { frames: {} } : { frames: { '1h': { dir: wdir } } }, ...extra });
test('rating: Guclu Al icin haftalik trend sart', () => {
  let r = Q.rating({ pro: PRO(80, 1) }); assert.equal(r.label, 'Güçlü Al'); assert.equal(r.idx, 4); assert.equal(r.weekly.src, 'haftalık');
  assert.deepEqual(r.warnings, []);
  r = Q.rating({ pro: PRO(80, -1) }); assert.equal(r.label, 'Al'); assert.ok(r.warnings.some(w => /Haftalık trend yükselişte değil/.test(w)));
  r = Q.rating({ pro: PRO(80, null) }); assert.equal(r.label, 'Al'); assert.ok(r.warnings.some(w => /doğrulanamadı/.test(w)));
  r = Q.rating({ pro: PRO(80, null), weekly: { dir: 1 } }); assert.equal(r.label, 'Güçlü Al'); assert.equal(r.weekly.src, 'günlükten');
  r = Q.rating({ pro: PRO(-80, 1) }); assert.equal(r.label, 'Azalt');
  r = Q.rating({ pro: PRO(-80, -1) }); assert.equal(r.label, 'Sat');
  // Gecmis yoksa sezgisel guven en fazla %65 ve acikca isaretli
  r = Q.rating({ pro: PRO(80, 1) }); assert.equal(r.calibration.method, 'sezgisel'); assert.ok(r.confidence <= 65); assert.equal(r.confidence, 65);
  assert.equal(Q.rating({ pro: { ok: false } }), null); assert.equal(Q.rating({}), null); assert.equal(Q.rating(), null);
});
test('rating: dusuk karne isabetinde teknik agirlik azalir (n >= 40, buzulmus)', () => {
  const reg = { dir: -1, label: 'Riskten kaçış' }, kr = n => ({ horizons: [{ h: 20, genel: { n, isabet: 40, neff: 30 } }] });
  let r = Q.rating({ pro: PRO(80, 1), reg }); assert.equal(r.label, 'Güçlü Al'); assert.equal(r.adaptive, null); near(r.score, (0.32 - 0.08) / 0.5, 0.006);
  // p* = (0,4*30+0,5*30)/60 = 0,45 -> f = 1 - (50-45)/20 = 0,75: teknik 0,3, tablo 0,06
  r = Q.rating({ pro: PRO(80, 1), reg, karne: kr(100), tech: { overall: { score: 0.5, label: 'Güçlü Al' } } });
  assert.equal(r.adaptive.factor, 0.75); assert.equal(r.components.find(c => c.key === 'teknik').w, 0.3); assert.equal(r.components.find(c => c.key === 'tablo').w, 0.06);
  assert.ok(r.warnings.some(w => /isabeti düşük/.test(w))); assert.ok(r.drivers.some(d => /ağırlık ×0,75/.test(d.text)));
  r = Q.rating({ pro: PRO(80, 1), reg, karne: kr(100) }); near(r.score, (0.24 - 0.08) / 0.4, 0.006); assert.equal(r.label, 'Al');
  // n < 40 ya da isabet >= 50: dokunma; f en az 0,5
  assert.equal(Q.rating({ pro: PRO(80, 1), karne: kr(39) }).adaptive, null);
  assert.equal(Q.rating({ pro: PRO(80, 1), karne: { horizons: [{ h: 20, genel: { n: 400, isabet: 55, neff: 50 } }] } }).adaptive, null);
  assert.equal(Q.rating({ pro: PRO(80, 1), karne: { horizons: [{ h: 20, genel: { n: 4000, isabet: 5, neff: 1e6 } }] } }).adaptive.factor, 0.5);
});
test('rating: likidite ve olay uyarilari', () => {
  const now = Date.UTC(2026, 9, 20, 9);   // Istanbul 12:00, 20 Ekim
  let r = Q.rating({ pro: PRO(30, 1), liquidityTL: 4e6, now }); assert.ok(r.warnings.some(w => /Düşük likidite.*4,0 milyon TL/.test(w)));
  r = Q.rating({ pro: PRO(30, 1), liquidityTL: 3e5, now }); assert.ok(r.warnings.some(w => /300 bin TL/.test(w)));
  for (const l of [5e6, 2e8, null, NaN]) assert.ok(!Q.rating({ pro: PRO(30, 1), liquidityTL: l, now }).warnings.some(w => /likidite/.test(w)), String(l));
  const events = [{ day: '2026-10-22', kind: 'bilanco' }, { day: '2026-10-21', kind: 'Bilanço' }, { day: '2026-10-27', kind: 'Temettü' },
    { day: '2026-10-28', kind: 'genel kurul' }, { day: '2026-10-19', kind: 'bilanço' }, { day: '2026-10-20', title: 'Olağan Genel Kurul Toplantısı' },
    { day: '2026-10-21', kind: 'diger' }, null, { day: 'gecersiz', kind: 'bilanco' }];
  r = Q.rating({ pro: PRO(30, 1), events, now });
  assert.deepEqual(r.events.map(e => [e.kind, e.days]), [['genelKurul', 0], ['bilanco', 1], ['temettu', 7]]);
  assert.ok(r.warnings.some(w => /^Genel kurul bugün/.test(w))); assert.ok(r.warnings.some(w => /^Bilanço yarın \(21\.10\.2026\)/.test(w)));
  assert.ok(r.warnings.some(w => /^Temettü 7 gün sonra/.test(w)));
  // Gece yarisi siniri Istanbul saatine gore: 20 Ekim 22:00 UTC = 21 Ekim 01:00 Istanbul
  assert.deepEqual(U.upcoming([{ day: '2026-10-21', kind: 'bilanco' }], Date.UTC(2026, 9, 20, 22)).map(e => e.days), [0]);
  assert.deepEqual(U.upcoming('x', now), []); assert.deepEqual(Q.rating({ pro: PRO(30, 1), now }).events, []);
});
test('rating: Hisse Radar kucuk agirlikli bilesen, isabetine gore', () => {
  let r = Q.rating({ pro: PRO(80, 1), radar: { karar: 'SAT', skor: -0.8, guven: 70, agirlik: 'isabet', uyum: 0.5 } });
  const rc = r.components.find(c => c.key === 'radar'); near(rc.w, 0.1 * 0.6 * 0.7, 1e-4);   // guven uyumu zaten icerir: tekrar carpilmaz
  assert.ok(r.warnings.some(w => /konsensüsü SAT; analist notuyla çelişiyor/.test(w)));
  // Olculmus isabet %45 (n=100) -> buzulmus < %50 -> katki yok, celiski uyarisi da yok
  r = Q.rating({ pro: PRO(80, 1), radar: { karar: 'SAT', skor: -0.8, guven: 70, isabet: { n: 100, oran: 45 } } });
  assert.ok(!r.components.some(c => c.key === 'radar')); assert.ok(!r.warnings.some(w => /çelişiyor/.test(w)));
  // %62, n=200 -> tam guvenilirlik: 0,1 * 0,7
  near(U.radarPart({ karar: 'AL', skor: 0.6, guven: 70, isabet: { n: 200, oran: 62 } }).w, 0.07, 1e-9);
  // Tum RadarSym: karari veren olculmus modellerin isabeti (n >= 20)
  const rp = U.radarPart({ consensus: { karar: 'AL', skor: 0.6, guven: 50 }, models: [{ karar: 'AL', isabet: { n: 40, oran: 70 } }, { karar: 'AL', isabet: { n: 10, oran: 90 } }, { karar: 'SAT', isabet: { n: 100, oran: 20 } }] });
  assert.equal(rp.src, 'isabet'); near(rp.w, 0.05, 1e-9);
  // Agirlik hicbir girdide 0,1'i asmaz; gecersiz girdi null
  for (const x of [{ karar: 'AL', skor: 9, guven: 500, isabet: { n: 1e6, oran: 99 } }, { karar: 'al' }, { karar: 'TUT', skor: 0 }]) { const p = U.radarPart(x); assert.ok(p && p.w <= 0.1 + 1e-12 && Math.abs(p.v) <= 1); }
  for (const x of [null, 5, {}, { karar: 'BELKI' }]) assert.equal(U.radarPart(x), null);
  // Radar kalibre guvene girmez
  const a = Q.rating({ pro: PRO(80, 1) }), b = Q.rating({ pro: PRO(80, 1), radar: { karar: 'AL', skor: 1, guven: 100 } });
  assert.equal(a.calibration.method, b.calibration.method);
});

// ---------- analyze butunlesik ----------
const PROF = rows => E.proAnalyze({ '1g': rows.slice(-400) }, { primary: '1g' });
test('analyze: geri uyumlu alanlar + yeni girdiler (liquidityTL, events, radar)', () => {
  const pro = PROF(ROWS), now = ROWS.at(-1).t, day = new Date(now + 3 * 3600000 + 2 * DAY).toISOString().slice(0, 10);
  const a = Q.analyze({ rows: ROWS.slice(-400), daily: ROWS.slice(-400), hist: ROWS, pro, bench: BENCH, now, liquidityTL: 2e6, events: [{ day, kind: 'bilanco' }], radar: { karar: 'AL', skor: 0.6, guven: 60, agirlik: 'isabet' } });
  for (const k of ['score', 'setup', 'odds', 'ranges', 'seasonality', 'tech', 'regime', 'rating', 'histN', 'histFrom', 'karne']) assert.ok(k in a, k);
  assert.equal(a.histN, ROWS.length);
  const R = a.rating;
  for (const k of ['label', 'idx', 'score', 'confidence', 'target', 'drivers']) assert.ok(k in R, k);
  assert.ok(Q.NOTES.includes(R.label)); assert.equal(Q.NOTES[R.idx], R.label);
  assert.ok(Number.isInteger(R.confidence) && R.confidence >= 0 && R.confidence <= 100);
  for (const k of ['base', 'low', 'high', 'low90', 'high90', 'upside', 'h']) assert.ok(Number.isFinite(R.target[k]), k);
  assert.ok(R.target.low90 <= R.target.low && R.target.low <= R.target.base && R.target.base <= R.target.high && R.target.high <= R.target.high90);
  for (const d of R.drivers) { textOk(d.text); assert.ok([-1, 0, 1].includes(d.dir)); }
  assert.ok(R.warnings.some(w => /likidite/.test(w))); assert.ok(R.warnings.some(w => /^Bilanço 2 gün sonra/.test(w)));
  assert.ok(R.components.some(c => c.key === 'radar')); near(R.components.reduce((s, c) => s + c.pay, 0), 100, 0.6);
  if (R.calibration.method === 'beta-harman') assert.equal(R.confidence, Math.round(Math.min(95, Math.max(5, R.calibration.p * 100))));
  assert.ok(a.karne.horizons.length === 3 && a.karne.horizons[2].son250);
  // Eski cagri bicimi (yeni girdiler yok) da calisir
  const b = Q.analyze({ rows: ROWS.slice(-400), daily: ROWS.slice(-400), hist: ROWS, pro, bench: BENCH, now });
  assert.ok(!b.rating.warnings.some(w => /likidite|Bilanço/.test(w))); assert.ok(!b.rating.components.some(c => c.key === 'radar'));
});
test('analyze/kenar: bos, kisa, bozuk ve sirasiz veri cokmez', () => {
  let a = Q.analyze(); assert.equal(a.rating, null); assert.equal(a.karne, null); assert.equal(a.histN, 0);
  a = Q.analyze({ rows: ROWS.slice(0, 60) }); assert.equal(a.karne, null); assert.equal(a.score, null);
  const bad = [...ROWS.slice(0, 300)].reverse(); bad.splice(10, 0, { t: 1, o: NaN, h: 1, l: 1, c: 1 }, null, { t: bad[20].t, o: 1, h: 0.5, l: 1, c: 1 }, { o: 5, h: 6, l: 4, c: 5 });
  const cl = Q.clean(bad); assert.equal(cl.length, 300); for (let i = 1; i < cl.length; i++) assert.ok(cl[i].t > cl[i - 1].t);
  assert.deepEqual(Q.karne(bad), Q.karne(ROWS.slice(0, 300)));
  // Duz seri (islem durdurma): sahte sinyal yok
  const k = Q.karne(flat(new Array(300).fill(10))); for (const h of k.horizons) assert.equal(h.n, 0);
  a = Q.analyze({ rows: flat(new Array(300).fill(10)), pro: { ok: false } }); assert.equal(a.rating, null);
});
test('rapor: metin temiz, yeni bolumler ve yatirim tavsiyesi notu', () => {
  const pro = PROF(ROWS), now = ROWS.at(-1).t, day = new Date(now + 3 * 3600000 + 1 * DAY).toISOString().slice(0, 10);
  const quant = Q.analyze({ rows: ROWS.slice(-400), daily: ROWS.slice(-400), hist: ROWS, pro, bench: BENCH, now, liquidityTL: 1e6, events: [{ day, kind: 'temettü' }], radar: { karar: 'AL', skor: 0.7, guven: 66, n: 5 } });
  const rep = Q.report({ symbol: 'TEST', name: 'Test A.Ş.', pro, quant, quote: { price: ROWS.at(-1).c, chgPct: 1.234 }, radar: { consensus: { karar: 'AL', skor: 0.7, guven: 66, n: 5 } } });
  textOk(rep.text); for (const s of rep.sections) { textOk(s.h); s.lines.forEach(textOk); }
  const H = rep.sections.map(s => s.h);
  for (const h of ['Özet', 'Uyarılar', 'Güven ve sistem karnesi', 'Hisse Radar (yapay zekâ konsensüsü)', 'Riskler']) assert.ok(H.includes(h), h);
  assert.ok(rep.text.startsWith('TEST · Borsa Pro analist raporu'));
  assert.ok(/yatırım tavsiyesi değildir/.test(rep.text)); assert.ok(/Temettü yarın/.test(rep.text)); assert.ok(/AL sonrası yükselme/.test(rep.text));
  assert.ok(rep.text.includes('Analist notu: ' + quant.rating.label + ' (güven %' + quant.rating.confidence + ')'));
  // Eksik alanlar: bolum atlanir, metin bozulmaz
  const r2 = Q.report({ symbol: 'X', pro, quant: { rating: null } }); textOk(r2.text); assert.ok(r2.sections.length >= 1);
  const r3 = Q.report({ symbol: 'X', pro, quant: { karne: Q.karne(ROWS), rating: Q.rating({ pro: PRO(10, 1) }) } }); textOk(r3.text);
  assert.equal(Q.report(null), null); assert.equal(Q.report({ pro: { ok: false }, quant: {} }), null);
});
test('performans: 2500 mumluk gecmiste analyze < 400 ms', () => {
  const rows = gen(2500, { seed: 3, drift: [0.001, -0.001, 0.0005] }), bench = gen(2500, { seed: 5, vol: 0.012 }), pro = PROF(rows);
  const t0 = performance.now();
  const a = Q.analyze({ rows: rows.slice(-400), daily: rows.slice(-400), hist: rows, pro, bench, now: rows.at(-1).t, liquidityTL: 1e7, events: [], radar: null });
  const ms = performance.now() - t0; assert.ok(a.rating && a.karne);
  assert.ok(ms < 400, 'analyze ' + ms.toFixed(0) + ' ms');
});
