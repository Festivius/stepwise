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
      preload: path.join(__dirname, 'preload.js') // FIXED: preload.js is in root, not src
    },
    icon: path.join(__dirname, 'assets', 'stepwise-icon.png'), // FIXED: Use correct icon name
    show: false
  });

  // Load the HTML file - FIXED PATH
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

// FIXED: YouTube Search IPC Handler
ipcMain.handle('youtube-search', async (event, query) => {
  try {
    console.log('🔍 IPC: Searching YouTube for:', query);
    
    if (!query || query.trim().length === 0) {
      throw new Error('Search query is required');
    }

    const response = await axios.get(
      'https://www.googleapis.com/youtube/v3/search',
      {
        params: {
          part: 'snippet',
          type: 'video',
          maxResults: 12,
          q: query.trim() + ' dance tutorial',
          key: 'AIzaSyA-2tVSmZeH84nMPSagvzmR6LU-LK9DlP4',
          safeSearch: 'strict'
        },
        timeout: 15000
      }
    );

    console.log('✅ IPC: Found', response.data.items?.length || 0, 'videos');
    return response.data;

  } catch (error) {
    console.error('❌ IPC YouTube search error:', error.response?.data || error.message);
    
    // Create user-friendly error messages
    let errorMessage = 'Failed to search YouTube';
    
    if (error.response?.status === 403) {
      errorMessage = 'YouTube API quota exceeded or invalid key';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorMessage = 'No internet connection';
    } else if (error.response?.data?.error?.message) {
      errorMessage = error.response.data.error.message;
    }
    
    throw new Error(errorMessage);
  }
});

// FIXED: Video Download IPC Handler
ipcMain.handle('download-video', async (event, videoId) => {
  try {
    console.log('⬇️ IPC: Starting download for video:', videoId);
    
    if (!videoId || videoId.trim().length === 0) {
      throw new Error('Video ID is required');
    }

    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    
    // Check if video already exists
    if (fs.existsSync(outputPath)) {
      console.log('✅ IPC: Video already cached:', videoId);
      const absolutePath = path.resolve(outputPath);
      const fileUrl = `file:///${absolutePath.replace(/\\/g, '/')}`;
      console.log('🎥 IPC: Returning file URL:', fileUrl);
      return { url: fileUrl };
    }

    console.log('📥 IPC: Downloading new video to:', outputPath);

    // Use youtube-dl-exec for downloading
    const ytDlp = require('youtube-dl-exec');
    
    // Validate youtube-dl-exec installation
    if (!ytDlp) {
      throw new Error('youtube-dl-exec not installed. Run: npm install youtube-dl-exec');
    }

    await ytDlp(`https://www.youtube.com/watch?v=${videoId}`, {
      format: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
      mergeOutputFormat: 'mp4',
      output: outputPath,
      maxFilesize: '100M',
      socketTimeout: 30,
      retries: 3,
      noWarnings: true
    });

    // Verify file was created and has content
    if (!fs.existsSync(outputPath)) {
      throw new Error('Video file was not created - download may have failed');
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      // Clean up empty file
      fs.unlinkSync(outputPath);
      throw new Error('Downloaded video file is empty - video may be unavailable');
    }

    console.log('✅ IPC: Download completed:', videoId, `(${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    
    const absolutePath = path.resolve(outputPath);
    const fileUrl = `file:///${absolutePath.replace(/\\/g, '/')}`;
    console.log('🎥 IPC: Returning file URL:', fileUrl);
    
    return { url: fileUrl };

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
    
    // Create user-friendly error messages
    let errorMessage = 'Failed to download video';
    
    if (error.message.includes('youtube-dl')) {
      errorMessage = 'Video downloader not available. Please restart the app.';
    } else if (error.message.includes('HTTP 403') || error.message.includes('Sign in to confirm')) {
      errorMessage = 'Video is age-restricted or private';
    } else if (error.message.includes('HTTP 404') || error.message.includes('not available')) {
      errorMessage = 'Video not found or unavailable';
    } else if (error.message.includes('format')) {
      errorMessage = 'No suitable video format available';
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