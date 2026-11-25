'use strict';
const electron = require('electron');
if (process.type === 'renderer') {
  let security = { enabled: true, touchIDAvailable: true, touchID: true, idleSeconds: 900 };
  let calls = [];
  electron.contextBridge.exposeInMainWorld('maxweb', {
    get: async () => ({ security, theme: { source: 'system', dark: true }, maxZoom: 100, banner: {}, updates: {}, update: { status: 'idle' } }),
    onUpdate() {}, onLock() {}, onTheme() {}, onMaxZoom() {},
    security: async value => { calls.push(value); security = { ...security, enabled: !value.disable }; return security; }
  });
  electron.contextBridge.exposeInMainWorld('__securityTest', { calls: () => calls });
} else {
  const assert = require('node:assert/strict');
  const path = require('node:path');
  const timer = setTimeout(() => electron.app.exit(1), 15000);
  electron.app.whenReady().then(async () => {
    const win = new electron.BrowserWindow({ show: false, webPreferences: { preload: __filename, sandbox: false, contextIsolation: true } });
    await win.loadFile(path.join(__dirname, '../src/ui/settings.html'));
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async code => { for (let n = 0; n < 50; n++) { if (await js(code)) return; await new Promise(r => setTimeout(r, 30)); } throw Error('Timed out: ' + code); };
    await wait('document.getElementById("change-code").hidden === false');
    assert.equal(await js('document.getElementById("new-code-fields").hidden && document.getElementById("current-pin-label").hidden'), true);
    await js('document.getElementById("change-code").click()');
    assert.equal(await js('document.getElementById("new-code-fields").hidden'), false);
    await js('document.getElementById("new-pin").value="1234";document.getElementById("change-code").click()');
    assert.equal(await js('document.getElementById("new-pin").value'), '');
    // Changing the idle timer asks for authentication without opening code replacement.
    await js('document.getElementById("idle-seconds").value="300";document.getElementById("security-save").click()');
    assert.equal(await js('window.__securityTest.calls().length'), 0);
    assert.equal(await js('document.getElementById("current-pin-label").hidden'), false);
    assert.equal(await js('document.getElementById("new-code-fields").hidden'), true);
    await js('document.getElementById("current-pin").value="493725";document.getElementById("security-save").click()');
    await wait('window.__securityTest.calls().length === 1 && document.getElementById("current-pin-label").hidden');
    const payload = await js('window.__securityTest.calls()[0]');
    assert.equal(payload.pin, ''); assert.equal(payload.currentPIN, '493725'); assert.equal(payload.idleSeconds, 300);
    await js('document.getElementById("change-code").click();document.getElementById("current-pin").value="493725";document.getElementById("new-pin").value="654321";document.getElementById("confirm-pin").value="654321";document.getElementById("security-save").click()');
    await wait('window.__securityTest.calls().length === 2 && document.getElementById("new-code-fields").hidden');
    assert.equal(await js('window.__securityTest.calls()[1].pin'), '654321');
    await js('document.getElementById("security-disable").click();document.getElementById("current-pin").value="654321";document.getElementById("security-disable").click()');
    await wait('document.getElementById("change-code").hidden');
    assert.equal(await js('document.getElementById("new-code-fields").hidden'), false);
    assert.equal(await js('document.getElementById("new-pin").required'), true);
    console.log('PASS: code fields collapse, cancel clears secrets, settings require current code, code change collapses, initial setup stays visible');
    clearTimeout(timer); electron.app.quit();
  }).catch(error => { console.error(error); electron.app.exit(1); });
}
