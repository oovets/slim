const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slimDesktop', {
  setZoom: (factor) => ipcRenderer.invoke('set-zoom', factor),
  openChromiumFallback: () => ipcRenderer.invoke('open-chromium-fallback'),
});
