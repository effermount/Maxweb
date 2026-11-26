'use strict';
const path = require('node:path');

const APP_NAME = 'Обла';
const STORAGE_NAME = 'Maxweb';
function configureBrand(app, platform = process.platform) {
  // A new display name must not create a new profile or a second instance lock.
  // Explicit user-data-dir overrides (including tests) remain untouched.
  const current = app.getPath('userData');
  const defaultPath = path.join(app.getPath('appData'), app.getName());
  const storageName = platform === 'win32' ? APP_NAME : STORAGE_NAME;
  const profile = current === defaultPath ? path.join(app.getPath('appData'), storageName) : current;
  // Electron uses its internal name for macOS encryption keys. Changing it would
  // lose access to the saved code and encrypted cookies. The system bundle name
  // and its matching helpers use APP_NAME independently (scripts/after-pack.cjs).
  // Keep Chromium's User-Agent product token ASCII on Windows. Visible names
  // come from the executable resources and the UI, and remain «Обла».
  app.setName(platform === 'win32' ? 'Obla' : storageName);
  app.setPath('userData', profile);
}

module.exports = { APP_NAME, STORAGE_NAME, configureBrand };
