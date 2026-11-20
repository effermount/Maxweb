'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { generateKeyPairSync, createHash, sign } = require('node:crypto');
const { canonicalManifest } = require('../src/update-core.cjs');
const { Updater } = require('../src/updater.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-install-test-'));
const target = path.join(root, 'installed/Maxweb.app');
async function main() {
  const keys = generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(root, 'public.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
  fs.mkdirSync(path.join(root, 'profile'), { recursive: true });
  fs.writeFileSync(path.join(root, 'profile/account-sessions'), 'primary + secondary authorization');
  const marker = path.join(root, 'launched');
  function fixture(appPath, version) {
    fs.mkdirSync(path.join(appPath, 'Contents/MacOS'), { recursive: true });
    const source = path.join(root, `fixture-${version}.c`);
    fs.writeFileSync(source, `#include <stdio.h>\nint main(void){ FILE *f=fopen(${JSON.stringify(marker)},"w"); if(!f) return 1; fputs("${version}",f); fclose(f); return 0; }\n`);
    execFileSync('/usr/bin/clang', ['-arch', 'arm64', source, '-o', path.join(appPath, 'Contents/MacOS/Maxweb')]);
    fs.writeFileSync(path.join(appPath, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.maxweb.qa.updater</string><key>CFBundleExecutable</key><string>Maxweb</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>LSBackgroundOnly</key><true/></dict></plist>`);
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath]);
  }
  fixture(target, '1.0.0');
  const newer = path.join(root, 'build/Maxweb.app'); fixture(newer, '1.2.0');
  const releases = path.join(root, 'releases'); fs.mkdirSync(releases);
  const archive = path.join(releases, 'Maxweb.zip');
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', newer, archive]);
  const bytes = fs.readFileSync(archive);
  const manifest = { schema: 1, version: '1.2.0', platform: 'darwin', arch: 'arm64', url: 'Maxweb.zip', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), publishedAt: new Date().toISOString(), notes: 'Installer fixture' };
  manifest.signature = sign(null, canonicalManifest(manifest), keys.privateKey).toString('base64');
  fs.writeFileSync(path.join(releases, 'latest.json'), JSON.stringify(manifest));
  const result = spawnSync(process.execPath, [path.join(__dirname, 'install-worker.cjs'), root], { stdio: 'inherit' });
  assert.equal(result.status, 0, 'Updater worker failed');
  const start = Date.now();
  while (Date.now() - start < 20000 && !fs.existsSync(marker)) await new Promise(resolve => setTimeout(resolve, 100));
  if (!fs.existsSync(marker)) {
    console.error(fs.existsSync(path.join(root, 'profile/Updates/install.log')) ? fs.readFileSync(path.join(root, 'profile/Updates/install.log'), 'utf8') : 'No installer log');
  }
  assert.equal(fs.readFileSync(marker, 'utf8'), '1.2.0');
  assert.equal(fs.readFileSync(path.join(root, 'profile/account-sessions'), 'utf8'), 'primary + secondary authorization');
  assert.equal(fs.readFileSync(path.join(root, 'profile/flushed'), 'utf8'), 'yes');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
  const updater = new Updater({ version: '1.2.0', directory: path.join(root, 'profile/Updates'), publicKey: keys.publicKey, getSettings: () => ({}), executable: path.join(target, 'Contents/MacOS/Maxweb') });
  await updater.finishPending();
  assert.equal(fs.existsSync(path.join(root, 'profile/Updates/pending.json')), false);
  assert.equal(fs.readdirSync(path.dirname(target)).some(name => name.startsWith('.maxweb-update-')), false);
  console.log('PASS: signed archive downloaded, app replaced after process exit, new version launched, sessions retained, backup cleaned after successful startup');
}
main().then(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error); console.error('Fixture retained:', root); process.exit(1); });
