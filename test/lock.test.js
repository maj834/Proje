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
  const flags = [], kc = fakeKeychain(), trashed = [];
  const chflags = async (p, on) => { flags.push([p, on]); };
  const trash = async p => { const d = path.join(root, 'Trash'); fs.mkdirSync(d, { recursive: true }); fs.renameSync(p, path.join(d, path.basename(p))); trashed.push(p); };
  const V = L.createVault({ dir: vdir, home, chflags, trash, tmpRoot, chunk: 64 * KB, protect: kc.protect, unprotect: kc.unprotect, scryptN: 2 ** 15, ...extra });
  t.after(() => { V.lock(); fs.rmSync(root, { recursive: true, force: true }); });
  await V.setup(PW);
  const write = (name, data) => { const p = path.join(home, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
  return { V, root, home, vdir, tmpRoot, flags, kc, trashed, write };
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
  assert.equal(V.forget(f[0].id), true); assert.equal(V.files().length, 0);
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
