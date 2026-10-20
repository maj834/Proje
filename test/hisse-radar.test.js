'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../hisse-radar.js');
const { createRadar, consensus, FILES, BASE, _util: U } = R;

// --- gercek dosya bicimleri ---------------------------------------------------------------------------------------
// maj834/Hisse deposundan (main: data/*.json, data dali: market.json, news.json) 20 Ekim 2026 kopyalarinin kirpilmis halleri.
// Alan adlari, tipleri ve degerler oldugu gibi; yalniz hisse/oge sayisi azaltildi, uzun haber adresleri kisaltildi.
// Testler kopya uzerinde oynar (FX() her cagrida yeni kopya).
const NOW = Date.parse('2026-10-20T13:05:00+03:00');
const H = 36e5, DAY = 864e5;
const REAL = {
  ai: { updatedAt: '2026-10-19T23:37:35+03:00', veri: '19 Ekim 2026, 18:09',
    modeller: [{ id: 'groq', ad: 'Llama (Groq)', model: 'openai/gpt-oss-120b', durum: 'ok', sayi: 30, atilan: 0, sure: 96.5 },
      { id: 'cohere', ad: 'Cohere', model: 'command-a-03-2025', durum: 'ok', sayi: 30, atilan: 0, sure: 71.8 }],
    hisseler: {
      THYAO: { groq: { karar: 'TUT', guven: 44, hedef: 273.5, neden: 'RSI 35, fiyat SMA10 altında, net kâr -%72, olumlu haber tek başına yeterli değil', karar1a: 'TUT', hedef1a: 273.5, karar3a: 'TUT', hedef3a: 273.5 },
        cohere: { karar: 'TUT', guven: 55, hedef: 275.0, neden: 'RSI 35, motor anlaşması haberi, ROE %12', karar1a: 'TUT', hedef1a: 280.0, karar3a: 'TUT', hedef3a: 290.0 } },
      GARAN: { groq: { karar: 'AL', guven: 68, hedef: 135.0, neden: 'MACD pozitif, SMA10>price, net kâr artışı', karar1a: 'AL', hedef1a: 140.0, karar3a: 'TUT', hedef3a: 145.0 },
        cohere: { karar: 'AL', guven: 60, hedef: 135.0, neden: 'MACD pozitif, 2Ç26 net kâr +9%, bankacılık sektörü olumlu.', karar1a: 'AL', hedef1a: 140.0, karar3a: 'AL', hedef3a: 145.0 } },
      ASTOR: { groq: { karar: 'AL', guven: 68, hedef: 177.9, neden: 'RSI 28 aşırı satım, net kâr +125%, fiyat -33% 20g', karar1a: 'AL', hedef1a: 189.6, karar3a: 'TUT', hedef3a: 164.9 },
        cohere: { karar: 'SAT', guven: 45, hedef: 150.0, neden: 'RSI 28, 20 gün -33.5%, enerji sektörü baskısı.', karar1a: 'SAT', hedef1a: 140.0, karar3a: 'TUT', hedef3a: 155.0 } },
      ASELS: { groq: { karar: 'TUT', guven: 40, hedef: 340.25, neden: 'RSI 41, SMA10>fiyat, F/K 48.5, negatif MACD', karar1a: 'TUT', hedef1a: 340.25, karar3a: 'TUT', hedef3a: 340.25 },
        cohere: { karar: 'AL', guven: 65, hedef: 360.0, neden: '2Ç26 hasılat +82%, RSI 41, savunma sektörü olumlu.', karar1a: 'AL', hedef1a: 375.0, karar3a: 'TUT', hedef3a: 390.0 } } },
    isabet: { cohere: { '1h': { n: 270, oran: 64.8 } }, groq: { '1h': { n: 258, oran: 62.8 } }, claude: { '1h': { n: 30, oran: 73.3 } } } },
  ai_genis: { updatedAt: '2026-10-20T08:01:59+03:00', talepSon: 1792472472, bekleyen: {}, ilerleme: { yapilan: 183, toplam: 596, populer: 100 },
    modeller: [{ id: 'groq', ad: 'Groq', model: 'openai/gpt-oss-120b', durum: 'ok', son: 1, atilan: 0, hata: '', zaman: '2026-10-20T08:01:52+03:00' },
      { id: 'mistral', ad: 'Mistral', model: '', durum: 'hata', son: 0, atilan: 0, hata: 'mistral-medium-latest 429: {"object":"error","message":"Rate limit exceeded","type":"rate_limited","param":null,"code":"1300","raw_status_code":429}', zaman: '2026-09-29T18:58:26+03:00' },
      { id: 'cohere', ad: 'Cohere', model: 'command-a-03-2025', durum: 'ok', son: 1, atilan: 0, hata: '', zaman: '2026-10-20T08:01:59+03:00' }],
    hisseler: {
      ENERY: { groq: { karar: 'TUT', guven: 48, hedef: 13.94, neden: 'RSI 59, fiyat SMA20 üstünde, 3 ay +42.8%', aciklama: 'Enerji fiyatları yükseliyor, Brent +1.6%, BIST 100 düşüşte ancak ENERY güçlü.', karar1a: 'TUT', hedef1a: 13.94, karar3a: 'AL', hedef3a: 18.0, model: 'openai/gpt-oss-120b' },
        ts: 1792161312,
        haber: [{ baslik: 'Borsada eylülün kazandıranları belli oldu! İşte zirvedeki 10 hisse haberi - BorsaninGündemi.com', url: 'https://www.borsaningundemi.com/haber/borsada-eylulun-kazandiranlari-belli-oldu-iste-zirvedeki-10-hisse-1910158', kaynak: 'web', duygu: null },
          { baslik: 'BIST Katılım Endeksleri\'nde 127 hissede değişikliğe gidilecek haberi - BorsaninGündemi.com', url: 'https://www.borsaningundemi.com/haber/bist-katilim-endekslerinde-127-hissede-degisiklige-gidilecek-1909924', kaynak: 'web', duygu: null }],
        cohere: { karar: 'TUT', guven: 65, hedef: 14.0, neden: 'RSI 69, kısa vadede aşırı alım bölgesinde; ancak 3 aylık trend güçlü (+49.6%).', aciklama: 'Hisseyi etkileyen gelişmeler: Küresel risk iştahının güçlenmesi ve enerji sektöründeki olumlu beklentiler.', karar1a: 'TUT', hedef1a: 14.5, karar3a: 'AL', hedef3a: 16.0, model: 'command-a-03-2025' } },
      HALKB: { groq: { karar: 'TUT', guven: 45, hedef: 42.28, neden: 'RSI 40, haftalık -4%, sektör medyan -20.6%', aciklama: 'Finans sektörü baskı altında, faiz artışı riskli ortam yaratıyor.', karar1a: 'TUT', hedef1a: 42.28, karar3a: 'TUT', hedef3a: 42.28, model: 'openai/gpt-oss-120b' }, ts: 1792161312, haber: [] } } },
  outlook: { updatedAt: '2026-09-29T20:39:51+03:00', guncelleme: '29 Eylül 2026, 20:39',
    yukselis: [{ guven: 50, hedef: 435, neden: 'Piyasa düşerken 20 günde +%3,3 ile ayrıştı; net kâr yıllık %125 arttı.', olay: 'Savunmacı perakende; BIST 100 20 günde -%13,6', sembol: 'BIMAS', vade: 'kısa' },
      { guven: 50, hedef: 293, neden: 'Düşen piyasada +%1,6 ile ayrıştı; BofA alım yaptı.', olay: 'BofA\'nın BIST işlemleri: THYAO alımları', sembol: 'THYAO', vade: 'kısa' }],
    dusus: [{ guven: 50, hedef: 138, neden: '2Ç26\'da 4,8 milyar TL zarar; Brent 100 $ üstü, model portföyden çıkarıldı.', olay: 'Ahlatcı Yatırım model portföyünden PGSUS\'u çıkardı', sembol: 'PGSUS', vade: 'kısa' }],
    kararlar: { THYAO: { guven: 50, hedef: 293, hedef1a: 295, hedef3a: 300, karar: 'TUT', karar1a: 'TUT', karar3a: 'TUT', neden: 'BofA alımıyla +%1,6; ama yakıt maliyeti ve net kâr -%72.' },
      GARAN: { guven: 50, hedef: 130, hedef1a: 132, hedef3a: 142, karar: 'TUT', karar1a: 'TUT', karar3a: 'AL', neden: 'F/K 4,7, ROE %24 güçlü; kısa vadede piyasa riski baskın.' } } },
  olasilik: { updatedAt: '2026-10-20T00:16:22+03:00', son: '2026-10-19', pencere_gun: 756,
    dogrulama: { '1h': { brier_kosullu: 0.2528, brier_kosulsuz: 0.2504, n: 28147, kosul_ise_yariyor: false }, '1a': { brier_kosullu: 0.2616, brier_kosulsuz: 0.2542, n: 26890, kosul_ise_yariyor: false },
      '3a': { brier_kosullu: 0.2752, brier_kosulsuz: 0.2644, n: 23205, kosul_ise_yariyor: false } },
    hisseler: {
      THYAO: { r20: -4.2, dilim: 1, ust200: 0, '1h': { p: 0.485, pu: 0.508, q: [-2.18, -0.18, 2.14], qu: [-2.45, 0.17, 2.83], n: 72, N: 756 },
        '1a': { p: 0.531, pu: 0.48, q: [-3.8, 3.96, 9.67], qu: [-5.01, -0.41, 6.8], n: 64, N: 756 }, '3a': { p: 0.765, pu: 0.574, q: [3.42, 6.82, 11.02], qu: [-6.29, 3.08, 10.83], n: 58, N: 756 } },
      ENERY: { r20: 7.8, dilim: 3, ust200: 1, '1h': { p: 0.459, pu: 0.544, q: [-4.1, -0.73, 3.55], qu: [-2.89, 0.7, 5.31], n: 136, N: 756 },
        '1a': { p: 0.621, pu: 0.607, q: [-4.44, 3.51, 11.74], qu: [-5.24, 4.3, 13.73], n: 136, N: 750 }, '3a': { p: 0.727, pu: 0.688, q: [-4.06, 12.66, 29.46], qu: [-4.62, 11.34, 28.78], n: 134, N: 708 } } } },
  secim: { updatedAt: '2026-10-20T00:00:23+03:00', tarih: '2026-10-19', zayif: [], guclu: [], guclu_not: '',
    riskli: { kurum: { TERA: 'Tera Portföy fonları temerrüde düştü, tasfiye süreci başladı; fon soruşturmasında yöneticiler hakkında 27 Eylül 2026\'da yakalama kararı çıktı.' },
      hisse: { TERA: 'Grup şirketi Tera Portföy\'ün fonları temerrüde düştü; yöneticiler hakkında yakalama kararı (27 Eylül 2026).', ASTOR: 'Fon soruşturması kapsamında şirket sahibine yurt dışı çıkış yasağı getirildi (29 Eylül 2026).' } },
    canli: { zayif: { n: 0, dogru: 0, son60_n: 0, son60_dogru: 0, bekleyen: 14 }, guclu: { n: 0, dogru: 0, son60_n: 0, son60_dogru: 0, bekleyen: 9 }, fon: { n: 1, dogru: 0, son60_n: 1, son60_dogru: 0, bekleyen: 11 } },
    gecmis: [{ tarih: '2026-10-07', kod: 'BRSAN', tur: 'guclu', vade_gun: 21, neden: 'RSI 47.9, 3‑ay %19.8, BIST100\'e göre 3‑ay %33.7, 200‑gün ort. uzaklık %10.1, günlük işlem 895 mn TL.', fiyat: 659.0, bist100: 12122.9004, ara: 3.13, ara_gun: 8 },
      { tarih: '2026-10-14', kod: 'PETKM', tur: 'guclu', vade_gun: 21, neden: 'RSI50, net kâr kâra geçti, F/K anlamsız ama büyüme +38%; Hasılat +38%, net kâr zarardan kâra geçti, RSI 50.', fiyat: 20.78, bist100: 12118.29, ara: -1.2, ara_gun: 3 }] },
  backtest: { updatedAt: '2026-10-20T00:00:22+03:00', evren: 88, donem: { bas: '2022-08-08', test_basi: '2025-01-01', son: '2026-10-19' }, bugun: [] },
  temel: { updatedAt: '2026-10-19T13:45:12+03:00', kaynak: 'Yahoo Finance (şirket finansal tabloları)',
    hisseler: { THYAO: { ceyrek: '2Ç26', tarih: '2026-06-30', para: 'USD', oncekiCeyrek: '1Ç26', gecenYilCeyrek: '2Ç25',
      satirlar: [{ ad: 'Hasılat', son: 7205000000.0, onceki: 5917000000.0, gecenYil: 5980000000.0, ceyreklik: 21.8, yillik: 20.5 }, { ad: 'Brüt kâr', son: 458000000.0, onceki: 494000000.0, gecenYil: 1145000000.0, ceyreklik: -7.3, yillik: -60.0 }],
      marjlar: [{ ad: 'Brüt marj', son: 6.4, gecenYil: 19.1, degisimPuan: -12.7 }], sapmalar: [{ ad: 'Hasılat', yillik: 20.5, yon: 'olumlu' }, { ad: 'Brüt kâr', yillik: -60.0, yon: 'olumsuz' }],
      oranlar: { fk: 30.475088, pddd: 0.382445, roe: 12.2, piyasaDegeri: 408940439194.0, borcOzsermaye: 0.89 }, puan: -1, ozet: 'net kâr yıllık %72 azaldı' } }, hatalar: [] },
  gundem: { updatedAt: '2026-10-19T23:37:35+03:00',
    haber_ai: { ts: 1792442255, zaman: '2026-10-19T23:37:35+03:00', model: '@cf/openai/gpt-oss-120b', piyasa_havasi: 'olumsuz',
      ozet: 'BIST 100 yüzde 0,98 düşerken SPK Başkanı istifası ve fon likidasyonları piyasada belirsizlik yarattı.',
      sektorler: [{ sektor: 'Enerji', etki: 'olumlu', onem: 2, neden: 'Brent düşüşü rafineri maliyetlerini azalttı' }, { sektor: 'Ulaştırma', etki: 'olumlu', onem: 2, neden: 'Yakıt fiyatları düştü, THYAO maliyet avantajı' },
        { sektor: 'Elektronik teknoloji', etki: 'olumsuz', onem: 2, neden: 'BofA ASELS satışı satış baskısı yarattı' }],
      hisseler: { THYAO: { etki: 'olumlu', onem: 2, neden: '' }, TUPRS: { etki: 'olumsuz', onem: 2, neden: '' }, ASELS: { etki: 'olumsuz', onem: 2, neden: '' } } },
    sirket: { THYAO: { ts: 1792086477, haberler: [
      { baslik: 'BofA\'nın İşlem Odakları: AKBNK, THYAO Alım, TUPRS Satım', url: 'https://news.google.com/rss/articles/CBMib0FVX3lxTE02bXJreFlHbndkSzJv', kaynak: 'Finans Hattı', zaman: '15 Eki' },
      { baslik: 'THY’den 300’den fazla uçak motoru için dev anlaşma', url: 'https://news.google.com/rss/articles/CBMiuAFBVV95cUxQNTRSbkFKaGlz', kaynak: 'Bigpara', zaman: '16 Eki' }] } },
    makro: { zaman: '2026-10-19T23:37:10+03:00', seriler: [{ ad: 'Brent petrol', son: 109.33, tarih: '2026-10-19', d5: 2.51, d20: 8.96, birim: '$', kaynak: 'Yahoo' },
      { ad: 'Dolar/TL', son: 49.544, tarih: '2026-10-19', d5: 0.42, d20: 1.51, birim: 'TL', kaynak: 'Yahoo' }] },
    piyasa: { zaman: '2026-10-19T23:37:23+03:00', ozet: 'The Borsa İstanbul BIST 100 index declined by 0.98% to 11,606.94 points during the day.' } },
  endeksler: { updatedAt: '2026-10-19T12:50:48+03:00', kaynak: 'TradingView', endeksler: { XU030: { ad: 'BIST 30', hisseler: ['AEFES', 'AKBNK', 'ASELS', 'ASTOR', 'BIMAS', 'EKGYO', 'ENKAI', 'EREGL',
    'FROTO', 'GARAN', 'GUBRF', 'ISCTR', 'KCHOL', 'KRDMD', 'MGROS', 'PETKM', 'PGSUS', 'SAHOL', 'SASA', 'SISE', 'TAVHL', 'TCELL', 'THYAO', 'TOASO', 'TRALT', 'TRMET', 'TTKOM', 'TUPRS', 'VAKBN', 'YKBNK'] } } },
  riskli: { aciklama: 'Elle doğrulanmış riskli kurum ve hisseler.', guncelleme: '2026-09-29',
    hisseler: [{ kod: 'TERA', neden: 'Grup şirketi Tera Portföy\'ün fonları temerrüde düştü; yöneticiler hakkında yakalama kararı (27 Eylül 2026).', kaynak: 'https://www.finansingundemi.com/haber/teranin-ceosu-ve-portfoy-baskani-icin-yakalama-karari/1909639' },
      { kod: 'ASTOR', neden: 'Fon soruşturması kapsamında şirket sahibine yurt dışı çıkış yasağı getirildi (29 Eylül 2026).', kaynak: '' }] },
  // data dali
  market: { updatedAt: '2026-10-20T13:03:56+03:00', kaynak: 'TradingView (yaklaşık 15 dk gecikmeli)', sutun: ['k', 'ad', 'fiyat', 'deg', 'hacim', 'sektor', 'pd', 'tv', 'rsi', 'h1', 'a1', 'a3', 'yuk', 'dus', 'yb'],
    hisseler: [['ASELS', 'Aselsan Elektronik San. ve Tic. A.Ş.', 330.25, 2.48, 18837930, 'Elektronik teknoloji', 1469460000000, -0.355, 39.3, -3.58, -13.03, -8.77, 331.75, 318.5, 42.35],
      ['GARAN', 'Türkiye Garanti Bankasi A.Ş.', 132.6, 0.08, 9621415, 'Finans', 556500000000, 0.221, 54.2, 2.08, 0.45, 6.59, 133.6, 131.5, -8.11],
      ['THYAO', 'Turk Hava Yollari A.O.', 268.75, 1.03, 9695093, 'Ulaştırma', 367080000000, -0.264, 34.2, -6.11, -7.01, -15.29, 269.25, 265, -0.83],
      ['HALKB', 'Türkiye Halk Bankasi A.Ş.', 41.82, 0.14, 4814682, 'Finans', 300036310206, -0.333, 38.6, -5.0, -12.47, 10.99, 42.3, 41.5, 13.39],
      ['ASTOR', 'Astor Enerji A.Ş.', 166.8, 3.86, 25404392, 'Sanayi üretimi', 160278806091, -0.355, 30.6, -15.07, -35.22, -44.54, 170.3, 159.1, 42.08],
      ['ENERY', 'Enerya Enerji A.Ş.', 13.83, 4.38, 25289165, 'Elektrik ve doğalgaz', 116459024658, 0.333, 56.7, -5.6, 9.16, 45.73, 13.9, 13.16, 45.58]] },
  news: { updatedAt: '2026-10-20T13:00:02+03:00', kaynak: 'Google Haberler', items: [
    { title: 'Günün öne çıkan gelişmeleri: THYAO, EKGYO, KCHOL, SAHOL, SKBNK', url: 'https://news.google.com/rss/articles/CBMirgFBVV95cUxNejBPeS1', kaynak: 'Midas', kat: 'Şirket', sym: 'EKGYO', ts: 1792483812, t: '20 Eki' },
    { title: 'Borsa İstanbul’dan 14 hisse için fiili dolaşım oranı duyurusu', url: 'https://news.google.com/rss/articles/CBMiiAFBVV95cUxPcVo1c2t', kaynak: 'Paratic Haber', kat: 'Borsa', ts: 1792489139, t: '20 Eki' },
    { title: 'Altın, konut, hisse, fon... 2027’de hangisi daha çok kazandıracak? İşte dev bankanın tahmini', url: 'https://news.google.com/rss/articles/CBMiygFBVV95cUxOTFJiZ1I', kaynak: 'Sabah', kat: 'Fon', ts: 1792488898, t: '20 Eki' },
    { title: 'THY’den 300’den fazla uçak motoru için dev anlaşma', url: 'https://news.google.com/rss/articles/CBMiuAFBVV95cUxQNTRSbkFKaGlz', kaynak: 'Bigpara', kat: 'Şirket', ts: 1792098000, t: '16 Eki' },
    { title: 'Havacılık sektöründe yeni dönem başlıyor', url: 'https://example.com/havacilik', kaynak: 'Örnek', kat: 'Ekonomi', ts: 1792480000, t: '20 Eki' },
    { title: 'Enerya\'dan yeni dağıtım bölgesi yatırımı', url: 'http://insecure.example.com/x', kaynak: 'Örnek', kat: 'Şirket', ts: 1792470000, t: '20 Eki' }] },
};
const FX = () => JSON.parse(JSON.stringify(REAL));
const iso = ms => new Date(ms).toISOString();

// --- sahte ag ----------------------------------------------------------------------------------------------------
// Adres -> dosya adi (FILES'tan). Yanit: fx[ad] (200 + ETag), over[ad] = {status} | {throw} | {raw} | 'hang' | fn(call)
const URL2NAME = Object.fromEntries(Object.entries(FILES).map(([n, [dal, yol]]) => [BASE + '/' + dal + '/' + yol, n]));
function fakeNet(fx = FX(), over = {}) {
  const calls = [];
  const fetch = (url, opt = {}) => {
    const name = URL2NAME[url] || null, call = { url, name, headers: { ...(opt.headers || {}) }, signal: opt.signal };
    calls.push(call);
    let o = over[name];
    if (typeof o === 'function') o = o(call);
    if (o === 'null') return Promise.resolve(null);
    if (o === 'hang') return new Promise((_, no) => { if (opt.signal) opt.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; no(e); }); });
    if (o && o.throw) return Promise.reject(o.throw);
    if (o && o.status) return Promise.resolve({ ok: o.status >= 200 && o.status < 300, status: o.status, headers: new Map([['etag', null]]), text: async () => o.raw ?? '' });
    if (o && 'raw' in o) return Promise.resolve({ ok: true, status: 200, headers: { ETag: '"raw"' }, text: async () => o.raw });
    if (!name || !(name in fx)) return Promise.resolve({ ok: false, status: 404, headers: {}, text: async () => '404: Not Found' });
    const etag = '"' + name + '-1"';
    if (call.headers['if-none-match'] === etag) return Promise.resolve({ ok: false, status: 304, headers: { etag }, text: async () => '' });
    return Promise.resolve({ ok: true, status: 200, headers: { etag }, text: async () => JSON.stringify(fx[name]) });
  };
  return { fetch, calls, fx, over };
}
function mk(opts = {}) {
  const net = fakeNet(opts.fx, opts.over), clock = { t: opts.t ?? NOW };
  const radar = createRadar({ fetch: net.fetch, now: () => clock.t, ...(opts.radar || {}) });
  return { radar, net, clock };
}
const tick = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// --- dosya adresleri, anahtarsiz erisim ---------------------------------------------------------------------------
test('adresler: main dalinda data/*.json, data dalinda canli dosyalar; anahtar/yetki basligi yok', async () => {
  assert.equal(BASE, 'https://raw.githubusercontent.com/maj834/Hisse');
  assert.deepEqual(FILES.ai, ['main', 'data/ai.json']); assert.deepEqual(FILES.market, ['data', 'market.json']); assert.deepEqual(FILES.news, ['data', 'news.json']);
  assert.deepEqual(FILES.riskli, ['main', 'data/riskli.json']);
  const { radar, net } = mk();
  await radar.forSymbol('THYAO');
  const urls = net.calls.map(c => c.url).sort();
  assert.ok(urls.includes(BASE + '/main/data/ai.json') && urls.includes(BASE + '/data/market.json') && urls.includes(BASE + '/data/news.json'));
  assert.equal(new Set(urls).size, urls.length, 'her dosya bir kez');
  for (const c of net.calls) {
    assert.ok(c.name, 'bilinmeyen adres: ' + c.url);
    assert.equal(c.headers.accept, 'application/json');
    assert.ok(!Object.keys(c.headers).some(k => /authorization|token|key/i.test(k)), 'anahtar gonderilmez');
    assert.ok(!('if-none-match' in c.headers), 'ilk istekte ETag yok');
  }
  // base sonundaki / temizlenir
  const net2 = fakeNet(); const r2 = createRadar({ fetch: net2.fetch, now: () => NOW, base: BASE + '/' });
  await r2.forSymbol('GARAN'); assert.ok(net2.calls.every(c => c.name));
});

// --- forSymbol: gercek BIST 30 ornegi ------------------------------------------------------------------------------
test('forSymbol THYAO (gercek ornek): modeller + isabet, isabet agirlikli konsensus, olasilik, temel, haberler, piyasa', async () => {
  const { radar } = mk();
  const r = await radar.forSymbol('THYAO');
  assert.equal(r.symbol, 'THYAO'); assert.equal(r.ad, 'Turk Hava Yollari A.O.'); assert.equal(r.sektor, 'Ulaştırma');
  assert.equal(r.updatedAt, Date.parse('2026-10-19T23:37:35+03:00')); assert.equal(r.veriZamani, '19 Ekim 2026, 18:09'); assert.equal(r.stale, false);
  assert.deepEqual(r.models.map(m => [m.id, m.ad, m.model, m.karar, m.guven, m.hedef]),
    [['groq', 'Llama (Groq)', 'openai/gpt-oss-120b', 'TUT', 44, 273.5], ['cohere', 'Cohere', 'command-a-03-2025', 'TUT', 55, 275]]);
  const g = r.models[0];
  assert.deepEqual(g.isabet, { n: 258, oran: 62.8 }); assert.equal(g.karar1a, 'TUT'); assert.equal(g.hedef3a, 273.5); assert.equal(g.kaynak, 'ai'); assert.equal(g.eski, false);
  assert.match(g.neden, /RSI 35/);
  // El hesabi: agirlik = isabet * guven/100 -> groq 0,628*0,44 = 0,27632; cohere 0,648*0,55 = 0,3564; W = 0,63272
  // guven = (0,27632*44 + 0,3564*55)/W = 50,196; hedef = (0,27632*273,5 + 0,3564*275)/W = 274,345 (fiyat 268,75: ikisi de %10 icinde)
  assert.deepEqual(r.consensus, { karar: 'TUT', skor: 0, guven: 50, hedef: 274.34, hedefYuzde: 2.08, n: 2, uyum: 1, agirlik: 'isabet',
    dagilim: { AL: 0, TUT: 2, SAT: 0 }, hamKarar: null, not: null });
  assert.equal(r.outlook, null, 'Claude beklentisi 29 Eylul: 3 gunden eski, kullanilmaz (uygulama da kullanmiyor)');
  assert.ok(!r.models.some(m => m.id === 'claude'));
  // olasilik: dogrulama brier >= 0,2475 -> kosulsuz oran, beceri yok uyarisi
  const o = r.olasilik;
  assert.equal(o.son, '2026-10-19'); assert.equal(o.r20, -4.2); assert.equal(o.dilim, 1);
  assert.deepEqual(o.vadeler['1h'], { gun: 5, p: 0.508, pKosullu: 0.485, pKosulsuz: 0.508, q: [-2.45, 0.17, 2.83], n: 756, kosullu: false, beceri: false });
  assert.equal(o.vadeler['1a'].gun, 21); assert.equal(o.vadeler['3a'].gun, 63);
  assert.match(o.not, /yazı-turadan iyi çıkmadı/);
  // temel: puan -1 -> TUT (uygulamadaki esik +-2)
  assert.equal(r.temel.puan, -1); assert.equal(r.temel.karar, 'TUT'); assert.equal(r.temel.ceyrek, '2Ç26'); assert.equal(r.temel.ozet, 'net kâr yıllık %72 azaldı');
  assert.equal(r.temel.oranlar.roe, 12.2); assert.equal(r.temel.satirlar.length, 2);
  assert.equal(r.secim, null); assert.equal(r.backtest, null); assert.equal(r.risk, null);
  // piyasa satiri (data dali market.json, sutun adlarina gore)
  assert.equal(r.piyasa.fiyat, 268.75); assert.equal(r.piyasa.degisimYuzde, 1.03); assert.equal(r.piyasa.rsi, 34.2); assert.equal(r.piyasa.ay, -7.01);
  assert.equal(r.piyasa.hacimTL, Math.round(268.75 * 9695093)); assert.equal(r.piyasa.updatedAt, Date.parse('2026-10-20T13:03:56+03:00'));
  // haber yapay zekasi (3 gunden taze) + sektor etkisi
  assert.deepEqual(r.haberAi, { etki: 'olumlu', onem: 2, neden: null, zaman: Date.parse('2026-10-19T23:37:35+03:00') });
  assert.equal(r.sektorEtkisi.sektor, 'Ulaştırma'); assert.equal(r.sektorEtkisi.etki, 'olumlu');
});

test('forSymbol haberler: sirket haberleri + kod/takma ad/sirket adi eslesmesi, tekrar yok, yeniden eskiye, yalniz https adres', async () => {
  const { radar } = mk();
  const h = (await radar.forSymbol('THYAO')).haberler;
  const titles = h.map(x => x.baslik);
  assert.equal(titles.filter(x => x === 'THY’den 300’den fazla uçak motoru için dev anlaşma').length, 1, 'ayni baslik bir kez');
  assert.ok(titles.includes('Günün öne çıkan gelişmeleri: THYAO, EKGYO, KCHOL, SAHOL, SKBNK'), 'kod gecen haber (sym baska hisse olsa da)');
  assert.ok(titles.includes('BofA\'nın İşlem Odakları: AKBNK, THYAO Alım, TUPRS Satım'));
  assert.ok(!titles.some(x => /Havacılık/.test(x)), '"Havacılık" THY ile eslesmez');
  assert.ok(!titles.some(x => /fiili dolaşım/.test(x)), 'genel haber eslesmez');
  for (let i = 1; i < h.length; i++) assert.ok((h[i - 1].zaman || 0) >= (h[i].zaman || 0), 'yeniden eskiye');
  assert.equal(h[0].zaman, 1792483812000); assert.equal(h[0].kaynak, 'Midas'); assert.equal(h[0].yazi, '20 Eki');
  // gundem.json '15 Eki' -> Istanbul gun basi
  const bofa = h.find(x => /BofA/.test(x.baslik));
  assert.equal(bofa.zaman, Date.UTC(2026, 9, 15) - 3 * 36e5); assert.equal(bofa.kaynak, 'Finans Hattı');
  assert.ok(h.every(x => x.url === null || /^https:\/\//.test(x.url)));
  assert.ok(h.every(x => 'baslik' in x && 'zaman' in x && 'kaynak' in x && 'etki' in x));
  // EKGYO: news.json 'sym' alani; ENERYA: sirket adinin ilk kelimesi; http adres atilir
  const e = await radar.forSymbol('ENERY');
  const en = e.haberler.find(x => /Enerya'dan/.test(x.baslik));
  assert.ok(en, 'sirket adi (Enerya Enerji A.Ş.) ilk kelimesiyle eslesir'); assert.equal(en.url, null, 'https olmayan adres verilmez');
  assert.ok(e.haberler.some(x => /eylülün kazandıranları/.test(x.baslik) && x.kaynak === null), 'ai_genis haberi; kaynak "web" gizlenir');
  const ek = U.haberlerFor('EKGYO', { news: REAL.news, ad: 'Emlak Konut GYO' }, NOW);
  assert.equal(ek.length, 1); assert.match(ek[0].baslik, /Günün öne çıkan/);
});

test('forSymbol ENERY (BIST 30 disi): ai_genis modelleri, 3 gunden eski analiz "eski", isabet ai.json\'dan; veriZamani okunur bicim', async () => {
  const { radar } = mk();
  const r = await radar.forSymbol('ENERY');
  assert.deepEqual(r.models.map(m => [m.id, m.karar, m.guven, m.kaynak, m.eski]), [['groq', 'TUT', 48, 'ai_genis', true], ['cohere', 'TUT', 65, 'ai_genis', true]]);
  assert.deepEqual(r.models[0].isabet, { n: 258, oran: 62.8 }); assert.equal(r.models[0].model, 'openai/gpt-oss-120b'); assert.match(r.models[1].aciklama, /risk iştahı/);
  assert.ok(!r.models.some(m => m.id === 'mistral'), 'hata veren model (bu hissede karari yok) listede yok');
  assert.equal(r.updatedAt, 1792161312000); assert.equal(r.veriZamani, '16 Ekim 2026, 17:35');
  // groq 0,628*0,48 = 0,30144; cohere 0,648*0,65 = 0,4212 -> hedef (0,30144*13,94 + 0,4212*14)/0,72264 = 13,975
  assert.equal(r.consensus.karar, 'TUT'); assert.equal(r.consensus.hedef, 13.97); assert.equal(r.consensus.agirlik, 'isabet');
  assert.equal(r.sektor, 'Elektrik ve doğalgaz'); assert.equal(r.temel, null);
  // 10 gunden eski kademeli tarama kullanilmaz; olasilik verisi oldugu icin hisse yine doner (konsensus yok)
  const fx = FX(); fx.ai_genis.hisseler.ENERY.ts = Math.floor((NOW - 11 * DAY) / 1000);
  const r2 = await mk({ fx }).radar.forSymbol('ENERY');
  assert.deepEqual(r2.models, []); assert.equal(r2.consensus, null); assert.ok(r2.olasilik); assert.equal(r2.updatedAt, Date.parse('2026-10-20T00:16:22+03:00'));
  // BIST 30 hissesinde (ai.json'da var) ai_genis'e bakilmaz
  const fx3 = FX(); fx3.ai_genis.hisseler.THYAO = { ts: Math.floor(NOW / 1000), groq: { karar: 'SAT', guven: 90 } };
  const r3 = await mk({ fx: fx3 }).radar.forSymbol('THYAO');
  assert.ok(r3.models.every(m => m.kaynak === 'ai'));
});

test('forSymbol kod bicimleri ve kapsam disi: kucuk harf, .IS soneki, Turkce i; bilinmeyen hisse null', async () => {
  const { radar, net } = mk();
  assert.equal((await radar.forSymbol('thyao')).symbol, 'THYAO');
  assert.equal((await radar.forSymbol('thyao.is')).symbol, 'THYAO', "'is' Turkce buyuk harfte 'İS' olur; yine de soneki atilir");
  assert.equal((await radar.forSymbol(' Garan.IS ')).symbol, 'GARAN');
  assert.equal(U.codeOf('isctr'), 'ISCTR'); assert.equal(U.codeOf('şişe'), 'SISE'); assert.equal(U.codeOf('a'), null); assert.equal(U.codeOf('THY AO'), null);
  assert.equal(await radar.forSymbol('XXXX'), null, 'hicbir dosyada yok');
  const n = net.calls.length;
  assert.equal(await radar.forSymbol(''), null); assert.equal(await radar.forSymbol(null), null); assert.equal(await radar.forSymbol('!!'), null);
  assert.equal(net.calls.length, n, 'gecersiz kodda ag istegi yok');
});

test('model listesi: ai.json durum "hata" atlanir, "eski" isaretlenir; taze Claude beklentisi model olarak eklenir', async () => {
  const fx = FX();
  fx.ai.modeller.push({ id: 'mistral', ad: 'Mistral', durum: 'hata', hata: '429' }, { id: 'gemini', ad: 'Gemini', model: 'gemini-2.5-flash', durum: 'eski', hata: 'zaman aşımı' });
  fx.ai.hisseler.THYAO.mistral = { karar: 'AL', guven: 90, hedef: 280 };
  fx.ai.hisseler.THYAO.gemini = { karar: 'TUT', guven: 50, hedef: 270 };
  fx.ai.hisseler.THYAO.bilinmeyen = { karar: 'AL', guven: 90 };                           // modeller listesinde olmayan anahtar
  fx.outlook.updatedAt = iso(NOW - 2 * H);
  const r = await mk({ fx }).radar.forSymbol('THYAO');
  assert.deepEqual(r.models.map(m => [m.id, m.eski, m.kaynak]), [['groq', false, 'ai'], ['cohere', false, 'ai'], ['gemini', true, 'ai'], ['claude', false, 'outlook']]);
  const c = r.models.find(m => m.id === 'claude');
  assert.equal(c.ad, 'Claude'); assert.equal(c.karar, 'TUT'); assert.equal(c.hedef, 293); assert.deepEqual(c.isabet, { n: 30, oran: 73.3 });
  assert.equal(r.models.find(m => m.id === 'gemini').isabet, null, 'isabet kaydi yok');
  // outlook: listede yukselis -> yon; yalniz kararlarda -> yon null; dusus listesinde -> 'dusus'
  assert.equal(r.outlook.yon, 'yukselis'); assert.equal(r.outlook.hedef, 293); assert.equal(r.outlook.guven, 50); assert.equal(r.outlook.vade, 'kısa'); assert.match(r.outlook.olay, /BofA/);
  assert.equal(r.outlook.eski, false);
  assert.equal(U.outlookOf(fx.outlook, 'PGSUS', NOW).yon, 'dusus');
  const ga = U.outlookOf(fx.outlook, 'GARAN', NOW); assert.equal(ga.yon, null); assert.equal(ga.karar, 'TUT');
  assert.equal(U.outlookOf(fx.outlook, 'AKBNK', NOW), null);
  assert.equal(U.outlookOf(REAL.outlook, 'THYAO', NOW), null, 'eski beklenti yok sayilir');
});

// --- konsensus ------------------------------------------------------------------------------------------------------
test('konsensus: isabet agirligi (n >= 20) sonucu degistirir; olculmemisse esit agirlik', () => {
  const m = (id, karar, guven, n, oran) => ({ id, karar, guven, isabet: n == null ? null : { n, oran } });
  // agirlik: 0,9*0,6 = 0,54; 0,85*0,6 = 0,51; 0,3*0,6 = 0,18 -> skor (0,54+0,51-0,18)/1,23 = 0,707 -> AL
  const w = consensus([m('a', 'AL', 60, 100, 90), m('b', 'AL', 60, 100, 85), m('c', 'SAT', 60, 100, 30)]);
  assert.equal(w.karar, 'AL'); assert.equal(w.skor, 0.707); assert.equal(w.agirlik, 'isabet'); assert.equal(w.uyum, 0.85); assert.equal(w.guven, 51);
  assert.deepEqual(w.dagilim, { AL: 2, TUT: 0, SAT: 1 });
  // ayni oylar, isabet olculmemis (n < 20): esit agirlik -> skor 1/3 -> TUT
  const e = consensus([m('a', 'AL', 60, 19, 90), m('b', 'AL', 60, 5, 85), m('c', 'SAT', 60, null)]);
  assert.equal(e.karar, 'TUT'); assert.equal(e.skor, 0.333); assert.equal(e.agirlik, 'esit'); assert.equal(e.uyum, 0); assert.equal(e.guven, 0);
  // sinir: n = 20 olculmus sayilir, n = 19 sayilmaz (olculmeyen model olculenlerin ortalamasini alir)
  const s20 = consensus([m('x', 'AL', 50, 20, 90), m('y', 'SAT', 50, 20, 30)]);
  assert.equal(s20.skor, 0.5, '(0,45-0,15)/0,6'); assert.equal(s20.karar, 'TUT', 'AL icin iki model gerekir'); assert.equal(s20.hamKarar, 'AL');
  assert.match(s20.not, /en az iki model/);
  const s19 = consensus([m('x', 'AL', 50, 20, 90), m('y', 'SAT', 50, 19, 30)]);
  assert.equal(s19.skor, 0, 'y olculmemis: x ile ayni agirlik (0,9)'); assert.equal(s19.hamKarar, null); assert.equal(s19.agirlik, 'isabet');
  // guven yoksa 0,5 sayilir; oran yuzde, 0-100 araliginda kirpilir
  const g = consensus([m('a', 'AL', null, 50, 80), m('b', 'AL', 80, 50, 140)]);
  assert.equal(g.karar, 'AL'); assert.equal(g.guven, Math.round((0.8 * 0.5 * 50 + 1 * 0.8 * 80) / (0.4 + 0.8)));
});

test('konsensus: gercek ai.json isabet alani kullanilir; bir modelin n < 20 olmasi agirligi degistirir', async () => {
  const fx = FX(); fx.ai.isabet.groq['1h'].n = 19;
  const r = await mk({ fx }).radar.forSymbol('THYAO');
  assert.deepEqual(r.models[0].isabet, { n: 19, oran: 62.8 }, 'ham isabet yine gosterilir');
  // groq olculmemis -> olculenlerin ortalamasi (yalniz cohere: 0,648): 0,648*0,44 = 0,28512 -> hedef 274,333
  assert.equal(r.consensus.hedef, 274.33); assert.equal(r.consensus.agirlik, 'isabet');
  const fx2 = FX(); fx2.ai.isabet = {};
  const r2 = await mk({ fx: fx2 }).radar.forSymbol('THYAO');
  assert.equal(r2.consensus.agirlik, 'esit'); assert.equal(r2.models[0].isabet, null);
  // esit isabet: agirlik yalniz guven -> (0,44*273,5 + 0,55*275)/0,99 = 274,333
  assert.equal(r2.consensus.hedef, 274.33);
});

test('konsensus: GARAN (iki model AL) AL; tek model AL ise TUT; tek model varsa not', async () => {
  const { radar } = mk();
  const g = (await radar.forSymbol('GARAN')).consensus;
  // 0,628*0,68 = 0,42704; 0,648*0,6 = 0,3888 -> guven (0,42704*68 + 0,3888*60)/0,81584 = 64,19; hedef 135 (+%1,81)
  assert.deepEqual([g.karar, g.skor, g.guven, g.hedef, g.hedefYuzde, g.uyum], ['AL', 1, 64, 135, 1.81, 1]);
  const a = (await radar.forSymbol('ASELS')).consensus;
  assert.equal(a.karar, 'TUT'); assert.equal(a.hamKarar, 'AL', 'skor 0,63 ama yalniz cohere AL diyor'); assert.equal(a.skor, 0.626);
  const one = consensus([{ id: 'a', karar: 'AL', guven: 70, isabet: { n: 40, oran: 60 }, hedef: 105 }], { price: 100 });
  assert.equal(one.karar, 'AL'); assert.equal(one.n, 1); assert.match(one.not, /Yalnız bir model var/); assert.equal(one.hedef, 105); assert.equal(one.hedefYuzde, 5);
  assert.equal(consensus([]), null); assert.equal(consensus([{ id: 'a', karar: 'BELKI' }]), null); assert.equal(consensus(null), null);
});

test('konsensus hedefi: fiyata gore %10 disi ya da karar yonuyle celisen hedef dislanir; fiyat yoksa hepsi', () => {
  const ms = [{ id: 'a', karar: 'AL', guven: 60, hedef: 105 }, { id: 'b', karar: 'AL', guven: 60, hedef: 120 }, { id: 'c', karar: 'AL', guven: 60, hedef: 95 },
    { id: 'd', karar: 'SAT', guven: 60, hedef: 101 }, { id: 'e', karar: 'TUT', guven: 60, hedef: 98 }];
  const c = consensus(ms, { price: 100 });
  assert.equal(c.hedef, 101.5, 'yalniz a (105) ve e (98, TUT)'); assert.equal(c.hedefYuzde, 1.5);
  const nop = consensus(ms);
  assert.equal(nop.hedef, Math.round((105 + 120 + 95 + 101 + 98) / 5 * 100) / 100); assert.equal(nop.hedefYuzde, null);
  assert.equal(consensus([{ id: 'a', karar: 'AL', hedef: 150 }, { id: 'b', karar: 'AL' }], { price: 100 }).hedef, null);
});

test('risk listesi: riskli hissede AL verilmez (TUT + not); secim.json yoksa riskli.json kullanilir', async () => {
  const fx = FX(); fx.ai.hisseler.ASTOR.cohere = { karar: 'AL', guven: 60, hedef: 175 };
  const r = await mk({ fx }).radar.forSymbol('ASTOR');
  assert.equal(r.consensus.karar, 'TUT'); assert.equal(r.consensus.hamKarar, 'AL'); assert.match(r.consensus.not, /^Risk uyarısı: Fon soruşturması/);
  assert.match(r.risk.neden, /yurt dışı çıkış yasağı/); assert.match(r.risk.kaynak, /Hisse Radar risk listesi/); assert.equal(r.risk.url, null, 'riskli.json kaynagi bos');
  // gercek ASTOR: AL + SAT -> zaten TUT, risk ayrica doner
  const a = await mk().radar.forSymbol('ASTOR');
  assert.equal(a.consensus.karar, 'TUT'); assert.equal(a.consensus.skor, 0.188); assert.equal(a.consensus.uyum, 0); assert.equal(a.consensus.hedef, 177.9, 'cohere 150 (%10 alti) dislanir');
  assert.ok(a.risk);
  // secim.json alinamazsa riskli.json (kaynak adresiyle)
  const fx2 = FX(); fx2.ai.hisseler.TERA = { groq: { karar: 'AL', guven: 80 }, cohere: { karar: 'AL', guven: 80 } };
  const t = await mk({ fx: fx2, over: { secim: { status: 500 } } }).radar.forSymbol('TERA');
  assert.equal(t.consensus.karar, 'TUT'); assert.match(t.risk.neden, /Tera Portföy/); assert.match(t.risk.url, /^https:\/\/www\.finansingundemi\.com/);
  assert.equal(t.stale, false, 'eski veri yok; yalniz hata');
  assert.equal(U.riskOf({}, {}, 'THYAO'), null);
  assert.deepEqual(U.riskList(REAL.secim, REAL.riskli).sort(), ['ASTOR', 'TERA']);
});

// --- olasilik, secim, backtest (uygulamanin dosya bicimleri) ---------------------------------------------------------
test('olasilik: kosullu oran yalniz dogrulamada yazi-turadan belirgin iyiyse; degilse kosulsuz; eski dosya yok sayilir', () => {
  const L = FX().olasilik;
  L.dogrulama['1h'] = { brier_kosullu: 0.2400, brier_kosulsuz: 0.2450 };                 // kosullu iyi ve kosulsuzdan iyi
  L.dogrulama['1a'] = { brier_kosullu: 0.2500, brier_kosulsuz: 0.2400 };                 // yalniz kosulsuz iyi
  const o = U.olasilikOf(L, 'THYAO', NOW);
  assert.deepEqual(o.vadeler['1h'], { gun: 5, p: 0.485, pKosullu: 0.485, pKosulsuz: 0.508, q: [-2.18, -0.18, 2.14], n: 72, kosullu: true, beceri: true });
  assert.deepEqual([o.vadeler['1a'].p, o.vadeler['1a'].kosullu, o.vadeler['1a'].beceri, o.vadeler['1a'].n], [0.48, false, true, 756]);
  assert.equal(o.vadeler['3a'].beceri, false); assert.equal(o.not, null, 'en az bir vadede beceri var');
  assert.equal(U.olasilikOf(L, 'YOKKOD', NOW), null);
  const old = FX().olasilik; old.son = '2026-10-01';
  assert.equal(U.olasilikOf(old, 'THYAO', NOW), null, '12 gunden eski');
  const bad = FX().olasilik; bad.hisseler.THYAO['1h'].qu = [1, 2];                  // beceri yok -> kosulsuz yuzdelikler (qu) kullanilir
  assert.equal(U.olasilikOf(bad, 'THYAO', NOW).vadeler['1h'].q, null, 'eksik yuzdelik');
  delete bad.hisseler.THYAO['1h'].qu;
  assert.deepEqual(U.olasilikOf(bad, 'THYAO', NOW).vadeler['1h'].q, [-2.18, -0.18, 2.14], 'qu yoksa q (uygulamadaki x.qu||x.q)');
});

test('secim/backtest: guclu-zayif listesi (secim.py bicimi), canli takip, grup isabeti; eski dosya yok sayilir', () => {
  const S = FX().secim;
  // secim.py: zayif = {...backtest bugun ogesi, ad, grup_isabet, grup_n, durum}; guclu = {kod, ad, neden, rsi, getiri_1ay, bist100e_gore_3ay, oy, durum}
  const bt = { kod: 'PGSUS', karar: 'SAT', vade: '1a', hedef: 'yon', kosul: ['RSI>70', '200 günlük ort. uzaklık: en yüksek %20'], isabet: 0.616, n: 438, kural_sayisi: 2, rsi: 72.1 };
  S.zayif = [{ ...bt, ad: 'Pegasus', grup_isabet: 0.557, grup_n: 438, durum: { r20: -8.1, rsi: 72.1, trend: -1, hacim_mn: 2400 } }];
  S.guclu = [{ kod: 'PETKM', ad: 'Petkim', neden: 'RSI 50, net kâr kâra geçti', rsi: 50, getiri_1ay: 3.1, bist100e_gore_3ay: 12.4, oy: '2/2', durum: { r20: 3.1 } }];
  S.gecmis.push({ tarih: '2026-10-19', kod: 'PGSUS', tur: 'zayif', vade_gun: 21, neden: 'x', fiyat: 140.2, bist100: 11606.9, ara: -1.4, ara_gun: 1 });
  const z = U.secimOf(S, 'PGSUS', NOW);
  assert.equal(z.tur, 'zayif'); assert.equal(z.yon, -1); assert.match(z.text, /zayıf kalması/);
  assert.equal(z.isabet, 0.557, 'birden cok kural: grup isabeti'); assert.equal(z.n, 438); assert.equal(z.kuralSayisi, 2); assert.equal(z.kosul.length, 2);
  assert.deepEqual(z.takip, { tarih: '2026-10-19', fiyat: 140.2, ara: -1.4, araGun: 1, sonuc: null });
  assert.deepEqual(z.canli, REAL.secim.canli.zayif);
  const g = U.secimOf(S, 'PETKM', NOW);
  assert.equal(g.tur, 'guclu'); assert.equal(g.yon, 1); assert.equal(g.oy, '2/2'); assert.equal(g.takip.fiyat, 20.78, 'gecmisteki son guclu kaydi');
  assert.equal(U.secimOf(S, 'THYAO', NOW), null);
  assert.equal(U.secimOf(S, 'PGSUS', Date.parse(S.updatedAt) + 101 * H), null, '100 saatten eski');
  const B = FX().backtest; B.bugun = [bt];
  const b = U.backtestOf(B, 'PGSUS', NOW);
  assert.deepEqual([b.karar, b.vade, b.hedef, b.isabet, b.n, b.kuralSayisi, b.rsi], ['SAT', '1a', 'yon', 0.616, 438, 2, 72.1]);
  assert.deepEqual(b.donem, REAL.backtest.donem);
  assert.equal(U.backtestOf(REAL.backtest, 'PGSUS', NOW), null, 'gercek dosyada bugun listesi bos');
});

test('yardimcilar: gun-ay ayristirma yil donumu, Turkce tarih bicimi, market satiri eksik sutun', () => {
  assert.equal(U.gunAy('15 Eki', NOW), Date.UTC(2026, 9, 15) - 3 * H);
  assert.equal(U.gunAy('28 Ara', Date.parse('2026-01-05T10:00:00Z')), Date.UTC(2025, 11, 28) - 3 * H, 'gelecege dusmez: gecen yil');
  assert.equal(U.gunAy('3 Şub', NOW), Date.UTC(2026, 1, 3) - 3 * H);
  assert.equal(U.gunAy('dün', NOW), null); assert.equal(U.gunAy('40 Eki', NOW), null);
  assert.equal(U.trTarih(Date.parse('2026-10-16T14:35:12Z')), '16 Ekim 2026, 17:35'); assert.equal(U.trTarih(null), null);
  assert.equal(U.marketRow({ sutun: ['ad', 'fiyat'], hisseler: [['THYAO', 1]] }, 'THYAO'), null, 'kod sutunu yok');
  const m = U.marketRow({ sutun: ['k', 'fiyat'], hisseler: [['THYAO', '268,75'], ['GARAN', 132.6]] }, 'GARAN');
  assert.equal(m.fiyat, 132.6); assert.equal(m.sektor, null); assert.equal(m.hacimTL, null);
  assert.equal(U.temelOf({ hisseler: { X: { puan: 3 } } }, 'X'), null, 'ozet alani yoksa temel yok (uygulama ile ayni)');
  assert.equal(U.temelOf({ hisseler: { X: { puan: 3, ozet: '' } } }, 'X').karar, 'AL');
});

// --- piyasa ozeti ----------------------------------------------------------------------------------------------------
test('market(): modeller + isabet + hata nedeni, gundem (liste dahil), endeksler, ozet (secim/outlook bos -> konsensus), riskli', async () => {
  const { radar } = mk();
  const m = await radar.market();
  assert.equal(m.updatedAt, Date.parse('2026-10-19T23:37:35+03:00')); assert.equal(m.veriZamani, '19 Ekim 2026, 18:09'); assert.equal(m.stale, false);
  assert.deepEqual(m.modeller.map(x => [x.id, x.kapsam, x.durum]), [['groq', 'BIST 30', 'ok'], ['cohere', 'BIST 30', 'ok'], ['groq', 'Geniş tarama', 'ok'],
    ['mistral', 'Geniş tarama', 'hata'], ['cohere', 'Geniş tarama', 'ok']]);
  assert.deepEqual(m.modeller[0].isabet, { n: 258, oran: 62.8 }); assert.equal(m.modeller[3].isabet, null);
  assert.ok(m.modeller.every(x => 'id' in x && 'ad' in x && 'model' in x && 'durum' in x && 'isabet' in x));
  assert.deepEqual(m.hatalar, ['Mistral (Geniş tarama) çalışmadı: kullanım sınırı doldu (429).']);
  assert.deepEqual(Object.keys(m.endeksler), ['XU030']); assert.equal(m.endeksler.XU030.n, 30); assert.equal(m.endeksler.XU030.ad, 'BIST 30');
  // gundem: yapay zeka piyasa yorumu + arayuz listesi (news.json, yeniden eskiye)
  assert.equal(m.gundem.havasi, 'olumsuz'); assert.match(m.gundem.ozet, /SPK Başkanı/); assert.equal(m.gundem.sektorler.length, 3);
  assert.equal(m.gundem.makro[0].ad, 'Brent petrol'); assert.match(m.gundem.piyasaOzet, /BIST 100/);
  assert.equal(m.gundem.list[0].baslik, 'Borsa İstanbul’dan 14 hisse için fiili dolaşım oranı duyurusu'); assert.equal(m.gundem.list[0].zaman, 1792489139000);
  assert.equal(m.gundem.list[0].kaynak, 'Paratic Haber'); assert.match(m.gundem.list[0].url, /^https:/);
  assert.equal(m.gundem.list.find(x => /Günün/.test(x.baslik)).sembol, 'EKGYO');
  // ozet: secim.json taze ama bos, outlook eski -> BIST 30 konsensusu (GARAN iki model AL)
  assert.equal(m.ozet.kaynak, 'konsensus'); assert.deepEqual(m.ozet.yukselis, ['GARAN']); assert.deepEqual(m.ozet.dusus, []);
  assert.deepEqual(m.ozet.al, [{ symbol: 'GARAN', karar: 'AL', skor: 1, guven: 64 }]); assert.deepEqual(m.ozet.dagilim, { AL: 1, TUT: 3, SAT: 0 });
  assert.deepEqual(m.ozet.riskli.sort(), ['ASTOR', 'TERA']);
});

test('market(): taze secim.json listesi onceliklidir, riskli hisse yukselis listesinde gosterilmez; taze outlook ikinci kaynak', async () => {
  const fx = FX();
  fx.secim.guclu = [{ kod: 'PETKM', ad: 'Petkim' }, { kod: 'ASTOR', ad: 'Astor' }]; fx.secim.zayif = [{ kod: 'PGSUS' }];
  const m = await mk({ fx }).radar.market();
  assert.equal(m.ozet.kaynak, 'secim'); assert.deepEqual(m.ozet.yukselis, ['PETKM']); assert.deepEqual(m.ozet.dusus, ['PGSUS']);
  const fx2 = FX(); fx2.outlook.updatedAt = iso(NOW - 5 * H);
  const m2 = await mk({ fx: fx2 }).radar.market();
  assert.equal(m2.ozet.kaynak, 'outlook'); assert.deepEqual(m2.ozet.yukselis, ['BIMAS', 'THYAO']); assert.deepEqual(m2.ozet.dusus, ['PGSUS']);
  // haber yapay zekasi 3 gunden eskiyse piyasa yorumu verilmez; liste yine var
  const fx3 = FX(); fx3.gundem.haber_ai.zaman = iso(NOW - 4 * DAY); fx3.gundem.haber_ai.ts = Math.floor((NOW - 4 * DAY) / 1000);
  const m3 = await mk({ fx: fx3 }).radar.market();
  assert.equal(m3.gundem.havasi, null); assert.equal(m3.gundem.ozet, null); assert.ok(m3.gundem.list.length > 0);
  // news.json alinamazsa liste gundem.json sirket haberlerinden
  const m4 = await mk({ over: { news: { status: 404 } } }).radar.market();
  assert.ok(m4.gundem.list.length === 2 && m4.gundem.list.every(x => x.sembol === 'THYAO'));
  assert.match(m4.hatalar[0], /^news\.json: Dosya bulunamadı \(HTTP 404\)\.$/);
});

// --- onbellek, ETag, eski veri, hatalar, zaman asimi ---------------------------------------------------------------------
test('onbellek: ttl icinde ag yok; ttl sonra If-None-Match ile sorulur, 304 govdesiz eski veriyi tazeler', async () => {
  const { radar, net, clock } = mk();
  await radar.forSymbol('THYAO');
  const first = net.calls.length;
  assert.equal(first, 11, 'sembol icin 11 dosya');
  await radar.forSymbol('GARAN'); await radar.market();
  assert.equal(net.calls.length, first + 1, 'yalniz endeksler.json yeni (market icin); gerisi onbellekte');
  clock.t += 300000 - 1; await radar.forSymbol('THYAO');
  assert.equal(net.calls.length, first + 1, 'ttl (5 dk) dolmadi');
  clock.t += 2; const n0 = net.calls.length;
  const r = await radar.forSymbol('THYAO');
  const again = net.calls.slice(n0);
  assert.equal(again.length, 11);
  for (const c of again) assert.equal(c.headers['if-none-match'], '"' + c.name + '-1"', 'ETag ile kosullu istek: ' + c.name);
  assert.equal(r.consensus.karar, 'TUT'); assert.equal(r.stale, false);
  const st = radar.status();
  assert.equal(st.ok, true); assert.equal(st.files.ai.at, clock.t, '304 de basarili indirme sayilir'); assert.equal(st.files.ai.ok, true);
});

test('onbellek: ayni dosyaya eszamanli istekler tek istekte birlesir', async () => {
  const { radar, net } = mk();
  await Promise.all([radar.forSymbol('THYAO'), radar.forSymbol('GARAN'), radar.market(), radar.forSymbol('ASELS')]);
  const names = net.calls.map(c => c.name);
  assert.equal(names.length, new Set(names).size, 'her dosya bir kez: ' + names.join(','));
  assert.equal(names.length, 12);
});

test('ag hatasi: eski veri stale:true ile doner, status Turkce hata verir; retryMs dolmadan yeniden istenmez', async () => {
  const over = {};
  const { radar, net, clock } = mk({ over });
  await radar.forSymbol('THYAO');
  over.ai = { throw: new TypeError('fetch failed') }; over.market = { status: 503 };
  clock.t += 300001;
  const r = await radar.forSymbol('THYAO');
  assert.equal(r.stale, true); assert.equal(r.consensus.karar, 'TUT', 'eski ai.json verisiyle'); assert.equal(r.piyasa.fiyat, 268.75);
  const st = radar.status();
  assert.equal(st.ok, false);
  assert.deepEqual(st.errors.sort(), ['ai.json: Hisse Radar\'a bağlanılamadı.', 'market.json: GitHub yanıt vermedi (HTTP 503).']);
  assert.equal(st.files.ai.ok, false); assert.equal(st.files.ai.stale, true); assert.equal(st.files.ai.at, NOW, 'son basarili indirme zamani korunur');
  assert.equal(st.files.olasilik.ok, true);
  // retryMs (60 sn) icinde basarisiz dosya yeniden istenmez
  const n0 = net.calls.length; clock.t += 30000;
  await radar.forSymbol('THYAO');
  assert.ok(!net.calls.slice(n0).some(c => c.name === 'ai' || c.name === 'market'));
  // ag duzelince
  delete over.ai; delete over.market; clock.t += 31000;
  const ok = await radar.forSymbol('THYAO');
  assert.equal(ok.stale, false); assert.equal(radar.status().ok, true); assert.deepEqual(radar.status().errors, []);
});

test('hatalar: hic veri yoksa forSymbol Turkce hata firlatir, market() null; HTTP ve bicim hatalari Turkce', async () => {
  const all = Object.fromEntries(Object.keys(FILES).map(n => [n, { status: 404 }]));
  const { radar } = mk({ over: all });
  await assert.rejects(radar.forSymbol('THYAO'), /^Error: Hisse Radar verisi alınamadı: .+: Dosya bulunamadı \(HTTP 404\)\.$/);
  assert.equal(await radar.market(), null);
  const st = radar.status();
  assert.equal(st.ok, false); assert.equal(st.updatedAt, null); assert.ok(st.errors.length >= 11); assert.equal(st.files.ai.ok, false); assert.equal(st.files.ai.at, null);
  const cases = [[{ status: 429 }, 'GitHub istek sınırına takıldı (HTTP 429); biraz sonra yeniden denenecek.'], [{ status: 403 }, 'GitHub istek sınırına takıldı (HTTP 403); biraz sonra yeniden denenecek.'],
    [{ status: 500 }, 'GitHub yanıt vermedi (HTTP 500).'], [{ status: 418 }, 'GitHub hata verdi (HTTP 418).'], [{ raw: '{bozuk' }, 'Dosya okunamadı (geçersiz JSON).'],
    [{ raw: '[1,2]' }, 'Dosya biçimi beklenmedik.'], [{ raw: 'x'.repeat(8e6 + 1) }, 'Dosya beklenenden büyük; okunmadı.'],
    [{ throw: new Error('ECONNRESET') }, 'Hisse Radar\'a bağlanılamadı.'], ['null', 'Hisse Radar boş yanıt verdi.']];
  for (const [o, msg] of cases) {
    const x = mk({ over: { ai: o } });
    await assert.rejects(x.radar._load('ai'), e => e.message === msg, msg);
    assert.equal(x.radar.status().files.ai.error, msg);
  }
  // fetch hic yoksa
  const nf = createRadar({ fetch: null, now: () => NOW });
  await assert.rejects(nf._load('ai'), /ağ erişimi yok/);
});

test('zaman asimi: varsayilan 12 sn; istek iptal edilir, Turkce hata, eski veri varsa o doner', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { radar, net, clock } = mk({ over: { ai: 'hang' } });
  let done; const p = radar._load('ai').then(v => { done = v; }, e => { done = e; });
  await tick(); t.mock.timers.tick(11999); await tick();
  assert.equal(done, undefined, '12 sn dolmadi');
  t.mock.timers.tick(1); await p;
  assert.ok(done instanceof Error); assert.equal(done.message, 'Hisse Radar yanıt vermedi (zaman aşımı).');
  assert.equal(net.calls[0].signal.aborted, true, 'istek iptal edildi');
  // eski veri varken zaman asimi: stale
  const over = {}; const x = mk({ over });
  await x.radar._load('ai');
  over.ai = 'hang'; x.clock.t += 300001;
  let got; const q = x.radar._load('ai').then(v => { got = v; });
  await tick(); t.mock.timers.tick(12000); await q;
  assert.equal(got.stale, true); assert.equal(got.data.veri, '19 Ekim 2026, 18:09');
  // ozel timeout secenegi
  const y = createRadar({ fetch: fakeNet(FX(), { ai: 'hang' }).fetch, now: () => NOW, timeout: 50 });
  let e2; const q2 = y._load('ai').catch(e => { e2 = e; });
  await tick(); t.mock.timers.tick(50); await q2;
  assert.match(e2.message, /zaman aşımı/);
  void clock;
});

test('status(): baslangicta bos; basaridan sonra dosya basina at/ok/updatedAt; updatedAt = ai.json zamani', async () => {
  const { radar } = mk();
  assert.deepEqual(radar.status(), { ok: false, updatedAt: null, errors: [], files: {} });
  await radar.market();
  const st = radar.status();
  assert.equal(st.ok, true); assert.equal(st.updatedAt, Date.parse('2026-10-19T23:37:35+03:00'));
  assert.deepEqual(Object.keys(st.files).sort(), ['ai', 'ai_genis', 'backtest', 'endeksler', 'gundem', 'news', 'outlook', 'riskli', 'secim']);
  assert.deepEqual(st.files.ai, { at: NOW, ok: true, stale: false, updatedAt: Date.parse('2026-10-19T23:37:35+03:00'), error: null });
  // ai.json yoksa en yeni dosyanin zamani
  const x = mk({ over: { ai: { status: 404 } } });
  await x.radar.market();
  assert.equal(x.radar.status().updatedAt, Date.parse('2026-10-20T13:00:02+03:00'), 'news.json en yeni');
});

test('Hisse Radar ciktilari JSON\'a cevrilebilir (IPC ile pencereye gider) ve girdiyi degistirmez', async () => {
  const fx = FX(), snap = JSON.stringify(fx);
  const { radar } = mk({ fx });
  const r = await radar.forSymbol('THYAO'), m = await radar.market();
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r); assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
  assert.equal(JSON.stringify(fx), snap);
});
