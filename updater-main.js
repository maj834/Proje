// Guncelleme (ana surec): acilistan 30 sn sonra ve 6 saatte bir GitHub Releases'e bakar; yeni surumu arka planda indirip
// dogrular, hazir olunca bildirim gosterir. Kurulum: "Yeniden baslat" (install) ya da uygulama kapanirken (onQuit).
// Ayrintilar ve guvenlik denetimleri updater.js'te. Gelistirme modunda (paketlenmemis) CEM_UPDATE_TEST yoksa calismaz.
'use strict';
const fs = require('fs'), os = require('os');
const U = require('./updater.js');

const FIRST_DELAY = 30 * 1000, EVERY = 6 * 60 * 60 * 1000;
// Acilis isareti: uygulama 'ready'den bu kadar sonra hatasiz calisiyorsa <dir>/started-<surum> yazilir. Kurulum betigi yeni surumu
// actiktan sonra bu dosyayi bekler (STARTED_WAIT sn); gelmezse yeni surumu kapatir, yedegi geri yukler ve eskiyi acar.
const STARTED_DELAY = 3 * 1000, STARTED_WAIT = 60;
const DEF = { auto: true, onQuit: true, skip: '' };
const clean = c => ({ auto: typeof c.auto === 'boolean' ? c.auto : DEF.auto, onQuit: typeof c.onQuit === 'boolean' ? c.onQuit : DEF.onQuit,
  skip: typeof c.skip === 'string' && U.parseVersion(c.skip) ? c.skip : '' });

function registerUpdater({ ipcMain, app, path, Notification, shell, cfg, save, send = () => {}, isAllowed = () => true, deps = {} }) {
  const fetch = deps.fetch || ((...a) => globalThis.fetch(...a));
  const exec = deps.exec;                                     // undefined -> updater.js varsayilani (execFile)
  const spawn = deps.spawn || require('child_process').spawn;
  const arch = deps.arch || process.arch;
  const pid = deps.pid || process.pid;
  const enabled = () => !!process.env.CEM_UPDATE_TEST || (app.isPackaged && (deps.platform || process.platform) === 'darwin');
  const conf = () => clean({ ...DEF, ...((cfg() || {}).update || {}) });
  const dir = () => deps.dir || path.join(app.getPath('userData'), 'guncelleme');
  const dlDir = () => path.join(dir(), 'indirme'), backupDir = () => path.join(dir(), 'yedek');
  const appPath = () => deps.appPath || U.bundlePath(app.getPath('exe'));
  const proc = deps.proc || process;
  // started-<v>: o surum basariyla acildi. started-<v>.failed: betik o surumu acamadi ve geri aldi (otomatik denetimde atlanir).
  const startedFile = v => path.join(dir(), 'started-' + v);
  const startFailed = v => { try { return fs.existsSync(startedFile(v) + '.failed'); } catch (e) { return false; } };

  const st = { current: app.getVersion(), latest: null, phase: 'idle', progress: null, notes: [], error: null, checkedAt: null };
  let pending = null, ready = null, busy = null, installBusy = null, installing = false, notified = '', timers = [], ctrl = null, cleaned = false;

  // --- acilis isareti (kurulum betigi bekler) ---
  let startErr = null, armed = false, startedOk = false, backupCleaned = false;
  const onStartErr = e => { startErr = e || new Error('hata'); };
  // Yalnizca yakalanmamis istisna acilisi basarisiz sayar; promise reddi (or. internet yokken bir istek) zararsiz olabilir,
  // iyi bir guncellemeyi geri aldirmasin
  const disarm = () => {
    if (!armed) return; armed = false;
    try { proc.removeListener('uncaughtExceptionMonitor', onStartErr); } catch (e) {}
  };
  if (enabled()) { armed = true; proc.on('uncaughtExceptionMonitor', onStartErr); }
  function markStarted() {
    disarm();
    if (startErr || !enabled()) return false;
    const v = st.current;
    try {
      fs.mkdirSync(dir(), { recursive: true });
      const tmp = startedFile(v) + '.tmp';
      fs.writeFileSync(tmp, `${v}\n${Date.now()}\n`); fs.renameSync(tmp, startedFile(v));
      startedOk = true;
      // eski isaretler: baska surumlerin started-* dosyalari ve bu/eski surumlerin .failed kayitlari silinir (daha yeni surumun .failed'i kalir)
      for (const n of fs.readdirSync(dir())) {
        const m = /^started-(.+?)(\.failed)?$/.exec(n);
        if (!m || n === 'started-' + v) continue;
        if (m[2] && U.parseVersion(m[1]) && U.compareVersions(m[1], v) > 0) continue;
        try { fs.rmSync(path.join(dir(), n), { force: true }); } catch (e) {}
      }
      return true;
    } catch (e) { return false; }
  }

  const can = () => U.canInstall(appPath() || '', deps.fs ? { fs: deps.fs } : {});
  // canInstall: {ok, reason} (hazir/var iken) -> arayuz "Yeniden baslat" yerine sebebi + "Sayfayi ac" gosterebilir
  const state = () => ({ ...st, notes: st.notes.slice(), enabled: enabled(), conf: conf(), ready: ready ? ready.version : null,
    canInstall: st.phase === 'ready' || st.phase === 'available' ? can() : null });
  const emit = () => { try { send('update', state()); } catch (e) {} };
  const set = o => { Object.assign(st, o); emit(); };
  const fail = e => { set({ phase: 'error', error: String((e && e.message) || e).slice(0, 300), progress: null }); };

  // Eski indirmeler ve kalmis yedek (kurulum betigi yeni surumun acilis isaretini gorunce siler; kalmissa betik yarida kesilmistir)
  // Yedek (onceki.app) yalnizca bu surec acilis isaretini yazabildiyse silinir: acilista hata olduysa kurulum betigi
  // isaret beklerken (STARTED_WAIT) geri yukleme icin ona ihtiyac duyar; ilk denetim (30 sn) onu silmemeli.
  function cleanup() {
    if (!cleaned) { cleaned = true; try { fs.rmSync(dlDir(), { recursive: true, force: true }); } catch (e) {} }
    if (!backupCleaned && (startedOk || !enabled())) { backupCleaned = true; try { fs.rmSync(backupDir(), { recursive: true, force: true }); } catch (e) {} }
  }

  // Hazir paketin gecici klasorunu sil (yalniz indirme klasoru altindaki hazirla-* klasoru)
  function dropPrepared(x) {
    if (!x || !x.app) return;
    const d = path.dirname(x.app);
    if (path.dirname(d) === dlDir() && /^hazirla-/.test(path.basename(d))) try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
  }

  // Yeni surumu indir + hazirla. Onceki hazir surum (ready) yenisi tamamen hazir olana kadar korunur; basarisizlikta o geri gelir.
  async function fetchAndPrepare(r) {
    const prevReady = ready;
    try { return await fetchAndPrepare1(r, prevReady); }
    catch (e) {
      if (prevReady && ready === prevReady && fs.existsSync(prevReady.app)) {
        set({ phase: 'ready', latest: prevReady.version, notes: prevReady.notes || [], progress: 1, error: null });
        e.keptReady = true;
      }
      throw e;
    }
  }
  async function fetchAndPrepare1(r, prevReady) {
    ctrl = new AbortController();
    set({ phase: 'downloading', progress: 0, error: null });
    let last = 0;
    const zip = await U.download(r.file, { dir: dlDir(), fetch, signal: ctrl.signal,
      onProgress: p => { if (p === 1 || p - last >= 0.02) { last = p; set({ progress: Math.round(p * 1000) / 1000 }); } } });
    const signed = await U.signInfo(appPath(), exec ? { exec } : {});
    const newApp = await U.prepare(zip, { version: r.version, signed, ...(exec ? { exec } : {}) });
    try { fs.rmSync(zip, { force: true }); } catch (e) {}
    ready = { version: r.version, app: newApp, notes: r.notes };
    if (prevReady && prevReady.app !== newApp) dropPrepared(prevReady);
    set({ phase: 'ready', latest: r.version, notes: r.notes, progress: 1, error: null });
    if (notified !== r.version && Notification && Notification.isSupported()) {
      notified = r.version;
      const n = new Notification({ title: `Cem App ${r.version} hazır — yeniden başlatınca kurulur`,
        body: r.notes.length ? r.notes.slice(0, 3).map(s => '• ' + s).join('\n') : 'Yeni sürüm indirildi ve doğrulandı.' });
      n.show();
    }
    return ready;
  }

  // manual: kullanici "Simdi denetle" dedi -> atlanan surum da gosterilir
  function check(manual = false) {
    if (!enabled()) { set({ phase: 'idle', error: 'Güncelleme yalnızca paketlenmiş Mac uygulamasında çalışır.' }); return Promise.resolve(state()); }
    if (busy) return busy;
    if (installing) return Promise.resolve(state());
    busy = (async () => {
      cleanup();
      const prev = st.phase;
      let rv = null;
      set({ phase: 'checking', error: null });
      try {
        const r = await U.check({ current: st.current, arch, fetch });
        st.checkedAt = Date.now(); rv = r.version;
        if (!r.update) { set({ phase: 'uptodate', latest: r.version, notes: [] }); return state(); }
        const c = conf();
        if (ready && ready.version === r.version) { set({ phase: 'ready', latest: r.version, notes: r.notes }); return state(); }
        if (!manual && (c.skip === r.version || startFailed(r.version))) {
          const why = c.skip === r.version ? null : `${r.version} açılamadı ve önceki sürüme dönüldü; "Şimdi denetle" ile yeniden denenebilir.`;
          if (ready) set({ phase: 'ready', latest: ready.version, error: why }); else set({ phase: 'idle', latest: r.version, notes: r.notes, error: why });
          return state();
        }
        pending = r;
        set({ phase: 'available', latest: r.version, notes: r.notes });
        if (c.auto) await fetchAndPrepare(r);   // eski hazir surum yenisi hazir olana kadar kalir
        return state();
      } catch (e) {
        if (e && e.keptReady) return state();
        if (rv && conf().skip === rv && !ready) { set({ phase: 'idle', progress: null, error: null }); return state(); }   // indirme sirasinda atlandi
        if (prev === 'ready' && ready) set({ phase: 'ready', latest: ready.version, error: null }); else fail(e); return state(); }
      finally { busy = null; ctrl = null; }
    })();
    return busy;
  }

  // Betigi ayri surecte calistir (uygulama kapandiktan sonra degistirir). relaunch=false: kapanista kur, yeniden acma.
  function runScript(relaunch) {
    const old = appPath(), c = can();
    if (!c.ok) { fail(new Error(c.reason)); return false; }
    if (!ready || !fs.existsSync(ready.app)) { ready = null; fail(new Error('İndirilen sürüm bulunamadı; yeniden denetle.')); return false; }
    try {
      fs.mkdirSync(dir(), { recursive: true });
      const script = path.join(dir(), 'kur.sh');
      fs.rmSync(script, { force: true });
      fs.writeFileSync(script, U.installScript({}), { mode: 0o700, flag: 'wx' });
      // Isaret her iki yolda: yeniden acilista betik hemen bekler; kapanista kurulumda kullanicinin ilk acilisini izler
      const marker = startedFile(ready.version);
      for (const f of [startedFile(ready.version), startedFile(ready.version) + '.failed']) fs.rmSync(f, { force: true });
      const args = U.installArgs({ oldApp: old, newApp: ready.app, pid, backupDir: backupDir(), relaunch, delay: deps.delay ?? 10,
        marker, wait: deps.startedWait ?? STARTED_WAIT });
      const env = { HOME: process.env.HOME || os.homedir(), TMPDIR: process.env.TMPDIR || os.tmpdir(), LANG: 'en_US.UTF-8' };
      if (process.env.CEM_UPDATE_TEST && process.env.CEM_UPDATE_PATH) env.CEM_UPDATE_PATH = process.env.CEM_UPDATE_PATH;
      const child = spawn('/bin/sh', [script, ...args], { detached: true, stdio: 'ignore', env, cwd: '/' });
      if (child && child.on) child.on('error', e => console.error('guncelleme betigi:', e.message));
      if (child && child.unref) child.unref();
      installing = true;
      set({ phase: 'installing', error: null });
      return true;
    } catch (e) { fail(e); return false; }
  }

  // "Yeniden baslat ve kur": gerekirse once indirir. Ayni anda tek kurulum (art arda tiklamalar ayni sozu alir).
  function install() {
    if (!enabled() || installing) return Promise.resolve(state());
    if (installBusy) return installBusy;
    installBusy = (async () => {
      if (busy) await busy;
      if (installing) return state();
      if (pending && U.compareVersions(pending.version, st.current) > 0 && (!ready || ready.version !== pending.version) && conf().skip !== pending.version) {
        try { await fetchAndPrepare(pending); }
        catch (e) { if (!(e && e.keptReady)) { fail(e); return state(); } }
        finally { ctrl = null; }
      }
      if (!ready) { fail(new Error('Kurulacak güncelleme yok.')); return state(); }
      if (runScript(true)) setImmediate(() => app.quit());
      return state();
    })();
    installBusy.finally(() => { installBusy = null; }).catch(() => {});
    return installBusy;
  }

  function setConf(o) {
    if (!o || typeof o !== 'object') return null;
    const n = { ...conf() };
    if ('auto' in o) { if (typeof o.auto !== 'boolean') return null; n.auto = o.auto; }
    if ('onQuit' in o) { if (typeof o.onQuit !== 'boolean') return null; n.onQuit = o.onQuit; }
    if ('skip' in o) { if (o.skip !== '' && o.skip !== null && !U.parseVersion(o.skip)) return null; n.skip = o.skip || ''; }
    save({ update: n });
    // Atlanan surum: hazir/indirilebilir durumdan cikar; kapanista da kurulmaz
    if (n.skip && st.latest === n.skip && ['available', 'ready', 'downloading', 'error'].includes(st.phase)) {
      if (ctrl) try { ctrl.abort(); } catch (e) {}
      if (ready && ready.version === n.skip) { dropPrepared(ready); ready = null; }
      if (pending && pending.version === n.skip) pending = null;
      set({ phase: 'idle', progress: null, error: null });
    } else emit();
    if ('auto' in o && n.auto && st.phase === 'available' && pending && !busy) check(false);
    return state();
  }

  ipcMain.handle('upd:state', e => isAllowed(e) ? state() : null);
  ipcMain.handle('upd:check', e => isAllowed(e) ? check(true) : null);
  ipcMain.handle('upd:install', e => isAllowed(e) ? install() : null);
  ipcMain.handle('upd:set', (e, o) => isAllowed(e) ? setConf(o) : null);
  ipcMain.handle('upd:open', e => { if (isAllowed(e) && shell) shell.openExternal(U.RELEASE_PAGE); return null; });

  // Normal kapanista hazir guncellemeyi kur (sormadan, yeniden acmadan)
  app.on('before-quit', () => {
    if (installing || !enabled() || !ready || !conf().onQuit || conf().skip === ready.version) return;
    if (ctrl) try { ctrl.abort(); } catch (e) {}
    runScript(false);
  });
  app.on('will-quit', () => { disarm(); for (const t of timers) clearTimeout(t), clearInterval(t); timers = []; if (ctrl) try { ctrl.abort(); } catch (e) {} });

  function start() {
    if (!enabled() || timers.length) return;
    const st1 = (deps.setTimeout || setTimeout)(() => check(false), deps.firstDelay ?? FIRST_DELAY);
    const st2 = (deps.setInterval || setInterval)(() => check(false), deps.every ?? EVERY);
    // ready'den sonra hatasiz gecen birkac saniye: acilis isareti (main.js'in kendi whenReady islemleri bu surede biter)
    const st3 = (deps.setTimeout || setTimeout)(markStarted, deps.startedDelay ?? STARTED_DELAY);
    for (const t of [st1, st2]) if (t && t.unref) t.unref();
    timers.push(st1, st2, st3);
  }
  app.whenReady().then(start);

  return { check, status: () => (ready && st.phase !== 'installing' ? `Güncelleme hazır: ${ready.version}` : null), install, state, set: setConf, markStarted,
    openPage: () => shell && shell.openExternal(U.RELEASE_PAGE) };
}

module.exports = { registerUpdater, clean };
