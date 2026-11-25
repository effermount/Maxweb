'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sign, createHash } = require('node:crypto');
const { canonicalManifest } = require('../src/update-core.cjs');
const { releaseNotes } = require('./release-notes.cjs');
const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const dist = path.join(root, 'dist');
const filename = `Obla-${version}-universal.zip`;
const archive = path.join(dist, filename);
const appPath = path.join(dist, 'mac-universal/Maxweb.app');
for (const executable of ['Contents/MacOS/Maxweb', 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework']) {
  const slices = execFileSync('/usr/bin/lipo', ['-archs', path.join(appPath, executable)], { encoding: 'utf8' }).trim().split(/\s+/);
  if (!['arm64', 'x86_64'].every(arch => slices.includes(arch))) throw new Error('Universal-сборка должна содержать Intel и Apple Silicon.');
}
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archive], { stdio: 'inherit' });
const manifest = {
  schema: 1, version, platform: 'darwin', arch: 'universal', url: filename,
  size: fs.statSync(archive).size,
  sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
  publishedAt: new Date().toISOString(),
  notes: releaseNotes(fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8'), version).slice(0, 12000)
};
const key = fs.readFileSync(path.join(root, '.release/signing-private.pem'));
for (const [name, arch] of [['latest-mac.json', 'universal'], ['latest.json', 'arm64']]) {
  // The legacy manifest describes an ARM64-compatible update, using the same
  // Universal archive. Old clients validate arm64 in the manifest and in lipo.
  const description = { ...manifest, arch };
  description.signature = sign(null, canonicalManifest(description), key).toString('base64');
  fs.writeFileSync(path.join(dist, name), JSON.stringify(description, null, 2) + '\n');
}
console.log(`Release ${version}: ${filename}, latest-mac.json, legacy latest.json and DMG are ready locally.`);
