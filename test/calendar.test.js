'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calendar.js');

// Istanbul saati (UTC+3, yaz saati yok) -> Date.
const tr = (y, mo, d, h = 12, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h - 3, mi));

test('hafta sonu kapali', () => {
  assert.deepEqual(C.status(tr(2026, 10, 17, 11)), { open: false, reason: 'hafta sonu', closeMin: null, half: false });
  assert.equal(C.isOpen(tr(2026, 10, 18, 11)), false);
  // UTC'de cuma gecesi, Istanbul'da cumartesi.
  assert.equal(C.status(new Date('2026-10-16T22:30:00Z')).reason, 'hafta sonu');
});

test('sabit resmi tatil', () => {
  const s = C.status(tr(2026, 4, 23, 11));
  assert.equal(s.open, false);
  assert.equal(s.reason, 'Ulusal Egemenlik ve Çocuk Bayramı tatili');
  assert.equal(C.status(tr(2026, 10, 29, 11)).reason, 'Cumhuriyet Bayramı tatili');
});

test('normal gun sinirlari 09:55 ve 18:15', () => {
  const d = (h, m) => C.status(tr(2026, 10, 20, h, m));
  assert.deepEqual(d(9, 54), { open: false, reason: 'seans 09:55\'te açılır', closeMin: 18 * 60 + 15, half: false });
  assert.equal(d(9, 55).open, true);
  assert.equal(d(9, 55).reason, null);
  assert.equal(d(18, 15).open, true);
  assert.deepEqual(d(18, 16), { open: false, reason: 'seans 18:15\'te kapandı', closeMin: 18 * 60 + 15, half: false });
  assert.equal(d(0, 0).open, false);
  assert.equal(C.OPEN, 595);
  assert.equal(C.CLOSE, 1095);
});

test('28 Ekim yarim gun: 12:45 oncesi acik, sonrasi kapali', () => {
  const before = C.status(tr(2026, 10, 28, 12, 44));
  assert.equal(before.open, true);
  assert.equal(before.half, true);
  assert.equal(before.closeMin, C.HALF_CLOSE);
  assert.match(before.reason, /Cumhuriyet Bayramı arifesi: yarım gün, 12:40'ta kapanır/);
  assert.equal(C.status(tr(2026, 10, 28, 12, 45)).open, true);
  const after = C.status(tr(2026, 10, 28, 12, 46));
  assert.equal(after.open, false);
  assert.equal(after.half, true);
  assert.match(after.reason, /yarım gün, seans 12:40'ta kapandı/);
  assert.equal(C.status(tr(2026, 10, 28, 9, 50)).open, false);
});

test('2026 Kurban Bayrami ve arifesi', () => {
  const arife = C.status(tr(2026, 5, 26, 11));
  assert.equal(arife.open, true);
  assert.equal(arife.half, true);
  assert.match(arife.reason, /Kurban Bayramı arifesi/);
  assert.equal(C.status(tr(2026, 5, 26, 13)).open, false);
  for (const d of [27, 28, 29]) assert.equal(C.status(tr(2026, 5, d, 11)).reason, 'Kurban Bayramı tatili', '05-' + d);
  assert.equal(C.status(tr(2026, 3, 20, 11)).reason, 'Ramazan Bayramı tatili');
  assert.equal(C.status(tr(2026, 3, 19, 11)).half, true);
  assert.equal(C.status(tr(2026, 6, 1, 11)).open, true);
});

test('yil bilgisi: 2026 dogrulanmis, 2027 dogrulanmamis, 2030 bilinmiyor', () => {
  assert.deepEqual(C.yearInfo(2026), { known: true, verified: true });
  assert.deepEqual(C.yearInfo(2027), { known: true, verified: false });
  assert.deepEqual(C.yearInfo(2030), { known: false, verified: false });
  assert.equal(C.status(tr(2027, 3, 10, 11)).reason, 'Ramazan Bayramı tatili');
  // Bilinmeyen yilda yalnizca sabit tatiller.
  assert.equal(C.status(tr(2030, 1, 1, 11)).reason, 'Yılbaşı tatili');
  assert.equal(C.status(tr(2030, 3, 5, 11)).open, true);
  assert.deepEqual(C.dayInfo(2030, '10-28'), ['half', 'Cumhuriyet Bayramı arifesi']);
});
