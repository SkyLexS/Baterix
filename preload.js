const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  get: () => ipcRenderer.invoke('get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  setThreshold: (id, v) => ipcRenderer.invoke('threshold:set', id, v),
  discoverRun: () => ipcRenderer.invoke('discover:run'),
  discoverAnalyze: (hint) => ipcRenderer.invoke('discover:analyze', hint),
  discoverSave: (ci, ki) => ipcRenderer.invoke('discover:save', ci, ki),
  copyText: (t) => ipcRenderer.invoke('clipboard:write', t),
  onDiscovery: (cb) => ipcRenderer.on('discovery', (_, d) => cb(d)),
  testNotification: () => ipcRenderer.invoke('notify:test'),
  onDevices: (cb) => ipcRenderer.on('devices', (_, d) => cb(d)),
});