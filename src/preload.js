'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskPet', {
  openCodex: () => ipcRenderer.invoke('pet:open-codex'),
  hide: () => ipcRenderer.send('pet:hide'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', Boolean(ignore)),
  dragStart: (x, y) => ipcRenderer.send('pet:drag-start', { x, y }),
  dragMove: (x, y) => ipcRenderer.send('pet:drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  onMessage: (callback) => {
    ipcRenderer.on('pet:message', (_event, message) => callback(message));
  }
});
