const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { configureBrand, APP_NAME, STORAGE_NAME } = require('../src/brand.cjs');

test('display rename reuses the Maxweb data directory for both old and new package names', () => {
  for (const name of ['Maxweb', 'Обла', 'maxweb']) {
    const paths = { appData: '/Library/Application Support', userData: path.join('/Library/Application Support', name) };
    const app = { getName: () => name, getPath: key => paths[key], setName: value => { app.name = value; }, setPath: (key, value) => { paths[key] = value; } };
    configureBrand(app);
    assert.equal(APP_NAME, 'Обла');
    assert.equal(app.name, STORAGE_NAME, 'Encryption namespace must stay unchanged');
    assert.equal(paths.userData, '/Library/Application Support/Maxweb');
  }
});
test('display rename preserves explicit user-data-dir overrides', () => {
  const paths = { appData: '/Library/Application Support', userData: '/tmp/isolated-profile' };
  const app = { getName: () => 'Обла', getPath: key => paths[key], setName() {}, setPath: (key, value) => { paths[key] = value; } };
  configureBrand(app);
  assert.equal(paths.userData, '/tmp/isolated-profile');
});
