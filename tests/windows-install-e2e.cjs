'use strict';
// A real NSIS reinstall in an ephemeral Windows runner, using the published
// installer's actual signature/hash. Never run against a person's app profile.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('This integration test is restricted to a disposable Windows CI runner.');

if (process.versions.electron) {
  const { app, session } = require('electron');
  const mode = process.argv[2], profile = process.argv[3], target = process.argv[4], source = process.argv[5];
  app.setName('Obla'); app.setPath('userData', profile);
  const deadline = setTimeout(() => app.exit(2), 60000);
  app.whenReady().then(async () => {
    const ses = session.fromPartition('persist:max');
    if (mode === 'verify') {
      assert.equal((await ses.cookies.get({ name: 'obla-update-fixture' }))[0]?.value, 'retained');
      console.log('PASS: encrypted fixture cookie survived native reinstall');
      clearTimeout(deadline); app.quit(); return;
    }
    await ses.cookies.set({ url: 'https://obla-fixture.invalid/', name: 'obla-update-fixture', value: 'retained', secure: true, expirationDate: Date.now() / 1000 + 3600 });
    if (mode === 'seed') {
      await ses.cookies.flushStore(); clearTimeout(deadline); app.quit(); return;
    }
    const { WindowsUpdater } = require('../src/windows-updater.cjs');
    const updater = new WindowsUpdater({ version: '0.0.0', directory: path.join(profile, 'Updates'), publicKey: fs.readFileSync(path.join(__dirname, '../assets/release-public.pem')),
      arch: 'x64', packaged: true, executable: path.join(target, 'Obla.exe'), getSettings: () => ({}),
      beforeInstall: async () => { ses.flushStorageData(); await ses.cookies.flushStore(); fs.writeFileSync(path.join(profile, 'flushed'), 'yes'); },
      quit: () => { clearTimeout(deadline); app.quit(); }
    });
    assert.equal((await updater.check(pathToFileURL(path.join(source, 'latest-windows.json')).href)).status, 'available');
    assert.equal((await updater.download()).status, 'ready');
    await updater.install();
  }).catch(error => { console.error(error); app.exit(1); });
} else {
  const source = path.resolve(process.argv[2]);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'latest-windows.json')));
  require('../src/update-core.cjs').verifyManifest(manifest, fs.readFileSync(path.join(__dirname, '../assets/release-public.pem')), pathToFileURL(path.join(source, 'latest-windows.json')).href, { platform: 'win32', arch: 'x64', allowFile: true });
  assert.equal(manifest.url, `Obla-${manifest.version}-windows-x64.exe`);
  const installer = path.join(source, manifest.url);
  const bytes = fs.readFileSync(installer);
  assert.equal(bytes.length, manifest.size);
  assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  let firstInstaller = installer;
  if (process.argv[3]) {
    const previous = path.resolve(process.argv[3]);
    const file = path.join(previous, 'latest-windows.json');
    const legacy = require('../src/update-core.cjs').verifyManifest(JSON.parse(fs.readFileSync(file)), fs.readFileSync(path.join(__dirname, '../assets/release-public.pem')), pathToFileURL(file).href, { platform: 'win32', arch: 'x64', allowFile: true });
    assert.equal(legacy.url, `Obla-${legacy.version}-windows-x64.exe`);
    firstInstaller = path.join(previous, legacy.url);
    const legacyBytes = fs.readFileSync(firstInstaller);
    assert.equal(legacyBytes.length, legacy.size);
    assert.equal(require('node:crypto').createHash('sha256').update(legacyBytes).digest('hex'), legacy.sha256);
  }
  const profile = path.join(process.env.APPDATA, 'Обла');
  assert(!fs.existsSync(profile), 'Refuse to touch an existing user profile');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'obla-native-update-')));
  const target = path.join(root, 'Обла with spaces'); fs.mkdirSync(target);
  const executable = path.join(target, 'Obla.exe');
  function stopFixture() {
    const escaped = executable.replaceAll("'", "''");
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escaped}' } | ForEach-Object { $_.ProcessId }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, 'Cannot enumerate fixture processes');
    const pids = (result.stdout || '').trim().split(/\s+/).filter(value => /^\d+$/.test(value));
    for (const pid of pids) spawnSync('taskkill.exe', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    return pids.length;
  }
  async function main() {
    const first = spawnSync(firstInstaller, ['/S', `/D=${target}`], { stdio: 'inherit', timeout: 120000, windowsVerbatimArguments: true, argv0: `"${firstInstaller}"` });
    assert.equal(first.status, 0, 'Initial NSIS installation failed');
    assert(fs.existsSync(executable));
    const store = require('../src/store.cjs').createStore(profile);
    store.set({ accounts: [{ id: 'default', name: 'Update fixture', customName: true }], theme: 'dark', maxZoom: 125,
      updates: { repository: 'effermount/Maxweb', autoCheck: false, userConfigured: true } });
    fs.writeFileSync(path.join(profile, 'keep-fixture'), 'retained');
    if (firstInstaller !== installer) {
      const seed = spawnSync(require('electron'), [__filename, 'seed', profile, target, source], { stdio: 'inherit', timeout: 45000 });
      assert.equal(seed.status, 0);
      const reset = spawnSync(installer, ['/S', `/D=${target}`], { stdio: 'inherit', timeout: 120000, windowsVerbatimArguments: true, argv0: `"${installer}"` });
      assert.equal(reset.status, 0, 'Manual version reset installation failed');
      const version = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${executable.replaceAll("'", "''")}').VersionInfo.FileVersion`], { encoding: 'utf8' });
      assert.equal(version.stdout.trim().split('.').slice(0, 3).join('.'), manifest.version);
      const retained = spawnSync(require('electron'), [__filename, 'verify', profile, target, source], { stdio: 'inherit', timeout: 45000 });
      assert.equal(retained.status, 0, 'Manual reset must retain the previous session');
      console.log('PASS: previous release replaced by the reset version with its session retained');
    }
    const worker = spawnSync(require('electron'), [__filename, 'update', profile, target, source], { stdio: 'inherit', timeout: 120000 });
    assert.equal(worker.status, 0, 'Updater worker failed');
    assert.equal(fs.readFileSync(path.join(profile, 'flushed'), 'utf8'), 'yes');
    const pending = path.join(profile, 'Updates/pending-windows.json');
    const start = Date.now();
    while (Date.now() - start < 120000 && fs.existsSync(pending)) await new Promise(resolve => setTimeout(resolve, 500));
    assert(!fs.existsSync(pending), 'Installed app did not relaunch and confirm its update');
    const state = require('../src/store.cjs').createStore(profile).get();
    assert.equal(state.accounts[0].name, 'Update fixture'); assert.equal(state.theme, 'dark'); assert.equal(state.maxZoom, 125);
    assert.equal(fs.readFileSync(path.join(profile, 'keep-fixture'), 'utf8'), 'retained');
    assert(stopFixture() > 0, 'Installed app must still be running after confirming the update');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const verified = spawnSync(require('electron'), [__filename, 'verify', profile, target, source], { stdio: 'inherit', timeout: 45000 });
    assert.equal(verified.status, 0, 'Cookie verification failed');
    console.log('PASS: real Windows NSIS install/update, Unicode/spaces, app relaunch, retained profile/settings and encrypted cookie');
  }
  main().then(() => { stopFixture(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); })
    .catch(error => { stopFixture(); console.error(error); process.exitCode = 1; });
}
