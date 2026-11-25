'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('maxwebShell', {
  notifications: (id, enabled) => ipcRenderer.invoke('accounts:notifications', id, enabled),
  collapse: value => ipcRenderer.invoke('shell:collapse', value),
  profileName: id => ipcRenderer.invoke('accounts:profile-name', id),
  lock: () => ipcRenderer.invoke('security:lock'),
  unlock: pin => ipcRenderer.invoke('security:unlock', pin),
  touchID: () => ipcRenderer.invoke('security:touch-id'),
  get: () => ipcRenderer.invoke('shell:get'),
  select: id => ipcRenderer.invoke('accounts:select', id),
  logout: id => ipcRenderer.invoke('accounts:logout', id),
  add: (service = 'max') => ipcRenderer.invoke('accounts:add', undefined, service),
  rename: (id, name) => ipcRenderer.invoke('accounts:rename', id, name),
  settings: () => ipcRenderer.invoke('shell:settings'),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('shell:state', listener);
    return () => ipcRenderer.removeListener('shell:state', listener);
  }
});

let lastActivity = 0;
for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) document.addEventListener(type, event => {
  if (event.isTrusted && Date.now() - lastActivity > 1000) { lastActivity = Date.now(); ipcRenderer.send('app:activity'); }
}, { capture: true, passive: true });
