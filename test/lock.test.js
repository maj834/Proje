'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { tmpDir } = require('./helpers/util.js');
const L = require('../lock.js');

const PW = 'gizli-sifre-1';
const KB = 1024;

// Sahte Anahtar Zinciri: protect/unprotect (gercekte safeStorage)
function fakeKeychain() {
  const store = new Map();
  return {
    protect: b => { const id = crypto.randomBytes(8).toString('hex'); store.set(id, Buffer.from(b)); return 'kc:' + id; },
    unprotect: s => { const b = store.get(String(s).slice(3)); if (!b) throw new Error('yok'); return Buffer.from(b); },
    store,
  };
}

async function setup(t, extra = {}) {
  const root = tmpDir(), home = path.join(root, 'home'), vdir = path.join(root, 'vault'), tmpRoot = path.join(root, 'tmp');
  fs.mkdirSync(home); fs.mkdirSync(tmpRoot);
  const flags = [], bflags = [], kc = fakeKeychain(), trashed = [];
  // yedek baglarin bayraklari ayri tutulur (flags yalnizca gorunen dosyalar)
  const bdir = path.join(vdir, 'yedek');
  const chflags = async (p, on) => { (p.startsWith(bdir + path.sep) ? bflags : flags).push([p, on]); };
  const trash = async p => { const d = path.join(root, 'Trash'); fs.mkdirSync(d, { recursive: true }); fs.renameSync(p, path.join(d, path.basename(p))); trashed.push(p); };
  const V = L.createVault({ dir: vdir, home, chflags, trash, tmpRoot, chunk: 64 * KB, protect: kc.protect, unprotect: kc.unprotect, scryptN: 2 ** 15, ...extra });
  t.after(() => { V.lock(); fs.rmSync(root, { recursive: true, force: true }); });
  await V.setup(PW);
  const write = (name, data) => { const p = path.join(home, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
  return { V, root, home, vdir, tmpRoot, flags, bflags, bdir, kc, trashed, write };
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const leftovers = d => fs.readdirSync(d).filter(n => /\.(aciliyor|kilitleniyor|yenileniyor)$/.test(n));

test('kucuk, bos ve buyuk (5 MB, 64 KB parca) dosyalar gidip geliyor', async (t) => {
  const { V, home, flags } = await setup(t);
  const cases = { 'kucuk.txt': Buffer.from('merhaba dunya'), 'bos.dat': Buffer.alloc(0),
    'tam.bin': crypto.randomBytes(128 * KB), 'buyuk.bin': crypto.randomBytes(5 * 1024 * KB + 123) };
  for (const [name, data] of Object.entries(cases)) {
    const src = path.join(home, name); fs.writeFileSync(src, data);
    let prog = 0;
    const r = await V.lockFile(src, { onProgress: d => { prog = d; } });
    assert.equal(r.path, src + '.kilitli'); assert.equal(r.name, name); assert.equal(r.size, data.length); assert.equal(r.flagged, true);
    assert.equal(prog, data.length);
    assert.ok(!fs.existsSync(src), 'orijinal silinmeli');
    const enc = fs.readFileSync(r.path);
    assert.equal(enc.subarray(0, 8).toString(), 'GOKILIT1');
    if (data.length > 32) assert.equal(enc.indexOf(data.subarray(0, 32)), -1, 'duz metin gorunmemeli');
    assert.equal(fs.statSync(r.path).mode & 0o777, 0o600);
    const meta = await V.verify(r.path);
    assert.equal(meta.sha256, sha(data)); assert.equal(meta.size, data.length);
    const out = path.join(home, 'cikti-' + name);
    await V.decryptTo(r.path, out);
    assert.ok(fs.readFileSync(out).equals(data));
  }
  assert.deepEqual(flags.map(f => [path.basename(f[0]), f[1]]), Object.keys(cases).map(n => [n + '.kilitli', true]));
  assert.equal(V.files().length, 4);
});

test('encryptStream/decryptStream: bos dosya tek bos son parca', async () => {
  const d = tmpDir(), dk = crypto.randomBytes(32), src = path.join(d, 'a'), out = path.join(d, 'a.k');
  fs.writeFileSync(src, '');
  const m = await L.encryptStream(dk, src, out, { chunk: 16 });
  assert.equal(m.size, 0);
  const sz = fs.statSync(out).size, hl = fs.readFileSync(out).readUInt32BE(25);
  assert.equal(sz, 29 + hl + 4 + 16);
  const chunks = []; await L.decryptStream(dk, out, b => chunks.push(Buffer.from(b)));
  assert.equal(Buffer.concat(chunks).length, 0);
  await assert.rejects(L.decryptStream(crypto.randomBytes(32), out, null), { code: 'AUTH' });
  fs.rmSync(d, { recursive: true, force: true });
});

// Kilitli dosyanin parca konumlari
function chunks(file) {
  const b = fs.readFileSync(file), hl = b.readUInt32BE(25); let pos = 29 + hl; const list = [];
  while (pos < b.length) { const n = b.readUInt32BE(pos); list.push({ pos, len: 4 + n + 16 }); pos += 4 + n + 16; }
  return { b, hl, list };
}

test('degistirme tespit ediliyor ve geride cikti kalmiyor', async (t) => {
  const { V, home, write } = await setup(t);
  const data = crypto.randomBytes(300 * KB);
  const mk = async name => { const r = await V.lockFile(write(name, data)); return r.path; };
  const expectFail = async (p, label) => {
    const out = path.join(home, 'out-' + label);
    await assert.rejects(V.decryptTo(p, out), e => ['TAMPER', 'AUTH', 'FORMAT'].includes(e.code), label);
    assert.ok(!fs.existsSync(out), label + ': cikti kalmamali');
    assert.deepEqual(leftovers(home), [], label + ': gecici dosya kalmamali');
    await assert.rejects(V.verify(p), label);
  };

  let p = await mk('bit.bin'); let c = chunks(p);
  c.b[c.list[1].pos + 10] ^= 1; fs.writeFileSync(p, c.b); await expectFail(p, 'bit');

  p = await mk('etiket.bin'); c = chunks(p);
  c.b[c.list[2].pos + c.list[2].len - 1] ^= 0x80; fs.writeFileSync(p, c.b); await expectFail(p, 'etiket');

  p = await mk('kes.bin'); c = chunks(p);
  fs.truncateSync(p, c.list.at(-1).pos); await expectFail(p, 'son-parca-yok');

  p = await mk('kes2.bin'); c = chunks(p);
  fs.truncateSync(p, c.b.length - 5); await expectFail(p, 'kesik');

  p = await mk('sira.bin'); c = chunks(p);
  const [a, b2] = c.list; assert.equal(a.len, b2.len);
  const swapped = Buffer.concat([c.b.subarray(0, a.pos), c.b.subarray(b2.pos, b2.pos + b2.len), c.b.subarray(a.pos, a.pos + a.len), c.b.subarray(b2.pos + b2.len)]);
  fs.writeFileSync(p, swapped); await expectFail(p, 'sira');

  p = await mk('baslik.bin'); c = chunks(p);
  c.b[29 + 20] ^= 1; fs.writeFileSync(p, c.b); await expectFail(p, 'baslik');

  p = await mk('tuz.bin'); c = chunks(p);
  c.b[12] ^= 1; fs.writeFileSync(p, c.b); await expectFail(p, 'tuz');

  p = await mk('ek.bin');
  fs.appendFileSync(p, Buffer.alloc(40)); await expectFail(p, 'sona-ek');

  p = await mk('magic.bin'); c = chunks(p);
  c.b[0] = 0x58; fs.writeFileSync(p, c.b); await expectFail(p, 'magic');
});

test('yanlis sifre, deneme siniri ve 30 sn bekleme', async (t) => {
  let clock = 1_000_000;
  const { V, vdir } = await setup(t, { now: () => clock, scryptN: undefined });
  V.lock(); assert.equal(V.isUnlocked(), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(vdir, 'vault.json'))).kdf.N, 2 ** 17, 'yeni kasalar N=2^17');
  assert.equal(fs.statSync(path.join(vdir, 'vault.json')).mode & 0o777, 0o600);
  for (let i = 1; i <= 4; i++) await assert.rejects(V.unlockWithPassword('yanlis-' + i), { code: 'WRONG', message: new RegExp(`${5 - i} deneme`) });
  await assert.rejects(V.unlockWithPassword('yanlis-5'), { code: 'WAIT' });
  await assert.rejects(V.unlockWithPassword(PW), { code: 'WAIT', message: /30 saniye/ });
  clock += 31_000;
  assert.equal(await V.unlockWithPassword(PW), true);
  assert.equal(V.isUnlocked(), true);
});

test('ilk kurulum: kisa sifre reddedilir, ikinci kurulum yok', async (t) => {
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const V = L.createVault({ dir: path.join(d, 'v'), home: d });
  assert.equal(V.hasPassword(), false);
  await assert.rejects(V.setup('12345'), { code: 'WEAK' });
  await assert.rejects(V.setup('1234567'), { code: 'WEAK', message: /en az 8/ });
  await assert.rejects(V.unlockWithPassword('abcdef'), { code: 'NOSETUP' });
  await V.setup('12345678'); assert.equal(V.hasPassword(), true); assert.equal(V.hasBiometric(), false);
  await assert.rejects(V.setup('baska-sifre'), { code: 'EXISTS' });
  V.lock();
});

test('sifre degisince dosyalar hala aciliyor, eski sifre gecmiyor', async (t) => {
  const { V, write, home } = await setup(t);
  const data = crypto.randomBytes(70 * KB);
  const r = await V.lockFile(write('belge.pdf', data));
  await assert.rejects(V.changePassword('yanlis-eski', 'yeni-sifre-9'), { code: 'WRONG' });
  await assert.rejects(V.changePassword(PW, 'kisa'), { code: 'WEAK' });
  await V.changePassword(PW, 'yeni-sifre-9');
  V.lock();
  await assert.rejects(V.unlockWithPassword(PW), { code: 'WRONG' });
  await V.unlockWithPassword('yeni-sifre-9');
  const out = path.join(home, 'x'); await V.decryptTo(r.path, out);
  assert.ok(fs.readFileSync(out).equals(data));
  await V.resetPassword('ucuncu-sifre');
  V.lock(); await V.unlockWithPassword('ucuncu-sifre');
  await V.verify(r.path);
});

test('dogrulama basarisizsa orijinal korunur, yarim cikti silinir', async (t) => {
  const { V, home, write, flags } = await setup(t);
  const data = crypto.randomBytes(200 * KB), src = write('foto.jpg', data);
  await assert.rejects(V.lockFile(src, { beforeVerify: tmp => { const b = fs.readFileSync(tmp); b[b.length - 100] ^= 1; fs.writeFileSync(tmp, b); } }), { code: 'VERIFY' });
  assert.ok(fs.readFileSync(src).equals(data));
  assert.ok(!fs.existsSync(src + '.kilitli'));
  assert.deepEqual(fs.readdirSync(home), ['foto.jpg']);
  assert.equal(flags.length, 0); assert.equal(V.files().length, 0);
  // disk dolu
  const V2 = L.createVault({ dir: path.join(home, '..', 'v2'), home, freeBytes: () => 10 * 1024 * 1024 });
  await V2.setup(PW); t.after(() => V2.lock());
  await assert.rejects(V2.lockFile(src), { code: 'SPACE' });
  assert.ok(fs.readFileSync(src).equals(data));
  // orijinal silinemezse kilitleme geri alinir (salt okunur klasor; root degilse)
  if (process.getuid && process.getuid() !== 0) {
    const ro = path.join(home, 'ro'); fs.mkdirSync(ro); const s2 = path.join(ro, 'a.txt'); fs.writeFileSync(s2, 'x');
    // izin hemen geri verilir: t.after sirasi setup'in klasor silmesinden sonraya kalabilir
    fs.chmodSync(ro, 0o500);
    try { await assert.rejects(V.lockFile(s2)); assert.deepEqual(fs.readdirSync(ro), ['a.txt']); }
    finally { fs.chmodSync(ro, 0o700); }
  }
});

test('kilidi kaldir: ad geri gelir, cakismada "(kilit acildi)" eklenir, uchg temizlenir', async (t) => {
  const { V, home, write, flags } = await setup(t);
  const data = Buffer.from('rapor icerigi'), src = write('dir/rapor.final.txt', data);
  const mtime = new Date('2024-01-02T03:04:05Z'); fs.utimesSync(src, mtime, mtime); fs.chmodSync(src, 0o640);
  const r = await V.lockFile(src);
  let u = await V.unlockFile(r.path);
  assert.equal(u.path, src); assert.ok(fs.readFileSync(src).equals(data));
  assert.equal(fs.statSync(src).mtimeMs, mtime.getTime()); assert.equal(fs.statSync(src).mode & 0o777, 0o640);
  assert.ok(!fs.existsSync(r.path)); assert.equal(V.files().length, 0);
  assert.deepEqual(flags.map(f => f[1]), [true, false]); assert.equal(flags[1][0], r.path);

  const r2 = await V.lockFile(src);
  fs.writeFileSync(src, 'baska');
  u = await V.unlockFile(r2.path);
  assert.equal(path.basename(u.path), 'rapor.final (kilit açıldı).txt');
  assert.ok(fs.readFileSync(u.path).equals(data)); assert.equal(fs.readFileSync(src, 'utf8'), 'baska');
  const r3 = await V.lockFile(src);
  fs.writeFileSync(src, 'yine');
  u = await V.unlockFile(r3.path);
  assert.equal(path.basename(u.path), 'rapor.final (kilit açıldı 2).txt');
  assert.equal(fs.readFileSync(u.path, 'utf8'), 'baska');
  assert.deepEqual(leftovers(path.dirname(src)), []);
});

test('reddedilenler: sembolik bag, .kilitli, klasor, ev disi, uygulama paketi, kasa klasoru', async (t) => {
  const { V, home, root, vdir, write } = await setup(t);
  const real = write('gercek.txt', 'x');
  fs.symlinkSync(real, path.join(home, 'bag.txt'));
  await assert.rejects(V.lockFile(path.join(home, 'bag.txt')), { code: 'SYMLINK' });
  write('eski.kilitli', 'x'); await assert.rejects(V.lockFile(path.join(home, 'eski.kilitli')), { code: 'ALREADY' });
  fs.mkdirSync(path.join(home, 'klasor')); await assert.rejects(V.lockFile(path.join(home, 'klasor')), { code: 'DIR', message: /klasör/ });
  const out = path.join(root, 'disari.txt'); fs.writeFileSync(out, 'x');
  await assert.rejects(V.lockFile(out), { code: 'OUTSIDE' });
  await assert.rejects(V.lockFile('goreli.txt'), { code: 'PATH' });
  await assert.rejects(V.lockFile(path.join(home, 'yok.txt')), { code: 'NOENT' });
  write('Uyg.app/Contents/x.plist', 'x'); await assert.rejects(V.lockFile(path.join(home, 'Uyg.app/Contents/x.plist')), { code: 'BUNDLE' });
  fs.linkSync(real, path.join(home, 'sabit.txt')); await assert.rejects(V.lockFile(real), { code: 'NLINK' });
  // ev icinde kasa klasoru
  const V2 = L.createVault({ dir: path.join(home, 'kasa'), home }); await V2.setup(PW); t.after(() => V2.lock());
  await assert.rejects(V2.lockFile(path.join(home, 'kasa', 'vault.json')), { code: 'DENY' });
  // sembolik bag ile ev disina kacis
  fs.symlinkSync(root, path.join(home, 'kok'));
  await assert.rejects(V.lockFile(path.join(home, 'kok', 'disari.txt')), { code: 'OUTSIDE' });
  assert.ok(vdir);
});

test('oturum kilitlenince DK sifirlanir, islemler reddedilir, bosta otomatik kilit', async (t) => {
  const { V, write } = await setup(t, { idleMs: 60 });
  const r = await V.lockFile(write('a.txt', 'abc'));
  const dk = V._peek(); assert.equal(dk.length, 32); assert.ok(dk.some(b => b !== 0));
  V.lock();
  assert.ok(dk.every(b => b === 0), 'DK sifirlanmali'); assert.equal(V._peek(), null);
  await assert.rejects(V.verify(r.path), { code: 'LOCKED' });
  await assert.rejects(V.lockFile(write('b.txt', 'x')), { code: 'LOCKED' });
  await V.unlockWithPassword(PW);
  assert.ok(V.remainingMs() > 0);
  const dk2 = V._peek();
  await new Promise(ok => setTimeout(ok, 150));
  assert.equal(V.isUnlocked(), false); assert.ok(dk2.every(b => b === 0));
});

test('Touch ID yolu: sahte biyometri + protect/unprotect', async (t) => {
  let asked = null, allow = true;
  const { V, kc, write, home } = await setup(t, { biometric: async reason => { asked = reason; if (!allow) throw new Error('iptal'); } });
  assert.equal(V.hasBiometric(), true); assert.equal(kc.store.size, 1);
  const data = Buffer.from('touch id ile acilan'); const r = await V.lockFile(write('t.txt', data));
  V.lock();
  allow = false; await assert.rejects(V.unlockBiometric(), { code: 'BIO' }); assert.equal(V.isUnlocked(), false);
  allow = true; await V.unlockBiometric(); assert.equal(asked, 'kilitli dosyaları açmak');
  const out = path.join(home, 'o.txt'); await V.decryptTo(r.path, out); assert.ok(fs.readFileSync(out).equals(data));
  V.lock();
  // Anahtar Zinciri bozuk -> sifreyle kurtarma
  await assert.rejects(V.unlockBiometric(() => { throw new Error('keychain'); }), { code: 'KEYCHAIN' });
  await assert.rejects(V.unlockBiometric(() => crypto.randomBytes(32)), { code: 'KEY' });
  await V.unlockWithPassword(PW); assert.equal(V.isUnlocked(), true);
  // unlockWithKey dogrudan
  V.lock(); const k = [...kc.store.values()][0];
  V.unlockWithKey(k); assert.equal(V.isUnlocked(), true);
  assert.throws(() => V.unlockWithKey(Buffer.alloc(32)), { code: 'KEY' });
});

test('Ac: ozel gecici kopya, kaydet ve yeniden kilitle, kilitlenince silinir', async (t) => {
  const { V, write, flags, tmpRoot } = await setup(t);
  const r = await V.lockFile(write('not.txt', 'ilk surum'));
  const tp = await V.openTemp(r.path);
  assert.equal(path.basename(tp), 'not.txt'); assert.ok(tp.startsWith(tmpRoot));
  assert.equal(fs.statSync(path.dirname(tp)).mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(tp, 'utf8'), 'ilk surum');
  assert.equal(await V.openTemp(r.path), tp, 'ikinci acista ayni kopya');
  assert.equal(V.files()[0].opened, true);
  fs.writeFileSync(tp, 'ikinci surum, daha uzun');
  flags.length = 0;
  const s = await V.saveTemp(r.path);
  assert.equal(s.flagged, true); assert.deepEqual(flags.map(f => f[1]), [false, true]);
  assert.equal(V.files()[0].size, 'ikinci surum, daha uzun'.length);
  const m = await V.verify(r.path); assert.equal(m.name, 'not.txt');
  V.lock();
  assert.ok(!fs.existsSync(tp)); assert.ok(!fs.existsSync(path.dirname(tp)));
  await V.unlockWithPassword(PW);
  await assert.rejects(V.saveTemp(r.path), { code: 'NOTEMP' });
  const u = await V.unlockFile(r.path); assert.equal(fs.readFileSync(u.path, 'utf8'), 'ikinci surum, daha uzun');
});

test('relock basarisizsa eski kilitli dosya aynen kalir', async (t) => {
  const { V, write, home } = await setup(t);
  const r = await V.lockFile(write('k.txt', 'eski'));
  const before = fs.readFileSync(r.path);
  const from = write('yeni.txt', 'yeni icerik');
  await assert.rejects(V.relock(r.path, from, { beforeVerify: tmp => fs.appendFileSync(tmp, 'x') }), { code: 'VERIFY' });
  assert.ok(fs.readFileSync(r.path).equals(before));
  assert.deepEqual(fs.readdirSync(home).sort(), ['k.txt.kilitli', 'yeni.txt']);
});

test('Sil: bayrak kaldirilir, Cop Sepeti\'ne tasinir; kayit ve bulunamadi', async (t) => {
  const { V, write, flags, trashed } = await setup(t);
  const a = await V.lockFile(write('a.txt', 'a')), b = await V.lockFile(write('b.txt', 'b'));
  flags.length = 0;
  await V.removeLocked(a.path);
  assert.deepEqual(trashed, [a.path]); assert.deepEqual(flags, [[a.path, false]]);
  assert.deepEqual(V.files().map(f => f.name), ['b.txt']);
  // Cop Sepeti hatasi -> bayrak geri
  flags.length = 0;
  await assert.rejects(V.removeLocked(b.path, { trash: async () => { throw new Error('olmadi'); } }), { code: 'TRASH' });
  assert.deepEqual(flags.map(f => f[1]), [false, true]); assert.ok(fs.existsSync(b.path));
  // dosya disarida silinirse "bulunamadi"
  fs.rmSync(b.path);
  const f = V.files(); assert.equal(f.length, 1); assert.equal(f[0].missing, true);
  assert.equal(await V.forget(f[0].id), true); assert.equal(V.files().length, 0);
  // kayitta icerik yok, yalnizca yol/ad/boyut/tarih
  const reg = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(a.path)), 'vault', 'registry.json')));
  assert.deepEqual(reg, []);
});

test('adopt: tasinan .kilitli dosya listeye geri eklenir; baska kasanin dosyasi eklenmez', async (t) => {
  const { V, write, home } = await setup(t);
  const r = await V.lockFile(write('x.bin', crypto.randomBytes(1000)));
  const moved = path.join(home, 'tasindi.bin.kilitli'); fs.renameSync(r.path, moved);
  assert.equal(V.files()[0].missing, true);
  const e = await V.adopt(moved); assert.equal(e.name, 'x.bin');
  const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const other = L.createVault({ dir: d, home }); await other.setup('baska-sifre'); t.after(() => other.lock());
  await assert.rejects(other.adopt(moved), { code: 'AUTH' });
});

test('safeName ve freeName', () => {
  assert.equal(L.safeName('../../etc/passwd'), 'passwd');
  assert.equal(L.safeName('a\u0000b'), 'a_b');
  assert.equal(L.safeName('..'), 'dosya');
  const d = tmpDir(); fs.writeFileSync(path.join(d, 'a.txt'), '');
  assert.equal(path.basename(L.freeName(d, 'a.txt')), 'a (kilit açıldı).txt');
  assert.equal(path.basename(L.freeName(d, 'b.txt')), 'b.txt');
  fs.rmSync(d, { recursive: true, force: true });
});

test('yanlis deneme sayaci yeniden baslatmada sifirlanmaz, bekleme katlanir', async (t) => {
  let clock = 5_000_000;
  const { V, vdir, tmpRoot, home } = await setup(t, { now: () => clock });
  V.lock();
  const again = () => L.createVault({ dir: vdir, home, tmpRoot, now: () => clock });
  for (let i = 1; i <= 3; i++) await assert.rejects(V.unlockWithPassword('yanlis-' + i), { code: 'WRONG' });
  // "uygulama yeniden acildi": sayac kaldigi yerden devam eder
  let V2 = again();
  await assert.rejects(V2.unlockWithPassword('yanlis-4'), { code: 'WRONG', message: /1 deneme/ });
  await assert.rejects(V2.unlockWithPassword('yanlis-5'), { code: 'WAIT', message: /30 saniye/ });
  V2 = again();
  await assert.rejects(V2.unlockWithPassword(PW), { code: 'WAIT' }, 'yeniden baslatma beklemeyi atlatmaz');
  clock += 31_000;
  for (let i = 1; i <= 4; i++) await assert.rejects(V2.unlockWithPassword('x' + i), { code: 'WRONG' });
  await assert.rejects(V2.unlockWithPassword('x5'), { code: 'WAIT', message: /60 saniye/ });
  clock += 61_000;
  assert.equal(await again().unlockWithPassword(PW), true);
  assert.ok(!fs.existsSync(path.join(vdir, 'attempts.json')), 'basarili giris sayaci sifirlar');
  // saat ileri alinmis kayit bile en fazla 15 dk bekletir
  fs.writeFileSync(path.join(vdir, 'attempts.json'), JSON.stringify({ fails: 0, until: clock + 1e12, rounds: 1 }));
  await assert.rejects(again().unlockWithPassword(PW), { code: 'WAIT', message: /15 dakika/ });
});

test('eski kasa (N=2^15) yeni surumle acilir; kdf vault.json\'dan okunur', async (t) => {
  const { V, vdir, tmpRoot, home } = await setup(t);
  assert.equal(JSON.parse(fs.readFileSync(path.join(vdir, 'vault.json'))).kdf.N, 2 ** 15);
  V.lock();
  const V2 = L.createVault({ dir: vdir, home, tmpRoot });
  assert.equal(await V2.unlockWithPassword(PW), true); V2.lock();
  const v = JSON.parse(fs.readFileSync(path.join(vdir, 'vault.json'))); v.kdf.N = 2 ** 30; fs.writeFileSync(path.join(vdir, 'vault.json'), JSON.stringify(v));
  await assert.rejects(L.createVault({ dir: vdir, home, tmpRoot }).unlockWithPassword(PW), { code: 'FORMAT' });
});

test('acma surerken kasa kilitlenirse duz metin kopya kalmaz (F7)', async (t) => {
  const { V, write, tmpRoot } = await setup(t);
  const r = await V.lockFile(write('gizli.bin', crypto.randomBytes(8 * 1024 * KB)));
  for (const delay of [0, 5, 20]) {
    await V.unlockWithPassword(PW);
    const p = V.openTemp(r.path);
    await new Promise(ok => setTimeout(ok, delay));
    V.lock('window');
    await assert.rejects(p, { code: 'LOCKED' });
    assert.deepEqual(fs.readdirSync(tmpRoot), [], 'gecici kopya kalmamali, gecikme ' + delay);
    assert.deepEqual(V.temps(), []);
  }
  // kilitleme cozme bittikten hemen sonra (temps.set'ten once) olursa da
  await V.unlockWithPassword(PW);
  const p = V.openTemp(r.path, { onProgress: (d, tot) => { if (d === tot) V.lock('window'); } });
  await assert.rejects(p, { code: 'LOCKED' });
  assert.deepEqual(fs.readdirSync(tmpRoot), []);
});

test('acilista onceki oturumdan kalan acik kopyalar ve yarim dosyalar silinir (F8)', async (t) => {
  const { V, vdir, tmpRoot, home, write } = await setup(t);
  const r = await V.lockFile(write('d/a.txt', 'TOPSECRET'));
  const tp = await V.openTemp(r.path);
  assert.ok(tp.startsWith(tmpRoot + path.sep));
  const d = path.dirname(r.path);
  fs.writeFileSync(path.join(d, '.a.txt.0123abcd.aciliyor'), 'yarim duz metin');
  fs.writeFileSync(path.join(d, '.b.txt.89abcdef.kilitleniyor'), 'x');
  fs.writeFileSync(path.join(d, '.c.kilitli.deadbeef.yenileniyor'), 'x');
  fs.writeFileSync(path.join(d, 'kullanici.aciliyor'), 'dokunma');
  fs.writeFileSync(path.join(tmpRoot, 'baska-uygulama.txt'), 'dokunma');
  // cokus: V kapatilmadan yeni ornek
  L.createVault({ dir: vdir, home, tmpRoot });
  assert.ok(!fs.existsSync(tp), 'eski duz metin kopya silinmeli');
  assert.deepEqual(fs.readdirSync(tmpRoot), ['baska-uygulama.txt']);
  assert.deepEqual(fs.readdirSync(d).sort(), ['a.txt.kilitli', 'kullanici.aciliyor']);
  // varsayilan gecici kok kasa klasorunun icinde
  const vd = path.join(home, '..', 'v3'), V3 = L.createVault({ dir: vd, home, scryptN: 2 ** 15 }); t.after(() => V3.lock());
  await V3.setup(PW); const r3 = await V3.lockFile(write('e.txt', 'x'));
  assert.ok((await V3.openTemp(r3.path)).startsWith(path.join(vd, 'tmp') + path.sep));
});

// ---- Silinme kurtarma: kasa klasorunde sert bag yedegi ----
const bak = (bdir, id) => path.join(bdir, id + '.kilitli');

test('kilitlerken yedek sert bag kurulur: ayni inode, 0700 klasor, uchg yedege de konur', async (t) => {
  const { V, write, bdir, flags, bflags } = await setup(t);
  const data = crypto.randomBytes(150 * KB);
  const r = await V.lockFile(write('foto.jpg', data));
  assert.equal(r.backup, true); assert.equal(V.entry(r.id).backup, true);
  const b = bak(bdir, r.id), sv = fs.statSync(r.path), sb = fs.statSync(b);
  assert.equal(sv.ino, sb.ino); assert.equal(sv.dev, sb.dev); assert.equal(sv.nlink, 2);
  assert.equal(fs.statSync(bdir).mode & 0o777, 0o700);
  assert.deepEqual(flags, [[r.path, true]]); assert.deepEqual(bflags, [[b, true]]);
  assert.deepEqual(V.check(), [{ id: r.id, name: 'foto.jpg', path: r.path, visible: true, backup: true, linked: true, recoverable: false }]);
  // yedek ek yer kaplamaz: ayni inode (yukarida); repair hicbir sey yapmaz
  assert.deepEqual(await V.repair(), { restored: [], failed: [], linked: 0, moved: [] });
});

test('gorunen dosya silinirse repair ayni yere geri baglar, icerik ayni ve aciliyor', async (t) => {
  const events = [];
  const { V, write, bdir, flags, home } = await setup(t, { onEvent: e => events.push(e) });
  const data = crypto.randomBytes(300 * KB);
  const r = await V.lockFile(write('d/rapor.pdf', data));
  const before = fs.readFileSync(r.path);
  fs.rmSync(r.path);                                   // sahibi "nouchg" + rm yapti
  assert.equal(V.files()[0].missing, true); assert.equal(V.files()[0].recoverable, true);
  assert.equal(V.check()[0].recoverable, true);
  flags.length = 0;
  const res = await V.repair();
  assert.deepEqual(res.restored.map(x => [x.path, x.renamed, x.flagged]), [[r.path, false, true]]);
  assert.deepEqual(flags, [[r.path, true]], 'geri gelen dosyaya uchg yeniden konur');
  assert.ok(fs.readFileSync(r.path).equals(before));
  assert.equal(fs.statSync(r.path).ino, fs.statSync(bak(bdir, r.id)).ino);
  assert.equal(V.files()[0].missing, false);
  assert.ok(events.some(e => e.type === 'restored' && e.files.length === 1));
  const out = path.join(home, 'cikti.pdf'); await V.decryptTo(r.path, out);
  assert.ok(fs.readFileSync(out).equals(data));
  // kasa kilitliyken de calisir (anahtar gerekmez), yeni ornek de (acilis)
  V.lock(); fs.rmSync(r.path);
  const V2 = L.createVault({ dir: path.join(home, '..', 'vault'), home, tmpRoot: path.join(home, '..', 'tmp') });
  assert.equal((await V2.repair()).restored.length, 1);
  assert.ok(fs.readFileSync(r.path).equals(before));
});

test('repair: ad doluysa "(geri getirildi)" adiyla geri gelir, kayit yeni yola guncellenir', async (t) => {
  const { V, write, home } = await setup(t);
  const data = Buffer.from('cakisma icerigi');
  const r = await V.lockFile(write('x.txt', data));
  const r2 = await V.lockFile(write('y.txt', 'baska'));
  fs.rmSync(r.path); fs.writeFileSync(r.path, 'kullanicinin yeni dosyasi');
  // ilk aday da dolu
  fs.writeFileSync(path.join(home, 'x.txt (geri getirildi).kilitli'), 'dolu');
  assert.equal(V.check()[0].recoverable, true, 'yerinde baska dosya, yedegi tutan baska ad yok');
  const res = await V.repair();
  assert.equal(res.restored.length, 1);
  const np = path.join(home, 'x.txt (geri getirildi 2).kilitli');
  assert.equal(res.restored[0].path, np); assert.equal(res.restored[0].renamed, true);
  assert.equal(fs.readFileSync(r.path, 'utf8'), 'kullanicinin yeni dosyasi');
  assert.equal(V.entry(r.id).path, np);
  const out = path.join(home, 'o.txt'); await V.decryptTo(np, out); assert.ok(fs.readFileSync(out).equals(data));
  assert.equal(V.entry(r2.id).path, r2.path);
  assert.deepEqual((await V.repair()).restored, []);
});

test('kilidi kaldir ve Cop Sepeti yedek bagi siler; forget de', async (t) => {
  const { V, write, bdir, bflags } = await setup(t);
  const a = await V.lockFile(write('a.txt', 'a')), b = await V.lockFile(write('b.txt', 'b')), c = await V.lockFile(write('c.txt', 'c'));
  assert.equal(fs.readdirSync(bdir).length, 3);
  bflags.length = 0;
  await V.unlockFile(a.path);
  assert.ok(!fs.existsSync(bak(bdir, a.id))); assert.deepEqual(bflags, [[bak(bdir, a.id), false]]);
  await V.removeLocked(b.path);
  assert.ok(!fs.existsSync(bak(bdir, b.id)));
  fs.rmSync(c.path);
  assert.equal(await V.forget(c.id), true);
  assert.deepEqual(fs.readdirSync(bdir), []);
  assert.deepEqual((await V.repair()).restored, [], 'silinen kayitlar geri getirilmez');
});

test('relock (kaydet ve yeniden kilitle) yedek bagi yeni dosyaya tasir', async (t) => {
  const { V, write, bdir, bflags, home } = await setup(t);
  const r = await V.lockFile(write('not.txt', 'ilk surum'));
  const oldIno = fs.statSync(r.path).ino;
  const from = write('yeni.txt', 'ikinci surum');
  bflags.length = 0;
  const s = await V.relock(r.path, from);
  assert.equal(s.backup, true);
  const b = bak(bdir, r.id);
  assert.notEqual(fs.statSync(r.path).ino, oldIno);
  assert.equal(fs.statSync(r.path).ino, fs.statSync(b).ino);
  assert.equal(fs.statSync(r.path).nlink, 2);
  assert.deepEqual(bflags, [[b, false], [b, true]]);
  assert.deepEqual(fs.readdirSync(bdir), [r.id + '.kilitli'], 'gecici yedek bag kalmaz');
  fs.rmSync(r.path); await V.repair();
  const out = path.join(home, 'o.txt'); await V.decryptTo(r.path, out);
  assert.equal(fs.readFileSync(out, 'utf8'), 'ikinci surum');
});

test('bag kurulamazsa (EXDEV) kopya alinmaz, backup:false; sonra kurulabilirse repair baglar', async (t) => {
  let fail = true; const calls = [];
  const link = (a, b) => { calls.push([a, b]); if (fail) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' }); return fs.linkSync(a, b); };
  const copy = fs.copyFileSync;
  fs.copyFileSync = p => { throw new Error('kopya alinmamali: ' + p); }; t.after(() => { fs.copyFileSync = copy; });
  const { V, write, bdir, bflags } = await setup(t, { link });
  const r = await V.lockFile(write('buyuk.bin', crypto.randomBytes(2 * 1024 * KB)));
  fs.copyFileSync = copy;
  assert.equal(r.backup, false); assert.equal(V.entry(r.id).backup, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(fs.readdirSync(bdir), [], 'yedek klasorunde dosya yok (kopya da yok)');
  assert.deepEqual(bflags, []); assert.equal(fs.statSync(r.path).nlink, 1);
  assert.deepEqual(V.check()[0], { id: r.id, name: 'buyuk.bin', path: r.path, visible: true, backup: false, linked: false, recoverable: false });
  // relock da kopya almaz
  const s = await V.relock(r.path, write('b2.bin', 'kucuk'));
  assert.equal(s.backup, false); assert.deepEqual(fs.readdirSync(bdir), []);
  // bag kurulabilir hale gelince (or. eski kayit) repair yedegi kurar
  fail = false;
  const res = await V.repair();
  assert.equal(res.linked, 1); assert.equal(V.entry(r.id).backup, true);
  assert.equal(fs.statSync(r.path).ino, fs.statSync(bak(bdir, r.id)).ino);
});

test('eski kayit (yedeksiz) acilista yedeklenir; yarim yedek baglari silinir; bozuk kimlik yok sayilir', async (t) => {
  const { V, write, vdir, bdir, home, tmpRoot } = await setup(t);
  const r = await V.lockFile(write('eski.txt', 'eski surum dosyasi'));
  // eski surum: yedek yok, kayitta backup alani yok
  fs.rmSync(bak(bdir, r.id));
  const reg = JSON.parse(fs.readFileSync(path.join(vdir, 'registry.json'))); delete reg[0].backup;
  reg.push({ id: '../../x', path: path.join(home, 'yok.kilitli'), name: 'k', size: 1, lockedAt: 1 });
  fs.writeFileSync(path.join(vdir, 'registry.json'), JSON.stringify(reg));
  fs.writeFileSync(path.join(bdir, r.id + '.kilitli.0123abcd.tmp'), 'yarim');
  fs.writeFileSync(path.join(bdir, 'baska.txt'), 'dokunma');
  const V2 = L.createVault({ dir: vdir, home, tmpRoot });
  assert.deepEqual(fs.readdirSync(bdir), ['baska.txt']);
  const res = await V2.repair();
  assert.equal(res.linked, 1); assert.deepEqual(res.restored, []);
  assert.equal(fs.statSync(r.path).ino, fs.statSync(bak(bdir, r.id)).ino);
  assert.equal(V2.entry(r.id).backup, true);
  assert.ok(!fs.existsSync(path.join(home, 'yok.kilitli')));
  // adopt edilen dosya da yedeklenir
  await V2.unlockWithPassword(PW);
  const moved = path.join(home, 'tasindi.kilitli'); fs.renameSync(r.path, moved);
  const e = await V2.adopt(moved);
  assert.equal(e.backup, true); assert.equal(fs.statSync(moved).ino, fs.statSync(bak(bdir, e.id)).ino);
  V2.lock(); assert.ok(V);
});

test('lock-main: acilista silinen dosya geri getirilir ve pencereye bir kez bildirilir', async (t) => {
  const root = tmpDir(), home = path.join(root, 'home'), ud = path.join(root, 'ud'), vdir = path.join(ud, 'kilit');
  fs.mkdirSync(home); fs.mkdirSync(ud);
  // macOS'ta lock-main gercek chflags kullanir: silmeden once bayraklari kaldir
  t.after(() => { if (process.platform === 'darwin') try { require('child_process').execFileSync('/usr/bin/chflags', ['-R', 'nouchg', root]); } catch (e) {}
    fs.rmSync(root, { recursive: true, force: true }); });
  // kasa onceden kurulmus (hizli scrypt) ve bir dosya kilitlenmis
  const V0 = L.createVault({ dir: vdir, home, scryptN: 2 ** 15 }); await V0.setup(PW);
  const src = path.join(home, 'a.txt'); fs.writeFileSync(src, 'gizli');
  const r = await V0.lockFile(src); V0.lock();
  fs.rmSync(r.path);
  delete require.cache[require.resolve('../lock-main.js')];
  const { registerLock } = require('../lock-main.js');
  const handlers = {}, sent = [], wc = { send: (ch, e) => sent.push(e), setWindowOpenHandler() {}, on() {} };
  const win = { webContents: wc, isDestroyed: () => false, loadFile() {}, once() {}, on() {}, show() {}, focus() {} };
  const ui = registerLock({ ipcMain: { handle: (ch, f) => { handlers[ch] = f; } }, dialog: {}, shell: {},
    app: { getPath: k => k === 'home' ? home : ud, on() {} }, BrowserWindow: function () { return win; }, path,
    systemPreferences: { canPromptTouchID: () => false }, safeStorage: { isEncryptionAvailable: () => false } });
  t.after(() => ui.vault.lock());
  const call = (ch, ...a) => handlers[ch]({ sender: wc }, ...a);
  // pencere kapaliyken: bildirim bekletilir
  assert.equal((await ui.ready).restored.length, 1);
  assert.ok(fs.existsSync(r.path), 'acilista geri getirildi');
  ui.open();
  let s = await call('kl:state');
  assert.equal(s.notice, '1 kilitli dosya silinmişti, geri getirildi.');
  s = await call('kl:state'); assert.equal(s.notice, undefined, 'bildirim bir kez');
  // kasa acilinca da calisir (macOS'ta geri gelen dosyada gercek uchg var: once kaldir, "sahibi nouchg + rm yapti")
  if (process.platform === 'darwin') require('child_process').execFileSync('/usr/bin/chflags', ['nouchg', r.path]);
  fs.rmSync(r.path);
  s = await call('kl:unlockPw', PW);
  assert.equal(s.ok, true); assert.equal(s.unlocked, true);
  // pencere acikken: olay olarak gider, durum yanitinda tekrar gelmez
  assert.deepEqual(sent.filter(e => e.type === 'repaired').map(e => e.msg), ['1 kilitli dosya silinmişti, geri getirildi.']);
  assert.equal(s.notice, undefined);
  assert.deepEqual(s.files.map(f => [f.name, f.missing, f.backup]), [['a.txt', false, true]]);
});

test('tasinan kilitli dosya eski yerine geri getirilmez, tasindi diye bildirilir', async (t) => {
  const { V, write, home } = await setup(t);
  const r = await V.lockFile(write('belge.txt', 'gizli'));
  const yeni = path.join(home, 'baska-yer.kilitli');
  fs.renameSync(r.path, yeni);                          // Finder ile tasindi (ayni disk)
  const res = await V.repair();
  assert.deepEqual(res.restored, []); assert.deepEqual(res.moved.map(x => x.name), ['belge.txt']);
  assert.ok(!fs.existsSync(r.path));
  fs.rmSync(yeni);                                      // simdi gercekten silindi: geri gelir
  assert.equal((await V.repair()).restored.length, 1);
});
