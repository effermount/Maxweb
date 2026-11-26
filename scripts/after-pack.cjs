'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plist = require('plist');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
let authBinary;

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const contents = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents');
  const info = plist.parse(fs.readFileSync(path.join(contents, 'Info.plist'), 'utf8'));
  const frameworks = path.join(contents, 'Frameworks');
  // Electron resolves child processes using CFBundleName.
  for (const entry of fs.readdirSync(frameworks)) {
    if (!/^Maxweb Helper(?: \((?:GPU|Plugin|Renderer)\))?\.app$/.test(entry)) continue;
    const directory = path.join(frameworks, entry);
    const file = path.join(directory, 'Contents/Info.plist');
    const helper = plist.parse(fs.readFileSync(file, 'utf8'));
    const name = `${info.CFBundleName}${entry.slice('Maxweb'.length, -4)}`;
    fs.renameSync(path.join(directory, 'Contents/MacOS', helper.CFBundleExecutable), path.join(directory, 'Contents/MacOS', name));
    helper.CFBundleExecutable = helper.CFBundleName = helper.CFBundleDisplayName = name;
    fs.writeFileSync(file, plist.build(helper));
    fs.renameSync(directory, path.join(frameworks, `${name}.app`));
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'obla-touch-id-'));
  try {
    // One Universal binary is shared by the three packaging passes of this build.
    if (!authBinary) {
      const source = path.join(__dirname, 'touch-id.swift');
      const binaries = ['arm64', 'x86_64'].map(arch => {
        const file = path.join(temporary, arch);
        execFileSync('/usr/bin/xcrun', ['swiftc', source, '-O', '-target', `${arch}-apple-macosx13.0`, '-o', file]);
        return file;
      });
      const universal = path.join(temporary, 'universal');
      execFileSync('/usr/bin/lipo', ['-create', ...binaries, '-output', universal]);
      authBinary = fs.readFileSync(universal);
    }
    const helper = path.join(frameworks, 'Обла.app', 'Contents');
    fs.mkdirSync(path.join(helper, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(helper, 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(helper, 'MacOS/Обла'), authBinary, { mode: 0o755 });
    fs.copyFileSync(path.join(__dirname, '../assets/icon.icns'), path.join(helper, 'Resources/icon.icns'));
    fs.writeFileSync(path.join(helper, 'Info.plist'), plist.build({
      CFBundleIdentifier: 'local.maxweb.desktop.touchid', CFBundleName: 'Обла',
      CFBundleDisplayName: 'Обла', CFBundleExecutable: 'Обла', CFBundlePackageType: 'APPL',
      CFBundleVersion: info.CFBundleVersion, CFBundleShortVersionString: info.CFBundleShortVersionString,
      CFBundleIconFile: 'icon.icns', LSUIElement: true, LSMinimumSystemVersion: '13.0'
    }));
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', path.dirname(helper)]);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
};
