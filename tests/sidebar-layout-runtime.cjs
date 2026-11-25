'use strict';
const {app,session}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'maxweb-sidebar-layout-'));app.setPath('userData',profile);
app.on('session-created',ses=>ses.protocol.handle('https',()=>new Response('<html><head><title>(12) Fixture</title></head><body>Fixture</body></html>',{headers:{'content-type':'text/html'}})));
const client=require('../src/main.cjs');
const timer=setTimeout(()=>app.exit(1),15000);
const wait=async check=>{for(let n=0;n<100;n++){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out');};
client.ready.then(async()=>{
 const shell=client.getMainWindow().webContents;if(shell.isLoading())await new Promise(r=>shell.once('did-stop-loading',r));
 client.renameAccount('default','Алексей Константинович Кузнецов');
 const telegramID=client.addAccount('Анна Сергеевна','telegram').activeAccountId;
 client.addAccount('Андрей Смирнов','whatsapp');
 client.addAccount('Виктор Ковалёв','vk');
 const js=code=>shell.executeJavaScript(code);
 await js(`window.maxwebShell.notifications("${telegramID}",false)`);
 const qa=path.join(__dirname,'../.tools/qa');fs.mkdirSync(qa,{recursive:true});
 for(const collapsed of [true,false]){
  await js(`window.maxwebShell.collapse(${collapsed})`);
  await wait(()=>js('document.querySelectorAll(".badge").length===4'));
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const geometry=await js(`Array.from(document.querySelectorAll('.account-row'),row=>{
   const rect=selector=>{const r=row.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
   return {avatar:rect('.avatar'),initials:rect('.avatar-initials'),service:rect('.service-mark'),mute:rect('.account-mute'),badge:rect('.badge'),height:row.getBoundingClientRect().height,name:rect('.name'),rename:rect('.rename'),nameWrap:getComputedStyle(row.querySelector('.name')).whiteSpace,insideAvatar:!!row.querySelector('.avatar .service-mark')};
  })`);
  const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  for(const {avatar,initials,service,mute,badge,height,name,rename,nameWrap,insideAvatar} of geometry){
   assert.equal(insideAvatar,false);
   if(collapsed){
    assert.equal(height,56,'Larger avatars must retain a compact row height');
    assert.equal(avatar.right-avatar.left,44,'Profile avatar must use the larger size');
    assert(Math.abs((initials.left+initials.right)-(avatar.left+avatar.right))<1,'Initials must be horizontally centered');
    assert(Math.abs((initials.top+initials.bottom)-(avatar.top+avatar.bottom))<1,'Initials must be vertically centered');
    const inside=(outer,inner)=>inner.left>=outer.left&&inner.right<=outer.right&&inner.top>=outer.top&&inner.bottom<=outer.bottom;
    assert(inside(avatar,mute),'Bell must fit inside the profile avatar');
    assert(inside(avatar,service),'Messenger badge must fit inside the profile avatar');
    assert(mute.right<=service.left,'Bell must sit to the left of the messenger badge');
    assert.equal(overlaps(mute,badge),false);
   }else {
    const inside=(outer,inner)=>inner.left>=outer.left&&inner.right<=outer.right&&inner.top>=outer.top&&inner.bottom<=outer.bottom;
    assert(inside(avatar,mute)); assert(inside(avatar,service));
    assert.equal(nameWrap,'normal','Long profile names must wrap');
    assert(name.right-name.left>=100,'Profile name must use the available panel width');
    assert(name.right<=rename.left,'Edit button must not cover the name');
    assert(Math.abs(rename.top-name.top)<=6,'Edit button must align with the first name line');
   }
   assert.equal(overlaps(service,mute),false);assert.equal(overlaps(service,badge),false);
  }
  const avatarColors=await js('Array.from(document.querySelectorAll(".avatar"),el=>getComputedStyle(el).backgroundColor)');
  assert.equal(await js('getComputedStyle(document.querySelector(".account-row.active")).backgroundColor'),'rgba(0, 0, 0, 0)','Active row must have no background fill');
  assert.equal(await js('getComputedStyle(document.querySelector(".active .avatar")).outlineStyle'),'solid','Active avatar must have a visible outline');
  await js('window.maxwebShell.select("default")');
  assert.deepEqual(await js('Array.from(document.querySelectorAll(".avatar"),el=>getComputedStyle(el).backgroundColor)'),avatarColors,'Selection must preserve profile colors');
  assert.equal(await js('document.querySelector(".account-row.active .account").getAttribute("aria-current")'),'page');
  await js(`window.maxwebShell.select("${telegramID}")`);
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  assert.equal(await js('document.querySelector("nav").scrollWidth>document.querySelector("nav").clientWidth'),false,'Sidebar must not scroll horizontally');
  fs.writeFileSync(path.join(qa,`sidebar-messenger-${collapsed?'collapsed':'expanded'}.png`),(await shell.capturePage({x:0,y:0,width:collapsed?72:220,height:370})).toPNG());
 }
 await js('window.maxwebShell.collapse(true)');await js('document.querySelector(".account-mute").click()');
 await wait(()=>client.getState().accounts[0].notifications===false);
 console.log('PASS: compact avatar/row sizes, bell and messenger inside avatar corners, no control overlap, expanded layout preserved, no overflow, mute still works');
 clearTimeout(timer);setTimeout(()=>app.exit(0),2000).unref();app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
app.on('will-quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
