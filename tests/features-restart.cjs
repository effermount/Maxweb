'use strict';
const { app, session, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
app.setPath('userData', process.env.MAXWEB_FEATURE_PROFILE);
const { createStore } = require('../src/store.cjs');
const { accountPartition } = require('../src/accounts.cjs');
const preferences = createStore(app.getPath('userData')).get();
app.whenReady().then(() => {
 for (const account of preferences.accounts) session.fromPartition(accountPartition(account.id)).protocol.handle('https', () => new Response('<html><body>MAX fixture after restart</body></html>', { headers: { 'content-type': 'text/html' } }));
});
const client = require('../src/main.cjs');
const deadline = setTimeout(() => app.exit(1), 20000);
client.ready.then(async () => {
 const win = client.getMainWindow();
 assert.equal(preferences.theme, 'dark'); assert.equal(nativeTheme.themeSource, 'dark'); assert.equal(nativeTheme.shouldUseDarkColors, true);
 assert.equal(client.getState().locked, true); assert.equal(client.getState().accounts, undefined);
 for (const view of win.contentView.children) assert.equal(view.getVisible(), false);
 await client.getSecurity().unlock('493725');
 assert.equal(client.getState().sidebarCollapsed, true);
 assert.equal(client.getState().accounts[0].name, 'Анна Тест');
 assert.equal(preferences.banner.showText, false);
 assert.equal(preferences.maxZoom, 125);
 for (const account of preferences.accounts) {
   const contents = client.getAccountContents(account.id);
   if (contents.isLoading()) await new Promise(resolve => contents.once('did-stop-loading', resolve));
   assert.ok(Math.abs(contents.getZoomFactor() - 1.25) < 0.001);
 }
 assert.equal(win.webContents.getZoomFactor(), 1);
 client.showSettings(); assert.equal(client.getState().pane, 'settings');
 console.log('PASS: real process restart starts locked, decrypts PIN verifier and restores sidebar, names and banner settings');
 clearTimeout(deadline); app.quit();
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
