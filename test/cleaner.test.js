'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { tmpDir } = require('./helpers/util.js');
const C = require('../cleaner.js');

const DAY = 864e5;
function put(p, data, ageDays) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  if (ageDays != null) { const t = new Date(Date.now() - ageDays * DAY); fs.utimesSync(p, t, t); }
  return p;
}
const rnd = n => crypto.randomBytes(n);
function setup(t) { const d = tmpDir(); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }
// Sahte Cop Sepeti: dosyalari gecici .Trash klasorune tasir
function fakeTrash(dir) {
  const tr = path.join(dir, 'FakeTrash'); fs.mkdirSync(tr, { recursive: true });
  const calls = [];
  const fn = async p => { calls.push(p); fs.renameSync(p, path.join(tr, calls.length + '-' + path.basename(p))); };
  return { fn, calls, dir: tr };
}
const readLog = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));

test('human Turkce bicim', () => {
  assert.equal(C.human(0), '0 B'); assert.equal(C.human(1536), '2 KB');
  assert.equal(C.human(1.25 * 1024 ** 3), '1,3 GB'); assert.equal(C.human(5 * 1024 ** 2), '5,0 MB');
});

test('kopyalar: ayni icerik farkli ad bulunur, ayni boyut farkli icerik bulunmaz', async (t) => {
  const d = setup(t), root = path.join(d, 'r'), data = rnd(5000), big = rnd(300 * 1024);
  put(path.join(root, 'a.bin'), data);
  put(path.join(root, 'alt', 'kopya-a.bin'), data);
  put(path.join(root, 'c.bin'), rnd(5000));                      // ayni boyut, farkli icerik
  put(path.join(root, 'big1.mov'), big);
  const big2 = Buffer.from(big); big2[150 * 1024] ^= 1;           // bas ve son ayni, ortasi farkli
  put(path.join(root, 'big2.mov'), big2);
  put(path.join(root, 'big3.mov'), big);
  const g = await C.findDuplicates([root], { home: d });
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].files.map(f => path.basename(f.path)).sort(), ['big1.mov', 'big3.mov']);   // en buyuk fazlalik once
  assert.deepEqual(g[1].files.map(f => path.basename(f.path)).sort(), ['a.bin', 'kopya-a.bin']);
  assert.equal(g[1].size, 5000);
  assert.equal(g[1].hash, crypto.createHash('sha256').update(data).digest('hex'));
  assert.ok(g[1].files.some(f => f.path === g[1].keep));
});

test('kopyalar: sabit baglar kopya sayilmaz, sembolik bag izlenmez', async (t) => {
  const d = setup(t), root = path.join(d, 'r'), data = rnd(4000);
  const a = put(path.join(root, 'a.bin'), data);
  fs.linkSync(a, path.join(root, 'sabit.bin'));
  fs.symlinkSync(a, path.join(root, 'kisayol.bin'));
  assert.deepEqual(await C.findDuplicates([root], { home: d }), []);
  put(path.join(root, 'gercek-kopya.bin'), data);
  const g = await C.findDuplicates([root, root], { home: d });   // ayni kok iki kez verilse de bir kez sayilir
  assert.equal(g.length, 1); assert.equal(g[0].files.length, 2);
  assert.ok(g[0].files.some(f => path.basename(f.path) === 'gercek-kopya.bin'));
  assert.ok(!g[0].files.some(f => path.basename(f.path) === 'kisayol.bin'));
});

test('kopyalar: gizli dosyalar, paketler, node_modules, Library, .icloud ve minSize atlanir', async (t) => {
  const d = setup(t), data = rnd(3000), small = rnd(100);
  put(path.join(d, 'Documents', 'a.bin'), data);
  put(path.join(d, 'Documents', '.gizli.bin'), data);
  put(path.join(d, 'Documents', '.gizliklasor', 'x.bin'), data);
  put(path.join(d, 'Documents', 'Uyg.app', 'Contents', 'x.bin'), data);
  put(path.join(d, 'Pictures', 'Fotolar.photoslibrary', 'x.bin'), data);
  put(path.join(d, 'Documents', 'node_modules', 'x.bin'), data);
  put(path.join(d, 'Library', 'Caches', 'x.bin'), data);
  put(path.join(d, 'Documents', 'b.bin.icloud'), data);
  put(path.join(d, 'Documents', 'k1.txt'), small); put(path.join(d, 'Documents', 'k2.txt'), small);
  assert.deepEqual(await C.findDuplicates([d], { home: d }), []);
  const g = await C.findDuplicates([d], { home: d, minSize: 1 });
  assert.equal(g.length, 1); assert.deepEqual(g[0].files.map(f => path.basename(f.path)).sort(), ['k1.txt', 'k2.txt']);
  // exclude
  put(path.join(d, 'Documents', 'disari', 'c.bin'), data);
  assert.equal((await C.findDuplicates([d], { home: d })).length, 1);
  assert.equal((await C.findDuplicates([d], { home: d, exclude: [path.join(d, 'Documents', 'disari')] })).length, 0);
});

test('kopyalar: iptal ve ilerleme', async (t) => {
  const d = setup(t), data = rnd(2000);
  put(path.join(d, 'r', 'a'), data); put(path.join(d, 'r', 'b'), data);
  const ev = [];
  await C.findDuplicates([path.join(d, 'r')], { home: d, onProgress: e => ev.push(e) });
  assert.ok(ev.some(e => e.phase === 'tara')); assert.ok(ev.some(e => e.phase === 'karsilastir'));
  const ac = new AbortController(); ac.abort();
  await assert.rejects(C.findDuplicates([path.join(d, 'r')], { home: d, signal: ac.signal }), { name: 'AbortError' });
});

test('kalacak kopya kurali', () => {
  const f = (p, b) => ({ path: p, birthtimeMs: b, mtimeMs: b });
  assert.equal(C.pickKeep([f('/U/a/Downloads/x.jpg', 1), f('/U/a/Pictures/tatil/x.jpg', 5)]), '/U/a/Pictures/tatil/x.jpg');
  assert.equal(C.pickKeep([f('/U/a/.Trash/x.jpg', 1), f('/U/a/Desktop/x.jpg', 9)]), '/U/a/Desktop/x.jpg');
  assert.equal(C.pickKeep([f('/U/a/Documents/yeni.jpg', 9), f('/U/a/Documents/eski/uzun-ad.jpg', 2)]), '/U/a/Documents/eski/uzun-ad.jpg');
  assert.equal(C.pickKeep([f('/U/a/Documents/uzun/yol/x.jpg', 3), f('/U/a/Documents/x.jpg', 3)]), '/U/a/Documents/x.jpg');
  assert.equal(C.pickKeep([f('/U/a/Downloads/x.jpg', 3), f('/U/a/Downloads/x (1).jpg', 1)]), '/U/a/Downloads/x (1).jpg');
});

async function dupSetup(t) {
  const d = setup(t), root = path.join(d, 'Documents'), data = rnd(6000);
  put(path.join(root, 'orijinal.pdf'), data);
  put(path.join(root, 'k1.pdf'), data);
  put(path.join(root, 'k2.pdf'), data);
  const groups = await C.findDuplicates([root], { home: d });
  assert.equal(groups.length, 1);
  return { d, root, groups, g: groups[0], tr: fakeTrash(d), log: path.join(d, 'kayit', 'log.jsonl') };
}

test('removeDuplicates: secilenler Cop Sepetine tasinir, kayit yazilir', async (t) => {
  const { d, groups, g, tr, log } = await dupSetup(t);
  const others = g.files.map(f => f.path).filter(p => p !== g.keep);
  const r = await C.removeDuplicates(groups, others, { trash: tr.fn, home: d, logFile: log });
  assert.deepEqual(r.removed.sort(), others.sort()); assert.equal(r.failed.length, 0); assert.equal(r.freed, 12000);
  assert.ok(fs.existsSync(g.keep));
  assert.equal(fs.readdirSync(tr.dir).length, 2);
  const L = readLog(log); assert.equal(L.length, 2); assert.equal(L[0].mode, 'trash'); assert.equal(L[0].size, 6000); assert.ok(L[0].t);
});

test('removeDuplicates: tum kopyalar secilirse hicbiri silinmez', async (t) => {
  const { d, groups, g, tr } = await dupSetup(t);
  const r = await C.removeDuplicates(groups, g.files.map(f => f.path), { trash: tr.fn, home: d });
  assert.equal(r.removed.length, 0); assert.equal(r.failed.length, 3); assert.equal(tr.calls.length, 0);
  assert.ok(g.files.every(f => fs.existsSync(f.path)));
});

test('removeDuplicates: icerik degistiyse ya da kalan kopya bozulduysa reddeder', async (t) => {
  const { d, groups, g, tr } = await dupSetup(t);
  const [a, b] = g.files.map(f => f.path).filter(p => p !== g.keep);
  const buf = fs.readFileSync(a); buf[10] ^= 0xff; fs.writeFileSync(a, buf);   // ayni boyut, farkli icerik
  let r = await C.removeDuplicates(groups, [a], { trash: tr.fn, home: d });
  assert.equal(r.removed.length, 0); assert.match(r.failed[0].error, /değişmiş/); assert.ok(fs.existsSync(a));
  // kalacak kopya ve diger kopya degisti: b icin dogrulanmis kalan kopya yok
  const kb = fs.readFileSync(g.keep); kb[0] ^= 1; fs.writeFileSync(g.keep, kb);
  r = await C.removeDuplicates(groups, [b], { trash: tr.fn, home: d });
  assert.equal(r.removed.length, 0); assert.match(r.failed[0].error, /Kalan kopya/); assert.ok(fs.existsSync(b));
  // son taramada olmayan yol
  r = await C.removeDuplicates(groups, [path.join(d, 'baska.pdf')], { trash: tr.fn, home: d });
  assert.equal(r.removed.length, 0); assert.match(r.failed[0].error, /Son taramada/);
  // silinen dosya / cop islevi yok
  fs.rmSync(b); r = await C.removeDuplicates(groups, [b], { trash: tr.fn, home: d });
  assert.equal(r.removed.length, 0); assert.equal(tr.calls.length, 0);
});

test('removeDuplicates: sembolik bagla degistirilen dosya tasinmaz', async (t) => {
  const { d, groups, g, tr } = await dupSetup(t);
  const a = g.files.map(f => f.path).find(p => p !== g.keep);
  fs.rmSync(a); fs.symlinkSync(g.keep, a);
  const r = await C.removeDuplicates(groups, [a], { trash: tr.fn, home: d });
  assert.equal(r.removed.length, 0); assert.equal(tr.calls.length, 0);
});

function fakeHome(t) {
  const h = setup(t);
  for (const p of ['Library/Caches', 'Library/Logs', 'Downloads', 'Desktop', 'Documents', '.Trash']) fs.mkdirSync(path.join(h, p), { recursive: true });
  return h;
}

test('removeItems korumasi: izinli koklerin disi, kok, ev, .. ve sembolik baglar reddedilir', async (t) => {
  const h = fakeHome(t), out = setup(t), tr = fakeTrash(out), log = path.join(out, 'log.jsonl');
  const doc = put(path.join(h, 'Documents', 'tez.docx'), 'onemli');
  const outside = put(path.join(out, 'dis', 'x.txt'), 'dis');
  fs.symlinkSync(path.join(out, 'dis'), path.join(h, 'Library', 'Caches', 'bag'));
  const linkFile = path.join(h, 'Library', 'Caches', 'dosyabag'); fs.symlinkSync(doc, linkFile);
  put(path.join(h, 'Library', 'Caches', 'com.apple.Safari', 'x'), 's');
  put(path.join(h, 'Library', 'Preferences', 'a.plist'), 'p');
  const bad = [
    doc, outside, h, '/', path.join(h, 'Library', 'Caches'), path.join(h, 'Library', 'Logs'),
    h + '/Library/Caches/../../Documents/tez.docx', h + '/Library/Caches/com.ornek/../../../Documents', h + '/Library/Caches/x/',
    path.join(h, 'Library', 'Caches', 'bag'), path.join(h, 'Library', 'Caches', 'bag', 'x.txt'), linkFile,
    path.join(h, 'Library', 'Caches', 'com.apple.Safari'), path.join(h, 'Library', 'Preferences', 'a.plist'),
    'Library/Caches/x', '', null, 42,
  ];
  const r = await C.removeItems(bad, { mode: 'delete', trash: tr.fn, home: h, logFile: log });
  assert.equal(r.removed.length, 0); assert.equal(r.failed.length, bad.length);
  assert.ok(fs.existsSync(doc) && fs.existsSync(outside) && fs.existsSync(path.join(h, 'Library', 'Caches', 'com.apple.Safari', 'x')));
  assert.ok(!fs.existsSync(log));
  // Cop kipi: Library ve ev disi reddedilir
  const r2 = await C.removeItems([path.join(h, 'Library', 'Preferences', 'a.plist'), path.join(h, 'library', 'Preferences', 'a.plist'), outside, h, path.join(h, 'Library')], { mode: 'trash', trash: tr.fn, home: h });
  assert.equal(r2.removed.length, 0); assert.equal(tr.calls.length, 0);
  // Cop islevi yoksa ya da bilinmeyen kip
  const dmg = put(path.join(h, 'Downloads', 'a.dmg'), 'x');
  assert.equal((await C.removeItems([dmg], { mode: 'trash', home: h })).removed.length, 0);
  assert.equal((await C.removeItems([dmg], { mode: 'yok', trash: tr.fn, home: h })).removed.length, 0);
  assert.equal((await C.removeItems([dmg], { mode: 'delete', trash: tr.fn, home: h })).removed.length, 0);   // dosya, bos klasor degil
  // ev klasoru gecersizse hicbir sey
  assert.equal((await C.removeItems([path.join('/', 'tmp', 'x')], { mode: 'delete', home: '/' })).removed.length, 0);
  assert.ok(fs.existsSync(dmg));
});

test('removeItems: izinli onbellek silinir, yukleyici Cop Sepetine, bos klasor yalnizca bossa', async (t) => {
  const h = fakeHome(t), out = setup(t), tr = fakeTrash(out), log = path.join(out, 'log.jsonl');
  const cache = path.join(h, 'Library', 'Caches', 'com.ornek.app'); put(path.join(cache, 'a', 'b.dat'), rnd(3000));
  const dmg = put(path.join(h, 'Downloads', 'Kurulum.dmg'), rnd(1000));
  const e1 = path.join(h, 'Documents', 'bos'); fs.mkdirSync(path.join(e1, 'ic'), { recursive: true }); put(path.join(e1, 'ic', '.DS_Store'), 'x');
  const full = path.join(h, 'Desktop', 'dolu'); put(path.join(full, 'not.txt'), 'icerik');
  let r = await C.removeItems([cache, e1, full], { mode: 'delete', trash: tr.fn, home: h, logFile: log });
  assert.deepEqual(r.removed, [cache, e1]); assert.equal(r.failed.length, 1); assert.match(r.failed[0].error, /boş değil/);
  assert.ok(!fs.existsSync(cache) && !fs.existsSync(e1) && fs.existsSync(path.join(full, 'not.txt')));
  assert.equal(r.freed, 3001);
  r = await C.removeItems([{ path: dmg }], { mode: 'trash', trash: tr.fn, home: h, logFile: log });
  assert.deepEqual(r.removed, [dmg]); assert.deepEqual(tr.calls, [dmg]);
  const L = readLog(log); assert.deepEqual(L.map(x => x.mode), ['delete', 'rmdir', 'trash']); assert.equal(L[0].path, cache); assert.equal(L[0].size, 3000);
});

test('scanJunk: sahte ev klasorunde kategoriler', async (t) => {
  const h = fakeHome(t), L = path.join(h, 'Library'), Cc = path.join(L, 'Caches');
  put(path.join(Cc, 'com.ornek.app', 'x.dat'), rnd(2000));
  put(path.join(Cc, 'com.apple.Safari', 'x.dat'), rnd(500));
  put(path.join(Cc, 'com.calisan.app', 'x.dat'), rnd(700));
  put(path.join(Cc, 'com.calisan.app.helper', 'x.dat'), rnd(700));
  put(path.join(Cc, 'CloudKit', 'x.dat'), rnd(700));
  put(path.join(Cc, 'bos-onbellek', '.keep'), '');
  put(path.join(Cc, 'Google', 'Chrome', 'Default', 'Cache', 'd.dat'), rnd(900));
  put(path.join(Cc, 'Google', 'Chrome', 'Default', 'History'), 'gecmis');
  put(path.join(Cc, 'Firefox', 'Profiles', 'p1', 'cache2', 'd.dat'), rnd(800));
  put(path.join(Cc, 'Yarn', 'v6', 'x'), rnd(600));
  fs.symlinkSync(path.join(h, 'Documents'), path.join(Cc, 'bag'));
  put(path.join(L, 'Logs', 'eski.log'), rnd(300), 10);
  put(path.join(L, 'Logs', 'yeni.log'), rnd(300), 1);
  put(path.join(L, 'Logs', 'Uyg', 'a.log'), rnd(100), 20); put(path.join(L, 'Logs', 'Uyg', 'b.log'), rnd(100), 0);  // icinde yeni dosya var
  put(path.join(L, 'Developer', 'Xcode', 'DerivedData', 'Proje-abc', 'x'), rnd(400));
  put(path.join(h, 'Downloads', 'eski.dmg'), rnd(100), 40);
  put(path.join(h, 'Downloads', 'yeni.pkg'), rnd(100), 5);
  put(path.join(h, 'Downloads', 'eski.zip'), rnd(100), 40);
  put(path.join(h, 'Downloads', 'klasor', 'ic.dmg'), rnd(100), 40);
  put(path.join(h, '.Trash', 'silinen.txt'), rnd(250));
  fs.mkdirSync(path.join(h, 'Documents', 'bos1', 'bos2'), { recursive: true }); put(path.join(h, 'Documents', 'bos1', '.DS_Store'), 'x');
  fs.mkdirSync(path.join(h, 'Desktop', 'dolu', 'bosic'), { recursive: true }); put(path.join(h, 'Desktop', 'dolu', 'a.txt'), 'x');
  fs.mkdirSync(path.join(h, 'Documents', '.gizli', 'bos'), { recursive: true });
  fs.mkdirSync(path.join(h, 'Documents', 'Uyg.app', 'Contents'), { recursive: true });

  const r = await C.scanJunk(h, { runningBundleIds: ['com.calisan.app', 'org.mozilla.firefox'] });
  const cat = id => r.categories.find(c => c.id === id);
  const names = id => cat(id).items.map(i => path.relative(h, i.path)).sort();
  assert.deepEqual(r.categories.map(c => c.id), ['cache', 'logs', 'dev', 'browser', 'installers', 'trash', 'emptydirs']);
  for (const c of r.categories) { assert.ok(c.title && c.desc && c.mode); assert.equal(typeof c.default, 'boolean'); }
  assert.deepEqual(names('cache'), ['Library/Caches/com.ornek.app']);
  assert.equal(cat('cache').size, 2000); assert.equal(cat('cache').default, true); assert.equal(cat('cache').mode, 'delete');
  assert.deepEqual(names('logs'), ['Library/Logs/eski.log']);
  assert.deepEqual(names('dev'), ['Library/Caches/Yarn', 'Library/Developer/Xcode/DerivedData/Proje-abc']); assert.equal(cat('dev').default, false);
  assert.deepEqual(names('browser'), ['Library/Caches/Google/Chrome/Default/Cache']); assert.match(cat('browser').note, /Firefox/);
  assert.deepEqual(names('installers'), ['Downloads/eski.dmg']); assert.equal(cat('installers').mode, 'trash');
  assert.deepEqual(names('trash'), ['.Trash/silinen.txt']); assert.equal(cat('trash').mode, 'trash-empty'); assert.equal(cat('trash').size, 250);
  assert.deepEqual(names('emptydirs'), ['Desktop/dolu/bosic', 'Documents/bos1']);
  assert.equal(r.total, r.categories.reduce((s, c) => s + c.size, 0));
  // Taranan her silme ogesi korumadan gecer
  for (const c of r.categories.filter(c => c.mode === 'delete'))
    for (const it of c.items) await C.guard(it.path, 'delete', h);
  // Calisan tarayici yoksa Firefox da listelenir
  const r2 = await C.scanJunk(h, {});
  assert.equal(r2.categories.find(c => c.id === 'browser').items.length, 2);
  assert.ok(r2.categories.find(c => c.id === 'cache').items.some(i => i.path.endsWith('com.calisan.app')));
});

test('scanJunk + removeItems uctan uca: yalnizca secilen kategori temizlenir', async (t) => {
  const h = fakeHome(t), out = setup(t), log = path.join(out, 'log.jsonl');
  put(path.join(h, 'Library', 'Caches', 'com.ornek.app', 'x'), rnd(1000));
  put(path.join(h, 'Library', 'Logs', 'eski.log'), rnd(100), 30);
  const doc = put(path.join(h, 'Documents', 'rapor.txt'), 'x');
  const r = await C.scanJunk(h);
  const cache = r.categories.find(c => c.id === 'cache');
  const res = await C.removeItems(cache.items, { mode: cache.mode, home: h, logFile: log });
  assert.equal(res.removed.length, 1); assert.equal(res.freed, 1000);
  assert.ok(fs.existsSync(path.join(h, 'Library', 'Logs', 'eski.log')) && fs.existsSync(doc));
  assert.ok(fs.existsSync(path.join(h, 'Library', 'Caches')));
  assert.equal(readLog(log).length, 1);
});

test('Cop Sepeti: yalnizca taramada gorulen ve degismemis ogeler silinir, sonradan atilanlar kalir (F6)', async (t) => {
  const h = fakeHome(t), out = setup(t), log = path.join(out, 'log.jsonl'), T = path.join(h, '.Trash');
  put(path.join(T, 'eski.txt'), rnd(300)); put(path.join(T, 'klasor', 'ic.txt'), rnd(200));
  put(path.join(T, 'degisecek.txt'), rnd(100)); put(path.join(T, 'yeniden.txt'), rnd(50));
  const r = await C.scanJunk(h);
  const cat = r.categories.find(c => c.id === 'trash');
  assert.equal(cat.items.length, 4);
  // taramadan sonra: yeni bir oge atildi, biri degisti, biri silinip ayni adla baska dosya atildi
  put(path.join(T, 'sonradan.txt'), rnd(500));
  put(path.join(T, 'degisecek.txt'), rnd(101));
  fs.rmSync(path.join(T, 'yeniden.txt')); put(path.join(T, 'yeniden.txt'), rnd(50));
  const it = cat.items.find(i => i.path.endsWith('yeniden.txt')); fs.utimesSync(it.path, it.mtimeMs / 1000, it.mtimeMs / 1000);
  const res = await C.removeItems(cat.items, { mode: 'trash-empty', cat: 'trash', home: h, logFile: log });
  assert.deepEqual(res.removed.map(p => path.basename(p)).sort(), ['eski.txt', 'klasor']);
  assert.equal(res.freed, 500);
  assert.deepEqual(fs.readdirSync(T).sort(), ['degisecek.txt', 'sonradan.txt', 'yeniden.txt']);
  assert.ok(res.failed.every(f => /değişmiş/.test(f.error)));
  // yalnizca yol (tarama bilgisi yok), .Trash disi, alt oge reddedilir
  const doc = put(path.join(h, 'Documents', 'a.txt'), 'x');
  const r2 = await C.removeItems([path.join(T, 'sonradan.txt'), { path: doc, size: 1, mtimeMs: fs.statSync(doc).mtimeMs }, path.join(T, 'x', 'y')], { mode: 'trash-empty', home: h });
  assert.equal(r2.removed.length, 0); assert.ok(fs.existsSync(doc) && fs.existsSync(path.join(T, 'sonradan.txt')));
});

test('cleaner-main: Cop Sepeti temizligi Finder "empty trash" cagirmaz, taranan ogeleri siler (F6)', async (t) => {
  const h = fakeHome(t), ud = setup(t), T = path.join(h, '.Trash');
  put(path.join(T, 'eski.txt'), rnd(300));
  const cp = require('child_process'), orig = cp.execFile, calls = [];
  cp.execFile = (...a) => { calls.push(a[0]); const cb = a.find(x => typeof x === 'function'); if (cb) cb(new Error('yok')); };
  t.after(() => { cp.execFile = orig; });
  delete require.cache[require.resolve('../cleaner-main.js')];
  const { registerCleaner } = require('../cleaner-main.js');
  const handlers = {}, wc = { send() {} };
  const win = { webContents: wc, isDestroyed: () => false, loadFile() {}, once() {}, on() {}, show() {}, focus() {} };
  wc.setWindowOpenHandler = () => {}; wc.on = () => {};
  const ui = registerCleaner({ ipcMain: { handle: (ch, f) => { handlers[ch] = f; } }, dialog: { showMessageBox: async () => ({ response: 0 }) },
    shell: { trashItem: async () => {} }, app: { getPath: k => k === 'home' ? h : ud }, BrowserWindow: function () { return win; }, path });
  ui.open();
  const call = (ch, ...a) => handlers[ch]({ sender: wc }, ...a);
  const s = await call('cl:junk'); assert.equal(s.ok, true);
  put(path.join(T, 'sonradan.txt'), rnd(100));   // tarama ile temizlik arasinda atildi
  const r = await call('cl:clean', ['trash']);
  assert.equal(r.ok, true); assert.equal(r.count, 1);
  assert.deepEqual(fs.readdirSync(T), ['sonradan.txt']);
  assert.ok(!calls.some(c => /osascript/.test(String(c))), 'Finder ile bosaltma yok');
});

test('kopyalar: sembolik bagli yol uzerinden ~/Library dosyasi tasinmaz, taranmaz (F9)', async (t) => {
  const d = setup(t), data = rnd(5000), tr = fakeTrash(d);
  const as = path.join(d, 'Library', 'Application Support', 'App');
  put(path.join(as, 'db.sqlite'), data); put(path.join(d, 'Documents', 'copy.sqlite'), data);
  fs.symlinkSync(path.join(d, 'Library'), path.join(d, 'Lib'));
  const via = path.join(d, 'Lib', 'Application Support', 'App', 'db.sqlite');
  // tarama: sembolik bagli kok uzerinden Library taranmaz
  assert.deepEqual(await C.findDuplicates([path.join(d, 'Lib', 'Application Support'), path.join(d, 'Documents')], { home: d }), []);
  // eski/elle olusturulmus grup ile de tasinamaz
  const g = { size: 5000, hash: crypto.createHash('sha256').update(data).digest('hex'), keep: path.join(d, 'Documents', 'copy.sqlite'),
    files: [{ path: via }, { path: path.join(d, 'Documents', 'copy.sqlite') }] };
  const r = await C.removeDuplicates([g], [via], { trash: tr.fn, home: d });
  assert.equal(r.removed.length, 0); assert.match(r.failed[0].error, /Library/);
  assert.ok(fs.existsSync(path.join(as, 'db.sqlite'))); assert.equal(tr.calls.length, 0);
});

test('kopyalar: ust klasor sembolik bagla kalan kopyaya yonlendirilirse tasinmaz (F10)', async (t) => {
  const d = setup(t), data = rnd(5000), tr = fakeTrash(d);
  const a = path.join(d, 'Photos'), b = path.join(d, 'Backup');
  put(path.join(a, 'img.jpg'), data); put(path.join(b, 'img.jpg'), data);
  const g = (await C.findDuplicates([d], { home: d }))[0];
  const del = g.files.find(f => f.path !== g.keep);
  fs.rmSync(path.dirname(del.path), { recursive: true }); fs.symlinkSync(path.dirname(g.keep), path.dirname(del.path));
  const r = await C.removeDuplicates([g], [del.path], { trash: tr.fn, home: d });
  assert.equal(r.removed.length, 0); assert.match(r.failed[0].error, /aynı dosya/);
  assert.ok(fs.existsSync(g.keep)); assert.equal(tr.calls.length, 0);
});

test('eski taramadan gelen yukleyici ve gunluk temizlik aninda yeniden denetlenir', async (t) => {
  const h = fakeHome(t), out = setup(t), tr = fakeTrash(out);
  const dmg = put(path.join(h, 'Downloads', 'eski.dmg'), rnd(100), 40);
  const lg = put(path.join(h, 'Library', 'Logs', 'eski.log'), rnd(100), 30);
  const r = await C.scanJunk(h);
  const inst = r.categories.find(c => c.id === 'installers').items, logs = r.categories.find(c => c.id === 'logs').items;
  assert.equal(inst.length, 1); assert.equal(logs.length, 1);
  // tarama sonrasi kullanici ayni adla yeni bir dosya indirdi / gunluk yeniden yazildi
  fs.writeFileSync(dmg, 'yeni'); fs.appendFileSync(lg, 'yeni satir');
  let x = await C.removeItems(inst, { mode: 'trash', cat: 'installers', trash: tr.fn, home: h });
  assert.equal(x.removed.length, 0); assert.match(x.failed[0].error, /yükleyici/); assert.equal(tr.calls.length, 0);
  x = await C.removeItems(logs, { mode: 'delete', cat: 'logs', home: h });
  assert.equal(x.removed.length, 0); assert.match(x.failed[0].error, /yakın zamanda/); assert.ok(fs.existsSync(lg));
  // uzanti/konum: Indirilenler kokunde olmayan ya da yukleyici olmayan dosya
  const zip = put(path.join(h, 'Downloads', 'eski.zip'), 'x', 40), sub = put(path.join(h, 'Downloads', 'k', 'a.dmg'), 'x', 40);
  x = await C.removeItems([zip, sub], { mode: 'trash', cat: 'installers', trash: tr.fn, home: h });
  assert.equal(x.removed.length, 0);
  // kosul hala saglaniyorsa temizlenir
  const t0 = new Date(Date.now() - 40 * DAY); fs.utimesSync(dmg, t0, t0); fs.utimesSync(lg, t0, t0);
  assert.equal((await C.removeItems(inst, { mode: 'trash', cat: 'installers', trash: tr.fn, home: h })).removed.length, 1);
  assert.equal((await C.removeItems(logs, { mode: 'delete', cat: 'logs', home: h })).removed.length, 1);
});
