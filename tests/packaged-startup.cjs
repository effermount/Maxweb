'use strict';
// Exercise native helper lookup in the actual bundle, using a hidden fixture
// renderer and disposable profile. Never open the installed user's accounts.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), asar = require('@electron/asar'), plist = require('plist');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obla-package-startup-'));
try {
  const profile = path.join(directory, 'profile'); fs.mkdirSync(profile);
  const legacy = spawnSync(require('electron'), [path.join(__dirname, 'brand-migration.cjs'), profile, 'legacy'], { encoding: 'utf8', timeout: 25000 });
  assert.equal(legacy.status, 0, legacy.stderr);
  const bundle = path.join(directory, 'Maxweb.app');
  execFileSync('/usr/bin/ditto', [path.join(root, 'dist/mac-universal/Maxweb.app'), bundle]);
  const contents = path.join(bundle, 'Contents'), infoPath = path.join(contents, 'Info.plist');
  const info = plist.parse(fs.readFileSync(infoPath, 'utf8'));
  assert.equal(info.CFBundleName, 'Обла');
  assert.equal(info.CFBundleExecutable, 'Maxweb');
  const auth = path.join(contents, 'Frameworks/Обла.app/Contents');
  const authInfo = plist.parse(fs.readFileSync(path.join(auth, 'Info.plist'), 'utf8'));
  assert.equal(authInfo.CFBundleDisplayName, 'Обла');
  const authExecutable = path.join(auth, 'MacOS/Обла');
  const architectures = execFileSync('/usr/bin/lipo', ['-archs', authExecutable], { encoding: 'utf8' });
  assert(architectures.includes('arm64') && architectures.includes('x86_64'));
  const availability = spawnSync(authExecutable, ['--check'], { timeout: 10000 });
  assert([0, 2].includes(availability.status), 'Native component must check availability without showing authentication');
  for (const suffix of ['', ' (Renderer)', ' (GPU)', ' (Plugin)']) {
    const name = `Обла Helper${suffix}`;
    assert(fs.existsSync(path.join(contents, 'Frameworks', `${name}.app`, 'Contents/MacOS', name)), `Missing ${name}`);
  }
  const fixture = path.join(directory, 'fixture'); fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'maxweb', main: 'main.cjs' }));
  fs.writeFileSync(path.join(fixture, 'main.cjs'), `
    const {app, BrowserWindow, safeStorage, session}=require('electron');
    const fs=require('fs'), assert=require('assert/strict');
    app.setName('Maxweb');app.setPath('userData',${JSON.stringify(profile)});
    const timer=setTimeout(()=>app.exit(2),15000);
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
      await win.loadURL('data:text/html,<title>Obla startup fixture</title>');
      assert.equal(await win.webContents.executeJavaScript('document.title'),'Obla startup fixture');
      assert.equal(app.getName(),'Maxweb');
      const ses=session.fromPartition('persist:max');
      assert.equal((await safeStorage.decryptStringAsync(fs.readFileSync(${JSON.stringify(path.join(profile, 'protected-fixture'))}))).result,'fixture-code-verifier');
      assert.equal((await ses.cookies.get({name:'brand-fixture'}))[0]?.value,'fixture-session');
      console.log('PACKAGED_STARTUP_OK');clearTimeout(timer);win.destroy();app.quit();
    }).catch(error=>{console.error(error);app.exit(1)});
  `);
  const archive = path.join(contents, 'Resources/app.asar');
  fs.unlinkSync(archive);
  execFileSync(process.execPath, ['--input-type=module', '-e', 'import {createPackage} from "@electron/asar";await createPackage(process.argv[1],process.argv[2]);', fixture, archive], { cwd: root });
  if (info.ElectronAsarIntegrity?.['Resources/app.asar']) info.ElectronAsarIntegrity['Resources/app.asar'].hash = crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
  fs.writeFileSync(infoPath, plist.build(info));
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { stdio: 'pipe' });
  const result = spawnSync(path.join(contents, 'MacOS', info.CFBundleExecutable), [], { encoding: 'utf8', timeout: 22000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PACKAGED_STARTUP_OK/);
  console.log('PASS: packaged Обла launches, retains the encrypted legacy code/cookie and includes the Universal native Touch ID component');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
