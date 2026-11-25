const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/store.cjs');
const { newAccount, accountPartition, normalizeAccounts, accountName } = require('../src/accounts.cjs');
test('v1.0 migrates to the original persistent partition without touching its files', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'Partitions/max'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Partitions/max/Cookies'), 'original session');
  fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify({ notifications: false, window: { width: 1100, height: 800 } }));
  const store = createStore(dir);
  assert.deepEqual(store.get().accounts, [{ id: 'default', name: 'Основной' }]);
  assert.equal(accountPartition('default'), 'persist:max');
  assert.equal(store.get().notifications, false);
  const other = newAccount('  Рабочий  ');
  assert.notEqual(accountPartition(other.id), accountPartition('default'));
  store.set({ accounts: [...store.get().accounts, other], activeAccountId: other.id });
  assert.equal(createStore(dir).get().activeAccountId, other.id);
  assert.equal(fs.readFileSync(path.join(dir, 'Partitions/max/Cookies'), 'utf8'), 'original session');
});
test('account names and partitions reject malformed or shared identities', () => {
  const account = newAccount('Личный');
  assert.equal(normalizeAccounts([account, account, { id: '../max', name: 'Oops' }]).length, 1);
  assert.throws(() => accountPartition('../max'));
  assert.throws(() => accountName(' '));
  assert.throws(() => accountName('x'.repeat(41)));
  assert.throws(() => accountName('hello\nworld'));
});

test('automatic names survive repeated normalization while legacy custom names retain priority', () => {
  const account = newAccount('Рабочий');
  const normalized = normalizeAccounts(normalizeAccounts([account]));
  assert.equal(normalized.find(a => a.id === account.id).customName, false);
  assert.equal(normalizeAccounts([{ id: account.id, name: 'Моё имя' }]).find(a => a.id === account.id).customName, true);
  assert.equal(normalizeAccounts([{ ...account, profileName: '\n' }]).find(a => a.id === account.id).name, 'Рабочий');
});


test('explicit account removal survives restart including an empty list', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-remove-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  const account = newAccount();
  store.set({ accounts: [account], activeAccountId: account.id });
  assert.deepEqual(createStore(dir).get().accounts, [account]);
  store.set({ accounts: [], activeAccountId: null });
  assert.deepEqual(createStore(dir).get().accounts, []);
  assert.equal(createStore(dir).get().activeAccountId, null);
});
test('only bounded PNG thumbnails are persisted for account avatars', () => {
  const account = newAccount();
  const avatar = 'data:image/png;base64,aGVsbG8=';
  assert.equal(normalizeAccounts([{ ...account, avatar }])[0].avatar, avatar);
  for (const invalid of ['https://example.com/avatar.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(90000)]) {
    assert.equal(normalizeAccounts([{ ...account, avatar: invalid }])[0].avatar, undefined);
  }
});


test('Telegram account types persist without changing existing MAX partitions', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-telegram-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir), telegram = newAccount(undefined, 'telegram');
  store.set({ accounts: [...store.get().accounts, telegram], activeAccountId: telegram.id });
  const restored = createStore(dir).get();
  assert.equal(restored.accounts[1].service, 'telegram');
  assert.equal(accountPartition('default'), 'persist:max');
  assert.notEqual(accountPartition(telegram.id, 'telegram'), accountPartition(telegram.id, 'max'));
  assert.throws(() => newAccount(undefined, 'unknown'));
  assert.throws(() => accountPartition('default', 'telegram'));
  assert.equal(normalizeAccounts([{ ...telegram, service: 'unknown' }]).length, 0);
});


test('WhatsApp sessions persist in their own partition and cannot reuse the legacy MAX account', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-whatsapp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir), whatsapp = newAccount(undefined, 'whatsapp');
  store.set({ accounts: [...store.get().accounts, whatsapp], activeAccountId: whatsapp.id });
  const restored = createStore(dir).get();
  assert.equal(restored.accounts[1].service, 'whatsapp');
  assert.equal(restored.activeAccountId, whatsapp.id);
  assert.equal(accountPartition(whatsapp.id, 'whatsapp'), `persist:whatsapp-${whatsapp.id}`);
  assert.notEqual(accountPartition(whatsapp.id, 'whatsapp'), accountPartition(whatsapp.id, 'telegram'));
  assert.throws(() => accountPartition('default', 'whatsapp'));
  assert.deepEqual(normalizeAccounts([{ id: 'default', name: 'Invalid', service: 'whatsapp' }]), []);
});

test('VK accounts persist independently and cannot replace the original MAX partition', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-vk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir), vk = newAccount(undefined, 'vk');
  store.set({ accounts: [...store.get().accounts, vk], activeAccountId: vk.id });
  const restored = createStore(dir).get();
  assert.equal(restored.accounts[1].service, 'vk'); assert.equal(restored.activeAccountId, vk.id);
  assert.equal(accountPartition(vk.id, 'vk'), `persist:vk-${vk.id}`);
  for (const service of ['max','telegram','whatsapp']) assert.notEqual(accountPartition(vk.id, 'vk'), accountPartition(vk.id, service));
  assert.throws(() => accountPartition('default', 'vk'));
  assert.deepEqual(normalizeAccounts([{ id: 'default', name: 'Invalid', service: 'vk' }]), []);
});
