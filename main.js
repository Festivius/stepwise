const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

let mainWindow;

// Set up videos directory in userData
const videosDir = path.join(app.getPath('userData'), 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  console.log('📁 Created videos directory:', videosDir);
}

// Set environment variable for server
process.env.VIDEOS_DIR = videosDir;

// Start the Express server - FIXED PATH
const server = require('./src/server.js');
const PORT = 3001;

let serverInstance;

function startServer() {
  return new Promise((resolve, reject) => {
    try {
      serverInstance = server.listen(PORT, '127.0.0.1', () => {
        console.log(`🚀 Electron server running on port ${PORT}`);
        resolve();
      });
      
      serverInstance.on('error', (err) => {
        console.error('❌ Server error:', err);
        reject(err);
      });
    } catch (err) {
      console.error('❌ Failed to start server:', err);
      reject(err);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'stepwise-icon.png'),
    show: false
  });

  // Load the HTML file
  mainWindow.loadFile('src/index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('✅ Electron window ready');
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverInstance) {
      serverInstance.close();
    }
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// App event handlers
app.whenReady().then(async () => {
  try {
    console.log('🎬 Starting Stepwise Studio...');
    
    // Start the server first
    await startServer();
    
    // Create window
    createWindow();
    
    console.log('✅ Stepwise Studio ready!');
  } catch (err) {
    console.error('❌ Failed to start application:', err);
    dialog.showErrorBox('Startup Error', `Failed to start Stepwise Studio: ${err.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverInstance) {
      serverInstance.close();
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

// FIXED: Use server endpoint instead of direct API calls
ipcMain.handle('youtube-search', async (event, query) => {
  try {
    console.log('🔍 IPC: Searching YouTube via server for:', query);
    
    if (!query || query.trim().length === 0) {
      throw new Error('Search query is required');
    }

    // Use the local server instead of direct API calls
    const response = await axios.get(`http://127.0.0.1:${PORT}/youtube-search`, {
      params: { q: query.trim() },
      timeout: 15000
    });

    console.log('✅ IPC: Found', response.data.items?.length || 0, 'videos');
    return response.data;

  } catch (error) {
    console.error('❌ IPC YouTube search error:', error.response?.data || error.message);
    
    let errorMessage = 'Failed to search YouTube';
    
    if (error.response?.status === 403) {
      errorMessage = 'YouTube API quota exceeded or invalid key';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorMessage = 'Server connection failed';
    } else if (error.response?.data?.error) {
      errorMessage = error.response.data.error;
    }
    
    throw new Error(errorMessage);
  }
});

// FIXED: Use server endpoint for downloads
ipcMain.handle('download-video', async (event, videoId) => {
  try {
    console.log('⬇️ IPC: Starting download via server for video:', videoId);
    
    if (!videoId || videoId.trim().length === 0) {
      throw new Error('Video ID is required');
    }

    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    
    // Check if video already exists
    if (fs.existsSync(outputPath)) {
      console.log('✅ IPC: Video already cached:', videoId);
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        // Remove empty file
        fs.unlinkSync(outputPath);
        console.log('🗑️ Removed empty cached file');
      } else {
        const fileUrl = `file:///${path.resolve(outputPath).replace(/\\/g, '/')}`;
        console.log('🎥 IPC: Returning cached file URL:', fileUrl);
        return { url: fileUrl };
      }
    }

    console.log('📥 IPC: Requesting download from server');

    // Use the local server for download
    const response = await axios.get(`http://127.0.0.1:${PORT}/download`, {
      params: { id: videoId },
      timeout: 60000 // 60 second timeout for downloads
    });

    if (!response.data.url) {
      throw new Error('Server did not return a video URL');
    }

    console.log('✅ IPC: Server download completed for:', videoId);
    
    // Verify the file exists and has content
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        fs.unlinkSync(outputPath);
        throw new Error('Downloaded file is empty');
      }
      console.log(`🎥 IPC: File verified (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    }
    
    return response.data;

  } catch (error) {
    console.error('❌ IPC Download error for', videoId, ':', error.message);
    
    // Clean up any partial downloads
    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
        console.log('🗑️ Cleaned up partial download');
      } catch (cleanupError) {
        console.warn('⚠️ Could not clean up partial download:', cleanupError.message);
      }
    }
    
    let errorMessage = 'Failed to download video';
    
    if (error.response?.data?.error) {
      errorMessage = error.response.data.error;
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Server connection failed';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'No internet connection';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Download timeout - try again';
    }
    
    throw new Error(errorMessage);
  }
});

// Handle app errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  dialog.showErrorBox('Application Error', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Cleanup on exit
app.on('before-quit', () => {
  if (serverInstance) {
    serverInstance.close();
  }
});

console.log('📁 Videos will be stored in:', videosDir);
console.log('🎬 Stepwise Studio main process loaded');