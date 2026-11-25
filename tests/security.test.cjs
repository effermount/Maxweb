'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppSecurity, pinRecord, verifyPIN, normalizeSecurity } = require('../src/security.cjs');
const { normalizeBanner, bannerContent } = require('../src/notifications.cjs');
function fixture() {
  let time = 1000000, data = { security: normalizeSecurity() }, touchAvailable = true, prompt = async () => {};
  const store = { get: () => structuredClone(data), set: patch => { data = { ...data, ...patch }; } };
  const options = { store, now: () => time, encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString(), canTouchID: () => touchAvailable, promptTouchID: () => prompt(), onChange() {} };
  const security = new AppSecurity(options);
  return { security, store, restart: () => new AppSecurity(options), advance: ms => { time += ms; }, unavailable: () => { touchAvailable = false; }, setPrompt: value => { prompt = value; } };
}
const configure = (security, extra = {}) => security.configure({ pin: '493725', confirmPIN: '493725', touchID: true, idleSeconds: 60, ...extra });
test('salted PIN verifier rejects malformed and wrong PINs', async () => {
  const first = await pinRecord('123456');
  assert.notEqual(first.hash, (await pinRecord('123456')).hash);
  assert.equal(await verifyPIN('123456', first), true);
  assert.equal(await verifyPIN('123457', first), false);
  await assert.rejects(pinRecord('123'));
});
test('lock starts on restart, guards settings and persists throttling across restart', async () => {
  const f = fixture(); await configure(f.security);
  assert.equal(f.store.get().security.verifier.includes('493725'), false);
  const security = f.restart(); assert.equal(security.locked, true);
  await assert.rejects(configure(security), /разблокируйте/);
  for (let i = 0; i < 5; i++) await assert.rejects(security.unlock('000000'));
  assert.equal(security.snapshot().retryAt, 1030000);
  await assert.rejects(f.restart().unlock('493725'), /Повторите/);
  f.advance(30001); await security.unlock('493725');
  assert.equal(security.locked, false);
  await assert.rejects(configure(security, { currentPIN: '000000', disable: true }));
  await configure(security, { currentPIN: '493725', disable: true });
  assert.equal(f.restart().locked, false);
});
test('idle follows app activity and biometric cancellation keeps lock; stale prompts cannot unlock', async () => {
  const f = fixture(); await configure(f.security);
  f.advance(59000); f.security.checkIdle(); assert.equal(f.security.locked, false);
  f.security.activity(); f.advance(2000); f.security.checkIdle(); assert.equal(f.security.locked, false);
  f.advance(60000); f.security.checkIdle(); assert.equal(f.security.locked, true);
  f.setPrompt(async () => { throw new Error('cancelled'); });
  await assert.rejects(f.security.unlock(undefined, true)); assert.equal(f.security.locked, true);
  let finish; f.setPrompt(() => new Promise(resolve => { finish = resolve; }));
  const unlocking = f.security.unlock(undefined, true);
  f.security.lock(); finish(); await assert.rejects(unlocking, /изменилось/);
  f.setPrompt(async () => {}); await f.security.unlock(undefined, true); assert.equal(f.security.locked, false);
  f.security.lock(); f.unavailable(); await assert.rejects(f.security.unlock(undefined, true), /недоступен/);
  await f.security.unlock('493725');
});
test('changing protection requires current PIN and confirmation; corrupted verifier fails closed', async () => {
  const f = fixture(); await assert.rejects(configure(f.security, { confirmPIN: '493726' }), /совпадают/);
  await configure(f.security);
  await assert.rejects(configure(f.security, { currentPIN: '000000' }));
  await configure(f.security, { currentPIN: '493725', pin: '7711', confirmPIN: '7711' });
  f.security.lock(); await assert.rejects(f.security.unlock('493725')); await f.security.unlock('7711');
  f.store.set({ security: { ...f.store.get().security, verifier: 'broken' } });
  const restarted = f.restart(); assert.equal(restarted.locked, true); await assert.rejects(restarted.unlock('7711'));
});
test('banner privacy never leaks sender through text or locked account names', () => {
  const account = { name: 'Private work account' }, settings = normalizeBanner();
  assert.deepEqual(bannerContent(account, 'Alice', 'Secret', settings), { title: 'Alice', subtitle: account.name, body: 'Secret', silent: false });
  for (const locked of [false, true]) {
    const value = bannerContent(account, 'Alice', 'Alice: Secret', { ...settings, showSender: false }, locked);
    assert.equal(value.title, 'Обла'); assert.equal(value.body, locked ? 'Новое сообщение' : 'Новое сообщение в MAX');
  }
  const locked = bannerContent(account, 'Alice', 'Secret', settings, true);
  assert.equal(locked.subtitle, ''); assert.equal(locked.title, 'Обла');
  assert.equal(bannerContent(account, 'Alice', 'Secret', { ...settings, showText: false }).body, 'Новое сообщение в MAX');
});
