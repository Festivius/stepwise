const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const YTDlpWrap = require('yt-dlp-wrap').default;

let mainWindow;
let ytDlpWrap;

// Set up videos directory in userData
const videosDir = path.join(app.getPath('userData'), 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  console.log('📁 Created videos directory:', videosDir);
}

// Initialize yt-dlp-wrap
async function initializeYtDlp() {
  try {
    console.log('🔧 Initializing yt-dlp...');
    console.log('📦 App is packaged:', app.isPackaged);
    console.log('💻 Platform:', process.platform);
    console.log('🗂️ Process resources path:', process.resourcesPath);
    
    let binaryPath = null;
    
    if (app.isPackaged) {
      // Try different possible locations for bundled binary
      const possiblePaths = [
        path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'yt-dlp-wrap', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        path.join(app.getAppPath(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
      ];
      
      console.log('🔍 Searching for yt-dlp binary in paths:', possiblePaths);
      
      for (const testPath of possiblePaths) {
        console.log('🔍 Checking:', testPath);
        if (fs.existsSync(testPath)) {
          binaryPath = testPath;
          console.log('✅ Found yt-dlp binary at:', binaryPath);
          break;
        }
      }
      
      if (binaryPath) {
        // Make sure binary is executable on Unix systems
        if (process.platform !== 'win32') {
          try {
            const { execSync } = require('child_process');
            execSync(`chmod +x "${binaryPath}"`);
            console.log('✅ Made binary executable');
          } catch (chmodError) {
            console.warn('⚠️ Could not make binary executable:', chmodError.message);
          }
        }
        
        ytDlpWrap = new YTDlpWrap(binaryPath);
        console.log('✅ Using bundled yt-dlp binary');
      } else {
        console.log('⚠️ No bundled binary found, falling back to auto-download');
        // Create yt-dlp in app data directory
        const ytDlpDir = path.join(app.getPath('userData'), 'yt-dlp');
        if (!fs.existsSync(ytDlpDir)) {
          fs.mkdirSync(ytDlpDir, { recursive: true });
        }
        
        ytDlpWrap = new YTDlpWrap(undefined, ytDlpDir);
        console.log('⬇️ yt-dlp will auto-download to:', ytDlpDir);
      }
    } else {
      // In development, let it auto-download to project directory
      const ytDlpDir = path.join(__dirname, 'yt-dlp-bin');
      if (!fs.existsSync(ytDlpDir)) {
        fs.mkdirSync(ytDlpDir, { recursive: true });
      }
      
      ytDlpWrap = new YTDlpWrap(undefined, ytDlpDir);
      console.log('🔧 Development mode - yt-dlp will auto-download to:', ytDlpDir);
    }
    
    // Test the binary with retry logic
    let retries = 3;
    let version = null;
    
    while (retries > 0 && !version) {
      try {
        console.log(`🧪 Testing yt-dlp binary (attempt ${4 - retries}/3)...`);
        version = await ytDlpWrap.getVersion();
        console.log('✅ yt-dlp version:', version);
        break;
      } catch (testError) {
        console.warn(`⚠️ yt-dlp test failed (attempt ${4 - retries}/3):`, testError.message);
        retries--;
        
        if (retries > 0) {
          console.log('⏱️ Waiting 2 seconds before retry...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    if (!version) {
      throw new Error('Failed to initialize yt-dlp after 3 attempts');
    }
    
  } catch (error) {
    console.error('❌ Failed to initialize yt-dlp:', error.message);
    console.error('❌ Full error:', error);
    ytDlpWrap = null;
    
    // Show user-friendly error
    if (app.isReady()) {
      dialog.showErrorBox('yt-dlp Initialization Error', 
        `Failed to initialize video downloader:\n${error.message}\n\nTry restarting the application or check your internet connection.`
      );
    }
  }
}

console.log('🎬 Stepwise Studio starting...');
console.log('📁 Videos directory:', videosDir);

// Create menu
function createMenu() {
  const template = [
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow.reload();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
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
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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

  mainWindow.loadFile('src/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('✅ Electron window ready');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Utility functions
function getDiskSpace() {
  try {
    const files = fs.readdirSync(videosDir);
    return {
      exists: true,
      fileCount: files.length,
      videoFiles: files.filter(f => f.endsWith('.mp4')).length
    };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

function cleanupOldVideos() {
  try {
    const files = fs.readdirSync(videosDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    let cleaned = 0;
    files.forEach(file => {
      const filePath = path.join(videosDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          console.log('🗑️ Cleaned up old video:', file);
          cleaned++;
        }
      } catch (err) {
        console.warn('⚠️ Could not clean up file:', file, err.message);
      }
    });
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old video(s)`);
    }
  } catch (err) {
    console.error('❌ Cleanup error:', err.message);
  }
}

// IPC Handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

ipcMain.handle('get-health', () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    videosDir: fs.existsSync(videosDir),
    diskSpace: getDiskSpace(),
    isElectron: true,
    ytDlpReady: !!ytDlpWrap,
    isPackaged: app.isPackaged,
    platform: process.platform
  };
});

// Add handler to reinitialize yt-dlp if needed
ipcMain.handle('reinitialize-ytdlp', async () => {
  try {
    console.log('🔄 Manual yt-dlp reinitialization requested');
    await initializeYtDlp();
    return { success: !!ytDlpWrap, ready: !!ytDlpWrap };
  } catch (error) {
    console.error('❌ Manual yt-dlp reinitialization failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('youtube-search', async (event, query) => {
  try {
    console.log('🔍 Searching YouTube for:', query);

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

    console.log('✅ Found', response.data.items?.length || 0, 'videos');
    return response.data;

  } catch (error) {
    console.error('❌ YouTube API error:', error.response?.data || error.message);
    
    let errorMessage = 'Failed to search YouTube';
    
    if (error.response?.status === 403) {
      errorMessage = 'YouTube API quota exceeded or invalid key';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorMessage = 'No internet connection';
    } else if (error.response?.data?.error) {
      errorMessage = error.response.data.error.message || error.response.data.error;
    }
    
    throw new Error(errorMessage);
  }
});

ipcMain.handle('download-video', async (event, videoId) => {
  try {
    console.log('⬇️ Starting download for video:', videoId);
    
    if (!videoId || videoId.trim().length === 0) {
      throw new Error('Video ID is required');
    }

    // Check if yt-dlp is initialized, try to reinitialize if not
    if (!ytDlpWrap) {
      console.log('🔄 yt-dlp not initialized, attempting to reinitialize...');
      await initializeYtDlp();
      
      if (!ytDlpWrap) {
        throw new Error('yt-dlp initialization failed. Please restart the application.');
      }
    }

    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    
    // Check if video already exists
    if (fs.existsSync(outputPath)) {
      console.log('✅ Video already cached:', videoId);
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        fs.unlinkSync(outputPath);
        console.log('🗑️ Removed empty cached file');
      } else {
        const fileUrl = `file:///${path.resolve(outputPath).replace(/\\/g, '/')}`;
        console.log('🎥 Returning cached file URL:', fileUrl);
        return { url: fileUrl };
      }
    }

    // First, let's get video info to check if it's available
    console.log('📊 Getting video info...');
    try {
      const infoOptions = [
        '--dump-json',
        '--no-warnings',
        `https://www.youtube.com/watch?v=${videoId}`
      ];
      
      const infoResult = await ytDlpWrap.exec(infoOptions);
      console.log('✅ Video info retrieved successfully');
    } catch (infoError) {
      console.error('❌ Video info error:', infoError.message);
      throw new Error(`Video not available: ${infoError.message}`);
    }

    // Download with yt-dlp-wrap with better error handling
    console.log('🎬 Starting video download...');
    const downloadOptions = [
      '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--max-filesize', '50M',
      '--socket-timeout', '30',
      '--retries', '2',
      '--fragment-retries', '2',
      '--no-warnings',
      '--no-playlist',
      '--ignore-errors',
      '--progress',
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    console.log('📋 Download command:', downloadOptions.join(' '));
    
    // Create a proper promise that waits for the download to complete
    const downloadPromise = new Promise((resolve, reject) => {
      let downloadOutput = '';
      let errorOutput = '';
      
      try {
        const process = ytDlpWrap.exec(downloadOptions);
        
        // Handle stdout for progress info
        if (process.ytDlpProcess && process.ytDlpProcess.stdout) {
          process.ytDlpProcess.stdout.on('data', (data) => {
            const output = data.toString();
            downloadOutput += output;
            console.log('📥 yt-dlp progress:', output.trim());
          });
        }
        
        // Handle stderr for errors
        if (process.ytDlpProcess && process.ytDlpProcess.stderr) {
          process.ytDlpProcess.stderr.on('data', (data) => {
            const output = data.toString();
            errorOutput += output;
            console.error('⚠️ yt-dlp stderr:', output.trim());
          });
        }
        
        // Handle process completion
        if (process.ytDlpProcess) {
          process.ytDlpProcess.on('close', (code) => {
            console.log('🏁 yt-dlp process closed with code:', code);
            
            if (code === 0) {
              resolve({ success: true, output: downloadOutput });
            } else {
              reject(new Error(`yt-dlp exited with code ${code}. Error: ${errorOutput || 'Unknown error'}`));
            }
          });
          
          process.ytDlpProcess.on('error', (error) => {
            console.error('❌ yt-dlp process error:', error);
            reject(error);
          });
        } else {
          // Fallback for when process structure is different
          setTimeout(() => {
            if (fs.existsSync(outputPath)) {
              resolve({ success: true, output: downloadOutput });
            } else {
              reject(new Error('Download process completed but no file was created'));
            }
          }, 10000); // Wait up to 10 seconds
        }
        
      } catch (error) {
        reject(error);
      }
    });
    
    try {
      const result = await downloadPromise;
      console.log('✅ Download completed successfully:', result);
    } catch (downloadError) {
      console.error('❌ yt-dlp download error:', downloadError.message);
      
      // More specific error handling
      const errorMsg = downloadError.message.toLowerCase();
      if (errorMsg.includes('private video') || errorMsg.includes('private')) {
        throw new Error('This video is private or unavailable');
      } else if (errorMsg.includes('video unavailable') || errorMsg.includes('unavailable')) {
        throw new Error('Video is unavailable or has been removed');
      } else if (errorMsg.includes('sign in to confirm') || errorMsg.includes('age')) {
        throw new Error('Video requires age verification');
      } else if (errorMsg.includes('too large') || errorMsg.includes('filesize')) {
        throw new Error('Video file is too large (>50MB)');
      } else if (errorMsg.includes('timeout') || errorMsg.includes('network')) {
        throw new Error('Download timeout - check your internet connection');
      } else if (errorMsg.includes('format') || errorMsg.includes('no video formats')) {
        throw new Error('No suitable video format available for this video');
      } else {
        throw new Error(`Download failed: ${downloadError.message}`);
      }
    }

    // Wait a bit more for file system to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify file was created and has content
    if (!fs.existsSync(outputPath)) {
      console.error('❌ Video file not found at:', outputPath);
      
      // Check if there are any files in the directory that might be our video
      const files = fs.readdirSync(videosDir);
      console.log('📁 Files in videos directory:', files);
      
      // Look for files that might be our video (partial downloads, etc.)
      const possibleFiles = files.filter(f => f.includes(videoId));
      console.log('🔍 Possible video files:', possibleFiles);
      
      throw new Error('Video file not created - download may have failed');
    }

    const stats = fs.statSync(outputPath);
    console.log('📊 File stats:', {
      size: stats.size,
      sizeKB: Math.round(stats.size / 1024),
      sizeMB: Math.round(stats.size / 1024 / 1024)
    });
    
    if (stats.size === 0) {
      fs.unlinkSync(outputPath);
      throw new Error('Downloaded video file is empty');
    }

    // Minimum file size check (1KB)
    if (stats.size < 1024) {
      fs.unlinkSync(outputPath);
      throw new Error('Downloaded file is too small - likely an error file');
    }

    console.log('✅ Download completed:', videoId, `(${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    
    const fileUrl = `file:///${path.resolve(outputPath).replace(/\\/g, '/')}`;
    console.log('🎥 Final file URL:', fileUrl);
    return { url: fileUrl };

  } catch (error) {
    console.error('❌ Download failed for', videoId, error.message);
    console.error('❌ Full error stack:', error.stack);
    
    // Clean up partial file
    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    if (fs.existsSync(outputPath)) {
      try {
        const stats = fs.statSync(outputPath);
        console.log('🗑️ Cleaning up partial file:', stats.size, 'bytes');
        fs.unlinkSync(outputPath);
      } catch (cleanupError) {
        console.warn('⚠️ Could not clean up partial download:', cleanupError.message);
      }
    }
    
    // Re-throw the original error message
    throw error;
  }
});

ipcMain.handle('cleanup-videos', () => {
  cleanupOldVideos();
  return { success: true };
});

ipcMain.handle('get-video-list', () => {
  try {
    const files = fs.readdirSync(videosDir);
    const videos = files
      .filter(f => f.endsWith('.mp4'))
      .map(file => {
        const filePath = path.join(videosDir, file);
        const stats = fs.statSync(filePath);
        return {
          id: path.basename(file, '.mp4'),
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      });
    
    return videos;
  } catch (err) {
    console.error('❌ Error getting video list:', err);
    return [];
  }
});

// App event handlers
app.whenReady().then(async () => {
  try {
    console.log('🎬 Starting Stepwise Studio...');
    
    // Initialize yt-dlp
    await initializeYtDlp();
    
    // Create window
    createWindow();
    
    // Create menu
    createMenu();
    
    // Run cleanup every hour
    setInterval(cleanupOldVideos, 60 * 60 * 1000);
    
    console.log('✅ Stepwise Studio ready!');
  } catch (err) {
    console.error('❌ Failed to start application:', err);
    dialog.showErrorBox('Startup Error', `Failed to start Stepwise Studio: ${err.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
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

console.log('📁 Videos will be stored in:', videosDir);
console.log('🎬 Stepwise Studio main process loaded');