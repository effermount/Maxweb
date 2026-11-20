'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Updater } = require('../src/updater.cjs');
const root = process.argv[2];
const updater = new Updater({
  version: '1.0.0', directory: path.join(root, 'profile/Updates'), publicKey: fs.readFileSync(path.join(root, 'public.pem')),
  getSettings: () => ({}), packaged: true, executable: path.join(root, 'installed/Maxweb.app/Contents/MacOS/Maxweb'), bundleId: 'local.maxweb.qa.updater',
  beforeInstall: async () => fs.writeFileSync(path.join(root, 'profile/flushed'), 'yes'), quit: () => process.exit(0)
});
(async () => { await updater.check(pathToFileURL(path.join(root, 'releases/latest.json'))); await updater.download(); await updater.install(); })().catch(error => { console.error(error); process.exit(1); });
