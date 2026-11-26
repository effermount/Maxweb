'use strict';
const fs = require('node:fs'), path = require('node:path');
const { createHash, sign } = require('node:crypto');
const { canonicalManifest } = require('../src/update-core.cjs');
const { releaseNotes } = require('./release-notes.cjs');
const root = path.resolve(__dirname, '..'), { version } = require('../package.json');
const directory = path.join(root, 'dist/windows');
const filename = `Obla-${version}-windows-x64.exe`;
const bytes = fs.readFileSync(path.join(directory, filename));
const manifest = { schema: 1, version, platform: 'win32', arch: 'x64', url: filename,
  size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  publishedAt: new Date().toISOString(), notes: releaseNotes(fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8'), version).slice(0, 12000) };
manifest.signature = sign(null, canonicalManifest(manifest), fs.readFileSync(path.join(root, '.release/signing-private.pem'))).toString('base64');
fs.writeFileSync(path.join(directory, 'latest-windows.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Signed Windows update manifest for ${version} is ready.`);
