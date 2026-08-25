'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('deskPet', {
  openCodex: () => ipcRenderer.invoke('pet:open-codex'),
  ask: (prompt, paths) => ipcRenderer.invoke('pet:ask', { prompt, paths }),
  getStatus: () => ipcRenderer.invoke('pet:get-status'),
  getSize: () => ipcRenderer.invoke('pet:get-size'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  hide: () => ipcRenderer.send('pet:hide'),
  setExpanded: (expanded) => ipcRenderer.send('pet:set-expanded', Boolean(expanded)),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', Boolean(ignore)),
  dragStart: (x, y) => ipcRenderer.send('pet:drag-start', { x, y }),
  dragMove: (x, y) => ipcRenderer.send('pet:drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  onMessage: (callback) => {
    ipcRenderer.on('pet:message', (_event, message) => callback(message));
  },
  onStatus: (callback) => {
    ipcRenderer.on('pet:status', (_event, status) => callback(status));
  },
  onSize: (callback) => {
    ipcRenderer.on('pet:size', (_event, size) => callback(size));
  },
  onOpenAsk: (callback) => {
    ipcRenderer.on('pet:open-ask', () => callback());
  }
});
