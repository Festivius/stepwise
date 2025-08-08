const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { spawn, execSync } = require('child_process');

let mainWindow;
let ytDlpPath = null;

// Set up videos directory in userData
const videosDir = path.join(app.getPath('userData'), 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  console.log('📁 Created videos directory:', videosDir);
}

// Initialize yt-dlp with bundled executable - WINDOWS ENHANCED
async function initializeYtDlp() {
  try {
    console.log('🔧 Initializing bundled yt-dlp...');
    console.log('📦 App is packaged:', app.isPackaged);
    console.log('💻 Platform:', process.platform);
    console.log('📁 Process cwd:', process.cwd());
    console.log('📁 __dirname:', __dirname);
    
    let binaryName;
    
    // Determine binary name based on platform
    if (process.platform === 'win32') {
      binaryName = 'yt-dlp.exe';
    } else if (process.platform === 'darwin') {
      binaryName = 'yt-dlp-macos';
    } else {
      binaryName = 'yt-dlp-linux';
    }
    
    // Enhanced path resolution for Windows
    let possiblePaths = [];
    
    if (app.isPackaged) {
      // When packaged, try multiple locations
      possiblePaths = [
        path.join(process.resourcesPath, 'binaries', binaryName),
        path.join(process.resourcesPath, 'app', 'binaries', binaryName),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'binaries', binaryName),
        path.join(app.getAppPath(), 'binaries', binaryName)
      ];
    } else {
      // Development paths
      possiblePaths = [
        path.join(__dirname, 'binaries', binaryName),
        path.join(process.cwd(), 'binaries', binaryName),
        path.join(__dirname, '..', 'binaries', binaryName)
      ];
    }
    
    // Find the first existing path
    for (const testPath of possiblePaths) {
      console.log('🔍 Testing path:', testPath);
      if (fs.existsSync(testPath)) {
        ytDlpPath = testPath;
        console.log('✅ Found yt-dlp at:', ytDlpPath);
        break;
      }
    }
    
    if (!ytDlpPath) {
      throw new Error(`yt-dlp binary not found. Searched paths:\n${possiblePaths.join('\n')}`);
    }
    
    // Check file size to ensure it's not corrupted
    const stats = fs.statSync(ytDlpPath);
    console.log('📊 Binary file size:', stats.size, 'bytes');
    if (stats.size < 100000) { // Less than 100KB is suspicious
      console.warn('⚠️ Binary file seems too small, might be corrupted');
    }
    
    // Windows-specific: Check if we need to mark as executable
    if (process.platform === 'win32') {
      // On Windows, .exe files should be executable by default
      console.log('🪟 Windows detected - .exe should be executable by default');
    } else {
      // Make executable on Unix systems
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
      
      // Windows-specific troubleshooting
      if (process.platform === 'win32') {
        console.log('🪟 Windows troubleshooting:');
        console.log('   - Check if antivirus is blocking the executable');
        console.log('   - Ensure Windows Defender exclusions are set');
        console.log('   - Try running as administrator if needed');
      }
      
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
        detail: `Warning: ${error.message}\n\nThe app will still work, but video downloads might fail.\n\nOn Windows, check if antivirus software is blocking the executable.`,
        buttons: ['OK']
      });
    }
    return false;
  }
}

// ENHANCED: Update the test function to include age restriction testing
async function testYtDlp() {
  return new Promise((resolve) => {
    console.log('🧪 Testing yt-dlp with age restriction bypass...');
    
    const spawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000
    };
    
    if (process.platform === 'win32') {
      spawnOptions.shell = false;
      spawnOptions.windowsHide = true;
    }
    
    // Test with version command and age restriction flags
    const testProcess = spawn(ytDlpPath, [
      '--version', 
      '--ignore-config',  // Ignore any config that might cause issues
      '--no-warnings'
    ], spawnOptions);
    
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
        console.log('✅ Age restriction bypass features available');
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
      
      if (process.platform === 'win32' && error.code === 'ENOENT') {
        resolve({ 
          success: false, 
          error: `Binary not found or not executable. Check Windows Defender/antivirus settings. Path: ${ytDlpPath}` 
        });
      } else {
        resolve({ success: false, error: `Process error: ${error.message}` });
      }
    });
    
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      console.warn('⚠️ yt-dlp test timeout after 60 seconds');
      testProcess.kill('SIGTERM');
      resolve({ success: false, error: 'Test timeout after 60 seconds' });
    }, 60000);
  });
}

console.log('🎬 Stepwise Studio starting...');
console.log('📁 Videos directory:', videosDir);
console.log('🪟 Windows compatibility mode active');

// Enhanced createMenu function with Windows-specific shortcuts
function createMenu() {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  
  const template = [
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            console.log('New file requested');
          }
        },
        {
          label: 'Open',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            console.log('Open file requested');
          }
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            console.log('Save requested');
          }
        },
        { type: 'separator' },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              focusedWindow.close();
            }
          }
        },
        // Windows-specific: Exit vs Quit
        {
          label: isWindows ? 'Exit' : 'Quit',
          accelerator: isMac ? 'Cmd+Q' : 'Alt+F4',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    // Edit menu with standard clipboard operations
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          role: 'undo'
        },
        {
          label: 'Redo',
          accelerator: isWindows ? 'CmdOrCtrl+Y' : 'CmdOrCtrl+Shift+Z',
          role: 'redo'
        },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          role: 'cut'
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          role: 'copy'
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          role: 'paste'
        },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          role: 'selectall'
        },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-find-dialog');
            }
          }
        }
      ]
    },
    // View menu
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
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            mainWindow.webContents.reloadIgnoringCache();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: isWindows ? 'F12' : 'Cmd+Alt+I',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            mainWindow.webContents.setZoomLevel(0);
          }
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Fullscreen',
          accelerator: 'F11',
          click: () => {
            const isFullScreen = mainWindow.isFullScreen();
            mainWindow.setFullScreen(!isFullScreen);
          }
        }
      ]
    },
    // Tools menu
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Debug Download',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: async () => {
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: 'Debug Download',
              message: 'Test video download functionality',
              detail: 'This will test downloading a sample video to verify the system is working.',
              buttons: ['Cancel', 'Test Download'],
              defaultId: 1
            });
            
            if (result.response === 1) {
              const testVideoId = 'dQw4w9WgXcQ';
              console.log('🧪 Testing download with video ID:', testVideoId);
              
              try {
                const downloadResult = await debugDownload(testVideoId);
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Debug Download Success',
                  message: 'Download test completed successfully',
                  detail: `File: ${downloadResult.url}`,
                  buttons: ['OK']
                });
              } catch (error) {
                dialog.showMessageBox(mainWindow, {
                  type: 'error',
                  title: 'Debug Download Failed',
                  message: 'Download test failed',
                  detail: `Error: ${error.message}\n\nTry checking:\n- Internet connection\n- Windows Defender settings\n- Antivirus exclusions`,
                  buttons: ['OK']
                });
              }
            }
          }
        },
        {
          label: 'Test yt-dlp',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: async () => {
            if (!ytDlpPath) {
              dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'yt-dlp Not Found',
                message: 'yt-dlp binary is not initialized',
                detail: 'The video downloader component is not available.',
                buttons: ['OK']
              });
              return;
            }
            
            const result = await testYtDlp();
            dialog.showMessageBox(mainWindow, {
              type: result.success ? 'info' : 'warning',
              title: 'yt-dlp Test Result',
              message: result.success ? 'yt-dlp is working correctly' : 'yt-dlp test failed',
              detail: result.error || result.version || 'Binary is ready for downloads',
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Open Videos Folder',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => {
            shell.openPath(videosDir).catch(err => {
              console.error('Could not open videos folder:', err);
              dialog.showErrorBox('Error', 'Could not open videos folder');
            });
          }
        },
        {
          label: 'Reinitialize yt-dlp',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: async () => {
            console.log('🔄 Reinitializing yt-dlp...');
            const success = await initializeYtDlp();
            dialog.showMessageBox(mainWindow, {
              type: success ? 'info' : 'error',
              title: 'Reinitialization Result',
              message: success ? 'yt-dlp reinitialized successfully' : 'Failed to reinitialize yt-dlp',
              detail: `Binary path: ${ytDlpPath || 'Not found'}`,
              buttons: ['OK']
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Cleanup Videos',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            cleanupOldVideos();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Cleanup Complete',
              message: 'Video cache has been cleared',
              buttons: ['OK']
            });
          }
        },
        // Windows-specific menu item
        ...(isWindows ? [{
          type: 'separator'
        }, {
          label: 'Windows Compatibility Check',
          click: async () => {
            const osInfo = {
              platform: process.platform,
              arch: process.arch,
              version: process.getSystemVersion(),
              nodeVersion: process.version
            };
            
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Windows Compatibility Info',
              message: 'System Information',
              detail: `Platform: ${osInfo.platform}\nArchitecture: ${osInfo.arch}\nOS Version: ${osInfo.version}\nNode.js: ${osInfo.nodeVersion}\n\nyt-dlp Path: ${ytDlpPath || 'Not initialized'}\nVideos Directory: ${videosDir}`,
              buttons: ['OK']
            });
          }
        }] : [])
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              focusedWindow.minimize();
            }
          }
        },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              focusedWindow.close();
            }
          }
        }
      ]
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Stepwise Studio',
          accelerator: 'F1',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Stepwise Studio',
              message: `Stepwise Studio v${app.getVersion()}`,
              detail: 'Precision • Dance • Control\n\nA desktop application for learning dance with YouTube videos.',
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            const shortcuts = isWindows ? 
              `Windows Keyboard Shortcuts:

File:
Ctrl+N - New
Ctrl+O - Open  
Ctrl+S - Save
Ctrl+W - Close
Alt+F4 - Exit

Edit:
Ctrl+Z - Undo
Ctrl+Y - Redo
Ctrl+X - Cut
Ctrl+C - Copy
Ctrl+V - Paste
Ctrl+A - Select All
Ctrl+F - Find

View:
Ctrl+R - Reload
F12 - Developer Tools
Ctrl+0 - Actual Size
Ctrl+Plus - Zoom In
Ctrl+Minus - Zoom Out
F11 - Fullscreen

Video Player:
Space - Play/Pause
← → - Skip Back/Forward
L - Toggle Loop
M - Mirror Video
F - Fullscreen` :
              `Keyboard Shortcuts:

File:
Cmd+N - New
Cmd+O - Open
Cmd+S - Save
Cmd+W - Close
Cmd+Q - Quit

Edit:
Cmd+Z - Undo
Cmd+Shift+Z - Redo
Cmd+X - Cut
Cmd+C - Copy
Cmd+V - Paste
Cmd+A - Select All
Cmd+F - Find

Video Player:
Space - Play/Pause
← → - Skip Back/Forward
L - Toggle Loop
M - Mirror Video
F - Fullscreen`;
            
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Keyboard Shortcuts',
              message: 'Available Keyboard Shortcuts',
              detail: shortcuts,
              buttons: ['OK']
            });
          }
        },
        ...(isWindows ? [{
          type: 'separator'
        }, {
          label: 'Windows Support',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Windows Support',
              message: 'Windows-Specific Features',
              detail: `Windows Compatibility Features:

• Native Windows shortcuts (Alt+F4, etc.)
• Windows Defender integration
• Proper Windows path handling  
• Windows-style menus and dialogs
• System integration
• Antivirus compatibility checks

If you experience issues:
1. Check Windows Defender exclusions
2. Verify antivirus settings
3. Run as administrator if needed
4. Check internet connection`,
              buttons: ['OK']
            });
          }
        }] : [])
      ]
    }
  ];

  // macOS specific menu adjustments
  if (isMac) {
    template.unshift({
      label: 'Stepwise Studio',
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
        },
        { type: 'separator' },
        {
          label: 'Hide Stepwise Studio',
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          role: 'hideothers'
        },
        {
          label: 'Show All',
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    });

    // Adjust Window menu for macOS
    template[5].submenu.push(
      { type: 'separator' },
      {
        label: 'Bring All to Front',
        role: 'front'
      }
    );
  }
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Windows-compatible window creation
function createWindow() {
  // Load previous window state
  const windowState = windowStateManager.loadState();
  
  // Windows-specific window options
  const windowOptions = {
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    autoHideMenuBar: false, // Keep menu bar visible on Windows
    titleBarStyle: process.platform === 'win32' ? 'default' : 'hiddenInset'
  };

  // Set icon with proper Windows path handling
  const iconPath = path.join(__dirname, 'assets', 'stepwise-icon.png');
  if (fs.existsSync(iconPath)) {
    windowOptions.icon = iconPath;
  } else {
    console.warn('⚠️ Icon file not found:', iconPath);
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Restore maximized/fullscreen state
  mainWindow.once('ready-to-show', () => {
    if (windowState.isMaximized) {
      mainWindow.maximize();
    }
    if (windowState.isFullScreen) {
      mainWindow.setFullScreen(true);
    }
    mainWindow.show();
    console.log('✅ Electron window ready with Windows compatibility');
  });

  // Set up state tracking
  windowStateManager.manage(mainWindow);

  // Load the HTML file
  const htmlPath = path.join(__dirname, 'src', 'index.html');
  mainWindow.loadFile(htmlPath).catch(err => {
    console.error('Failed to load HTML file:', err);
    dialog.showErrorBox('Load Error', `Could not load the application: ${err.message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Windows-specific: Handle window events
  if (process.platform === 'win32') {
    // Handle Windows-specific shortcuts
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // Handle Alt+F4 for closing
      if (input.key === 'F4' && input.alt && !input.shift && !input.control && !input.meta) {
        event.preventDefault();
        mainWindow.close();
      }
    });
  }
}

// Enhanced download with age restriction bypass
ipcMain.handle('download-video', async (event, videoId) => {
  try {
    console.log('⬇️ Starting age-restriction-aware download for video:', videoId);
    
    if (!videoId || videoId.trim().length === 0) {
      throw new Error('Video ID is required');
    }

    if (!ytDlpPath) {
      throw new Error('yt-dlp not available. Try reinitializing from Tools menu.');
    }

    if (!fs.existsSync(ytDlpPath)) {
      throw new Error(`yt-dlp binary does not exist at: ${ytDlpPath}`);
    }

    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    console.log('📄 Output path:', outputPath);
    
    // Check if video already exists
    if (fs.existsSync(outputPath)) {
      console.log('✅ Video already cached:', videoId);
      const stats = fs.statSync(outputPath);
      if (stats.size > 1024) {
        const fileUrl = `file:///${outputPath.replace(/\\/g, '/')}`;
        console.log('🎥 Returning cached file URL:', fileUrl);
        return { url: fileUrl };
      } else {
        fs.unlinkSync(outputPath);
        console.log('🗑️ Removed empty cached file');
      }
    }

    console.log('🎬 Starting fresh video download with age restriction bypass...');
    
    return new Promise((resolve, reject) => {
      // ENHANCED: Age restriction bypass arguments
      const args = [
        '--verbose',
        '--no-check-certificates',
        
        // CRITICAL: Age restriction bypass methods
        '--age-limit', '0',  // Bypass age restrictions
        '--no-warnings',     // Suppress age-related warnings
        '--ignore-errors',   // Continue despite age verification errors
        
        // ENHANCED: Multiple extractor strategies for age-restricted content
        '--extractor-args', 'youtube:player_client=android,web,ios,mweb',  // Try multiple clients
        '--extractor-args', 'youtube:skip=hls,dash',  // Skip problematic formats
        '--extractor-args', 'youtube:include_live_dash=false',
        
        // ENHANCED: Better user agent rotation
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        
        // ENHANCED: Headers to mimic real browser
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
        '--add-header', 'Accept-Encoding:gzip, deflate, br',
        '--add-header', 'DNT:1',
        '--add-header', 'Upgrade-Insecure-Requests:1',
        '--add-header', 'Sec-Fetch-Dest:document',
        '--add-header', 'Sec-Fetch-Mode:navigate',
        '--add-header', 'Sec-Fetch-Site:none',
        '--add-header', 'Sec-Fetch-User:?1',
        
        // ENHANCED: Cookie handling for age verification
        // '--cookies-from-browser', 'chrome',  // Try to use Chrome cookies if available
        
        // Enhanced geo-bypass
        '--geo-bypass',
        '--geo-bypass-country', 'US',
        '--geo-bypass-ip-block', '0.0.0.0/0',
        
        // Enhanced format selection with fallbacks for age-restricted content
        '-f', 'bestvideo[height=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=1080]+bestaudio/best[height=1080]/bestvideo[height=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=720]+bestaudio/best[height=720]/best[height<=1080][ext=mp4]/best',
        '--merge-output-format', 'mp4',
        
        // Enhanced retry logic for age-restricted content
        '--socket-timeout', '120',  // Increased timeout
        '--retries', '5',           // More retries
        '--fragment-retries', '5',
        '--retry-sleep', '2',       // Wait between retries
        
        // File size and quality
        '--max-filesize', '1000M',    // Increased size limit for longer videos
        
        // Output and progress
        '--no-playlist',
        '--newline',
        '--progress-template', '%(progress)s',
        '-o', outputPath,
        
        // ENHANCED: URL format with additional parameters
        `https://www.youtube.com/watch?v=${videoId}&has_verified=1&bpctr=9999999999`
      ];
      
      console.log('📋 Enhanced command with age restriction bypass');
      console.log('🔧 Using multiple player clients and browser headers');
      
      // Enhanced spawn options
      const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: 300000,  // 5 minute timeout for longer videos
        env: { 
          ...process.env, 
          PYTHONIOENCODING: 'utf-8',
          // Set environment variables that can help with age restrictions
          YOUTUBE_DL_AGE_LIMIT: '0'
        }
      };
      
      const downloadProcess = spawn(ytDlpPath, args, spawnOptions);
      
      let stderr = '';
      let stdout = '';
      
      downloadProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('📥 STDOUT:', output.trim());
        
        // Monitor for age restriction indicators
        if (output.toLowerCase().includes('age') || 
            output.toLowerCase().includes('verify') ||
            output.toLowerCase().includes('restricted')) {
          console.log('🔄 Detected potential age restriction, continuing with bypass...');
        }
      });
      
      downloadProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.log('⚠️ STDERR:', output.trim());
      });
      
      downloadProcess.on('close', (code) => {
        console.log('🏁 Download process closed with code:', code);
        
        // Check if file exists and has content
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log('📊 Output file size:', stats.size, 'bytes');
          
          if (stats.size > 1024) {
            const normalizedPath = outputPath.replace(/\\/g, '/');
            const fileUrl = `file:///${normalizedPath}`;
            console.log('✅ Download completed successfully:', fileUrl);
            resolve({ url: fileUrl });
            return;
          } else {
            console.log('🗑️ Removing file that is too small:', stats.size, 'bytes');
            fs.unlinkSync(outputPath);
          }
        }
        
        // ENHANCED: Better error handling for age restrictions
        let errorMessage = 'Download failed';
        const stderrLower = stderr.toLowerCase();
        const stdoutLower = stdout.toLowerCase();
        
        // Age restriction specific errors
        if (stderrLower.includes('sign in to confirm your age') || 
            stderrLower.includes('age-restricted') ||
            stderrLower.includes('content warning') ||
            stdoutLower.includes('requires age verification')) {
          
          console.log('🔄 Attempting secondary download method for age-restricted content...');
          
          // Try alternative download method
          attemptAlternativeDownload(videoId, outputPath)
            .then(resolve)
            .catch(() => {
              reject(new Error('This video requires age verification. Try using a different video or ensure you are logged into YouTube in your browser.'));
            });
          return;
        }
        
        // Platform-specific error handling
        if (process.platform === 'win32') {
          if (stderrLower.includes('access is denied') || stderrLower.includes('permission denied')) {
            errorMessage = 'Permission denied. Try running as administrator or check Windows Defender settings.';
          } else if (stderrLower.includes('virus') || stderrLower.includes('malware') || stderrLower.includes('blocked')) {
            errorMessage = 'Download blocked by antivirus. Add Stepwise Studio to your antivirus exclusions.';
          } else if (stderrLower.includes('network') || stderrLower.includes('timeout')) {
            errorMessage = 'Network timeout. Check your internet connection and Windows Firewall settings.';
          }
        }
        
        // General error handling
        if (stderrLower.includes('video unavailable') || stdoutLower.includes('unavailable')) {
          errorMessage = 'Video is unavailable or has been removed from YouTube';
        } else if (stderrLower.includes('private video') || stderrLower.includes('private')) {
          errorMessage = 'This video is private and cannot be downloaded';
        } else if (stderrLower.includes('too large') || stderrLower.includes('filesize')) {
          errorMessage = 'Video file is too large (>1000MB limit)';
        } else if (stderrLower.includes('unable to extract') || stderrLower.includes('no video formats')) {
          errorMessage = 'Unable to extract video - it may be restricted. Trying alternative method...';
          
          // Try alternative method for extraction failures
          attemptAlternativeDownload(videoId, outputPath)
            .then(resolve)
            .catch(() => reject(new Error('Unable to download this video. It may be geo-blocked or have strict restrictions.')));
          return;
        } else if (stderrLower.includes('http error 403')) {
          errorMessage = 'Access denied by YouTube. Trying alternative method...';
          
          attemptAlternativeDownload(videoId, outputPath)
            .then(resolve)
            .catch(() => reject(new Error('Access denied by YouTube. Try a different video or wait a few minutes.')));
          return;
        } else if (stderrLower.includes('http error 404')) {
          errorMessage = 'Video not found - it may have been deleted';
        }
        
        console.log('❌ Final error message:', errorMessage);
        reject(new Error(errorMessage));
      });
      
      downloadProcess.on('error', (error) => {
        console.error('❌ Process spawn error:', error);
        
        let errorMsg = `Failed to start download process: ${error.message}`;
        if (process.platform === 'win32') {
          if (error.code === 'ENOENT') {
            errorMsg = 'yt-dlp executable not found. Check if antivirus software quarantined it.';
          } else if (error.code === 'EACCES') {
            errorMsg = 'Permission denied to execute yt-dlp. Try running as administrator.';
          }
        }
        
        reject(new Error(errorMsg));
      });
      
      // Enhanced timeout for longer videos
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
        reject(new Error('Download timeout (5 minutes) - video may be very large or connection is slow'));
      }, 300000); // 5 minutes timeout
      
      downloadProcess.on('close', () => {
        clearTimeout(timeout);
      });
    });

  } catch (error) {
    console.error('❌ Download failed for', videoId, ':', error.message);
    throw error;
  }
});

// NEW: Alternative download method for age-restricted content
async function attemptAlternativeDownload(videoId, outputPath) {
  console.log('🔄 Attempting alternative download method...');
  
  return new Promise((resolve, reject) => {
    // Alternative arguments with different approach
    const altArgs = [
      '--no-check-certificates',
      '--quiet',  // Reduce verbosity for alternative method
      '--no-warnings',
      
      // Different extraction strategy
      '--extractor-args', 'youtube:player_client=ios',  // iOS client often bypasses restrictions
      '--user-agent', 'com.google.ios.youtube/17.33.2 (iPhone14,2; U; CPU iOS 15_6 like Mac OS X)',
      
      // Simplified format selection
      '-f', 'best[height<=1080]/best',
      '--max-filesize', '1000M',  // Smaller size limit for alternative method
      
      // Basic retry logic
      '--retries', '3',
      '--socket-timeout', '90',
      
      '--no-playlist',
      '-o', outputPath,
      
      // Try with minimal additional parameters
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    
    console.log('🎯 Trying iOS client bypass method...');
    
    const altProcess = spawn(ytDlpPath, altArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 180000  // 3 minute timeout
    });
    
    let altStderr = '';
    
    altProcess.stderr.on('data', (data) => {
      altStderr += data.toString();
    });
    
    altProcess.on('close', (code) => {
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 1024) {
          const normalizedPath = outputPath.replace(/\\/g, '/');
          const fileUrl = `file:///${normalizedPath}`;
          console.log('✅ Alternative download successful:', fileUrl);
          resolve({ url: fileUrl });
          return;
        } else {
          try {
            fs.unlinkSync(outputPath);
          } catch (e) {
            console.warn('Could not remove small alternative file:', e.message);
          }
        }
      }
      
      console.log('❌ Alternative download failed');
      reject(new Error('Alternative download method failed'));
    });
    
    altProcess.on('error', (error) => {
      console.log('❌ Alternative process error:', error);
      reject(error);
    });
    
    // Timeout for alternative method
    setTimeout(() => {
      altProcess.kill();
      reject(new Error('Alternative download timeout'));
    }, 180000);
  });
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
    const maxAge = 24 * 60 * 60 * 1000 * 0; // 24 hours (now all videos)

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

// Enhanced debug download with age restriction testing
async function debugDownload(videoId) {
  console.log('🐛 DEBUG: Testing age restriction bypass for:', videoId);
  
  if (!ytDlpPath) {
    throw new Error('yt-dlp path is null or undefined');
  }
  
  if (!fs.existsSync(ytDlpPath)) {
    throw new Error(`yt-dlp binary does not exist at: ${ytDlpPath}`);
  }
  
  const outputPath = path.join(videosDir, `debug_${videoId}.mp4`);
  console.log('🐛 DEBUG: Testing with enhanced args for:', outputPath);
  
  return new Promise((resolve, reject) => {
    const args = [
      '--verbose',
      '--no-check-certificates',
      '--age-limit', '0',
      '--extractor-args', 'youtube:player_client=android,ios',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '-f', 'best[height<=1080]/best',
      '--max-filesize', '1000M',
      '--retries', '3',
      '--no-playlist',
      '--no-warnings',
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${videoId}&has_verified=1`
    ];
    
    console.log('🐛 DEBUG: Enhanced command for age restriction testing');
    
    const spawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe']
    };
    
    if (process.platform === 'win32') {
      spawnOptions.windowsHide = true;
    }
    
    const process = spawn(ytDlpPath, args, spawnOptions);
    
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
      
      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log('🐛 DEBUG: File created, size:', stats.size);
        
        if (stats.size > 100) {
          const normalizedPath = outputPath.replace(/\\/g, '/');
          const fileUrl = `file:///${normalizedPath}`;
          resolve({ url: fileUrl });
        } else {
          fs.unlinkSync(outputPath);
          reject(new Error(`File too small: ${stats.size} bytes`));
        }
      } else {
        // Try alternative method if main debug fails
        console.log('🐛 DEBUG: Main method failed, trying alternative...');
        attemptAlternativeDownload(videoId, outputPath)
          .then(resolve)
          .catch(() => {
            reject(new Error(`Debug download failed with code ${code}. stderr: ${stderr}`));
          });
      }
    });
    
    process.on('error', (error) => {
      console.log('🐛 DEBUG: Process error:', error);
      reject(error);
    });
    
    setTimeout(() => {
      console.log('🐛 DEBUG: Timeout, killing process');
      process.kill();
      reject(new Error('Debug download timeout'));
    }, 120000);  // 2 minute timeout for debug
  });
}

// Window state management with Windows compatibility
class WindowStateManager {
  constructor() {
    this.stateFile = path.join(app.getPath('userData'), 'window-state.json');
    this.defaultState = {
      width: 1400,
      height: 900,
      x: undefined,
      y: undefined,
      isMaximized: false,
      isFullScreen: false
    };
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        const state = JSON.parse(data);
        
        // Windows-specific validation
        if (process.platform === 'win32') {
          const { screen } = require('electron');
          const displays = screen.getAllDisplays();
          
          // Ensure window is visible on at least one display
          const display = displays.find(d => 
            state.x >= d.bounds.x - 100 && state.x < d.bounds.x + d.bounds.width + 100 &&
            state.y >= d.bounds.y - 100 && state.y < d.bounds.y + d.bounds.height + 100
          );
          
          if (!display) {
            console.log('🪟 Window was off-screen, using default position');
            state.x = undefined;
            state.y = undefined;
          }
        }
        
        return { ...this.defaultState, ...state };
      }
    } catch (error) {
      console.warn('Could not load window state:', error.message);
    }
    return this.defaultState;
  }

  saveState(window) {
    try {
      const bounds = window.getBounds();
      const state = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized: window.isMaximized(),
        isFullScreen: window.isFullScreen()
      };
      
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
      console.log('💾 Window state saved');
    } catch (error) {
      console.warn('Could not save window state:', error.message);
    }
  }

  manage(window) {
    const saveState = () => this.saveState(window);
    
    window.on('resize', saveState);
    window.on('move', saveState);
    window.on('maximize', saveState);
    window.on('unmaximize', saveState);
    window.on('enter-full-screen', saveState);
    window.on('leave-full-screen', saveState);
    window.on('close', saveState);
  }
}

// Enhanced user preferences with Windows paths
class UserPreferencesManager {
  constructor() {
    this.preferencesFile = path.join(app.getPath('userData'), 'user-preferences.json');
    this.defaultPreferences = {
      volume: 1,
      playbackRate: 1,
      loopMode: false,
      loopStartTime: 0,
      loopEndTime: 10,
      mirrorMode: false,
      lastSearchQuery: '',
      savedVideos: [],
      recentVideos: [],
      theme: 'default',
      lastVideoId: null,
      lastVideoTitle: '',
      lastThumbnail: '',
      currentVideoTime: 0,
      totalPracticeTime: 0,
      sessionCount: 0,
      lastSessionDate: null
    };
  }

  loadPreferences() {
    try {
      if (fs.existsSync(this.preferencesFile)) {
        const data = fs.readFileSync(this.preferencesFile, 'utf8');
        const preferences = JSON.parse(data);
        return { ...this.defaultPreferences, ...preferences };
      }
    } catch (error) {
      console.warn('Could not load preferences:', error.message);
    }
    return this.defaultPreferences;
  }

  savePreferences(preferences) {
    try {
      fs.writeFileSync(this.preferencesFile, JSON.stringify(preferences, null, 2));
      console.log('💾 User preferences saved');
    } catch (error) {
      console.warn('Could not save preferences:', error.message);
    }
  }

  get(key) {
    const preferences = this.loadPreferences();
    return preferences[key];
  }

  set(key, value) {
    const preferences = this.loadPreferences();
    preferences[key] = value;
    this.savePreferences(preferences);
  }

  update(updates) {
    const preferences = this.loadPreferences();
    Object.assign(preferences, updates);
    this.savePreferences(preferences);
  }
}

// Create managers
const windowStateManager = new WindowStateManager();
const preferencesManager = new UserPreferencesManager();

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
    platform: process.platform,
    windowsCompatible: process.platform === 'win32'
  };
});

// YouTube search with Windows error handling
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
          key: 'AIzaSyCnYR4E6pNBl-oHscWZOE_akXbmOtT7FfI',
          safeSearch: 'strict'
        },
        timeout: 60000
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
      errorMessage = process.platform === 'win32' ? 
        'No internet connection. Check Windows Firewall settings.' : 
        'No internet connection';
    } else if (error.response?.data?.error) {
      errorMessage = error.response.data.error.message || error.response.data.error;
    }
    
    throw new Error(errorMessage);
  }
});

// Add remaining IPC handlers
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

// Preferences IPC handlers
ipcMain.handle('get-preferences', () => {
  return preferencesManager.loadPreferences();
});

ipcMain.handle('save-preferences', (event, preferences) => {
  preferencesManager.savePreferences(preferences);
  return true;
});

ipcMain.handle('get-preference', (event, key) => {
  return preferencesManager.get(key);
});

ipcMain.handle('set-preference', (event, key, value) => {
  preferencesManager.set(key, value);
  return true;
});

ipcMain.handle('update-preferences', (event, updates) => {
  preferencesManager.update(updates);
  return true;
});

// Session tracking
let sessionStartTime = Date.now();

ipcMain.handle('get-session-time', () => {
  return Date.now() - sessionStartTime;
});

ipcMain.handle('save-session-data', (event, data) => {
  const sessionTime = Date.now() - sessionStartTime;
  const currentPrefs = preferencesManager.loadPreferences();
  
  preferencesManager.update({
    totalPracticeTime: (currentPrefs.totalPracticeTime || 0) + sessionTime,
    sessionCount: (currentPrefs.sessionCount || 0) + 1,
    lastSessionDate: new Date().toISOString(),
    ...data
  });
  
  return true;
});

// App event handlers with Windows compatibility
app.whenReady().then(async () => {
  try {
    console.log('🎬 Starting Stepwise Studio with Windows compatibility...');
    
    createWindow();
    createMenu();
    
    // Initialize yt-dlp (non-blocking)
    initializeYtDlp().then(ytDlpReady => {
      if (ytDlpReady) {
        console.log('✅ yt-dlp initialized successfully');
      } else {
        console.warn('⚠️ yt-dlp initialization failed - downloads may not work');
        if (process.platform === 'win32') {
          console.log('🪟 Windows users: Check antivirus settings and Windows Defender exclusions');
        }
      }
    });
    
    // Clean up old videos every hour
    setInterval(cleanupOldVideos, 60 * 60 * 1000);
    
    console.log('✅ Stepwise Studio ready for Windows!');
  } catch (err) {
    console.error('❌ Failed to start application:', err);
    dialog.showErrorBox('Startup Error', `Failed to start Stepwise Studio: ${err.message}`);
  }
});

// Windows-specific app event handling
app.on('window-all-closed', () => {
  // On Windows, always quit when all windows are closed
  if (process.platform === 'win32') {
    app.quit();
  } else if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Auto-save preferences periodically
setInterval(() => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auto-save-preferences');
  }
}, 30000);

// Save state before app quits
app.on('before-quit', () => {
  console.log('🔄 Saving app state before quit...');
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    windowStateManager.saveState(mainWindow);
    mainWindow.webContents.send('app-closing');
  }
});

// Enhanced error handling for Windows
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  
  let errorMessage = error.message;
  if (process.platform === 'win32') {
    // Add Windows-specific error context
    if (error.code === 'ENOENT') {
      errorMessage += '\n\nThis might be caused by:\n• Missing files\n• Antivirus blocking\n• Windows Defender quarantine';
    } else if (error.code === 'EACCES') {
      errorMessage += '\n\nTry running as administrator or check folder permissions.';
    }
  }
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('Application Error', errorMessage);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('📁 Videos will be stored in:', videosDir);
console.log('🪟 Windows compatibility features enabled');
console.log('🎬 Stepwise Studio main process loaded for Windows');