'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('deskPet', {
  openCodex: () => ipcRenderer.invoke('pet:open-codex'),
  ask: (prompt, paths, conversationId, history) => ipcRenderer.invoke('pet:ask', {
    prompt,
    paths,
    conversationId,
    history
  }),
  stop: () => ipcRenderer.invoke('pet:stop'),
  newConversation: (conversationId) => ipcRenderer.invoke('pet:new-conversation', conversationId),
  captureScreen: () => ipcRenderer.invoke('pet:capture-screen'),
  captureRegion: () => ipcRenderer.invoke('pet:capture-region'),
  selectFiles: () => ipcRenderer.invoke('pet:select-files'),
  copyText: (text) => ipcRenderer.invoke('pet:copy-text', text),
  getStatus: () => ipcRenderer.invoke('pet:get-status'),
  getSize: () => ipcRenderer.invoke('pet:get-size'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  hide: () => ipcRenderer.send('pet:hide'),
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
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
  },
  onWake: (callback) => {
    ipcRenderer.on('pet:wake', (_event, payload) => callback(payload));
  },
  onPlayMotion: (callback) => {
    ipcRenderer.on('pet:play-motion', (_event, motion) => callback(motion));
  },
  onSnapState: (callback) => {
    ipcRenderer.on('pet:snap-state', (_event, state) => callback(state));
  }
});
