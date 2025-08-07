const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Dialogs
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  
  // Health check
  getHealth: () => ipcRenderer.invoke('get-health'),
  
  // YouTube operations
  youtubeSearch: (query) => ipcRenderer.invoke('youtube-search', query),
  downloadVideo: (videoId) => ipcRenderer.invoke('download-video', videoId),
  
  // File operations
  cleanupVideos: () => ipcRenderer.invoke('cleanup-videos'),
  getVideoList: () => ipcRenderer.invoke('get-video-list'),
  
  // Platform info
  platform: process.platform,
  isElectron: true
});