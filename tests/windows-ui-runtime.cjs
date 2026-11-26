'use strict';
const electron = require('electron');
if (process.type === 'renderer') {
  let updateChecks = 0, updateListener;
  const security = { enabled: true, locked: true, touchID: false, touchIDAvailable: false, idleSeconds: 300 };
  electron.contextBridge.exposeInMainWorld('maxweb', {
    platform: 'win32',
    get: async () => ({ platform: 'win32', arch: 'x64', version: '1.2.16', packaged: true, security, theme: { source: 'system', dark: true }, maxZoom: 100, banner: {}, updates: { autoCheck: false }, update: { status: 'idle', currentVersion: '1.2.16' } }),
    onUpdate(callback) { updateListener = callback; }, onLock() {}, onTheme() {}, onMaxZoom() {},
    updateCheck: async () => { updateChecks++; }
  });
  electron.contextBridge.exposeInMainWorld('maxwebShell', {
    platform: 'win32', get: async () => ({ locked: true, security, version: '1.2.16' }), onState() {},
    touchID: () => { throw Error('Windows must not request Touch ID'); }
  });
  electron.contextBridge.exposeInMainWorld('__windowsTest', { updateChecks: () => updateChecks, update: state => updateListener(state) });
} else {
  const assert = require('node:assert/strict'), path = require('node:path');
  electron.app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'obla-windows-ui-')));
  require('../src/brand.cjs').configureBrand(electron.app, 'win32');
  const timer = setTimeout(() => electron.app.exit(1), 15000);
  electron.app.whenReady().then(async () => {
    const win = new electron.BrowserWindow({ show: false, webPreferences: { preload: __filename, sandbox: false, contextIsolation: true } });
    const js = code => win.webContents.executeJavaScript(code);
    await win.loadFile(path.join(__dirname, '../src/ui/settings.html'));
    assert(!/[^\x20-\x7e]/.test(electron.session.defaultSession.getUserAgent()), 'Windows User-Agent must contain only valid ASCII characters');
    for (let n = 0; n < 80 && !await js('document.getElementById("version").textContent.includes("Windows")'); n++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(await js('document.getElementById("version").textContent'), 'Обла 1.2.16 · Windows x64');
    assert.equal(await js('document.getElementById("security-touch-id").closest("label").hidden'), true);
    assert.equal(await js('document.getElementById("auto-update").closest("label").hidden'), false);
    assert.equal(await js('document.getElementById("auto-update").checked'), false);
    assert.equal(await js('document.getElementById("update-download").hidden && document.getElementById("update-install").hidden'), true);
    assert.match(await js('document.getElementById("theme-hint").textContent'), /Windows/);
    assert.match(await js('document.getElementById("security-state").textContent'), /Ctrl\+L/);
    assert(!await js('document.body.innerText.includes("macOS") || document.body.innerText.includes("⌘")'));
    assert.equal(await js('window.__windowsTest.updateChecks()'), 0);
    await js('document.getElementById("update-check").click()');
    assert.equal(await js('window.__windowsTest.updateChecks()'), 1);
    await js('window.__windowsTest.update({status:"available",version:"1.2.17",currentVersion:"1.2.16",notes:"Current release"})');
    assert.equal(await js('document.getElementById("update-download").hidden'), false);
    await js('window.__windowsTest.update({status:"downloading",progress:47,currentVersion:"1.2.16"})');
    assert.equal(await js('document.getElementById("update-progress").value'), 47);
    await js('window.__windowsTest.update({status:"ready",currentVersion:"1.2.16"})');
    assert.equal(await js('document.getElementById("update-install").hidden || document.getElementById("update-install").disabled'), false);
    await win.loadFile(path.join(__dirname, '../src/ui/shell.html'));
    for (let n = 0; n < 80 && !await js('document.body.classList.contains("locked")'); n++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(await js('document.getElementById("touch-id").hidden'), true);
    assert.equal(await js('document.getElementById("unlock-form").hidden'), false);
    assert(!await js('document.body.textContent.includes("⌘")'));
    console.log('PASS: Windows settings/lock screen, Ctrl shortcuts, system theme, code fallback and automatic update controls');
    clearTimeout(timer); win.destroy(); electron.app.quit();
  }).catch(error => { console.error(error); electron.app.exit(1); });
}
