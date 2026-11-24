const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/store.cjs');
const releaseConfig = require('../src/release-config.json');

test('preferences persist across restarts without returning mutable internal state', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  store.set({ notifications: false, window: { width: 900, height: 650, x: 20, y: 40 } });
  assert.equal(createStore(dir).get().notifications, false);
  assert.deepEqual(createStore(dir).get().window, { width: 900, height: 650, x: 20, y: 40 });
  store.get().window.width = 1;
  assert.equal(store.get().window.width, 900);
});

test('release default fills an old empty feed but preserves an explicitly cleared source', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'preferences.json');
  fs.writeFileSync(file, JSON.stringify({ updates: { repository: '', autoCheck: true } }));
  assert.equal(createStore(dir).get().updates.repository, releaseConfig.repository);
  fs.writeFileSync(file, JSON.stringify({ updates: { repository: '', autoCheck: false, userConfigured: true } }));
  assert.equal(createStore(dir).get().updates.repository, '');
  assert.equal(createStore(dir).get().updates.autoCheck, false);
});
test('invalid saved settings cannot create an unusable window', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'preferences.json');
  fs.writeFileSync(file, '{broken json');
  assert.equal(createStore(dir).get().notifications, true);
  fs.writeFileSync(file, JSON.stringify({ notifications: 'false', window: { width: -100, height: 90000 } }));
  assert.equal(createStore(dir).get().notifications, true);
  assert.deepEqual(createStore(dir).get().window, { width: 800, height: 2160 });
});

test('repository relocation migrates the old feed and retains update preferences across restarts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-relocation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'preferences.json');
  for (const userConfigured of [false, true]) {
    fs.writeFileSync(file, JSON.stringify({ updates: { repository: 'forkkrn-cmd/Maxweb', autoCheck: false, userConfigured } }));
    const store = createStore(dir);
    assert.deepEqual(store.get().updates, { repository: 'effermount/Maxweb', autoCheck: false, userConfigured });
    store.set({ sidebarCollapsed: true });
    assert.equal(createStore(dir).get().updates.repository, 'effermount/Maxweb');
  }
  fs.writeFileSync(file, JSON.stringify({ updates: { repository: 'custom/Maxweb', autoCheck: true, userConfigured: true } }));
  assert.equal(createStore(dir).get().updates.repository, 'custom/Maxweb');
});

test('theme defaults to system, persists overrides and rejects invalid saved values', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-theme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(createStore(dir).get().theme, 'system');
  for (const theme of ['dark', 'light', 'system']) {
    createStore(dir).set({ theme });
    assert.equal(createStore(dir).get().theme, theme);
  }
  fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify({ theme: 'unknown' }));
  assert.equal(createStore(dir).get().theme, 'system');
});

test('MAX zoom persists as a percentage and ignores invalid saved values', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-zoom-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(createStore(dir).get().maxZoom, 100);
  createStore(dir).set({ maxZoom: 125 });
  assert.equal(createStore(dir).get().maxZoom, 125);
  for (const maxZoom of [0, 49, 201, 125.5, '125', null]) {
    fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify({ maxZoom }));
    assert.equal(createStore(dir).get().maxZoom, 100);
  }
});
