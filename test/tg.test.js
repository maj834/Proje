'use strict';
// tg.js canli Telegram hesabi ister; yalnizca saf yardimci floodSeconds denenir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { errors } = require('telegram');
const { floodSeconds } = require('../tg.js');

test('floodSeconds: FloodWaitError, FLOOD_WAIT mesaji, diger hatalar', () => {
  const fw = new errors.FloodWaitError({ request: undefined, capture: 42 });
  assert.equal(fw.seconds, 42);
  assert.equal(floodSeconds(fw), 42);
  assert.equal(floodSeconds(new Error('A wait of FLOOD_WAIT_17 seconds is required')), 17);
  assert.equal(floodSeconds(new Error('FLOOD_WAIT')), 60);
  assert.equal(floodSeconds(new Error('PHONE_CODE_INVALID')), 0);
  assert.equal(floodSeconds(null), 0);
  assert.equal(floodSeconds(undefined), 0);
});
