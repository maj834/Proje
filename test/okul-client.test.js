'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createOkul, OGRETMEN_PROMPT, _util } = require('../okul-client.js');

const URL0 = 'https://ornek.supabase.co', ANON = 'anon-test-anahtari';
const DAY = 86400000;
// 20 Ekim 2026 12:00 Istanbul (09:00 UTC)
const NOW = Date.UTC(2026, 9, 20, 9, 0, 0);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'okul-'));

// ornek tablo (okul_icerik satirlari)
function rows() {
  const r = [];
  r.push({ slug: 'analiz-2026-10-19-aksam', tur: 'analiz', baslik: 'Dünün kapanışı', ozet: 'XU100 yatay', tarih: '2026-10-19', konu: 'genel', govde: { bolumler: [{ baslik: 'Genel', metin: 'Sakin gün' }] }, yayinda: true });
  r.push({ slug: 'analiz-2026-10-20-sabah', tur: 'analiz', baslik: 'Sabah bülteni', ozet: 'Asya karışık', tarih: '2026-10-20', konu: 'genel',
    govde: { piyasa: { xu100: { son: 10234.5, degisim: 1.2 } }, bolumler: [{ baslik: 'Gece', metin: 'ABD vadeliler artıda' }], uyari: 'Yatırım tavsiyesi değildir.' }, yayinda: true,
    kaynaklar: [{ ad: 'KAP', url: 'https://www.kap.org.tr/x' }, { ad: 'kotu', url: 'javascript:alert(1)' }, { ad: 'http', url: 'http://a.b' }] });
  r.push({ slug: 'analiz-2026-10-20-aksam', tur: 'analiz', baslik: 'Akşam analizi', ozet: 'Bankalar öncü', tarih: '2026-10-20', konu: 'genel', govde: { bolumler: [] }, yayinda: true });
  for (let i = 1; i <= 5; i++) r.push({ slug: 'ders-00' + i + '-konu-' + i, tur: 'ders', baslik: 'Ders ' + i, ozet: 'Özet ' + i, sira: i, seviye: i < 4 ? 'baslangic' : 'orta',
    konu: i % 2 ? 'temel-kavramlar' : 'bist-kurallari', tarih: i === 4 ? '2026-10-20' : '2026-10-1' + i, video_url: i === 2 ? 'https://youtu.be/abc' : i === 3 ? 'http://kotu' : null,
    govde: { hedefler: ['h'], bolumler: [{ baslik: 'b', metin: 'm' }], alistirmalar: [{ soru: 's', cevap: 'c' }] }, yayinda: true });
  const sor = (slug, tarih, dogru, konu) => ({ slug, tur: 'soru', baslik: slug, tarih, konu, yayinda: true,
    govde: { soru: 'T+2 takas ne demektir? (' + slug + ')', secenekler: ['A', 'B', 'C', 'D'], dogru, aciklama: 'Takas iki iş günü sonra gerçekleşir.', ders_slug: 'ders-002-konu-2', zorluk: 1 } });
  for (let i = 1; i <= 4; i++) r.push(sor('soru-2026-10-20-0' + i, '2026-10-20', i % 4, i % 2 ? 'bist-kurallari' : 'risk'));
  for (let i = 1; i <= 3; i++) r.push(sor('soru-2026-10-19-0' + i, '2026-10-19', 0, 'teknik'));
  r.push({ slug: 'soru-2026-10-18-01', tur: 'soru', baslik: 'bozuk', tarih: '2026-10-18', govde: { soru: 'x', secenekler: ['a'], dogru: 3 }, yayinda: true });
  r.push({ slug: 'sozluk-sermaye-artirimi', tur: 'sozluk', baslik: 'Sermaye Artırımı', tarih: '2026-10-10', govde: { terim: 'Sermaye Artırımı', tanim: 'Şirketin sermayesini bedelli ya da bedelsiz artırması.', ornek: 'Bedelsiz %100' }, yayinda: true });
  r.push({ slug: 'sozluk-devre-kesici', tur: 'sozluk', baslik: 'Devre Kesici', tarih: '2026-10-10', govde: { terim: 'Devre Kesici', tanim: 'Sert fiyat hareketinde işlemlerin geçici durması.' }, yayinda: true });
  r.push({ slug: 'sozluk-takas', tur: 'sozluk', baslik: 'Takas', tarih: '2026-10-10', govde: { terim: 'Takas', tanim: 'T+2 ile para ve hissenin el değiştirmesi; devre kesici ile ilgisi yok.' }, yayinda: true });
  return r;
}

// PostgREST alt kumesini taklit eden sahte fetch
function fakeFetch(data = rows()) {
  const f = async (u, o) => {
    f.calls.push({ url: u, headers: o && o.headers });
    if (f.fail) throw new TypeError('fetch failed');
    if (f.status) return { ok: false, status: f.status, json: async () => ({}) };
    const x = new URL(u);
    assert.equal(x.pathname, '/rest/v1/okul_icerik');
    let out = data.slice();
    let order = [], limit = Infinity;
    for (const [k, v] of x.searchParams) {
      if (k === 'select') continue;
      if (k === 'order') { order = v.split(','); continue; }
      if (k === 'limit') { limit = +v; continue; }
      const [op, ...rest] = v.split('.'); const val = rest.join('.');
      out = out.filter(r => {
        const a = r[k];
        if (op === 'eq') return String(a) === val;
        if (op === 'lt') return a != null && a < val;
        if (op === 'gt') return a != null && +a > +val;
        throw new Error('op ' + op);
      });
    }
    out.sort((a, b) => {
      for (const o of order) {
        const [c, dir] = o.split('.'); const av = a[c], bv = b[c];
        if (av === bv) continue;
        if (av == null) return 1; if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
    const body = out.slice(0, limit).map(r => { const c = { ...r }; delete c.yayinda; return c; });
    return { ok: true, status: 200, json: async () => body };
  };
  f.calls = [];
  return f;
}
const mk = (o = {}) => {
  const clock = { t: NOW };
  const fetch = o.fetch || fakeFetch();
  const ok = createOkul({ fetch, now: () => clock.t, dir: o.dir === undefined ? tmp() : o.dir, url: URL0, anon: ANON, rand: () => 0.42, ...o, fetch });
  return { ok, fetch, clock };
};

test('list: REST adresi, basliklar, ders sirasi, alan secimi, filtreler', async () => {
  const { ok, fetch } = mk();
  const r = await ok.list({ tur: 'ders' });
  assert.equal(r.ok, true); assert.ok(!r.stale);
  assert.deepEqual(r.items.map(x => x.sira), [1, 2, 3, 4, 5]);
  const c = fetch.calls[0], u = new URL(c.url);
  assert.equal(u.origin, URL0);
  assert.equal(u.searchParams.get('tur'), 'eq.ders');
  assert.equal(u.searchParams.get('yayinda'), 'eq.true');
  assert.match(u.searchParams.get('order'), /^sira\.asc/);
  assert.match(u.searchParams.get('select'), /^slug,tur,baslik/);
  assert.ok(!/govde/.test(u.searchParams.get('select')));
  assert.equal(c.headers.apikey, ANON); assert.equal(c.headers.Authorization, 'Bearer ' + ANON);
  assert.equal(r.items[0].govde, undefined);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['baslik', 'etiketler', 'konu', 'ozet', 'semboller', 'seviye', 'sira', 'slug', 'tarih', 'tur', 'video_url']);
  assert.equal(r.items[1].video_url, 'https://youtu.be/abc');
  assert.equal(r.items[2].video_url, null, 'https olmayan video adresi atilir');
  // filtre + sayfa
  const f = await ok.list({ tur: 'ders', seviye: 'baslangic', konu: 'temel-kavramlar' });
  assert.deepEqual(f.items.map(x => x.sira), [1, 3]);
  const b = await ok.list({ tur: 'ders', before: 3 });
  assert.deepEqual(b.items.map(x => x.sira), [4, 5]);
  const a = await ok.list({ tur: 'analiz', limit: 2 });
  assert.deepEqual(a.items.map(x => x.slug), ['analiz-2026-10-20-sabah', 'analiz-2026-10-20-aksam']);
  const old = await ok.list({ tur: 'analiz', before: '2026-10-20' });
  assert.deepEqual(old.items.map(x => x.slug), ['analiz-2026-10-19-aksam']);
  // gecersiz girdiler aga gitmeden reddedilir (enjeksiyon yok)
  const n = fetch.calls.length;
  for (const bad of [{ tur: 'x' }, { tur: 'ders', konu: 'eq.1&x' }, { tur: 'ders', seviye: 'uzman' }, { tur: 'analiz', before: '2026-1-1&a' }]) {
    const e = await ok.list(bad); assert.equal(e.ok, false); assert.ok(e.error.length > 3);
  }
  assert.equal(fetch.calls.length, n);
});

test('get: govde dahil, yalniz https kaynaklar, gecersiz/olmayan slug', async () => {
  const { ok, fetch } = mk();
  const g = await ok.get('analiz-2026-10-20-sabah');
  assert.equal(g.ok, true);
  assert.equal(g.item.govde.piyasa.xu100.son, 10234.5);
  assert.deepEqual(g.item.kaynaklar, [{ ad: 'KAP', url: 'https://www.kap.org.tr/x' }]);
  assert.equal(new URL(fetch.calls[0].url).searchParams.get('slug'), 'eq.analiz-2026-10-20-sabah');
  assert.equal((await ok.get('../etc')).ok, false);
  assert.equal((await ok.get('Buyuk-Harf')).ok, false);
  const yok = await ok.get('ders-999-yok');
  assert.equal(yok.ok, false); assert.match(yok.error, /bulunamadı/);
});

test('onbellek: ttl icinde ag yok; ag duserse eski veri stale, disk onbellegi yeni ornekte cevrimdisi calisir', async () => {
  const dir = tmp();
  const { ok, fetch, clock } = mk({ dir });
  const a = await ok.list({ tur: 'ders' });
  await ok.list({ tur: 'ders' });
  assert.equal(fetch.calls.length, 1, 'ttl icinde ikinci istek yok');
  // eszamanli istekler tek istekte birlesir
  clock.t += 11 * 60000;
  await Promise.all([ok.list({ tur: 'ders' }), ok.list({ tur: 'ders' })]);
  assert.equal(fetch.calls.length, 2);
  clock.t += 11 * 60000; fetch.fail = true;
  const s = await ok.list({ tur: 'ders' });
  assert.equal(s.ok, true); assert.equal(s.stale, true); assert.match(s.uyari, /ulaşılamadı/);
  assert.deepEqual(s.items, a.items);
  await ok.flush();
  assert.ok(fs.existsSync(path.join(dir, 'okul-onbellek.json')));
  // yeni ornek (uygulama yeniden acildi), ag yok -> diskten
  const f2 = fakeFetch(); f2.fail = true;
  const o2 = createOkul({ fetch: f2, now: () => NOW + DAY, dir, url: URL0, anon: ANON });
  const d = await o2.list({ tur: 'ders' });
  assert.equal(d.ok, true); assert.equal(d.stale, true); assert.equal(d.items.length, 5);
  // hic onbellek yoksa Turkce hata
  const e = await o2.list({ tur: 'sozluk' });
  assert.equal(e.ok, false); assert.match(e.error, /Borsa Okulu/);
  // sunucu hatalari
  const f3 = fakeFetch(); f3.status = 401;
  const o3 = createOkul({ fetch: f3, now: () => NOW, dir: null, url: URL0, anon: ANON });
  assert.match((await o3.list({ tur: 'ders' })).error, /reddedildi/);
  // yapilandirilmamis
  const o4 = createOkul({ fetch: fakeFetch(), now: () => NOW, dir: null, url: '', anon: '' });
  assert.match((await o4.list({ tur: 'ders' })).error, /yapılandırılmamış/);
});

test('today: bugunun sabah/aksam analizi, 3 soru (cevapsiz), gunun dersi; yoksa en sonuncusu', async () => {
  const { ok } = mk();
  const t = await ok.today();
  assert.equal(t.ok, true); assert.equal(t.tarih, '2026-10-20');
  assert.equal(t.sabah.slug, 'analiz-2026-10-20-sabah'); assert.equal(t.aksam.slug, 'analiz-2026-10-20-aksam');
  assert.equal(t.sabah.govde.piyasa.xu100.degisim, 1.2);
  assert.equal(t.sorular.length, 3);
  for (const s of t.sorular) { assert.equal(s.dogru, undefined); assert.equal(s.aciklama, undefined); assert.equal(s.secenekler.length, 4); assert.equal(s.tarih, '2026-10-20'); }
  assert.equal(t.ders.slug, 'ders-004-konu-4', 'bugun yayinlanan ders');
  assert.equal(t.dersToplam, 5); assert.equal(t.dersOkunan, 0);
  // ertesi gun icerik yok -> en son gun
  const { ok: o2 } = mk({ now: () => NOW + 3 * DAY });
  const t2 = await o2.today();
  assert.equal(t2.tarih, '2026-10-23');
  assert.equal(t2.aksam.slug, 'analiz-2026-10-20-aksam');
  assert.equal(t2.sorular[0].tarih, '2026-10-20');
  assert.equal(t2.ders.slug, 'ders-001-konu-1', 'okunmamis ilk ders');
  await o2.markRead('ders-001-konu-1');
  assert.equal((await o2.today()).ders.slug, 'ders-002-konu-2');
  // cevaplanan soru gunun sorularinda sona kayar
  const first = t.sorular[0].slug;
  await ok.answer(first, 0);
  const t3 = await ok.today();
  assert.ok(!t3.sorular.slice(0, 3).some(s => s.slug === first) || t3.sorular.findIndex(s => s.slug === first) === 2);
});

test('quiz + answer: puanlama, seri, konu istatistigi, diske kalici ilerleme', async () => {
  const dir = tmp();
  const { ok, clock } = mk({ dir });
  const q = await ok.quiz({ n: 5 });
  assert.equal(q.ok, true); assert.equal(q.sorular.length, 5);
  for (const s of q.sorular) { assert.equal(s.dogru, undefined); assert.ok(/^soru-/.test(s.slug)); }
  assert.ok(!q.sorular.some(s => s.slug === 'soru-2026-10-18-01'), 'bozuk soru elenir');
  // soru-2026-10-20-01: dogru = 1, konu bist-kurallari
  const r1 = await ok.answer('soru-2026-10-20-01', 1);
  assert.equal(r1.ok, true); assert.equal(r1.dogru, true); assert.equal(r1.cevap, 1);
  assert.match(r1.aciklama, /iki iş günü/); assert.equal(r1.ders_slug, 'ders-002-konu-2');
  const r2 = await ok.answer('soru-2026-10-20-03', 3);
  assert.equal(r2.dogru, true); assert.equal(r2.istatistik.seri, 2);
  const r3 = await ok.answer('soru-2026-10-20-02', 0);
  assert.equal(r3.dogru, false); assert.equal(r3.cevap, 2);
  assert.deepEqual({ t: r3.istatistik.toplam, d: r3.istatistik.dogru, s: r3.istatistik.seri, e: r3.istatistik.enIyi, o: r3.istatistik.oran }, { t: 3, d: 2, s: 0, e: 2, o: 67 });
  assert.deepEqual(r3.istatistik.konular['bist-kurallari'], { n: 2, dogru: 2, oran: 100 });
  assert.deepEqual(r3.istatistik.konular.risk, { n: 1, dogru: 0, oran: 0 });
  // gecersiz secim/slug
  assert.equal((await ok.answer('soru-2026-10-20-01', 7)).ok, false);
  assert.equal((await ok.answer('soru-2026-10-20-01', 'a')).ok, false);
  assert.equal((await ok.answer('x', 0)).ok, false);
  assert.equal((await ok.answer('ders-001-konu-1', 0)).ok, false, 'soru olmayan icerik');
  // quiz onceligi: cevaplanmamislar once, sonra yanlislar
  const all = await ok.quiz({ n: 50 });
  const idx = s => all.sorular.findIndex(x => x.slug === s);
  assert.equal(all.sorular.length, 7);
  assert.ok(idx('soru-2026-10-20-02') > idx('soru-2026-10-19-01'), 'yanlis cevaplanan, hic gorulmemisten sonra');
  assert.ok(idx('soru-2026-10-20-01') > idx('soru-2026-10-20-02'), 'dogru cevaplanan en sonda');
  const k = await ok.quiz({ konu: 'teknik' });
  assert.ok(k.sorular.length === 3 && k.sorular.every(s => s.konu === 'teknik'));
  assert.equal((await ok.quiz({ konu: 'yok' })).ok, false);
  await ok.flush();
  // yeni ornek ayni klasorden ilerlemeyi okur; ag olmasa da
  clock.t += 1000;
  const f2 = fakeFetch(); f2.fail = true;
  const o2 = createOkul({ fetch: f2, now: () => NOW + 5000, dir, url: URL0, anon: ANON });
  const p = await o2.progress();
  assert.equal(p.ok, true); assert.equal(p.quiz.toplam, 3); assert.equal(p.quiz.dogru, 2); assert.equal(p.quiz.enIyi, 2);
  assert.equal(p.gun.seri, 1); assert.equal(p.gun.son, '2026-10-20');
});

test('markRead + gun serisi: ardisik gunler artar, bosluk sifirlar; bozuk ilerleme dosyasi guvenle yok sayilir', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'okul-ilerleme.json'), '{bozuk json');
  const { ok, clock } = mk({ dir });
  assert.deepEqual((await ok.progress()).okunan, []);
  await ok.markRead('ders-001-konu-1'); await ok.markRead('ders-001-konu-1');
  clock.t += DAY; await ok.markRead('ders-002-konu-2');
  clock.t += DAY; await ok.markRead('ders-003-konu-3');
  let p = await ok.progress();
  assert.deepEqual(p.okunan, ['ders-001-konu-1', 'ders-002-konu-2', 'ders-003-konu-3']);
  assert.equal(p.gun.seri, 3); assert.equal(p.son.slug, 'ders-003-konu-3');
  clock.t += 3 * DAY;
  assert.equal((await ok.progress()).gun.seri, 0, 'gun atlanmis: seri kirik');
  await ok.markRead('ders-004-konu-4');
  p = await ok.progress(); assert.equal(p.gun.seri, 1);
  assert.equal((await ok.markRead('a/b')).ok, false);
  await ok.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'okul-ilerleme.json'), 'utf8'));
  assert.equal(saved.okunan.length, 4);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
  // normProgress bozuk alanlari temizler
  const n = _util.normProgress({ okunan: ['ok-slug', '../x', 5], quiz: { toplam: 2, dogru: 9, seri: -1 } });
  assert.deepEqual(n.okunan, ['ok-slug']); assert.equal(n.quiz.dogru, 2); assert.equal(n.quiz.seri, 0);
});

test('sozluk: Turkce harf duyarsiz arama, terim eslesmesi tanimdan once', async () => {
  const { ok } = mk();
  const all = await ok.sozluk();
  assert.deepEqual(all.items.map(x => x.terim), ['Devre Kesici', 'Sermaye Artırımı', 'Takas']);
  assert.deepEqual((await ok.sozluk({ q: 'sermaye artirimi' })).items.map(x => x.slug), ['sozluk-sermaye-artirimi']);
  assert.deepEqual((await ok.sozluk({ q: 'ARTIRIM' })).items.map(x => x.slug), ['sozluk-sermaye-artirimi']);
  assert.deepEqual((await ok.sozluk({ q: 'devre' })).items.map(x => x.slug), ['sozluk-devre-kesici', 'sozluk-takas']);
  assert.deepEqual((await ok.sozluk({ q: 'zzz' })).items, []);
  assert.equal(all.items[1].ornek, 'Bedelsiz %100');
  assert.equal(_util.fold('İŞLEM ÇIKIŞ Ğ Ü Ö'), 'islem cikis g u o');
});

test('ask: ogretmen kisiligi, baglam ve gecmis iletilir; hata ve bos cevaplar Turkce', async () => {
  const seen = [];
  const ai = async m => { seen.push(m); return 'Güzel bir noktaya değindin.\n\nSence bu durumda ne olurdu?'; };
  const { ok } = mk({ ai });
  const r = await ok.ask('T+2 takas ne demek?', { baglam: { sembol: 'THYAO', fiyat: 312.5 }, gecmis: [{ rol: 'u', metin: 'Merhaba' }, { rol: 'a', metin: 'Hoş geldin' }] });
  assert.equal(r.ok, true); assert.match(r.cevap, /Sence/);
  assert.equal(seen[0].system, OGRETMEN_PROMPT);
  assert.match(seen[0].user, /THYAO/); assert.match(seen[0].user, /312\.5/);
  assert.match(seen[0].user, /Öğrenci: Merhaba/); assert.match(seen[0].user, /Öğretmen: Hoş geldin/);
  assert.match(seen[0].user, /T\+2 takas ne demek\?$/);
  // nesne bicimli ai yaniti
  const o2 = mk({ ai: async () => ({ ok: true, text: 'Cevap' }) }).ok;
  assert.deepEqual(await o2.ask('soru'), { ok: true, cevap: 'Cevap' });
  const o3 = mk({ ai: async () => ({ ok: false, error: 'Kota doldu' }) }).ok;
  assert.deepEqual(await o3.ask('soru'), { ok: false, error: 'Kota doldu' });
  const o4 = mk({ ai: async () => { throw new Error('ağ yok'); } }).ok;
  assert.match((await o4.ask('soru')).error, /cevap veremedi: ağ yok/);
  const o5 = mk({ ai: async () => '   ' }).ok;
  assert.match((await o5.ask('soru')).error, /boş cevap/);
  assert.match((await mk({ ai: null }).ok.ask('soru')).error, /anahtar/);
  assert.match((await ok.ask('   ')).error, /soru yaz/);
  assert.match((await ok.ask('x'.repeat(2001))).error, /çok uzun/);
});

test('ogretmen istemi: Sokratik, BIST bilgisi, al/sat tavsiyesi yasagi, sayi uydurmama', () => {
  for (const re of [/Sokratik/, /T\+2/, /devre kesici/i, /VBTS/, /stopaj/i, /kademe/i, /ASLA doğrudan al\/sat\/tut tavsiyesi verme/, /Sayıları uydurma/, /Yatırım tavsiyesi değildir/, /Türkçe/])
    assert.match(OGRETMEN_PROMPT, re);
});

test('call koprusu: islemleri yonlendirir, open yalniz https, bilinmeyen islem ve istisnalar {ok:false}', async () => {
  const opened = [];
  const { ok } = mk({ open: async u => { opened.push(u); } });
  assert.equal((await ok.call('list', { tur: 'ders' })).items.length, 5);
  assert.equal((await ok.call('get', { slug: 'ders-001-konu-1' })).item.sira, 1);
  assert.equal((await ok.call('today')).ok, true);
  const q = await ok.call('quiz', { n: 2 }); assert.equal(q.sorular.length, 2);
  assert.equal((await ok.call('answer', { slug: q.sorular[0].slug, secim: 0 })).ok, true);
  assert.equal((await ok.call('markRead', { slug: 'ders-001-konu-1' })).ok, true);
  assert.equal((await ok.call('progress')).quiz.toplam, 1);
  assert.equal((await ok.call('sozluk', { q: 'takas' })).items[0].slug, 'sozluk-takas');
  assert.deepEqual(await ok.call('open', { url: 'https://youtu.be/abc' }), { ok: true });
  assert.equal((await ok.call('open', { url: 'file:///etc/passwd' })).ok, false);
  assert.equal((await ok.call('open', { url: 'javascript:alert(1)' })).ok, false);
  assert.deepEqual(opened, ['https://youtu.be/abc']);
  assert.match((await ok.call('sil')).error, /Bilinmeyen/);
  const bad = createOkul({ fetch: () => { throw new Error('x'); }, now: () => NOW, dir: null, url: URL0, anon: ANON });
  assert.equal((await bad.call('list', { tur: 'ders' })).ok, false);
});

test('yardimcilar: Istanbul tarihi, https denetimi', () => {
  assert.equal(_util.isoDay(Date.UTC(2026, 9, 20, 21, 30)), '2026-10-21', 'UTC 21:30 = Istanbul 00:30 ertesi gun');
  assert.equal(_util.isoDay(Date.UTC(2026, 9, 20, 20, 59)), '2026-10-20');
  assert.equal(_util.isHttps('https://a.b/c'), true);
  assert.equal(_util.isHttps('http://a.b'), false);
  assert.equal(_util.isHttps('nope'), false);
});
