'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('./helpers/util.js');
const P = require('../pano-main.js');

const it = (o) => ({ id: o.id || Math.random().toString(16).slice(2, 18).padEnd(16, '0'), type: 'text', at: 0, pin: false, ...o });

// Sahte resim: boyut buyudukce onizleme buyur
function img(w, h, seed = 'a') {
  return { isEmpty: () => false, getSize: () => ({ width: w, height: h }), toPNG: () => Buffer.from('png:' + seed + ':' + w + 'x' + h),
    resize: (o) => img(o.width, o.height, seed), toDataURL: () => 'data:image/png;base64,' + Buffer.from('x'.repeat(w * h)).toString('base64'),
    toJPEG: () => Buffer.from('j') };
}
const empty = { isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) };

// Sahte pano: set() ile icerik konur, yazma islemleri icerigi degistirir
function clip() {
  const c = { text: '', img: null, extra: {}, formats: [], reads: 0,
    availableFormats: () => { c.reads++; return c.formats.slice(); }, readText: () => c.text, readImage: () => c.img || empty,
    readBuffer: (t) => Buffer.from(c.extra[t] || ''), read: (t) => c.extra[t] || '', has: (t) => t in c.extra,
    writeText: (t) => c.set({ text: t }), writeImage: (im) => c.set({ img: im }), writeBuffer: (t, b) => c.set({ extra: { [t]: b.toString() } }) };
  c.set = ({ text = '', img: im = null, extra = {} }) => {
    c.text = text; c.img = im; c.extra = extra;
    c.formats = [...(text ? ['text/plain'] : []), ...(im ? ['image/png'] : []), ...Object.keys(extra).filter((k) => !k.startsWith('gizli:'))];
    // 'gizli:' ile baslayan anahtar: bicim listesinde gorunmeyen ama has()/readBuffer ile bulunan isaret
    for (const k of Object.keys(extra)) if (k.startsWith('gizli:')) { c.extra[k.slice(6)] = extra[k]; delete c.extra[k]; }
  };
  return c;
}

function setup(t, o = {}) {
  const d = o.dir || tmpDir(); if (!o.dir) t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const cb = o.clip || clip(), handlers = {}, reg = {}, sent = [];
  let visible = false, onReady;
  const wc = { send: (ch, m) => sent.push([ch, m]), setWindowOpenHandler() {}, on() {}, isDevToolsOpened: () => false };
  const winEv = {};
  function Win() { return { webContents: wc, loadFile() {}, isDestroyed: () => false, isVisible: () => visible, getSize: () => [380, 480],
    setPosition() {}, show() { visible = true; }, hide() { visible = false; }, focus() {}, close() { visible = false; winEv.closed && winEv.closed(); },
    on(e, f) { winEv[e] = f; } }; }
  Win.getAllWindows = () => [];
  const ui = P.registerPano({ ipcMain: { handle: (c, f) => { handlers[c] = f; } },
    app: { getPath: () => d, whenReady: () => ({ then: (f) => { onReady = f; } }), on() {} },
    BrowserWindow: Win, path, clipboard: cb,
    nativeImage: { createFromPath: (p) => (fs.existsSync(p) ? img(4, 4, 'disk') : empty) },
    globalShortcut: { register: (a, f) => { if (o.scFail) return false; reg[a] = f; return true; }, unregister: (a) => { delete reg[a]; }, isRegistered: (a) => !!reg[a] },
    screen: { getCursorScreenPoint: () => ({ x: 100, y: 100 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    safeStorage: o.ss || { isEncryptionAvailable: () => false }, cfg: () => ({}), save() {}, isOn: () => true });
  t.after(() => ui.disable());
  onReady();
  const call = (ch, ...a) => handlers[ch]({ sender: wc }, ...a);
  const state = () => { ui.open(); return call('pano:state'); };
  return { ui, cb, handlers, reg, wc, d, call, state, sent, isVisible: () => visible };
}

test('sigOf: yazi, bicim ya da resim boyutu degisince imza degisir', () => {
  const a = P.sigOf({ formats: ['text/plain'], text: 'a', img: null });
  assert.equal(a, P.sigOf({ formats: ['text/plain'], text: 'a', img: null }));
  assert.notEqual(a, P.sigOf({ formats: ['text/plain'], text: 'b', img: null }));
  assert.notEqual(a, P.sigOf({ formats: ['text/plain', 'text/html'], text: 'a', img: null }));
  assert.notEqual(P.sigOf({ formats: ['image/png'], img: '10x10' }), P.sigOf({ formats: ['image/png'], img: '10x11' }));
});

test('addItem: ayni icerik en uste tasinir, kopya olusmaz; sinirda sabitlenenler kalir', () => {
  let l = [it({ key: 'a', id: 'a'.repeat(16) }), it({ key: 'b' }), it({ key: 'c' })];
  let r = P.addItem(l, it({ key: 'c', at: 9 }));
  assert.deepEqual(r.list.map((x) => x.key), ['c', 'a', 'b']);
  assert.equal(r.list[0].at, 9); assert.equal(r.list.length, 3);
  assert.equal(P.addItem(r.list, it({ key: 'c' })).changed, false);   // zaten en ustte
  // 200 sinir: en eski sabitlenmemis atilir, sabit olan (en eski) kalir
  l = []; for (let i = 0; i < 200; i++) l.push(it({ key: 'k' + i, pin: i === 199 }));
  r = P.addItem(l, it({ key: 'yeni' }));
  assert.equal(r.list.length, 200); assert.equal(r.list[0].key, 'yeni');
  assert.equal(r.list.at(-1).key, 'k199'); assert.deepEqual(r.removed.map((x) => x.key), ['k198']);
});

test('search: Turkce buyuk/kucuk harf, kelimelerin hepsi, dosya adlari', () => {
  const l = [it({ text: 'İstanbul Borsası' }), it({ text: 'ISPARTA gülü' }), it({ type: 'files', files: ['/Users/cem/Masaüstü/Rapor.pdf'] }),
    it({ type: 'image', thumb: 'data:image/png;base64,' })];
  assert.equal(P.search(l, 'istanbul').length, 1);
  assert.equal(P.search(l, 'İSTANBUL borsa').length, 1);
  assert.equal(P.search(l, 'ısparta')[0].text, 'ISPARTA gülü');           // tr-TR: I -> ı
  assert.equal(P.search(l, 'rapor')[0].type, 'files');
  assert.equal(P.search(l, 'resim')[0].type, 'image');
  assert.equal(P.search(l, '  ').length, 4);
  assert.equal(P.search(l, 'istanbul ısparta').length, 0);
});

test('ago: goreli zaman Turkce', () => {
  const n = 1e12;
  assert.equal(P.ago(n - 5e3, n), 'az önce'); assert.equal(P.ago(n - 3 * 60e3, n), '3 dk önce');
  assert.equal(P.ago(n - 2 * 3600e3, n), '2 sa önce'); assert.equal(P.ago(n - 26 * 3600e3, n), 'dün'); assert.equal(P.ago(n - 3 * 86400e3, n), '3 gün önce');
});

test('isConcealed: bicim listesi, has() ya da ham veri', () => {
  for (const t of P.CONCEALED) assert.equal(P.isConcealed({}, ['text/plain', t]), true);
  assert.equal(P.isConcealed({ has: (t) => t === 'org.nspasteboard.TransientType' }, []), true);
  assert.equal(P.isConcealed({ readBuffer: (t) => Buffer.from(t === 'org.nspasteboard.AutoGeneratedType' ? '1' : '') }, []), true);
  assert.equal(P.isConcealed({ has: () => false, readBuffer: () => Buffer.alloc(0) }, ['text/plain']), false);
});

test('encode/decode: sifreli ve duz bicim, bozuk veri hata verir', () => {
  const items = [it({ id: 'ab'.repeat(8), text: 'merhaba', key: 'x' })];
  const plain = P.encodeStore(items, { isEncryptionAvailable: () => false });
  assert.equal(JSON.parse(plain).items[0].text, 'merhaba');
  const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() };
  const enc = P.encodeStore(items, ss);
  assert.ok(!enc.includes('merhaba'));
  assert.equal(P.decodeStore(enc, ss)[0].text, 'merhaba');
  assert.equal(P.decodeStore(plain, ss)[0].text, 'merhaba');            // eski duz dosya okunur
  assert.throws(() => P.decodeStore(enc, { isEncryptionAvailable: () => false }));
  assert.throws(() => P.decodeStore(Buffer.from('{bozuk'), null));
  // dogrulama: bilinmeyen tur, gecersiz id, buyuk yazi atilir
  assert.equal(P.normalize([{ id: 'x', type: 'text', text: 'a' }, { id: 'a'.repeat(16), type: 'exe' },
    { id: 'b'.repeat(16), type: 'text', text: 'y'.repeat(P.TEXT_MAX + 1) }]).length, 0);
});

test('registerPano: degisim algilama, tekrar en uste, gizli tur ve buyuk yazi atlanir', (t) => {
  const e = setup(t);
  e.cb.set({ text: 'bir' }); e.ui.tick();
  e.cb.set({ text: 'iki' }); e.ui.tick(); e.ui.tick();                  // ayni icerik ikinci kez sayilmaz
  e.cb.set({ text: 'bir' }); e.ui.tick();
  let s = e.state();
  assert.deepEqual(s.items.map((x) => x.text), ['bir', 'iki']);
  // sifre yoneticisi: bicim listesinde ya da yalniz has()/readBuffer ile gorunen isaret
  e.cb.set({ text: 'Gizli$ifre1', extra: { 'org.nspasteboard.ConcealedType': '' } }); e.ui.tick();
  e.cb.set({ text: 'Gizli$ifre2', extra: { 'gizli:org.nspasteboard.TransientType': '' } }); e.ui.tick();
  e.cb.set({ text: 'x'.repeat(P.TEXT_MAX + 1) }); e.ui.tick();
  e.cb.set({ text: '   \n' }); e.ui.tick();
  s = e.call('pano:state');
  assert.deepEqual(s.items.map((x) => x.text), ['bir', 'iki']);
  assert.equal(e.ui.status(), '2 kayıt');
  e.ui.flush();
  assert.ok(!fs.readFileSync(path.join(e.d, 'pano', 'gecmis.json'), 'utf8').includes('Gizli'));
});

test('registerPano: duraklatma, gonderen kontrolu, geri kopyalama yeni kayit sayilmaz', (t) => {
  const e = setup(t);
  e.cb.set({ text: 'eski' }); e.ui.tick(); e.cb.set({ text: 'yeni' }); e.ui.tick();
  e.state();
  // baska pencereden gelen istekler reddedilir
  const bad = { sender: {} };
  for (const ch of ['pano:state', 'pano:pause', 'pano:clear']) assert.equal(e.handlers[ch](bad), null);
  for (const ch of ['pano:copy', 'pano:del', 'pano:pin']) assert.equal(e.handlers[ch](bad, e.call('pano:state').items[0].id), null);
  assert.equal(e.handlers['pano:find'](bad, 'x'), null);
  assert.equal(e.call('pano:copy', '../../etc'), null);                 // gecersiz id
  // duraklat: kopyalanan kaydedilmez, devam edince de sonradan eklenmez
  assert.equal(e.call('pano:pause').paused, 10); assert.match(e.ui.status(), /duraklatıldı/);
  e.cb.set({ text: 'duraklamada' }); e.ui.tick();
  assert.equal(e.call('pano:pause').paused, 0); e.ui.tick();
  assert.equal(e.call('pano:state').items.length, 2);
  // geri kopyalama: panoya yazar, pencereyi gizler, en uste tasir, yeni kayit olmaz
  const old = e.call('pano:state').items.find((x) => x.text === 'eski');
  assert.equal(e.isVisible(), true);
  assert.deepEqual(e.call('pano:copy', old.id), { ok: true });
  assert.equal(e.cb.text, 'eski'); assert.equal(e.isVisible(), false);
  e.ui.tick(); e.ui.tick();
  assert.deepEqual(e.call('pano:state').items.map((x) => x.text), ['eski', 'yeni']);
  // arama id dondurur
  assert.deepEqual(e.call('pano:find', 'YEN'), [e.call('pano:state').items[1].id]);
  // sil
  assert.deepEqual(e.call('pano:del', old.id).items.map((x) => x.text), ['yeni']);
});

test('registerPano: sabitleme (en fazla 30, ustte gosterilir, atilmaz) ve tumunu sil', (t) => {
  const e = setup(t);
  for (let i = 0; i < 31; i++) { e.cb.set({ text: 's' + i }); e.ui.tick(); }
  e.state();
  const ids = e.call('pano:state').items.map((x) => x.id);
  for (let i = 0; i < 30; i++) assert.equal(e.call('pano:pin', ids[i]).err, undefined);
  assert.match(e.call('pano:pin', ids[30]).err, /En fazla 30/);
  for (let i = 0; i < 200; i++) { e.cb.set({ text: 'd' + i }); e.ui.tick(); }
  const s = e.call('pano:state');
  assert.equal(s.items.length, 200);
  assert.equal(s.items.filter((x) => x.pin).length, 30); assert.ok(s.items.slice(0, 30).every((x) => x.pin));
  assert.equal(s.items[30].text, 'd199');
  assert.equal(e.call('pano:clear').items.length, 0); assert.equal(e.ui.status(), '0 kayıt');
});

test('registerPano: resim kaydi (onizleme + dosya), dosya kopyasi, silince dosya gider', (t) => {
  const e = setup(t);
  e.cb.set({ img: img(1200, 800, 'r1') }); e.ui.tick();
  let s = e.state(); const im = s.items[0];
  assert.equal(im.type, 'image'); assert.equal(im.w, 1200); assert.ok(im.thumb.startsWith('data:image/png;base64,') && im.thumb.length <= 64 * 1024);
  const f = path.join(e.d, 'pano', 'img', im.id + '.png');
  assert.equal(fs.readFileSync(f, 'utf8'), 'png:r1:1200x800');
  e.cb.set({ text: 'ara' }); e.ui.tick();
  e.cb.set({ img: img(1200, 800, 'r1') }); e.ui.tick();               // ayni resim: en uste, yeni dosya yok
  s = e.call('pano:state'); assert.equal(s.items.length, 2); assert.equal(s.items[0].id, im.id);
  assert.equal(fs.readdirSync(path.join(e.d, 'pano', 'img')).length, 1);
  // Finder dosya kopyasi: yazi (dosya adi) olsa da dosya kaydi oncelikli
  e.cb.set({ text: 'Rapor.pdf', extra: { NSFilenamesPboardType: P.plist(['/Users/cem/A & B.pdf', '/Users/cem/Rapor.pdf']) } }); e.ui.tick();
  s = e.call('pano:state'); assert.equal(s.items[0].type, 'files'); assert.deepEqual(s.items[0].files, ['/Users/cem/A & B.pdf', '/Users/cem/Rapor.pdf']);
  e.cb.set({ extra: { 'public.file-url': 'file:///Users/cem/Tek%20Dosya.txt' } }); e.ui.tick();
  assert.deepEqual(e.call('pano:state').items[0].files, ['/Users/cem/Tek Dosya.txt']);
  // resmi geri kopyala, sonra sil
  assert.deepEqual(e.call('pano:copy', im.id), { ok: true }); assert.equal(e.cb.img.getSize().width, 4);
  e.ui.tick(); assert.equal(e.call('pano:state').items.length, 4);
  e.call('pano:del', im.id); assert.equal(fs.existsSync(f), false);
});

test('registerPano: kalicilik (duz JSON 0600, atomik) ve bozuk dosyadan kurtarma', (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const t1 = { after: (f) => t.after(f) };
  const a = setup(t1, { dir: d });
  a.cb.set({ text: 'kalıcı' }); a.ui.tick(); a.cb.set({ text: 'ikinci' }); a.ui.tick();
  a.state(); a.call('pano:pin', a.call('pano:state').items[1].id);
  a.ui.disable();                                                      // kapatinca diske yazilir
  const file = path.join(d, 'pano', 'gecmis.json');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.join(d, 'pano')).filter((x) => x.endsWith('.tmp')), []);
  const b = setup(t1, { dir: d, clip: a.cb });
  const s = b.state();
  assert.deepEqual(s.items.map((x) => [x.text, x.pin]), [['kalıcı', true], ['ikinci', false]]);
  b.ui.disable();
  // bozuk dosya: bos baslar, eskisi .bozuk olarak saklanir
  fs.writeFileSync(file, '{"v":1,"items":[bozuk');
  const c = setup(t1, { dir: d, clip: clip() });
  assert.equal(c.state().items.length, 0);
  assert.equal(fs.readFileSync(file + '.bozuk', 'utf8'), '{"v":1,"items":[bozuk');
});

test('registerPano: sifreli kayit safeStorage varsa duz metin icermez', (t) => {
  const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s, 'utf8').map((x) => x ^ 0x5a), decryptString: (b) => Buffer.from(b).map((x) => x ^ 0x5a).toString('utf8') };
  const e = setup(t, { ss });
  e.cb.set({ text: 'banka notu' }); e.ui.tick(); e.ui.flush();
  const raw = fs.readFileSync(path.join(e.d, 'pano', 'gecmis.json'));
  assert.ok(!raw.includes('banka')); assert.equal(P.decodeStore(raw, ss)[0].text, 'banka notu');
});

test('kisayol: acilista kaydolur, kapatinca kalkar, alinamazsa durumda yazar, rearm geri alir', (t) => {
  const e = setup(t);
  assert.equal(typeof e.reg[P.SHORTCUT], 'function');
  delete e.reg[P.SHORTCUT]; e.ui.rearm(); assert.equal(typeof e.reg[P.SHORTCUT], 'function');
  e.reg[P.SHORTCUT](); assert.equal(e.isVisible(), true);             // ⌘⇧V pencereyi acar
  e.ui.disable(); assert.equal(e.reg[P.SHORTCUT], undefined); assert.equal(e.ui.status(), null);
  const f = setup(t, { scFail: true });
  assert.equal(f.ui.status(), '0 kayıt · ⌘⇧V kısayolu alınamadı');
  assert.equal(f.state().shortcut, false);
});
