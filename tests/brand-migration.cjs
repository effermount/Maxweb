'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'obla-migration-'));
  try {
    for (const phase of ['legacy', 'obla']) {
      const result = spawnSync(require('electron'), [__filename, profile, phase], { stdio: 'inherit', timeout: 25000 });
      assert.equal(result.status, 0, `Brand migration phase ${phase} failed`);
    }
    console.log('PASS: encrypted fixture cookie, protected secret and account settings survive rename across real Electron restarts');
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
} else {
  const { app, session, safeStorage } = require('electron');
  const profile = process.argv[2], phase = process.argv[3];
  app.setPath('userData', profile);
  if (phase === 'legacy') app.setName('Maxweb');
  else require('../src/brand.cjs').configureBrand(app);
  const timeout = setTimeout(() => { console.error('Migration fixture timed out'); app.exit(1); }, 20000);
  app.whenReady().then(async () => {
    const store = require('../src/store.cjs').createStore(profile);
    const ses = session.fromPartition('persist:max');
    const secret = path.join(profile, 'protected-fixture');
    if (phase === 'legacy') {
      assert(await safeStorage.isAsyncEncryptionAvailable());
      fs.writeFileSync(secret, await safeStorage.encryptStringAsync('fixture-code-verifier'));
      await ses.cookies.set({ url: 'https://web.max.ru/', name: 'brand-fixture', value: 'fixture-session', secure: true, expirationDate: Date.now()/1000 + 3600 });
      await ses.cookies.flushStore();
      store.set({ theme: 'dark', maxZoom: 125, accounts: [{ id: 'default', name: 'Fixture account', customName: true, notifications: false }] });
    } else {
      assert.equal(app.getName(), 'Maxweb'); assert.equal(app.getPath('userData'), profile);
      assert.equal((await safeStorage.decryptStringAsync(fs.readFileSync(secret))).result, 'fixture-code-verifier');
      assert.equal((await ses.cookies.get({ name: 'brand-fixture' }))[0]?.value, 'fixture-session');
      assert.equal(store.get().accounts[0].name, 'Fixture account');
      assert.equal(store.get().accounts[0].notifications, false);
      assert.equal(store.get().maxZoom, 125);
    }
    clearTimeout(timeout); app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
