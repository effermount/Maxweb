'use strict';
const { app, session, Notification, powerMonitor, nativeTheme } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const profile = process.env.MAXWEB_FEATURE_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-features-'));
app.setPath('userData', profile);
// Test native routing and formatting without posting real banners to the user's desktop.
Notification.prototype.show = function () { this.emit('show'); };
Notification.prototype.close = function () { this.emit('close'); };
const fixture = `<!doctype html><html lang="ru"><body><h1>MAX fixture</h1><p>Account content</p><script>
window.saveProfile = async name => {
 const db = await new Promise((resolve,reject) => { const r=indexedDB.open('max-db-22-1234',1); r.onupgradeneeded=()=>r.result.createObjectStore('viewer',{keyPath:'id'}); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
 await new Promise((resolve,reject)=>{const tx=db.transaction('viewer','readwrite');tx.objectStore('viewer').put({id:'',model:{contact:{names:[{type:'ONEME',firstName:name,lastName:'Тест'}]}}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)}); db.close();
};
void window.saveProfile('Мария');
</script></body></html>`;
app.whenReady().then(() => session.fromPartition('persist:max').protocol.handle('https', () => new Response(fixture, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
const client = require('../src/main.cjs');
const deadline = setTimeout(() => { console.error('Feature test timed out'); app.exit(1); }, 60000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function loaded(contents) { if (contents.isLoading()) await once(contents, 'did-stop-loading'); }
async function waitFor(check, message) { for (let i = 0; i < 160; i++) { if (await check()) return; await pause(100); } throw new Error(message); }
client.ready.then(async () => {
 const win = client.getMainWindow(), shell = win.webContents, primary = client.getAccountContents();
 await Promise.all([loaded(shell), loaded(primary)]);
 const sj = code => shell.executeJavaScript(code);
 await waitFor(() => client.getState().accounts[0].name === 'Мария Тест', 'Profile name did not sync');
 client.renameAccount('default', 'Личное');
 await primary.executeJavaScript('window.saveProfile("Анна")');
 await waitFor(() => client.getState().accounts[0].profileName === 'Анна Тест', 'Profile change did not sync');
 assert.equal(client.getState().accounts[0].name, 'Личное');
 await sj('window.maxwebShell.profileName("default")');
 assert.equal(client.getState().accounts[0].name, 'Анна Тест');
 console.log('PASS: own MAX profile sync, local rename priority and reset to automatic name');
 await sj('window.maxwebShell.collapse(true)');
 assert.equal(client.getState().sidebarCollapsed, true);
 await waitFor(() => sj('document.body.classList.contains("collapsed")'), 'Collapsed class missing');
 assert.equal(await sj('document.querySelector("aside").getBoundingClientRect().width'), 72);
 assert.equal(win.contentView.children[0].getBounds().x, 72);
 const secondID = client.addAccount('Рабочий').activeAccountId;
 const secondSession = client.getSession(secondID);
 secondSession.protocol.handle('https', () => new Response(fixture, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
 await client.loadMax(secondID);
 await waitFor(() => sj('document.querySelectorAll(".account").length === 2'), 'Account icons missing');
 await sj('document.querySelector(".account").click()');
 await waitFor(() => client.getState().activeAccountId === 'default', 'Collapsed switching failed');
 const qa = path.join(__dirname, '../.tools/qa'); fs.mkdirSync(qa, { recursive: true });
 fs.writeFileSync(path.join(qa, 'sidebar-collapsed.png'), (await win.capturePage()).toPNG());
 console.log('PASS: collapsed rail preserves clickable accounts and adjusts native content bounds');
 const settings = client.showSettings().webContents; await loaded(settings);
 const js = code => settings.executeJavaScript(code);
 await waitFor(() => js('document.getElementById("version").textContent.includes("1.2")'), 'Settings did not initialize');
 assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
 // Use the actual setting control and native media queries; account pages must stay alive.
 await primary.executeJavaScript('window.themeSurvivor = "same-document"');
 async function chooseTheme(source) {
   await js(`document.getElementById("theme").value=${JSON.stringify(source)};document.getElementById("theme").dispatchEvent(new Event("change"));void 0`);
   await waitFor(() => js('!document.getElementById("theme").disabled'), 'Theme setting did not finish');
 }
 async function expectTheme(dark) {
   for (const contents of [shell, settings]) await waitFor(() => contents.executeJavaScript(`matchMedia('(prefers-color-scheme: dark)').matches === ${dark}`), 'Native theme did not reach renderer');
   assert.equal(await sj('getComputedStyle(document.documentElement).backgroundColor'), dark ? 'rgb(32, 32, 42)' : 'rgb(241, 239, 247)');
   assert.equal(await js('getComputedStyle(document.documentElement).backgroundColor'), dark ? 'rgb(27, 27, 35)' : 'rgb(246, 245, 250)');
 }
 await chooseTheme('dark'); await expectTheme(true);
 assert.equal((await js('window.maxweb.get()')).theme.source, 'dark');
 await pause(150);
 fs.writeFileSync(path.join(qa, 'theme-dark-settings.png'), (await settings.capturePage()).toPNG());
 fs.writeFileSync(path.join(qa, 'theme-dark-sidebar.png'), (await shell.capturePage()).toPNG());
 await chooseTheme('light'); await expectTheme(false);
 await pause(150);
 fs.writeFileSync(path.join(qa, 'theme-light-settings.png'), (await settings.capturePage()).toPNG());
 await chooseTheme('system');
 assert.equal(nativeTheme.themeSource, 'system');
 // Model native appearance changes without changing the user's macOS preferences.
 nativeTheme.themeSource = 'dark'; await expectTheme(true);
 assert.equal((await js('window.maxweb.get()')).theme.source, 'system');
 nativeTheme.themeSource = 'light'; await expectTheme(false);
 await chooseTheme('dark');
 await assert.rejects(js('window.maxweb.theme("invalid")'));
 assert.equal(nativeTheme.themeSource, 'dark');
 assert.equal(await primary.executeJavaScript('window.themeSurvivor'), 'same-document');
 console.log('PASS: light, dark and system appearance update both renderers without reload; manual selection is validated');

 await js('document.querySelector("#security-form").scrollIntoView()'); await pause(200);
 fs.writeFileSync(path.join(qa, 'security-settings.png'), (await settings.capturePage()).toPNG());
 assert.equal(await js('document.querySelector("#banner-text").checked'), true);
 for (const id of ['banner-account', 'banner-text', 'banner-sound']) {
   await js(`document.getElementById(${JSON.stringify(id)}).click()`);
   await waitFor(() => js(`!document.getElementById(${JSON.stringify(id)}).disabled`), 'Banner setting did not finish');
 }
 await primary.executeJavaScript('window.notice=new Notification("Alice",{body:"Secret"}); window.clicks=0; window.notice.onclick=()=>window.clicks++; void 0');
 await waitFor(() => client.getAccountNotifications().size > 0, 'Native banner bridge failed');
 let notice = [...client.getAccountNotifications().values()].at(-1);
 assert.equal(notice.title, 'Alice'); assert.equal(notice.subtitle, ''); assert.equal(notice.body, 'Новое сообщение в MAX'); assert.equal(notice.silent, true);
 client.selectAccount(secondID); notice.emit('click');
 await waitFor(() => client.getState().activeAccountId === 'default', 'Notification account routing failed');
 await waitFor(() => primary.executeJavaScript('window.clicks===1'), 'Original MAX click handler was lost');
 console.log('PASS: native banner privacy, sound setting, account routing and original MAX click callback');
 client.showSettings();
 await js('document.querySelector("#new-pin").value="493725"; document.querySelector("#confirm-pin").value="493725"; document.querySelector("#idle-seconds").value="60"; document.querySelector("#security-save").click(); void 0');
 await waitFor(() => client.getSecurity().snapshot().enabled, 'PIN setup form failed');
 assert.equal(client.getSecurity().snapshot().enabled, true);
 await sj('window.maxwebShell.lock()');
 assert.equal(client.getState().locked, true); assert.equal(client.getState().accounts, undefined);
 for (const view of win.contentView.children) assert.equal(view.getVisible(), false);
 await waitFor(() => sj('!document.querySelector("#lock-screen").hidden'), 'Lock screen not shown');
 assert.equal(await sj('getComputedStyle(document.querySelector("#lock-screen")).backgroundColor'), 'rgb(32, 32, 42)');
 await assert.rejects(sj('window.maxwebShell.select("default")'));
 await assert.rejects(js('window.maxweb.get()'));
 await assert.rejects(sj('window.maxwebShell.unlock("000000")'));
 assert.equal(client.getState().locked, true);
 await primary.executeJavaScript('window.lockNotice=new Notification("Bob",{body:"Very private"}); window.lockClicks=0; window.lockNotice.onclick=()=>window.lockClicks++; void 0');
 await waitFor(() => client.getAccountNotifications().size > 0, 'Locked banner missing');
 notice = [...client.getAccountNotifications().values()].at(-1);
 assert.equal(notice.title, 'Maxweb'); assert.equal(notice.subtitle, ''); assert.equal(notice.body, 'Новое сообщение в MAX');
 notice.emit('click');
 assert.equal(client.getState().locked, true); assert.equal(await primary.executeJavaScript('window.lockClicks'), 0);
 await pause(200);
 fs.writeFileSync(path.join(qa, 'lock-screen.png'), (await win.capturePage()).toPNG());
 await sj('window.maxwebShell.unlock("493725")');
 await waitFor(() => primary.executeJavaScript('window.lockClicks===1'), 'Deferred MAX click was not delivered after unlocking');
 assert.equal(client.getState().locked, false);
 powerMonitor.emit('suspend'); assert.equal(client.getState().locked, true);
 await sj('window.maxwebShell.unlock("493725")');
 client.getSecurity().lastActivity -= 61000; client.getSecurity().checkIdle(); assert.equal(client.getState().locked, true);
 console.log('PASS: PIN setup, wrong PIN, hidden native views, IPC guards, private locked banners, deferred clicks, sleep and inactivity lock');
 const saved = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json')));
 assert.equal(saved.sidebarCollapsed, true); assert.equal(saved.banner.showText, false); assert.ok(saved.security.verifier); assert.equal(saved.security.verifier.includes('493725'), false);
 assert.equal(new (require('../src/security.cjs').AppSecurity)({store:{get:()=>saved},now:Date.now}).locked, true);
 clearTimeout(deadline); console.log('ALL FEATURE CHECKS PASSED'); app.quit();
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
app.on('will-quit', () => { if (!process.env.MAXWEB_FEATURE_PROFILE) fs.rmSync(profile, { recursive: true, force: true }); });
