'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Updater } = require('../src/updater.cjs');
const timer = setTimeout(() => app.exit(1), 60000);
app.whenReady().then(async () => {
  const updater = new Updater({version:'1.0.0',directory:path.join(__dirname,'../.tools/qa/online-update'),publicKey:fs.readFileSync(path.join(__dirname,'../assets/release-public.pem')),getSettings:()=>({repository:'forkkrn-cmd/Maxweb'}), fetchImpl:(url,options)=>globalThis.fetch(url,options)});
  const state=await updater.check();
  assert.equal(state.status,'available');
  console.log('PASS: bundled Electron Node Fetch followed GitHub HTTPS redirects and verified public signed release',state.version);
  clearTimeout(timer); app.quit();
}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1)});
