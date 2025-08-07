const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const express = require('express'); // Add this import
const cors = require('cors'); // Add this import if you have it

// Add to your main.js after the existing imports
const { autoUpdater } = require('electron-updater');

// Configure auto-updater
autoUpdater.checkForUpdatesAndNotify();
autoUpdater.autoDownload = false; // Don't auto-download, ask user first

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('🔍 Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('✅ Update available:', info.version);
  
  // Show dialog to user
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Available',
    message: `A new version (${info.version}) is available!`,
    detail: 'Would you like to download and install it?',
    buttons: ['Download Update', 'Later'],
    defaultId: 0
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.downloadUpdate();
      
      // Show download progress (optional)
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Downloading Update',
        message: 'Downloading update... The app will restart when ready.',
        buttons: ['OK']
      });
    }
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('✅ App is up to date');
});

autoUpdater.on('error', (err) => {
  console.error('❌ Auto-updater error:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  let log_message = `Download speed: ${progressObj.bytesPerSecond}`;
  log_message = log_message + ` - Downloaded ${progressObj.percent}%`;
  log_message = log_message + ` (${progressObj.transferred}/${progressObj.total})`;
  console.log('⬇️ Update progress:', log_message);
});

autoUpdater.on('update-downloaded', () => {
  console.log('✅ Update downloaded');
  
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: 'Update downloaded. The application will restart to apply the update.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

// Add menu item for manual update check
function createMenu() {
  const template = [
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => {
            autoUpdater.checkForUpdatesAndNotify();
          }
        },
        {
          label: 'About Stepwise Studio',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Stepwise Studio',
              message: `Stepwise Studio v${app.getVersion()}`,
              detail: 'Precision • Dance • Control'
            });
          }
        }
      ]
    }
  ];
  
  const menu = require('electron').Menu.buildFromTemplate(template);
  require('electron').Menu.setApplicationMenu(menu);
}

let mainWindow;

// Set up videos directory in userData
const videosDir = path.join(app.getPath('userData'), 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  console.log('📁 Created videos directory:', videosDir);
}

// Set environment variable for server
process.env.VIDEOS_DIR = videosDir;

// Create Express server instance - THIS WAS MISSING!
const server = express();
server.use(express.json());
server.use(cors()); // Enable CORS if you have the cors package

// Add your server routes here
server.get('/youtube-search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Add your YouTube search logic here
    // This is a placeholder - you'll need to implement the actual search
    console.log('🔍 Searching YouTube for:', query);
    
    // For now, return empty results
    res.json({ items: [] });
    
  } catch (error) {
    console.error('❌ YouTube search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

server.get('/download', async (req, res) => {
  try {
    const videoId = req.query.id;
    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    // Add your video download logic here
    console.log('⬇️ Downloading video:', videoId);
    
    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    
    // This is a placeholder - you'll need to implement the actual download
    // For now, return a mock response
    res.json({ 
      url: `file:///${path.resolve(outputPath).replace(/\\/g, '/')}`,
      message: 'Download completed'
    });
    
  } catch (error) {
    console.error('❌ Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Start the Express server
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
    
    // Create menu
    createMenu();
    
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