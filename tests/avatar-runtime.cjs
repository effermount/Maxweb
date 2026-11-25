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
  assert(options.headers['User-Agent'].includes('Chrome/'));
  assert.match(options.headers.Referer, /^https:\/\/web\.(max\.ru|whatsapp\.com|vk\.me)\/$/);
  return new Response(png, { headers: { 'content-type': 'image/png' } });
};
const fixtures = {
  'web.max.ru': `window.saveProfile=async photo=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('max-db-26-123',1);r.onupgradeneeded=()=>{r.result.createObjectStore('viewer',{keyPath:['revision','id']});r.result.createObjectStore('contacts',{keyPath:['revision','id']})};r.onsuccess=()=>resolve(r.result)});
    await new Promise(resolve=>{const tx=db.transaction(['viewer','contacts'],'readwrite');tx.objectStore('viewer').put({revision:'viewer-current',id:'',model:{_meta:{persistTime:2},contact:{id:'123',updateTime:1,names:[{type:'ONEME',firstName:'MAX self'}]}}});
      tx.objectStore('contacts').put({revision:'contacts-current',id:'123',model:{id:'123',updateTime:2,names:[{type:'ONEME',name:'MAX self'}],...(photo?{baseUrl:'https://cdn.max.ru/avatar?fn=original'}:{})}});
      tx.objectStore('contacts').put({revision:'contacts-current',id:'456',model:{id:'456',baseUrl:'https://cdn.max.ru/not-self'}});tx.oncomplete=resolve});db.close();
  };void saveProfile(true);`,
  'web.telegram.org': `window.fetch=async()=>{throw Error('Blob fetch blocked')};window.avatarCalls=0;window.photo=${ownPhoto};window.selfUser={id:'123',first_name:'Telegram self',photo:{_:'userProfilePhoto',photo_id:'one'}};
    window.fixtureRoot={myId:undefined,getMyId(){return this.myId},addEventListener(){},managers:{appUsersManager:{getSelf:async()=>window.selfUser},appAvatarsManager:{loadAvatar:async()=>++window.avatarCalls===1?undefined:window.photo}}};window.apiManagerProxy={tabState:{accountNumber:0},invoke:async(type,request)=>{if(type!=='manager'||request.name!=='appUsersManager'||request.method!=='getSelf'||request.accountNumber!==0)throw Error('Not own request');return window.selfUser},loadAvatar:(...args)=>window.fixtureRoot.managers.appAvatarsManager.loadAvatar(...args)};`,
  'web.whatsapp.com': `window.fetch=async()=>{throw Error('Simulated page CORS failure')};window.me={_serialized:'self@lid'};window.pn={_serialized:'self@c.us'};
    window.require=name=>({WAWebUserPrefsMeUser:{getMaybeMeUser:()=>window.me,getMaybeMePnUser:()=>window.pn},WAWebUserPrefsGeneral:{getPushname:()=> 'WhatsApp self'},
      WAWebProfilePicThumbCollection:{ProfilePicThumbCollection:{get:()=>({}),find:async me=>{if(me===window.me)return {};if(me!==window.pn)throw Error('Not self');return {__x_previewEurl:'https://pps.whatsapp.net/self.jpg'}}}}})[name];`,
  'web.vk.me': `window.fetch=async()=>{throw Error('Simulated page CORS failure')};
    window.vkmeConfig={vkid:123,user:{id:123,first_name:'VK',last_name:'self'}};window.ownUser={id:123,firstName:'VK',lastName:'self',photo:{photo100:'https://sun.userapi.com/self.jpg'}};
    const own=document.createElement('button');own.setAttribute('aria-label','Меню');own.__reactFiber$fixture={memoizedProps:{user:window.ownUser}};document.body.append(own);
    const chat=document.createElement('header');chat.setAttribute('data-name','Other contact');chat.__reactFiber$fixture={memoizedProps:{user:{id:456,first_name:'Other',photo_100:'https://sun.userapi.com/not-self.jpg'}}};document.body.append(chat);`
};
app.on('session-created', ses => ses.protocol.handle('https', request => {
  const url = new URL(request.url);
  if (url.hostname === 'web.telegram.org' && /^\/k\/rootScope-(fixture|active)\.js$/.test(url.pathname)) return new Response(url.pathname.includes('active') ? 'export const n=window.fixtureRoot;' : 'export const n={getMyId:()=>0,addEventListener(){}};', {headers:{'content-type':'application/javascript'}});
  if (!fixtures[url.hostname]) return new Response(null, { status: 403 });
  return new Response(`<!doctype html>${url.hostname === 'web.telegram.org' ? '<link rel="modulepreload" href="/k/rootScope-fixture.js">' : ''}<body><script>${fixtures[url.hostname]}</script></body>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "connect-src 'none'; img-src blob: https:" }
  });
}));
const client = require('../src/main.cjs');
const timeout = setTimeout(() => { console.error('Avatar runtime timed out'); app.exit(1); }, 45000);
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
  assert(!networkReads.some(url => url.includes('not-self')), 'Never load another contact photo');
  const maxURL = new URL(networkReads.find(url => url.includes('cdn.max.ru')));
  assert.deepEqual(maxURL.searchParams.getAll('fn'), ['original', 'sqr_128'], 'Keep the original MAX photo query parameters');
  assert.equal(client.getState().accounts.find(a => a.id === ids.vk).profileName, 'VK self', 'Own VK model is read without opening a menu');
  await telegram.executeJavaScript("window.fixtureRoot.myId='123';delete window.apiManagerProxy;import('/k/rootScope-active.js').then(()=>undefined)");
  const saved = client.getState().accounts.find(a => a.id === ids.telegram).avatar;
  await telegram.executeJavaScript('window.__maxwebProfile.send({name:"Invalid image test",avatar:"not an image"});void 0');
  await wait(() => client.getState().accounts.find(a => a.id === ids.telegram)?.profileName === 'Invalid image test', 'invalid image update');
  assert.equal(client.getState().accounts.find(a => a.id === ids.telegram).avatar, saved, 'Invalid image does not erase saved photo');
  await telegram.executeJavaScript('window.selfUser={...window.selfUser,first_name:"Renamed",photo:{_:"userProfilePhoto",photo_id:"two"}};window.fixtureRoot.managers.appAvatarsManager.loadAvatar=async()=>undefined;void 0');
  await wait(() => client.getState().accounts.find(a => a.id === ids.telegram)?.profileName === 'Renamed', 'name updates during photo failure');
  assert.equal(client.getState().accounts.find(a => a.id === ids.telegram).avatar, saved, 'Temporary failure preserves saved photo');
  await telegram.executeJavaScript('window.selfUser={...window.selfUser,photo:{_:"userProfilePhotoEmpty"}};void 0');
  await wait(() => client.getState().accounts.find(a => a.id === ids.telegram)?.avatar === '', 'explicit photo removal');
  const vk = client.getAccountContents(ids.vk);
  await vk.executeJavaScript(`delete document.querySelector('[aria-label="Меню"]').__reactFiber$fixture;
    const menu=document.createElement('div');menu.setAttribute('role','menu');menu.setAttribute('aria-label','Меню');
    const header=document.createElement('div');header.append('VK menu self');const img=new Image();img.src=${ownPhoto};header.append(img);
    menu.append(header,document.createElement('div'));document.body.append(menu);void 0`);
  await wait(() => client.getState().accounts.find(a => a.id === ids.vk)?.profileName === 'VK menu self', 'own menu header');
  assert(client.getState().accounts.find(a => a.id === ids.vk).avatar, 'Menu avatar is decoded through img-src');
  await vk.executeJavaScript(`document.querySelector('[role="menu"]').remove();delete window.vkmeConfig.user;document.querySelector('[aria-label="Меню"]').__reactFiber$fixture={memoizedProps:{user:{id:456,first_name:'Wrong contact'}}};void 0`);
  await new Promise(resolve => setTimeout(resolve, 5200));
  assert.equal(client.getState().accounts.find(a => a.id === ids.vk).profileName, 'VK menu self', 'A different identity cannot replace the owner');
  const shell = client.getMainWindow().webContents;
  await wait(() => !shell.isLoading(), 'shell');
  assert.equal(await shell.executeJavaScript('typeof window.__maxwebProfile'), 'undefined', 'Shell has no image fetch bridge');
  await assert.rejects(client.getAccountContents(ids.whatsapp).executeJavaScript('window.__maxwebProfile.readAvatar("https://127.0.0.1/private")'));
  console.log('PASS: current WhatsApp store exports, MAX own contact record, Telegram blob with connect-src blocked, VK self model/menu, identity guard, CDN headers, saved image preservation and removal');
  clearTimeout(timeout); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('will-quit', () => fs.rmSync(directory, { recursive: true, force: true }));
