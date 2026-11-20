'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
app.setPath('userData', process.env.MAXWEB_TEST_PROFILE);
const { secondID } = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'test-expectations.json')));
const client = require('../src/main.cjs');
const deadline = setTimeout(() => app.exit(1), 60000);
client.ready.then(async () => {
  assert.equal(client.getState().accounts.length, 2);
  assert.equal(client.getState().activeAccountId, secondID);
  assert.equal(client.getState().accounts.find(a => a.id === secondID).name, 'Личный');
  for (const [id, value] of [['default', 'primary'], [secondID, 'secondary']]) {
    const contents = client.getAccountContents(id);
    if (contents.isLoading()) await once(contents, 'did-stop-loading');
    assert.equal((await client.getSession(id).cookies.get({ name: 'maxweb-smoke' }))[0].value, value);
    assert.equal(await contents.executeJavaScript('localStorage.getItem("maxweb-smoke")'), value);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'))).updates.repository, 'example/Maxweb');
  console.log('PASS: both account authorizations, account names, selection and update settings survived a full process restart');
  clearTimeout(deadline); app.quit();
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
