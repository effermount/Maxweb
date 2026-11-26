'use strict';
const { build } = require('./package.json');
module.exports = {
  ...build,
  productName: 'Обла',
  artifactName: 'Obla-${version}-windows-${arch}.${ext}',
  directories: { ...build.directories, output: 'dist/windows' },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }],
    icon: 'assets/icon.ico', executableName: 'Obla',
    signExecutable: false,
    requestedExecutionLevel: 'asInvoker'
  },
  nsis: {
    oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    shortcutName: 'Обла', deleteAppDataOnUninstall: false,
    installerLanguages: ['ru_RU', 'en_US'], runAfterFinish: true
  }
};
