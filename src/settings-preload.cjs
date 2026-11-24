'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('maxweb', {
  banner: value => ipcRenderer.invoke('settings:banner', value),
  security: value => ipcRenderer.invoke('settings:security', value),
  lock: () => ipcRenderer.invoke('settings:lock'),
  get: () => ipcRenderer.invoke('settings:get'),
  notifications: enabled => ipcRenderer.invoke('settings:notifications', enabled),
  login: enabled => ipcRenderer.invoke('settings:login', enabled),
  test: () => ipcRenderer.invoke('settings:test'),
  system: () => ipcRenderer.invoke('settings:system'),
  open: () => ipcRenderer.invoke('settings:open'),
  updateConfigure: (repository, autoCheck) => ipcRenderer.invoke('updates:configure', repository, autoCheck),
  updateCheck: () => ipcRenderer.invoke('updates:check'),
  updateDownload: () => ipcRenderer.invoke('updates:download'),
  updateInstall: () => ipcRenderer.invoke('updates:install'),
  onLock: callback => ipcRenderer.on('security:locked', () => callback()),
  onUpdate: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:state', listener);
    return () => ipcRenderer.removeListener('updates:state', listener);
  }
});

let lastActivity = 0;
for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) document.addEventListener(type, event => {
  if (event.isTrusted && Date.now() - lastActivity > 1000) { lastActivity = Date.now(); ipcRenderer.send('app:activity'); }
}, { capture: true, passive: true });
