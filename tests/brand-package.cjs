'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');
const { verifyManifest } = require('../src/update-core.cjs');
const root = path.resolve(__dirname, '..'), { version } = require('../package.json');
const app = path.join(root, 'dist/mac-universal/Maxweb.app'), contents = path.join(app, 'Contents');
const plist = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, path.join(contents, 'Info.plist')], { encoding: 'utf8' }).trim();
assert.equal(plist('CFBundleIdentifier'), 'local.maxweb.desktop');
assert.equal(plist('CFBundleName'), 'Обла', 'System menus must use the current bundle name');
assert.equal(plist('CFBundleExecutable'), 'Maxweb', 'Preserve the executable path for Keychain and old installers');
for (const suffix of ['', ' (Renderer)', ' (GPU)', ' (Plugin)']) {
  const helper = `Обла Helper${suffix}`;
  assert(fs.existsSync(path.join(contents, 'Frameworks', `${helper}.app`, 'Contents/MacOS', helper)), `Electron must find ${helper}`);
}
assert.equal(plist('CFBundleShortVersionString'), version);
const display = execFileSync('/usr/bin/swift', ['-e', 'import Foundation; print(FileManager.default.displayName(atPath:CommandLine.arguments[1]))', app], { encoding: 'utf8' }).trim();
assert.equal(display, 'Обла', 'Finder must display the current brand');
assert.equal(plist('CFBundleDisplayName'), 'Maxweb', 'Preserve native Keychain compatibility');
for (const name of ['MacOS/Maxweb', 'Frameworks/Electron Framework.framework/Versions/A/Electron Framework']) {
  const slices = execFileSync('/usr/bin/lipo', ['-archs', path.join(contents, name)], { encoding: 'utf8' });
  assert(slices.includes('arm64') && slices.includes('x86_64'));
}
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const bundle = path.join(contents, 'Resources/app.asar');
for (const file of ['src/brand.cjs', 'src/ui/shell.html', 'src/ui/settings.html', 'src/main.cjs', 'src/update-core.cjs', 'src/updater.cjs', 'src/windows-updater.cjs', 'src/touch-id.cjs', 'assets/icon.png', 'assets/trayTemplate.png']) {
  assert(asar.extractFile(bundle, file).equals(fs.readFileSync(path.join(root, file))), `${file} must match the final source`);
}
for (const language of ['ru', 'en']) assert.match(fs.readFileSync(path.join(contents, `Resources/${language}.lproj/InfoPlist.strings`), 'utf8'), /CFBundleDisplayName = "Обла"/);
const modern = JSON.parse(fs.readFileSync(path.join(root, 'dist/latest-mac.json'))), legacy = JSON.parse(fs.readFileSync(path.join(root, 'dist/latest.json')));
const key = fs.readFileSync(path.join(root, 'assets/release-public.pem'));
const base = `https://github.com/effermount/Maxweb/releases/download/v${version}/`;
for (const arch of ['arm64', 'x64']) verifyManifest(modern, key, base + 'latest-mac.json', { arch });
verifyManifest(legacy, key, base + 'latest.json', { arch: 'arm64' });
assert.equal(modern.arch, 'universal'); assert.equal(legacy.arch, 'arm64');
assert.equal(modern.url, `Obla-${version}-universal.zip`);
assert(!modern.notes.includes('## Maxweb'), 'Update prompt must not include old release history');
const bytes = fs.readFileSync(path.join(root, 'dist', modern.url)), hash = createHash('sha256').update(bytes).digest('hex');
for (const manifest of [modern, legacy]) { assert.equal(manifest.version, version); assert.equal(manifest.sha256, hash); assert.equal(manifest.size, bytes.length); }
const dmg = path.join(root, 'dist', `Obla-${version}-universal.dmg`);
assert(fs.statSync(dmg).size > 0);
console.log(`PASS: Обла ${version}, system display name, legacy filename and storage identity, Universal slices, code signature and compatible signed update archives`);
console.log(`DMG: ${(fs.statSync(dmg).size / 1e6).toFixed(1)} MB`);
