'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('maxwebShell', {
  get: () => ipcRenderer.invoke('shell:get'),
  select: id => ipcRenderer.invoke('accounts:select', id),
  add: name => ipcRenderer.invoke('accounts:add', name),
  rename: (id, name) => ipcRenderer.invoke('accounts:rename', id, name),
  settings: () => ipcRenderer.invoke('shell:settings'),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('shell:state', listener);
    return () => ipcRenderer.removeListener('shell:state', listener);
  }
});
