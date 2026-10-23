'use strict';
// Guc durumu: pilde mi, ekran kilitli mi, uykuda mi. Arka planda surekli calisan isler (Neo mikrofonu, Sistem
// olcumu, Pano yoklamasi) buna gore yavaslar ya da durur. Electron powerMonitor yalnizca 'ready' sonrasi
// kullanilabilir: init() ilk cagrida baglanir; Electron disinda (testler) varsayilan durumda kalir.
let st = { battery: false, locked: false, asleep: false }, pm = null;
const subs = new Set();

function set(o) {
  const n = { ...st, ...o };
  if (n.battery === st.battery && n.locked === st.locked && n.asleep === st.asleep) return;
  st = n;
  for (const f of subs) try { f(st); } catch (e) { console.error('power:', e); }
}

function init(m) {
  if (pm) return;
  try { pm = m || require('electron').powerMonitor; } catch (e) { pm = null; }
  if (!pm || typeof pm.on !== 'function') { pm = null; return; }
  try { st = { ...st, battery: !!(pm.isOnBatteryPower && pm.isOnBatteryPower()) }; } catch (e) {}
  pm.on('on-battery', () => set({ battery: true }));
  pm.on('on-ac', () => set({ battery: false }));
  pm.on('lock-screen', () => set({ locked: true }));
  pm.on('unlock-screen', () => set({ locked: false }));
  pm.on('suspend', () => set({ asleep: true }));
  pm.on('resume', () => set({ asleep: false }));
}

const state = () => st;
const away = () => st.locked || st.asleep;            // kimse bakmiyor: ekran kilitli ya da Mac uykuda
function on(f) { subs.add(f); return () => subs.delete(f); }

module.exports = { init, state, away, on, _set: set };
