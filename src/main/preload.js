'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  saveTask: (input) => ipcRenderer.invoke('task:save', input),
  toggleTask: (id) => ipcRenderer.invoke('task:toggle', id),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),
  restoreTask: (snap) => ipcRenderer.invoke('task:restore', snap),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setSize: (width, height) => ipcRenderer.send('window:size', { width, height }),
  googleSignIn: () => ipcRenderer.invoke('google:signIn'),
  googleSignOut: () => ipcRenderer.invoke('google:signOut'),
  googleSync: () => ipcRenderer.invoke('google:sync'),
  exportTasks: () => ipcRenderer.invoke('backup:export'),
  importTasks: () => ipcRenderer.invoke('backup:import'),
  hide: () => ipcRenderer.invoke('app:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openRepo: () => ipcRenderer.invoke('app:openRepo'),
  getReminder: () => ipcRenderer.invoke('reminder:get'),
  reminderAction: (action) => ipcRenderer.invoke('reminder:act', action),
});
