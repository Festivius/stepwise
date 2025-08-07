const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { spawn } = require('child_process');

let mainWindow;
let ytDlpPath = null;

// Set up videos directory in userData
const videosDir = path.join(app.getPath('userData'), 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  console.log('📁 Created videos directory:', videosDir);
}

// Initialize yt-dlp with bundled executable
async function initializeYtDlp() {
  try {
    console.log('🔧 Initializing bundled yt-dlp...');
    console.log('📦 App is packaged:', app.isPackaged);
    console.log('💻 Platform:', process.platform);
    
    let binaryName;
    
    // Determine binary name based on platform
    if (process.platform === 'win32') {
      binaryName = 'yt-dlp.exe';
    } else if (process.platform === 'darwin') {
      binaryName = 'yt-dlp-macos';
    } else {
      binaryName = 'yt-dlp-linux';
    }
    
    if (app.isPackaged) {
      ytDlpPath = path.join(process.resourcesPath, 'binaries', binaryName);
    } else {
      ytDlpPath = path.join(__dirname, 'binaries', binaryName);
    }
    
    console.log('🔍 Looking for yt-dlp at:', ytDlpPath);
    
    if (!fs.existsSync(ytDlpPath)) {
      throw new Error(`yt-dlp binary not found at: ${ytDlpPath}`);
    }
    
    // Check file size to ensure it's not corrupted
    const stats = fs.statSync(ytDlpPath);
    console.log('📊 Binary file size:', stats.size, 'bytes');
    if (stats.size < 1000000) { // Less than 1MB is suspicious
      console.warn('⚠️ Binary file seems too small, might be corrupted');
    }
    
    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      const { execSync } = require('child_process');
      try {
        execSync(`chmod +x "${ytDlpPath}"`);
        console.log('✅ Made binary executable');
      } catch (e) {
        console.warn('⚠️ Could not make binary executable:', e.message);
      }
    }
    
    // Test the binary with improved error handling
    const testResult = await testYtDlp();
    if (testResult.success) {
      console.log('✅ yt-dlp ready at:', ytDlpPath);
      return true;
    } else {
      console.warn('⚠️ yt-dlp test failed, but continuing:', testResult.error);
      return true;
    }
    
  } catch (error) {
    console.error('❌ Failed to initialize yt-dlp:', error.message);
    ytDlpPath = null;
    
    if (app.isReady()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'yt-dlp Warning',
        message: 'Video downloader may not work properly',
        detail: `Warning: ${error.message}\n\nThe app will still work, but video downloads might fail.`,
        buttons: ['OK']
      });
    }
    return false;
  }
}

// Test yt-dlp binary
function testYtDlp() {
  return new Promise((resolve) => {
    console.log('🧪 Testing yt-dlp binary...');
    
    const testProcess = spawn(ytDlpPath, ['--version'], { 
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000
    });
    
    let output = '';
    let errorOutput = '';
    let resolved = false;
    
    testProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    testProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    testProcess.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      
      if (code === 0 && output.trim()) {
        console.log('✅ yt-dlp version:', output.trim());
        resolve({ success: true, version: output.trim() });
      } else {
        console.warn('⚠️ yt-dlp test returned code:', code, 'stderr:', errorOutput);
        resolve({ success: false, error: `Exit code ${code}: ${errorOutput}` });
      }
    });
    
    testProcess.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      console.warn('⚠️ Process error during test:', error.message);
      resolve({ success: false, error: `Process error: ${error.message}` });
    });
    
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      console.warn('⚠️ yt-dlp test timeout after 15 seconds');
      testProcess.kill('SIGTERM');
      resolve({ success: false, error: 'Test timeout after 15 seconds' });
    }, 15000);
  });
}

console.log('🎬 Stepwise Studio starting...');
console.log('📁 Videos directory:', videosDir);

// Create menu with debug options
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
      label: 'Tools',
      submenu: [
        {
          label: 'Debug Download',
          click: async () => {
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: 'Debug Download',
              message: 'Enter a YouTube video ID to test download',
              detail: 'Example: dQw4w9WgXcQ (from https://youtube.com/watch?v=dQw4w9WgXcQ)',
              buttons: ['Cancel', 'Test'],
              defaultId: 1
            });
            
            if (result.response === 1) {
              // Simple prompt simulation - in production you'd want a proper input dialog
              const testVideoId = 'dQw4w9WgXcQ'; // Rick Roll for testing
              console.log('🧪 Testing download with video ID:', testVideoId);
              
              try {
                const downloadResult = await debugDownload(testVideoId);
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Debug Download Result',
                  message: 'Download test completed successfully',
                  detail: `File: ${downloadResult.url}`
                });
              } catch (error) {
                dialog.showMessageBox(mainWindow, {
                  type: 'error',
                  title: 'Debug Download Failed',
                  message: 'Download test failed',
                  detail: error.message
                });
              }
            }
          }
        },
        {
          label: 'Test yt-dlp',
          click: async () => {
            if (!ytDlpPath) {
              dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'yt-dlp Not Found',
                message: 'yt-dlp binary is not initialized'
              });
              return;
            }
            
            const result = await testYtDlp();
            dialog.showMessageBox(mainWindow, {
              type: result.success ? 'info' : 'warning',
              title: 'yt-dlp Test Result',
              message: result.success ? 'yt-dlp is working correctly' : 'yt-dlp test failed',
              detail: result.error || result.version || 'Binary is ready for downloads'
            });
          }
        },
        {
          label: 'Check Videos Folder',
          click: () => {
            const { shell } = require('electron');
            shell.openPath(videosDir);
          }
        },
        {
          label: 'Reinitialize yt-dlp',
          click: async () => {
            console.log('🔄 Reinitializing yt-dlp...');
            const success = await initializeYtDlp();
            dialog.showMessageBox(mainWindow, {
              type: success ? 'info' : 'error',
              title: 'Reinitialization Result',
              message: success ? 'yt-dlp reinitialized successfully' : 'Failed to reinitialize yt-dlp',
              detail: `Binary path: ${ytDlpPath || 'Not found'}`
            });
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

// Debug download function with detailed logging
async function debugDownload(videoId) {
  console.log('🐛 DEBUG: Starting debug download for:', videoId);
  console.log('🐛 DEBUG: ytDlpPath:', ytDlpPath);
  console.log('🐛 DEBUG: videosDir:', videosDir);
  
  if (!ytDlpPath) {
    throw new Error('yt-dlp path is null or undefined');
  }
  
  if (!fs.existsSync(ytDlpPath)) {
    throw new Error(`yt-dlp binary does not exist at: ${ytDlpPath}`);
  }
  
  const outputPath = path.join(videosDir, `debug_${videoId}.mp4`);
  console.log('🐛 DEBUG: outputPath:', outputPath);
  
  return new Promise((resolve, reject) => {
    // UPDATED ARGS - Add authentication bypass and format selection
    const args = [
      '--verbose',
      '--no-check-certificates',
      '--extractor-args', 'youtube:player_client=android',  // Use Android client
      '--user-agent', 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
      '-f', 'best[height<=480][ext=mp4]/best[ext=mp4]/best',  // Fallback format selection
      '--max-filesize', '10M',
      '--socket-timeout', '30',
      '--retries', '3',
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    
    console.log('🐛 DEBUG: Command:', ytDlpPath);
    console.log('🐛 DEBUG: Args:', args.join(' '));
    
    const process = spawn(ytDlpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('🐛 STDOUT:', output.trim());
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('🐛 STDERR:', output.trim());
    });
    
    process.on('close', (code) => {
      console.log('🐛 DEBUG: Process closed with code:', code);
      console.log('🐛 DEBUG: Final stdout:', stdout);
      console.log('🐛 DEBUG: Final stderr:', stderr);
      
      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log('🐛 DEBUG: File created, size:', stats.size);
        
        if (stats.size > 100) { // At least 100 bytes
          const fileUrl = `file:///${path.resolve(outputPath).replace(/\\/g, '/')}`;
          resolve({ url: fileUrl });
        } else {
          fs.unlinkSync(outputPath);
          reject(new Error(`File too small: ${stats.size} bytes`));
        }
      } else {
        reject(new Error(`Download failed with code ${code}. stderr: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      console.log('🐛 DEBUG: Process error:', error);
      reject(error);
    });
    
    // 60 second timeout for debug
    setTimeout(() => {
      console.log('🐛 DEBUG: Timeout, killing process');
      process.kill();
      reject(new Error('Debug download timeout'));
    }, 60000);
  });
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
    ytDlpReady: !!ytDlpPath,
    ytDlpPath: ytDlpPath,
    isPackaged: app.isPackaged,
    platform: process.platform
  };
});

// YouTube search (unchanged)
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

// Enhanced download with comprehensive error handling and authentication bypass
ipcMain.handle('download-video', async (event, videoId) => {
  try {
    console.log('⬇️ Starting download for video:', videoId);
    console.log('🔧 ytDlpPath:', ytDlpPath);
    console.log('📁 videosDir:', videosDir);
    
    if (!videoId || videoId.trim().length === 0) {
      throw new Error('Video ID is required');
    }

    if (!ytDlpPath) {
      throw new Error('yt-dlp not available. Binary path is null/undefined. Try reinitializing from the Tools menu.');
    }

    if (!fs.existsSync(ytDlpPath)) {
      throw new Error(`yt-dlp binary does not exist at: ${ytDlpPath}. Please reinstall the application.`);
    }

    // Test if binary is executable
    try {
      const testResult = await testYtDlp();
      if (!testResult.success) {
        throw new Error(`yt-dlp binary test failed: ${testResult.error}`);
      }
    } catch (testError) {
      throw new Error(`yt-dlp binary is not working: ${testError.message}`);
    }

    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    console.log('📄 Output path:', outputPath);
    
    // Check if video already exists
    if (fs.existsSync(outputPath)) {
      console.log('✅ Video already cached:', videoId);
      const stats = fs.statSync(outputPath);
      if (stats.size > 1024) {
        const fileUrl = `file:///${path.resolve(outputPath).replace(/\\/g, '/')}`;
        console.log('🎥 Returning cached file URL:', fileUrl);
        return { url: fileUrl };
      } else {
        fs.unlinkSync(outputPath);
        console.log('🗑️ Removed empty cached file');
      }
    }

    console.log('🎬 Starting fresh video download...');
    
    return new Promise((resolve, reject) => {
      // UPDATED ARGS - Critical changes for authentication bypass
      const args = [
        '--verbose',
        '--no-check-certificates',
        '--extractor-args', 'youtube:player_client=android',  // Use Android client to bypass restrictions
        '--user-agent', 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
        '--no-warnings',
        '--ignore-errors',
        '--geo-bypass',
        '--geo-bypass-country', 'US',
        '-f', 'best[height<=480][ext=mp4]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--max-filesize', '25M',
        '--socket-timeout', '30',
        '--retries', '3',
        '--fragment-retries', '3',
        '--no-playlist',
        '--newline',
        '--progress-template', '%(progress)s',
        '-o', outputPath,
        `https://www.youtube.com/watch?v=${videoId}`
      ];
      
      console.log('📋 Full command:', `"${ytDlpPath}" ${args.join(' ')}`);
      
      const downloadProcess = spawn(ytDlpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      
      let stderr = '';
      let stdout = '';
      let lastProgress = '';
      
      downloadProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        lastProgress = output.trim();
        console.log('📥 STDOUT:', output.trim());
      });
      
      downloadProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.log('⚠️ STDERR:', output.trim());
      });
      
      downloadProcess.on('close', (code) => {
        console.log('🏁 Download process closed with code:', code);
        console.log('📊 Final stdout length:', stdout.length);
        console.log('⚠️ Final stderr length:', stderr.length);
        console.log('📄 Last progress:', lastProgress);
        
        // Check if file exists and has content
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log('📊 Output file size:', stats.size, 'bytes');
          
          if (stats.size > 1024) { // At least 1KB
            const fileUrl = `file:///${path.resolve(outputPath).replace(/\\/g, '/')}`;
            console.log('✅ Download completed successfully:', fileUrl);
            resolve({ url: fileUrl });
            return;
          } else {
            console.log('🗑️ Removing file that is too small:', stats.size, 'bytes');
            fs.unlinkSync(outputPath);
          }
        }
        
        // If we get here, download failed
        console.log('❌ Download failed - analyzing error...');
        
        // Parse error message
        let errorMessage = 'Download failed';
        const stderrLower = stderr.toLowerCase();
        const stdoutLower = stdout.toLowerCase();
        
        if (stderrLower.includes('video unavailable') || stdoutLower.includes('unavailable')) {
          errorMessage = 'Video is unavailable or has been removed from YouTube';
        } else if (stderrLower.includes('private video') || stderrLower.includes('private')) {
          errorMessage = 'This video is private and cannot be downloaded';
        } else if (stderrLower.includes('sign in to confirm') || stderrLower.includes('age')) {
          errorMessage = 'Video requires age verification. Try a different video.';
        } else if (stderrLower.includes('too large') || stderrLower.includes('filesize')) {
          errorMessage = 'Video file is too large (>25MB limit)';
        } else if (stderrLower.includes('timeout') || stderrLower.includes('network')) {
          errorMessage = 'Download timeout - check your internet connection';
        } else if (stderrLower.includes('unable to extract') || stderrLower.includes('no video formats')) {
          errorMessage = 'Unable to extract video - it may be restricted. Try a different video.';
        } else if (stderrLower.includes('http error 403')) {
          errorMessage = 'Access denied. YouTube has blocked this request. Try a different video or wait a few minutes.';
        } else if (stderrLower.includes('http error 404')) {
          errorMessage = 'Video not found - it may have been deleted';
        } else if (stderrLower.includes('cvs po token') || stderrLower.includes('po token')) {
          errorMessage = 'YouTube authentication required. Try a different video or try again later.';
        } else if (code !== 0) {
          // Include more context for debugging
          const errorContext = stderr.split('\n').slice(-3).join('\n').trim();
          errorMessage = `Download failed: Try a different video or wait a few minutes. YouTube may be blocking requests.`;
        }
        
        console.log('❌ Final error message:', errorMessage);
        reject(new Error(errorMessage));
      });
      
      downloadProcess.on('error', (error) => {
        console.error('❌ Process spawn error:', error);
        reject(new Error(`Failed to start download process: ${error.message}`));
      });
      
      // Timeout after 2 minutes
      const timeout = setTimeout(() => {
        console.log('⏰ Download timeout, killing process');
        downloadProcess.kill('SIGTERM');
        
        setTimeout(() => {
          if (!downloadProcess.killed) {
            downloadProcess.kill('SIGKILL');
          }
        }, 5000);
        
        if (fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
          } catch (e) {
            console.warn('Could not clean up timeout file:', e.message);
          }
        }
        reject(new Error('Download timeout (2 minutes) - video may be too large or network is slow'));
      }, 120000);
      
      // Clear timeout if process ends normally
      downloadProcess.on('close', () => {
        clearTimeout(timeout);
      });
    });

  } catch (error) {
    console.error('❌ Download failed for', videoId, ':', error.message);
    throw error;
  }
});

// Add debug download handler
ipcMain.handle('debug-download', async (event, videoId) => {
  try {
    return await debugDownload(videoId);
  } catch (error) {
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

ipcMain.handle('test-ytdlp', async () => {
  try {
    if (!ytDlpPath) {
      return { ready: false, error: 'yt-dlp not initialized' };
    }
    
    const result = await testYtDlp();
    return { ready: result.success, path: ytDlpPath, error: result.error, version: result.version };
  } catch (error) {
    return { ready: false, error: error.message };
  }
});

ipcMain.handle('reinitialize-ytdlp', async () => {
  try {
    console.log('🔄 Reinitializing yt-dlp...');
    const success = await initializeYtDlp();
    return { success, path: ytDlpPath };
  } catch (error) {
    console.error('❌ Reinitialization failed:', error);
    return { success: false, error: error.message };
  }
});

// App event handlers
app.whenReady().then(async () => {
  try {
    console.log('🎬 Starting Stepwise Studio...');
    
    createWindow();
    createMenu();
    
    // Initialize yt-dlp (non-blocking)
    initializeYtDlp().then(ytDlpReady => {
      if (ytDlpReady) {
        console.log('✅ yt-dlp initialized successfully');
      } else {
        console.warn('⚠️ yt-dlp initialization failed - downloads may not work');
      }
    });
    
    setInterval(cleanupOldVideos, 60 * 60 * 1000);
    
    console.log('✅ Stepwise Studio ready!');
  } catch (err) {
    console.error('❌ Failed to start application:', err);
    dialog.showErrorBox('Startup Error', `Failed to start Stepwise Studio: ${err.message}`);
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

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('Application Error', error.message);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('📁 Videos will be stored in:', videosDir);
console.log('🎬 Stepwise Studio main process loaded');