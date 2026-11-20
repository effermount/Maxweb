'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sign, createHash } = require('node:crypto');
const { canonicalManifest } = require('../src/update-core.cjs');
const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const dist = path.join(root, 'dist');
const filename = `Maxweb-${version}-apple-silicon.zip`;
const archive = path.join(dist, filename);
const appPath = path.join(dist, 'mac-arm64/Maxweb.app');
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archive], { stdio: 'inherit' });
const manifest = {
  schema: 1, version, platform: 'darwin', arch: 'arm64', url: filename,
  size: fs.statSync(archive).size,
  sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
  publishedAt: new Date().toISOString(),
  notes: 'Несколько аккаунтов в одном окне с сохранением авторизаций. Обновления через GitHub Releases. Автопрокрутка к отправленному сообщению.'
};
manifest.signature = sign(null, canonicalManifest(manifest), fs.readFileSync(path.join(root, '.release/signing-private.pem'))).toString('base64');
fs.writeFileSync(path.join(dist, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Release ${version}: ${filename}, latest.json and DMG are ready to upload to GitHub Releases.`);
