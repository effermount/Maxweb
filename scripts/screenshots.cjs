'use strict';
// Render the real app in a disposable, offline profile. No personal sessions,
// messages, biometric prompts or network requests are used for documentation.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'obla-docs-'));
app.setPath('userData', profile);
require('../src/store.cjs').createStore(profile).set({ theme: 'dark', updates: { autoCheck: false }, accounts: [
  { id: 'default', service: 'max', name: 'Александр', customName: true },
  { id: '11111111-1111-4111-8111-111111111111', service: 'telegram', name: 'Рабочий', customName: true },
  { id: '22222222-2222-4222-8222-222222222223', service: 'whatsapp', name: 'Личный', customName: true, notifications: false },
  { id: '33333333-3333-4333-8333-333333333335', service: 'vk', name: 'Друзья', customName: true }
] });
app.on('session-created', ses => {
  ses.protocol.handle('https', () => new Response('<!doctype html><meta charset="utf-8"><title>Демонстрационный аккаунт</title>', { headers: { 'content-type': 'text/html' } }));
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
});
const client = require('../src/main.cjs');
const wait = async check => { for (let n = 0; n < 200; n++) { if (await check()) return; await new Promise(r => setTimeout(r, 30)); } throw Error('Screenshot surface did not become ready'); };
const frames = wc => wc.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const deadline = setTimeout(() => app.exit(1), 60000);
async function poster(name, title, subtitle, capture, light = false) {
  const screen = Array.isArray(capture)
    ? `<div class="screen" style="display:flex"><img style="width:264px" src="${capture[0].toDataURL()}"><img style="width:1176px" src="${capture[1].toDataURL()}"></div>`
    : `<img class="screen" src="${capture.toDataURL()}">`;
  const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'assets/icon.png')).toString('base64');
  const win = new BrowserWindow({ width: 1600, height: 1120, useContentSize: true, show: false, webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true } });
  const html = `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1600px;height:1120px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:${light ? '#30243f' : '#f6f1ff'};background:${light ? 'radial-gradient(ellipse at 85% 20%,#ded2fc,transparent 65%),linear-gradient(135deg,#f7f4ff,#eae3f6)' : 'radial-gradient(ellipse at 80% 0%,#4d3378,transparent 62%),linear-gradient(135deg,#181421,#262031)'}}
    header{position:absolute;left:80px;top:52px;right:80px;display:flex;justify-content:space-between;align-items:center}h1{margin:0;font-size:43px;letter-spacing:-1.4px;font-weight:650}p{margin:12px 0 0;font-size:22px;color:${light ? '#7c6a90' : '#c2b1da'}}.wordmark{font-size:27px;font-weight:650;letter-spacing:-.8px;display:flex;align-items:center;gap:13px}.wordmark img{width:49px;height:49px;border-radius:13px}.window{position:absolute;left:80px;top:198px;width:1440px;border-radius:17px;overflow:hidden;border:1px solid ${light ? '#b9a6d2' : '#76608e'};box-shadow:0 35px 80px #100a2540}.bar{height:38px;background:${light ? '#f6f2fb' : '#302937'};display:flex;align-items:center;padding:0 15px;gap:8px;position:relative}.dot{width:11px;height:11px;border-radius:50%}.caption{position:absolute;left:45%;font-size:13px;color:${light ? '#85748e' : '#bcacc9'}}.screen{display:block;width:1440px;height:auto}footer{position:absolute;bottom:29px;left:82px;right:82px;display:flex;justify-content:space-between;font-size:15px;letter-spacing:.4px;color:${light ? '#85748e' : '#a998bf'}}
    </style><header><div><h1>${title}</h1><p>${subtitle}</p></div><div class="wordmark"><img src="${icon}">Обла</div></header><div class="window"><div class="bar"><i class="dot" style="background:#ff6259"></i><i class="dot" style="background:#ffbd2e"></i><i class="dot" style="background:#29c840"></i><span class="caption">Обла · macOS</span></div>${screen}</div><footer><span>MAX · Telegram · WhatsApp · VK</span><span>Демонстрационный профиль · Обла ${version}</span></footer>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await win.webContents.executeJavaScript('Promise.all(Array.from(document.images,img=>img.decode()))');
  await frames(win.webContents);
  const output = path.join(root, 'docs/screenshots', name + '.png');
  fs.writeFileSync(output, (await win.webContents.capturePage()).resize({ width: 1600 }).toPNG());
  win.destroy(); console.log('Rendered ' + output);
}
client.ready.then(async () => {
  const main = client.getMainWindow(); main.setContentSize(1200, 690);
  const shell = main.webContents;
  await wait(() => !shell.isLoading());
  await wait(() => shell.executeJavaScript('document.querySelectorAll(".account-row").length===4'));
  assert.equal(client.getState().accounts.length, 4);
  const settings = client.showSettings().webContents;
  await wait(() => !settings.isLoading());
  await wait(() => settings.executeJavaScript(`document.getElementById("version").textContent.includes(${JSON.stringify(version)})`));
  await settings.executeJavaScript('Promise.all(Array.from(document.images,img=>img.decode()))');
  await frames(settings); await frames(shell);
  const captureSettings = async () => [await shell.capturePage({ x: 0, y: 0, width: 220, height: 690 }), await settings.capturePage()];
  await poster('overview', 'Всё общение. В вашем ритме.', 'Четыре мессенджера рядом — и пространство под вас.', await captureSettings());
  await settings.executeJavaScript(`document.getElementById('theme').value='light';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(() => settings.executeJavaScript('matchMedia("(prefers-color-scheme: light)").matches'));
  await settings.executeJavaScript(`document.getElementById('notifications').closest('section').previousElementSibling.scrollIntoView({block:'start'})`);
  await frames(settings); await frames(shell);
  await poster('notifications', 'Оставьте только важное.', 'Отдельные аккаунты, звук и содержимое баннеров — под вашим контролем.', await captureSettings(), true);
  await settings.executeJavaScript(`document.getElementById('theme').value='dark';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(() => settings.executeJavaScript('matchMedia("(prefers-color-scheme: dark)").matches'));
  // Hide child views, then render the genuine lock UI using a fixture state.
  for (const view of main.contentView.children) view.setVisible(false);
  await shell.executeJavaScript('document.hasFocus=()=>false;void 0');
  shell.send('shell:state', { ...client.getState(), locked: true, security: { enabled: true, touchID: true, touchIDAvailable: true } });
  await wait(() => shell.executeJavaScript('!document.getElementById("lock-screen").hidden'));
  await frames(shell);
  await poster('security', 'Личное остаётся личным.', 'Touch ID, код доступа и автоматическая блокировка.', await main.capturePage());
  clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
