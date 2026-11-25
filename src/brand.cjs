'use strict';
const path = require('node:path');

const APP_NAME = 'Обла';
const STORAGE_NAME = 'Maxweb';
function configureBrand(app) {
  // A new display name must not create a new profile or a second instance lock.
  // Explicit user-data-dir overrides (including tests) remain untouched.
  const current = app.getPath('userData');
  const defaultPath = path.join(app.getPath('appData'), app.getName());
  const profile = current === defaultPath ? path.join(app.getPath('appData'), STORAGE_NAME) : current;
  // Electron uses its internal name for macOS encryption keys. Changing it would
  // lose access to the saved code and encrypted cookies. UI and localized bundle
  // display names use APP_NAME independently.
  app.setName(STORAGE_NAME);
  app.setPath('userData', profile);
}

module.exports = { APP_NAME, STORAGE_NAME, configureBrand };
