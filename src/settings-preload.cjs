'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('maxweb', {
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
  onUpdate: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:state', listener);
    return () => ipcRenderer.removeListener('updates:state', listener);
  }
});
