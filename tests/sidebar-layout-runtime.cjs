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
 client.addAccount(undefined,'telegram');
 const js=code=>shell.executeJavaScript(code);
 const qa=path.join(__dirname,'../.tools/qa');fs.mkdirSync(qa,{recursive:true});
 for(const collapsed of [true,false]){
  await js(`window.maxwebShell.collapse(${collapsed})`);
  await wait(()=>js('document.querySelectorAll(".badge").length===2'));
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const geometry=await js(`Array.from(document.querySelectorAll('.account-row'),row=>{
   const rect=selector=>{const r=row.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
   return {avatar:rect('.avatar'),service:rect('.service-mark'),mute:rect('.account-mute'),badge:rect('.badge'),insideAvatar:!!row.querySelector('.avatar .service-mark')};
  })`);
  const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  for(const {avatar,service,mute,badge,insideAvatar} of geometry){
   assert.equal(insideAvatar,false);assert(service.left>=avatar.right,'Messenger icon must be to the right of the avatar');
   assert.equal(overlaps(service,avatar),false);assert.equal(overlaps(service,mute),false);assert.equal(overlaps(service,badge),false);
  }
  assert.equal(await js('document.querySelector("nav").scrollWidth>document.querySelector("nav").clientWidth'),false,'Sidebar must not scroll horizontally');
  fs.writeFileSync(path.join(qa,`sidebar-messenger-${collapsed?'collapsed':'expanded'}.png`),(await shell.capturePage({x:0,y:0,width:collapsed?72:220,height:280})).toPNG());
 }
 await js('window.maxwebShell.collapse(true)');await js('document.querySelector(".account-mute").click()');
 await wait(()=>client.getState().accounts[0].notifications===false);
 console.log('PASS: MAX/Telegram icons to the right, no avatar/bell/badge overlap in either sidebar mode, no horizontal overflow, mute still works');
 clearTimeout(timer);app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
app.on('will-quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
