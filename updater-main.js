// Guncelleme (ana surec): acilistan 30 sn sonra ve 6 saatte bir GitHub Releases'e bakar; yeni surumu arka planda indirip
// dogrular, hazir olunca bildirim gosterir. Kurulum: "Yeniden baslat" (install) ya da uygulama kapanirken (onQuit).
// Ayrintilar ve guvenlik denetimleri updater.js'te. Gelistirme modunda (paketlenmemis) CEM_UPDATE_TEST yoksa calismaz.
'use strict';
const fs = require('fs'), os = require('os');
const U = require('./updater.js');

const FIRST_DELAY = 30 * 1000, EVERY = 6 * 60 * 60 * 1000;
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

  const st = { current: app.getVersion(), latest: null, phase: 'idle', progress: null, notes: [], error: null, checkedAt: null };
  let pending = null, ready = null, busy = null, installing = false, notified = '', timers = [], ctrl = null, cleaned = false;

  const can = () => U.canInstall(appPath() || '', deps.fs ? { fs: deps.fs } : {});
  // canInstall: {ok, reason} (hazir/var iken) -> arayuz "Yeniden baslat" yerine sebebi + "Sayfayi ac" gosterebilir
  const state = () => ({ ...st, notes: st.notes.slice(), enabled: enabled(), conf: conf(), canInstall: st.phase === 'ready' || st.phase === 'available' ? can() : null });
  const emit = () => { try { send('update', state()); } catch (e) {} };
  const set = o => { Object.assign(st, o); emit(); };
  const fail = e => { set({ phase: 'error', error: String((e && e.message) || e).slice(0, 300), progress: null }); };

  // Eski indirmeler ve kalmis yedek (kurulum betigi 10 sn sonra siler; kalmissa betik yarida kesilmistir)
  function cleanup() {
    if (cleaned) return; cleaned = true;
    for (const p of [dlDir(), backupDir()]) try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
  }

  async function fetchAndPrepare(r) {
    ctrl = new AbortController();
    set({ phase: 'downloading', progress: 0, error: null });
    let last = 0;
    const zip = await U.download(r.file, { dir: dlDir(), fetch, signal: ctrl.signal,
      onProgress: p => { if (p === 1 || p - last >= 0.02) { last = p; set({ progress: Math.round(p * 1000) / 1000 }); } } });
    const signed = await U.signInfo(appPath(), exec ? { exec } : {});
    const newApp = await U.prepare(zip, { version: r.version, signed, ...(exec ? { exec } : {}) });
    try { fs.rmSync(zip, { force: true }); } catch (e) {}
    ready = { version: r.version, app: newApp };
    set({ phase: 'ready', progress: 1, error: null });
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
      set({ phase: 'checking', error: null });
      try {
        const r = await U.check({ current: st.current, arch, fetch });
        st.checkedAt = Date.now();
        if (!r.update) { set({ phase: 'uptodate', latest: r.version, notes: [] }); return state(); }
        const c = conf();
        if (ready && ready.version === r.version) { set({ phase: 'ready', latest: r.version, notes: r.notes }); return state(); }
        if (!manual && c.skip === r.version) { set({ phase: 'idle', latest: r.version, notes: r.notes }); return state(); }
        pending = r;
        set({ phase: 'available', latest: r.version, notes: r.notes });
        if (c.auto) { ready = null; await fetchAndPrepare(r); }
        return state();
      } catch (e) { if (prev === 'ready' && ready) set({ phase: 'ready', error: null }); else fail(e); return state(); }
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
      const args = U.installArgs({ oldApp: old, newApp: ready.app, pid, backupDir: backupDir(), relaunch, delay: deps.delay ?? 10 });
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

  // "Yeniden baslat ve kur": gerekirse once indirir
  async function install() {
    if (!enabled() || installing) return state();
    if (busy) await busy;
    if (st.phase !== 'ready' && pending && U.compareVersions(pending.version, st.current) > 0) {
      try { await fetchAndPrepare(pending); } catch (e) { fail(e); return state(); } finally { ctrl = null; }
    }
    if (!ready) { fail(new Error('Kurulacak güncelleme yok.')); return state(); }
    if (runScript(true)) setImmediate(() => app.quit());
    return state();
  }

  function setConf(o) {
    if (!o || typeof o !== 'object') return null;
    const n = { ...conf() };
    if ('auto' in o) { if (typeof o.auto !== 'boolean') return null; n.auto = o.auto; }
    if ('onQuit' in o) { if (typeof o.onQuit !== 'boolean') return null; n.onQuit = o.onQuit; }
    if ('skip' in o) { if (o.skip !== '' && o.skip !== null && !U.parseVersion(o.skip)) return null; n.skip = o.skip || ''; }
    save({ update: n });
    if (n.skip && st.latest === n.skip && st.phase === 'available') set({ phase: 'idle' });
    else emit();
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
    if (installing || !enabled() || st.phase !== 'ready' || !ready || !conf().onQuit) return;
    if (ctrl) try { ctrl.abort(); } catch (e) {}
    runScript(false);
  });
  app.on('will-quit', () => { for (const t of timers) clearTimeout(t), clearInterval(t); timers = []; if (ctrl) try { ctrl.abort(); } catch (e) {} });

  function start() {
    if (!enabled() || timers.length) return;
    const st1 = (deps.setTimeout || setTimeout)(() => check(false), deps.firstDelay ?? FIRST_DELAY);
    const st2 = (deps.setInterval || setInterval)(() => check(false), deps.every ?? EVERY);
    for (const t of [st1, st2]) if (t && t.unref) t.unref();
    timers.push(st1, st2);
  }
  app.whenReady().then(start);

  return { check, status: () => (st.phase === 'ready' ? `Güncelleme hazır: ${st.latest}` : null), install, state, set: setConf,
    openPage: () => shell && shell.openExternal(U.RELEASE_PAGE) };
}

module.exports = { registerUpdater, clean };
