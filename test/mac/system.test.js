'use strict';
// macOS entegrasyon testleri: GERCEK sistem (chflags uchg, sert bag, ~/.Trash, 127.0.0.1 sunucusu). Yalnizca darwin'de
// calisir; `npm test` (test/*.test.js) bu klasoru kapsamaz, CI'da mac isinde `node --test test/mac/` ile kosulur.
// GUI istemi, Touch ID, Anahtar Zinciri ya da Finder otomasyonu yok (GitHub macos runner'da etkilesim olmaz).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

const MAC = process.platform === 'darwin';
const skip = MAC ? false : 'yalnizca macOS';
const PW = 'mac-entegrasyon-1';
const KB = 1024;

// Gercek chflags (lock-main.js ile ayni)
const chflags = (p, on) => new Promise((ok, no) => execFile('/usr/bin/chflags', [on ? 'uchg' : 'nouchg', p], e => e ? no(e) : ok()));
const hasUchg = p => /\buchg\b/.test(execFileSync('/bin/ls', ['-lOd', p], { encoding: 'utf8' }));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

// Gecici kok: realpath (/var -> /private/var) ve test sonunda bayraklar kaldirilip silinir
function root(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cemapp-mac-')));
  t.after(() => {
    try { execFileSync('/usr/bin/chflags', ['-R', 'nouchg', d]); } catch (e) {}
    fs.rmSync(d, { recursive: true, force: true });
  });
  return d;
}
async function vault(t) {
  const L = require('../../lock.js');
  const d = root(t), home = path.join(d, 'home'), dir = path.join(d, 'vault');
  fs.mkdirSync(home);
  const V = L.createVault({ dir, home, chflags, scryptN: 2 ** 15, chunk: 64 * KB });
  t.after(() => V.lock());
  await V.setup(PW);
  const write = (n, data) => { const p = path.join(home, n); fs.writeFileSync(p, data); return p; };
  return { V, L, d, home, dir, bdir: path.join(dir, 'yedek'), write };
}

test('kilit: gercek uchg; rm ve unlink EPERM, kilidi kaldir calisir, yedek silinir', { skip }, async (t) => {
  const { V, home, bdir, write } = await vault(t);
  const data = crypto.randomBytes(700 * KB);
  const r = await V.lockFile(write('belge.pdf', data));
  assert.equal(r.flagged, true); assert.equal(r.backup, true);
  assert.ok(hasUchg(r.path), 'gorunen dosyada uchg');
  const b = path.join(bdir, r.id + '.kilitli');
  assert.ok(hasUchg(b), 'yedekte de uchg (ayni inode)');
  assert.throws(() => fs.unlinkSync(r.path), { code: 'EPERM' });
  assert.throws(() => execFileSync('/bin/rm', ['-f', r.path], { stdio: 'pipe' }), 'rm basarisiz olmali');
  assert.throws(() => fs.writeFileSync(r.path, 'x'), e => ['EPERM', 'EACCES'].includes(e.code));
  assert.ok(fs.existsSync(r.path));
  const u = await V.unlockFile(r.path);
  assert.equal(u.path, path.join(home, 'belge.pdf'));
  assert.equal(sha(fs.readFileSync(u.path)), sha(data));
  assert.ok(!fs.existsSync(r.path)); assert.ok(!fs.existsSync(b), 'yedek bag silinmeli');
  assert.ok(!hasUchg(u.path));
});

test('kilit: gercek sert bag yedegi; nouchg + rm sonrasi repair geri getirir ve uchg yeniden konur', { skip }, async (t) => {
  const { V, L, home, dir, bdir, write } = await vault(t);
  const data = crypto.randomBytes(2 * 1024 * KB + 17);
  const r = await V.lockFile(write('foto.jpg', data));
  const b = path.join(bdir, r.id + '.kilitli');
  const sv = fs.statSync(r.path), sb = fs.statSync(b);
  assert.equal(sv.ino, sb.ino); assert.equal(sv.nlink, 2);
  assert.equal(fs.statSync(bdir).mode & 0o777, 0o700);
  // bilgi: macOS degistirilemez dosyaya sert bag kurmaz (bu yuzden bag uchg'den once kurulur)
  const extra = path.join(home, 'deneme-bag');
  let linked = false;
  try { fs.linkSync(r.path, extra); linked = true; } catch (e) { t.diagnostic('uchg dosyaya link: ' + e.code); }
  if (linked) {   // beklenmedik: bag kurulduysa geri al (nlink 2 kalsin)
    t.diagnostic('uchg dosyaya link KURULDU');
    execFileSync('/usr/bin/chflags', ['nouchg', extra]); fs.rmSync(extra); execFileSync('/usr/bin/chflags', ['uchg', r.path]);
  }
  assert.equal(fs.statSync(b).nlink, 2);
  // sahibi bayragi kaldirip siler (Terminal: chflags nouchg + rm)
  execFileSync('/usr/bin/chflags', ['nouchg', r.path]);
  execFileSync('/bin/rm', [r.path]);
  assert.ok(!fs.existsSync(r.path)); assert.ok(fs.existsSync(b), 'icerik yedek adla yasiyor');
  V.lock();
  // acilis: yeni ornek, kasa kilitli (anahtarsiz onarim)
  const V2 = L.createVault({ dir, home, chflags }); t.after(() => V2.lock());
  const res = await V2.repair();
  assert.deepEqual(res.restored.map(x => [x.path, x.flagged]), [[r.path, true]]);
  assert.ok(hasUchg(r.path)); assert.equal(fs.statSync(r.path).ino, fs.statSync(b).ino);
  assert.throws(() => fs.unlinkSync(r.path), { code: 'EPERM' });
  await V2.unlockWithPassword(PW);
  const out = path.join(home, 'cikti.jpg'); await V2.decryptTo(r.path, out);
  assert.equal(sha(fs.readFileSync(out)), sha(data));
  // ad doluysa "(geri getirildi)"
  execFileSync('/usr/bin/chflags', ['nouchg', r.path]); fs.rmSync(r.path); fs.writeFileSync(r.path, 'baska');
  const res2 = await V2.repair();
  assert.equal(path.basename(res2.restored[0].path), 'foto.jpg (geri getirildi).kilitli');
  assert.ok(hasUchg(res2.restored[0].path));
});

test('kilit: kaydet ve yeniden kilitle gercek uchg ile yedegi yeni inode\'a tasir', { skip }, async (t) => {
  const { V, bdir, write } = await vault(t);
  const r = await V.lockFile(write('not.txt', 'ilk surum'));
  const tp = await V.openTemp(r.path);
  fs.writeFileSync(tp, 'ikinci surum, daha uzun');
  const s = await V.saveTemp(r.path);
  assert.equal(s.flagged, true); assert.equal(s.backup, true);
  const b = path.join(bdir, r.id + '.kilitli');
  assert.equal(fs.statSync(r.path).ino, fs.statSync(b).ino); assert.equal(fs.statSync(r.path).nlink, 2);
  assert.ok(hasUchg(r.path)); assert.deepEqual(fs.readdirSync(bdir), [r.id + '.kilitli']);
  const u = await V.unlockFile(r.path);
  assert.equal(fs.readFileSync(u.path, 'utf8'), 'ikinci surum, daha uzun');
  assert.deepEqual(fs.readdirSync(bdir), []);
});

// Temizlik: cleaner-main.js Cop Sepeti icin Electron shell.trashItem kullanir; burada Electron'suz kisim (guard,
// removeItems, gunluk) gercek ~/.Trash'e tasiyan bir trash islevi ve 'trash-empty' ile gercek Cop Sepeti'nden silme.
test('temizlik: eski yukleyici gercek ~/.Trash\'e tasinir, sonra Cop Sepeti temizligiyle silinir', { skip }, async (t) => {
  const C = require('../../cleaner.js');
  const d = root(t), home = path.join(d, 'home'), dl = path.join(home, 'Downloads');
  fs.mkdirSync(dl, { recursive: true });
  const name = 'cemapp-test-' + crypto.randomBytes(4).toString('hex') + '.dmg', p = path.join(dl, name);
  fs.writeFileSync(p, crypto.randomBytes(3000));
  const old = new Date(Date.now() - 40 * 86400e3); fs.utimesSync(p, old, old);
  const realHome = os.homedir(), T = path.join(realHome, '.Trash');
  let dest = null;
  t.after(() => { if (dest) fs.rmSync(dest, { force: true }); });
  const trash = async q => {
    fs.mkdirSync(T, { recursive: true });
    dest = path.join(T, path.basename(q));
    try { fs.renameSync(q, dest); }
    catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(q, dest); fs.rmSync(q); }
  };
  // ~/.Trash TCC ile korunuyorsa (Tam Disk Erisimi yok) atla
  try { fs.mkdirSync(T, { recursive: true }); fs.accessSync(T, fs.constants.W_OK); const probe = path.join(T, '.' + name + '.yoklama'); fs.writeFileSync(probe, ''); fs.rmSync(probe); }
  catch (e) { t.skip('~/.Trash yazilamiyor: ' + e.code); return; }
  const log = path.join(d, 'kayit.jsonl');
  const r = await C.removeItems([p], { mode: 'trash', cat: 'installers', trash, home, logFile: log });
  assert.deepEqual(r.failed, []); assert.deepEqual(r.removed, [p]); assert.equal(r.freed, 3000);
  assert.ok(!fs.existsSync(p)); assert.ok(fs.existsSync(dest), 'gercek Cop Sepeti\'nde');
  // ~/Library korunur
  const lib = path.join(home, 'Library', 'Preferences', 'a.plist'); fs.mkdirSync(path.dirname(lib), { recursive: true }); fs.writeFileSync(lib, 'x');
  assert.equal((await C.removeItems([lib], { mode: 'trash', trash, home })).removed.length, 0);
  // gercek Cop Sepeti'nden yalnizca taranan oge silinir (ev = gercek ev klasoru)
  const st = fs.lstatSync(dest);
  const item = { path: dest, size: 3000, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, dev: st.dev };
  const r2 = await C.removeItems([item], { mode: 'trash-empty', home: realHome });
  assert.deepEqual(r2.failed, []); assert.ok(!fs.existsSync(dest)); dest = null;
});

test('paylasim: 127.0.0.1 uzerinden sayfa, liste, indirme ve aralik istegi', { skip }, async (t) => {
  const { createShare } = require('../../share.js');
  const d = root(t), dl = path.join(d, 'dl'); fs.mkdirSync(dl);
  const src = path.join(d, 'rapor ğüş.bin'), data = crypto.randomBytes(1024 * KB + 5); fs.writeFileSync(src, data);
  const S = createShare({ downloadsDir: dl, host: '127.0.0.1', ask: async () => false });
  t.after(() => S.stop());
  const info = await S.start();
  assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]+\/$/);
  const [f] = S.add([src]);
  const page = await fetch(info.url); assert.equal(page.status, 200);
  assert.match(await page.text(), /rapor ğüş\.bin/);
  const list = await (await fetch(info.url + 'list')).json(); assert.deepEqual(list.map(x => x.id), [f.id]);
  const res = await fetch(info.url + 'f/' + f.id); assert.equal(res.status, 200);
  assert.equal(sha(Buffer.from(await res.arrayBuffer())), sha(data));
  const part = await fetch(info.url + 'f/' + f.id, { headers: { range: 'bytes=10-19' } });
  assert.equal(part.status, 206); assert.ok(Buffer.from(await part.arrayBuffer()).equals(data.subarray(10, 20)));
  assert.equal((await fetch(info.url.replace(/\/s\/[^/]+\//, '/s/yanlis/'))).status, 404);
  S.stop();
  await assert.rejects(fetch(info.url), 'kapandiktan sonra baglanti yok');
});
