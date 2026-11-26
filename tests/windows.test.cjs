'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { generateKeyPairSync, createHash, sign } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { WindowsUpdater, installerArguments } = require('../src/windows-updater.cjs');
const { canonicalManifest, verifyManifest, githubRelease } = require('../src/update-core.cjs');
const keys = generateKeyPairSync('ed25519');
function installer() {
  const bytes = Buffer.alloc(128); bytes.write('MZ'); bytes.writeUInt32LE(64, 60);
  bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x14c, 68); return bytes;
}
function signed(bytes = installer(), extra = {}) {
  const manifest = { schema: 1, version: '1.2.16', platform: 'win32', arch: 'x64', url: 'Obla-1.2.16-windows-x64.exe', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), publishedAt: '2026-11-26T00:00:00Z', notes: 'Current release only', ...extra };
  manifest.signature = sign(null, canonicalManifest(manifest), keys.privateKey).toString('base64'); return manifest;
}
async function fixture(t, bytes = installer(), failSpawn = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'obla-windows-updates-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'Обла with spaces'), directory = path.join(root, 'profile/Updates');
  fs.mkdirSync(target); fs.mkdirSync(directory, { recursive: true });
  const account = path.join(root, 'profile/accounts'); fs.writeFileSync(account, 'retained fixture sessions');
  fs.writeFileSync(path.join(root, 'Obla-1.2.16-windows-x64.exe'), bytes);
  const source = pathToFileURL(path.join(root, 'latest-windows.json')).href;
  fs.writeFileSync(path.join(root, 'latest-windows.json'), JSON.stringify(signed(bytes)));
  let flushed = 0, quit = 0, spawned = 0, unref = false;
  const options = { version: '1.2.15', arch: 'x64', directory, publicKey: keys.publicKey, packaged: true,
    executable: path.join(target, 'Obla.exe'), getSettings: () => ({ repository: 'effermount/Maxweb' }),
    beforeInstall: async () => { flushed++; }, quit: () => { quit++; },
    spawnInstaller: (file, args, config) => {
      spawned++; assert.equal(flushed, 1);
      assert.equal(file, path.join(directory, 'Obla-1.2.16-windows-x64.exe'));
      assert.deepEqual(args, ['--updated', '/S', '--force-run', `/D=${target}`]);
      assert.equal(config.shell, false); assert.equal(config.detached, true); assert.equal(config.windowsVerbatimArguments, true);
      assert.equal(config.argv0, `"${file}"`);
      const child = new EventEmitter(); child.unref = () => { unref = true; };
      process.nextTick(() => child.emit(failSpawn ? 'error' : 'spawn', new Error('spawn rejected'))); return child;
    }
  };
  const updater = new WindowsUpdater(options);
  return { updater, source, options, directory, account, counters: () => ({ flushed, quit, spawned, unref }) };
}
test('Windows feed selects Windows only and rejects a Mac fallback, wrong architecture and forged signatures', async () => {
  const manifest = signed(), base = 'https://github.com/effermount/Maxweb/releases/download/v1.2.16/latest-windows.json';
  assert.equal(verifyManifest(manifest, keys.publicKey, base, { platform: 'win32', arch: 'x64' }).platform, 'win32');
  assert.throws(() => verifyManifest(manifest, keys.publicKey, base, { platform: 'darwin', arch: 'x64' }));
  assert.throws(() => verifyManifest(manifest, keys.publicKey, base, { platform: 'win32', arch: 'arm64' }));
  assert.throws(() => verifyManifest({ ...manifest, version: '9.0.0' }, keys.publicKey, base, { platform: 'win32', arch: 'x64' }), /Подпись/);
  assert.throws(() => verifyManifest(signed(undefined, { url: 'Mac.zip' }), keys.publicKey, base, { platform: 'win32', arch: 'x64' }), /EXE/);
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return url.endsWith('/latest') ? Response.json({ assets: [{ name: 'latest-mac.json', browser_download_url: base.replace('windows', 'mac') }, { name: 'latest-windows.json', browser_download_url: base }] }) : Response.json(manifest); };
  await githubRelease('effermount/Maxweb', { platform: 'win32', fetchImpl }); assert.equal(calls[1], base);
  await assert.rejects(githubRelease('effermount/Maxweb', { platform: 'win32', fetchImpl: async () => Response.json({ assets: [{ name: 'latest-mac.json', browser_download_url: base.replace('windows', 'mac') }] }) }), /latest-windows/);
});
test('Windows signed download installs only after flush, preserves profile and confirms next startup', async t => {
  const f = await fixture(t);
  assert.equal((await f.updater.check(f.source)).status, 'available');
  assert.equal((await f.updater.download()).status, 'ready');
  const saved = f.updater.archive; await f.updater.install();
  assert.deepEqual(f.counters(), { flushed: 1, quit: 1, spawned: 1, unref: true });
  assert.equal(fs.readFileSync(f.account, 'utf8'), 'retained fixture sessions');
  const next = new WindowsUpdater({ ...f.options, version: '1.2.16' });
  await next.finishPending(); assert.equal(next.snapshot().status, 'current');
  assert(!fs.existsSync(saved)); assert(!fs.existsSync(path.join(f.directory, 'pending-windows.json')));
  assert.equal(fs.readFileSync(f.account, 'utf8'), 'retained fixture sessions');
  assert.equal((await next.check(f.source)).status, 'current'); assert.equal(next.candidate, null);
});
test('Windows refuses an installer altered after download without quitting or launching it', async t => {
  const f = await fixture(t); await f.updater.check(f.source); await f.updater.download();
  fs.appendFileSync(f.updater.archive, 'tampered');
  await assert.rejects(f.updater.install(), /изменился/);
  assert.deepEqual(f.counters(), { flushed: 0, quit: 0, spawned: 0, unref: false });
  assert.equal(f.updater.snapshot().status, 'available');
});
test('Windows rejects invalid PE and launch errors without losing the running application', async t => {
  const invalid = await fixture(t, Buffer.alloc(128)); await invalid.updater.check(invalid.source); await invalid.updater.download();
  await assert.rejects(invalid.updater.install(), /установщик/); assert.equal(invalid.counters().quit, 0);
  const failed = await fixture(t, installer(), true); await failed.updater.check(failed.source); await failed.updater.download();
  await assert.rejects(failed.updater.install(), /spawn rejected/); assert.equal(failed.counters().quit, 0);
  assert(!fs.existsSync(path.join(failed.directory, 'pending-windows.json')));
});
test('NSIS receives the directory with Unicode/spaces as the final unquoted argument', () => {
  assert.equal(installerArguments('C:\\Users\\Имя Фамилия\\Обла').at(-1), '/D=C:\\Users\\Имя Фамилия\\Обла');
  assert.throws(() => installerArguments('C:\\unsafe"\\path'));
  assert.throws(() => installerArguments('relative'));
});
