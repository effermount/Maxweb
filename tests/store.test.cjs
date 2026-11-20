const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/store.cjs');

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
