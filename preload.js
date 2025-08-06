const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  youtubeSearch: (query) => ipcRenderer.invoke('youtube-search', query),
  downloadVideo: (videoId) => ipcRenderer.invoke('download-video', videoId),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Auto-updater events
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
  restartApp: () => ipcRenderer.send('restart-app'),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// Expose a flag to check if we're in Electron
contextBridge.exposeInMainWorld('isElectron', true);