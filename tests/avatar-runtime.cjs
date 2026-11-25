'use strict';
const { app, session, dialog, nativeImage } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-avatar-'));
app.setPath('userData', directory);
dialog.showMessageBox = async () => ({ response: 1 });
const png = nativeImage.createFromBitmap(Buffer.alloc(16, 180), { width: 2, height: 2 }).toPNG();
const ownPhoto = `URL.createObjectURL(new Blob([new Uint8Array(${JSON.stringify([...png])})],{type:'image/png'}))`;
const networkReads = [];
globalThis.fetch = async (url, options) => {
  networkReads.push(String(url));
  assert.equal(options.credentials, 'omit');
  return new Response(png, { headers: { 'content-type': 'image/png' } });
};
const fixtures = {
  'web.max.ru': `window.saveProfile=async photo=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('max-db-22-123',1);r.onupgradeneeded=()=>r.result.createObjectStore('viewer',{keyPath:'id'});r.onsuccess=()=>resolve(r.result)});
    await new Promise(resolve=>{const tx=db.transaction('viewer','readwrite');tx.objectStore('viewer').put({id:'',model:{contact:{names:[{type:'ONEME',firstName:'MAX self'}],...(photo?{baseUrl:'https://cdn.max.ru/avatar'}:{})}}});tx.oncomplete=resolve});db.close();
  };void saveProfile(true);`,
  'web.telegram.org': `window.avatarCalls=0;window.photo=${ownPhoto};window.selfUser={id:'123',first_name:'Telegram self',photo:{_:'userProfilePhoto',photo_id:'one'}};
    window.rootScope={myId:'123',managers:{appUsersManager:{getSelf:async()=>window.selfUser},appAvatarsManager:{loadAvatar:async()=>++window.avatarCalls===1?undefined:window.photo}}};`,
  'web.whatsapp.com': `window.fetch=async()=>{throw Error('Simulated page CORS failure')};window.me={_serialized:'self@c.us'};
    window.require=name=>({WAWebUserPrefsMeUser:{getMaybeMePnUser:()=>window.me},WAWebUserPrefsGeneral:{getPushname:()=> 'WhatsApp self'},
      WAWebProfilePicThumbCollection:{ProfilePicThumb:{get:()=>({}),find:async me=>{if(me!==window.me)throw Error('Not self');return {img:'https://pps.whatsapp.net/self.jpg'}}}}})[name];`,
  'web.vk.me': `window.fetch=async()=>{throw Error('Simulated page CORS failure')};
    const own=document.createElement('button');own.setAttribute('aria-label','Мой профиль');own.setAttribute('data-name','VK self');
    const img=document.createElement('img');img.src='https://sun.userapi.com/self.jpg';own.append(img);document.body.append(own);`
};
app.on('session-created', ses => ses.protocol.handle('https', request => {
  const url = new URL(request.url);
  if (!fixtures[url.hostname]) return new Response(null, { status: 403 });
  return new Response(`<!doctype html><body><script>${fixtures[url.hostname]}</script></body>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': url.hostname === 'web.telegram.org' ? 'connect-src blob:' : "connect-src 'none'" }
  });
}));
const client = require('../src/main.cjs');
const timeout = setTimeout(() => { console.error('Avatar runtime timed out'); app.exit(1); }, 40000);
const wait = async (check, label) => { for (let n = 0; n < 300; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error('Timed out: '+label); };
client.ready.then(async () => {
  const ids = { max: 'default' };
  for (const service of ['telegram', 'whatsapp', 'vk']) ids[service] = client.addAccount(undefined, service).activeAccountId;
  for (const [service, id] of Object.entries(ids)) {
    await wait(() => client.getState().accounts.find(a => a.id === id)?.avatar, service+' avatar');
    const account = client.getState().accounts.find(a => a.id === id);
    assert.match(account.avatar, /^data:image\/png;base64,/);
  }
  const telegram = client.getAccountContents(ids.telegram);
  assert(await telegram.executeJavaScript('window.avatarCalls>=2'), 'Telegram retries an initially missing URL');
  assert(networkReads.some(url => url.includes('cdn.max.ru')), 'MAX bypasses page connect-src through bounded native fallback');
  assert(networkReads.some(url => url.includes('pps.whatsapp.net')), 'WhatsApp bypasses page CORS');
  assert(networkReads.some(url => url.includes('sun.userapi.com')), 'VK bypasses page CORS');
  const saved = client.getState().accounts.find(a => a.id === ids.telegram).avatar;
  await telegram.executeJavaScript('window.__maxwebProfile.send({name:"Invalid image test",avatar:"not an image"});void 0');
  await wait(() => client.getState().accounts.find(a => a.id === ids.telegram)?.profileName === 'Invalid image test', 'invalid image update');
  assert.equal(client.getState().accounts.find(a => a.id === ids.telegram).avatar, saved, 'Invalid image does not erase saved photo');
  await telegram.executeJavaScript('window.selfUser={...window.selfUser,first_name:"Renamed",photo:{_:"userProfilePhoto",photo_id:"two"}};window.rootScope.managers.appAvatarsManager.loadAvatar=async()=>undefined;void 0');
  await wait(() => client.getState().accounts.find(a => a.id === ids.telegram)?.profileName === 'Renamed', 'name updates during photo failure');
  assert.equal(client.getState().accounts.find(a => a.id === ids.telegram).avatar, saved, 'Temporary failure preserves saved photo');
  await telegram.executeJavaScript('window.selfUser={...window.selfUser,photo:{_:"userProfilePhotoEmpty"}};void 0');
  await wait(() => client.getState().accounts.find(a => a.id === ids.telegram)?.avatar === '', 'explicit photo removal');
  const shell = client.getMainWindow().webContents;
  await wait(() => !shell.isLoading(), 'shell');
  assert.equal(await shell.executeJavaScript('typeof window.__maxwebProfile'), 'undefined', 'Shell has no image fetch bridge');
  await assert.rejects(client.getAccountContents(ids.whatsapp).executeJavaScript('window.__maxwebProfile.readAvatar("https://127.0.0.1/private")'));
  console.log('PASS: own avatars for four services, page CORS/CSP fallback, stale WhatsApp cache refresh, Telegram retry, saved image preservation and explicit removal, unsafe origin rejection');
  clearTimeout(timeout); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('will-quit', () => fs.rmSync(directory, { recursive: true, force: true }));
