// Kendi kendini guncelleme (saf mantik): GitHub Releases'teki latest.json -> zip indir (SHA-256) -> ac ve dogrula -> kurulum betigi.
// Uygulama imzasiz/notarize edilmemis oldugu icin Squirrel kullanilamaz. Ag, komut ve dosya erisimi disaridan verilebilir (testler).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const REPO = 'maj834/Proje';
const BUNDLE_ID = 'com.cem.app';
const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;
const HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const MAX_SIZE = 600 * 1024 * 1024;     // paket en fazla 600 MB
const MAX_MANIFEST = 256 * 1024;
const MAX_REDIRECTS = 5;
const VER_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const ARCHS = ['arm64', 'x64'];

// --- surum karsilastirma (sayisal: 2.0.10 > 2.0.9) ---
function parseVersion(v) {
  const m = typeof v === 'string' && VER_RE.exec(v.trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error('Geçersiz sürüm: ' + (!x ? a : b));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

// --- URL politikasi: yalnizca https ve GitHub alan adlari ---
function allowedUrl(u) {
  let p; try { p = new URL(String(u)); } catch (e) { return false; }
  return p.protocol === 'https:' && !p.username && !p.password && (p.port === '' || p.port === '443') && HOSTS.includes(p.hostname.toLowerCase());
}
function assertUrl(u) { if (!allowedUrl(u)) throw new Error('İzin verilmeyen adres: ' + String(u).slice(0, 200)); }
const assetName = (v, arch) => `CemApp-${v}-${arch}.zip`;
const assetUrl = (v, name) => `https://github.com/${REPO}/releases/download/v${v}/${name}`;

// --- latest.json dogrulama (kati) ---
function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Sürüm bilgisi bozuk');
  if (!parseVersion(m.version)) throw new Error('Sürüm bilgisi bozuk: version');
  const version = m.version.trim();
  if (m.date != null && (typeof m.date !== 'string' || m.date.length > 64)) throw new Error('Sürüm bilgisi bozuk: date');
  let notes = m.notes == null ? [] : m.notes;
  if (typeof notes === 'string') notes = notes.split('\n');
  if (!Array.isArray(notes) || notes.some(n => typeof n !== 'string')) throw new Error('Sürüm bilgisi bozuk: notes');
  notes = notes.map(n => n.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300)).filter(Boolean).slice(0, 30);
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > 8) throw new Error('Sürüm bilgisi bozuk: files');
  const seen = new Set();
  const files = m.files.map((f, i) => {
    const bad = k => { throw new Error(`Sürüm bilgisi bozuk: files[${i}].${k}`); };
    if (!f || typeof f !== 'object') bad('');
    if (!ARCHS.includes(f.arch)) bad('arch');
    if (seen.has(f.arch)) bad('arch (tekrar)');
    seen.add(f.arch);
    if (f.name !== assetName(version, f.arch)) bad('name');
    if (typeof f.url !== 'string' || !allowedUrl(f.url) || f.url !== assetUrl(version, f.name)) bad('url');
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) bad('sha256');
    if (!Number.isSafeInteger(f.size) || f.size < 1 || f.size > MAX_SIZE) bad('size');
    return { arch: f.arch, name: f.name, url: f.url, sha256: f.sha256, size: f.size, version };
  });
  return { version, date: m.date || null, notes, files };
}

// --- ag: yonlendirmeleri elle izle, her adresi politikaya gore denetle ---
async function get(url, { fetch = globalThis.fetch, signal, accept } = {}) {
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertUrl(url);
    const res = await fetch(url, { redirect: 'manual', signal, headers: { 'user-agent': 'CemApp-Updater', accept: accept || '*/*' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      try { if (res.body) await res.body.cancel(); } catch (e) {}
      if (!loc) throw new Error('Yönlendirme adresi yok');
      url = new URL(loc, url).toString();
      continue;
    }
    if (res.status === 404) { try { if (res.body) await res.body.cancel(); } catch (e) {} throw Object.assign(new Error('Sürüm bulunamadı (404)'), { status: 404 }); }
    if (!res.ok) { try { if (res.body) await res.body.cancel(); } catch (e) {} throw new Error('Sunucu hatası: HTTP ' + res.status); }
    return res;
  }
  throw new Error('Çok fazla yönlendirme');
}

async function readLimited(res, max) {
  const chunks = []; let n = 0;
  for await (const c of res.body) { n += c.length; if (n > max) throw new Error('Yanıt çok büyük'); chunks.push(Buffer.from(c)); }
  return Buffer.concat(chunks);
}

// Guncelleme var mi? {update:false, version} ya da {update:true, version, notes, date, file}
async function check({ current, arch, fetch, signal, url = MANIFEST_URL } = {}) {
  if (!parseVersion(current)) throw new Error('Geçersiz mevcut sürüm: ' + current);
  if (!ARCHS.includes(arch)) throw new Error('Desteklenmeyen mimari: ' + arch);
  const res = await get(url, { fetch, signal, accept: 'application/json' });
  let raw; try { raw = JSON.parse((await readLimited(res, MAX_MANIFEST)).toString('utf8')); } catch (e) { throw new Error('Sürüm bilgisi okunamadı: ' + e.message); }
  const m = validateManifest(raw);
  if (compareVersions(m.version, current) <= 0) return { update: false, version: m.version };
  const file = m.files.find(f => f.arch === arch);
  if (!file) throw new Error(`Bu Mac (${arch}) için güncelleme paketi yok`);
  return { update: true, version: m.version, notes: m.notes, date: m.date, file };
}

function sameHash(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y);
}
async function hashFile(p) {
  const h = crypto.createHash('sha256');
  for await (const c of fs.createReadStream(p)) h.update(c);
  return h.digest('hex');
}

// Paketi <dir>/CemApp-<v>.zip.part'a indir, boyut + SHA-256 denetle, sonra .zip yap. Zaten inmis ve dogruysa tekrar indirmez.
async function download(file, { dir, fetch, onProgress, signal } = {}) {
  if (!file || !parseVersion(file.version) || !/^[0-9a-f]{64}$/.test(file.sha256 || '')) throw new Error('Geçersiz paket bilgisi');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_SIZE) throw new Error('Geçersiz paket boyutu');
  assertUrl(file.url);
  fs.mkdirSync(dir, { recursive: true });
  const final = path.join(dir, `CemApp-${file.version}.zip`), part = final + '.part';
  try {
    if (fs.statSync(final).size === file.size && sameHash(await hashFile(final), file.sha256)) { onProgress && onProgress(1, file.size, file.size); return final; }
  } catch (e) {}
  fs.rmSync(final, { force: true }); fs.rmSync(part, { force: true });
  let fh = null;
  try {
    const res = await get(file.url, { fetch, signal, accept: 'application/octet-stream' });
    const len = res.headers.get('content-length');
    if (len != null && +len !== file.size) throw new Error(`Paket boyutu uyuşmuyor (${len} ≠ ${file.size})`);
    fh = await fs.promises.open(part, 'wx', 0o600);
    const h = crypto.createHash('sha256'); let got = 0, lastPct = -1;
    for await (const chunk of res.body) {
      if (signal && signal.aborted) throw new Error('İndirme iptal edildi');
      const b = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      got += b.length;
      if (got > file.size) throw new Error('Paket beklenenden büyük');
      h.update(b);
      let off = 0; while (off < b.length) off += (await fh.write(b, off, b.length - off)).bytesWritten;
      const pct = Math.floor(got / file.size * 100);
      if (onProgress && pct !== lastPct) { lastPct = pct; onProgress(got / file.size, got, file.size); }
    }
    if (signal && signal.aborted) throw new Error('İndirme iptal edildi');
    if (got !== file.size) throw new Error(`Paket eksik indi (${got} / ${file.size})`);
    await fh.sync(); await fh.close(); fh = null;
    if (!sameHash(h.digest('hex'), file.sha256)) throw new Error('Paket doğrulanamadı (SHA-256 uyuşmuyor)');
    fs.renameSync(part, final);
    return final;
  } catch (e) {
    if (fh) try { await fh.close(); } catch (x) {}
    fs.rmSync(part, { force: true });
    if (e && e.name === 'AbortError') throw new Error('İndirme iptal edildi');
    throw e;
  }
}

// execFile (kabuk yok) -> Promise<{stdout, stderr}>
function defaultExec(cmd, args) {
  const { execFile } = require('child_process');
  return new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024, timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
    if (err) { err.stdout = stdout; err.stderr = stderr; rej(err); } else res({ stdout: String(stdout), stderr: String(stderr) });
  }));
}

// Calisan uygulama imzali mi? {signed, team}. Ad-hoc / imzasiz -> signed:false
async function signInfo(appPath, { exec = defaultExec } = {}) {
  try {
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
    const r = await exec('/usr/bin/codesign', ['-dv', '--verbose=2', appPath]);
    const out = String(r.stderr || '') + String(r.stdout || '');
    if (/Signature=adhoc/.test(out)) return { signed: false, team: null };
    const t = /TeamIdentifier=([A-Z0-9]{10})\b/.exec(out);
    return { signed: true, team: t ? t[1] : null };
  } catch (e) { return { signed: false, team: null }; }
}

// Zip'i ac, tek .app bul, kimlik + surum denetle, karantinayi kaldir, (mevcut imzaliysa) imzayi dogrula. Yeni .app yolunu dondurur.
async function prepare(zipPath, { exec = defaultExec, version, signed = null, workDir } = {}) {
  if (!parseVersion(version)) throw new Error('Beklenen sürüm geçersiz');
  const tmp = fs.mkdtempSync(path.join(workDir || path.dirname(zipPath), 'hazirla-'));
  try {
    await exec('/usr/bin/ditto', ['-x', '-k', zipPath, tmp]);
    const apps = fs.readdirSync(tmp).filter(n => n.endsWith('.app') && fs.lstatSync(path.join(tmp, n)).isDirectory());
    if (apps.length !== 1) throw new Error(apps.length ? 'Pakette birden fazla uygulama var' : 'Pakette uygulama bulunamadı');
    const app = path.join(tmp, apps[0]), plist = path.join(app, 'Contents', 'Info.plist');
    if (!fs.existsSync(plist) || !fs.lstatSync(plist).isFile()) throw new Error('Uygulama bilgisi (Info.plist) yok');
    const key = async k => String((await exec('/usr/bin/plutil', ['-extract', k, 'raw', '-o', '-', plist])).stdout || '').trim();
    const id = await key('CFBundleIdentifier');
    if (id !== BUNDLE_ID) throw new Error('Paket başka bir uygulamaya ait: ' + id.slice(0, 80));
    const v = await key('CFBundleShortVersionString');
    if (v !== version) throw new Error(`Paket sürümü uyuşmuyor (${v.slice(0, 40)} ≠ ${version})`);
    try { await exec('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', app]); } catch (e) {}
    if (signed && signed.signed) {
      try { await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]); } catch (e) { throw new Error('Yeni sürümün imzası doğrulanamadı'); }
      if (signed.team) {
        const r = await exec('/usr/bin/codesign', ['-dv', '--verbose=2', app]);
        const t = /TeamIdentifier=([A-Z0-9]{10})\b/.exec(String(r.stderr || '') + String(r.stdout || ''));
        if (!t || t[1] !== signed.team) throw new Error('Yeni sürüm farklı bir geliştirici tarafından imzalanmış');
      }
    }
    return app;
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
}

// Kurulum betigi (POSIX sh). Yollar betige YAZILMAZ: $1..$8 konum argumanlari.
// $1 eski .app  $2 yeni .app  $3 beklenecek pid  $4 yedek klasoru  $5 yeniden ac (1/0, varsayilan 1)  $6 yedek silme gecikmesi sn (varsayilan 10)
// $7 acilis isareti dosyasi (bos: yok)  $8 isaret bekleme suresi sn (varsayilan 30). $7 verilirse ve yeniden acilirsa: yeni surum $8 sn icinde
// isareti yazmazsa (acilista coktu / takildi) yeni surum kapatilir, yedek geri yuklenir, eski surum acilir ve "$7.failed" yazilir.
// installScript({oldApp,newApp,pid,backupDir}) yollari bilerek kullanmaz: argumanlar installArgs ile ayri verilir.
function installScript() {
  return `#!/bin/sh
# Cem App guncelleyici: uygulamanin kapanmasini bekler, eskisini yedekler, yenisini yerine koyar, hata olursa geri alir.
PATH="\${CEM_UPDATE_PATH:+\$CEM_UPDATE_PATH:}/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
umask 022
OLD=$1
NEW=$2
PID=$3
BK=$4
RELAUNCH=\${5:-1}
DELAY=\${6:-10}
MARK=\${7:-}
WAIT=\${8:-30}
case "$BK" in /*) ;; *) exit 2 ;; esac
mkdir -p -- "$BK" || exit 2
LOG="$BK/guncelleme.log"
log() { printf '%s %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG" 2>/dev/null; }
fail() { log "HATA: $*"; exit 1; }
case "$PID" in ''|*[!0-9]*) fail "gecersiz pid" ;; esac
case "$RELAUNCH" in 0|1) ;; *) fail "gecersiz secenek" ;; esac
case "$DELAY" in ''|*[!0-9]*) fail "gecersiz gecikme" ;; esac
case "$WAIT" in ''|*[!0-9]*) fail "gecersiz bekleme" ;; esac
case "$MARK" in ''|/*) ;; *) fail "gecersiz isaret" ;; esac
case "$OLD" in /*.app) ;; *) fail "gecersiz hedef" ;; esac
case "$NEW" in /*.app) ;; *) fail "gecersiz yeni surum" ;; esac
[ -d "$NEW" ] || fail "yeni surum bulunamadi"
log "basladi (pid $PID)"
# Yerine konan (yeni) uygulamanin calisan sureclerini kapat: ikilisi $OLD/Contents/MacOS altinda olanlar (lsof ile, kabuk deseni yok)
stop_new() {
  command -v lsof >/dev/null 2>&1 || return 0
  pids=$(lsof -t -- "$OLD"/Contents/MacOS/* 2>/dev/null) || true
  ok=""
  for p in $pids; do
    case "$p" in ''|*[!0-9]*) continue ;; esac
    [ "$p" = "$$" ] && continue
    ok="$ok $p"
  done
  [ -n "$ok" ] || return 0
  log "yeni surum kapatiliyor:$ok"
  for p in $ok; do kill "$p" 2>/dev/null; done
  j=0
  while [ "$j" -lt 20 ]; do
    alive=0
    for p in $ok; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && return 0
    j=$((j + 1))
    sleep 0.5
  done
  for p in $ok; do kill -9 "$p" 2>/dev/null; done
  return 0
}
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -ge 60 ] && fail "uygulama 30 sn icinde kapanmadi; kurulum iptal"
  sleep 0.5
done
BAK="$BK/onceki.app"
rm -rf -- "$BAK"
[ -n "$MARK" ] && rm -f -- "$MARK"
had_old=0
if [ -e "$OLD" ]; then
  mv -f -- "$OLD" "$BAK" || fail "eski surum yedeklenemedi"
  had_old=1
fi
if mv -- "$NEW" "$OLD"; then
  log "yeni surum tasindi"
elif rm -rf -- "$OLD" && ditto "$NEW" "$OLD"; then
  log "yeni surum kopyalandi (ditto)"
  rm -rf -- "$NEW"
else
  log "yeni surum yerlestirilemedi; geri aliniyor"
  rm -rf -- "$OLD"
  if [ "$had_old" = 1 ]; then
    if mv -- "$BAK" "$OLD"; then log "eski surum geri yuklendi"; else log "GERI YUKLENEMEDI, yedek: $BAK"; fi
  fi
  [ "$RELAUNCH" = 1 ] && open -n "$OLD"
  exit 1
fi
if [ "$RELAUNCH" = 1 ]; then
  if open -n "$OLD"; then
    log "yeni surum acildi"
    if [ -n "$MARK" ]; then
      # Yeni surumun basariyla actigini bildiren isareti bekle; gelmezse geri al
      i=0
      while [ ! -e "$MARK" ]; do
        i=$((i + 1))
        if [ "$i" -gt $((WAIT * 2)) ]; then
          log "yeni surum $WAIT sn icinde acilis isareti yazmadi; geri aliniyor"
          stop_new
          printf '%s\\n' "$(date '+%s')" > "$MARK.failed" 2>/dev/null
          if [ "$had_old" = 1 ]; then
            rm -rf -- "$OLD"
            if mv -- "$BAK" "$OLD"; then log "eski surum geri yuklendi"; open -n "$OLD"; else log "GERI YUKLENEMEDI, yedek: $BAK"; fi
          fi
          exit 1
        fi
        sleep 0.5
      done
      rm -f -- "$MARK"
      log "yeni surum basariyla acildi"
    else
      sleep "$DELAY"
    fi
  else
    log "yeni surum acilamadi; geri aliniyor"
    if [ "$had_old" = 1 ]; then
      rm -rf -- "$OLD"
      if mv -- "$BAK" "$OLD"; then log "eski surum geri yuklendi"; open -n "$OLD"; else log "GERI YUKLENEMEDI, yedek: $BAK"; fi
    fi
    exit 1
  fi
fi
rm -rf -- "$BAK"
log "tamam"
exit 0
`;
}

// /bin/sh <betik> ardindan verilecek argumanlar (dogrulanmis)
function installArgs({ oldApp, newApp, pid, backupDir, relaunch = true, delay = 10, marker = '', wait = 30 }) {
  for (const [k, v] of [['oldApp', oldApp], ['newApp', newApp]]) if (typeof v !== 'string' || !path.isAbsolute(v) || !v.endsWith('.app')) throw new Error('Geçersiz yol: ' + k);
  if (typeof backupDir !== 'string' || !path.isAbsolute(backupDir)) throw new Error('Geçersiz yol: backupDir');
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Geçersiz pid');
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > 600) throw new Error('Geçersiz gecikme');
  if (marker !== '' && (typeof marker !== 'string' || !path.isAbsolute(marker))) throw new Error('Geçersiz yol: marker');
  if (!Number.isSafeInteger(wait) || wait < 1 || wait > 600) throw new Error('Geçersiz bekleme');
  return [oldApp, newApp, String(pid), backupDir, relaunch ? '1' : '0', String(delay), marker, String(wait)];
}

// Bu konumdaki uygulama yerinde guncellenebilir mi?
function canInstall(appPath, { fs: F = fs } = {}) {
  const no = reason => ({ ok: false, reason });
  if (typeof appPath !== 'string' || !path.isAbsolute(appPath)) return no('Uygulamanın konumu bulunamadı.');
  const p = path.normalize(appPath).replace(/\/+$/, '');
  if (!p.endsWith('.app')) return no('Uygulama paketi (.app) bulunamadı.');
  if (p.startsWith('/Volumes/')) return no('Uygulama disk görüntüsünden (DMG) çalışıyor. Önce Uygulamalar klasörüne sürükleyip oradan aç.');
  if (/\/AppTranslocation\//.test(p)) return no('macOS uygulamayı geçici bir konumdan çalıştırıyor (App Translocation). Uygulamayı Uygulamalar klasörüne taşıyıp yeniden aç.');
  try { F.accessSync(path.dirname(p), F.constants.W_OK); F.accessSync(p, F.constants.W_OK); }
  catch (e) { return no('Uygulamanın bulunduğu klasöre yazma izni yok. Yeni sürümü GitHub\'dan elle indir.'); }
  return { ok: true, reason: null };
}

// .../Cem App.app/Contents/MacOS/Cem App -> .../Cem App.app
function bundlePath(exe) {
  const p = path.resolve(String(exe), '..', '..', '..');
  return p.endsWith('.app') ? p : null;
}

module.exports = { check, download, prepare, installScript, installArgs, canInstall, signInfo, bundlePath, compareVersions, parseVersion,
  validateManifest, allowedUrl, hashFile, MANIFEST_URL, RELEASE_PAGE, BUNDLE_ID, HOSTS, MAX_SIZE };
