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
  
  // yt-dlp management
  testYtDlp: () => ipcRenderer.invoke('test-ytdlp'),
  reinitializeYtDlp: () => ipcRenderer.invoke('reinitialize-ytdlp'),
  debugDownload: (videoId) => ipcRenderer.invoke('debug-download', videoId),
  
  // File operations
  cleanupVideos: () => ipcRenderer.invoke('cleanup-videos'),
  getVideoList: () => ipcRenderer.invoke('get-video-list'),

  // NEW: Enhanced preferences management
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  savePreferences: (preferences) => ipcRenderer.invoke('save-preferences', preferences),
  getPreference: (key) => ipcRenderer.invoke('get-preference', key),
  setPreference: (key, value) => ipcRenderer.invoke('set-preference', key, value),
  updatePreferences: (updates) => ipcRenderer.invoke('update-preferences', updates),
  
  // NEW: Session tracking
  getSessionTime: () => ipcRenderer.invoke('get-session-time'),
  saveSessionData: (data) => ipcRenderer.invoke('save-session-data', data),
  
  // NEW: Listen for app events
  onAutoSave: (callback) => ipcRenderer.on('auto-save-preferences', callback),
  onAppClosing: (callback) => ipcRenderer.on('app-closing', callback),

  // Clean up listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // Platform info
  platform: process.platform,
  isElectron: true
});