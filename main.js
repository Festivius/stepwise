const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { spawn, execSync } = require('child_process');

// Constants
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const videosDir = path.join(app.getPath('userData'), 'videos');
const pluginsDir = path.join(app.getPath('userData'), 'yt-dlp-plugins');
const EmbeddedBgutilServer = require('./src/embedded-bgutil-server.js');

// Logging utility
const logger = {
  info: (msg, ...args) => console.log(`ℹ️ ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`⚠️ ${msg}`, ...args),
  error: (msg, ...args) => console.error(`❌ ${msg}`, ...args),
  debug: (msg, ...args) => process.env.NODE_ENV === 'development' && console.log(`🐛 ${msg}`, ...args)
};

let mainWindow;
let ytDlpPath = null;
let embeddedBgutilServer = null;

// Initialize directories
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  logger.info('Created videos directory:', videosDir);
}

// Utility functions
const findBinary = (binaryName) => {
  const paths = app.isPackaged 
    ? [
        path.join(process.resourcesPath, 'binaries', binaryName),
        path.join(process.resourcesPath, 'app', 'binaries', binaryName),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'binaries', binaryName)
      ]
    : [
        path.join(__dirname, 'binaries', binaryName),
        path.join(process.cwd(), 'binaries', binaryName)
      ];
  
  return paths.find(p => fs.existsSync(p));
};

const getSpawnOptions = (timeout = 300000) => ({
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: isWindows,
  timeout,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
});

const checkBgutilAvailability = async () => {
  try {
    // Check if embedded bgutil server is running
    let httpAvailable = false;
    let scriptAvailable = false;
    
    // Test HTTP server
    try {
      const response = await axios.get('http://127.0.0.1:4416/health', { timeout: 1000 });
      httpAvailable = response.status === 200;
    } catch (error) {
      // HTTP server not available
    }
    
    // For embedded setup, we always have the plugin available
    scriptAvailable = true;
    
    return {
      httpAvailable,
      scriptAvailable,
      embedded: true,
      automatic: true
    };
  } catch (error) {
    logger.error('Error checking bgutil availability:', error.message);
    return {
      httpAvailable: false,
      scriptAvailable: false,
      embedded: true,
      automatic: true,
      error: error.message
    };
  }
};

const getYtDlpArgs = (videoId, outputPath, options = {}) => {
  const baseArgs = [
    '--no-check-certificates',
    '--age-limit', '0',
    '--no-warnings',
    '--ignore-errors', 
    '--geo-bypass',
    '--retries', '8',
    '--socket-timeout', '120',
    '--max-filesize', '2000M',
    '--no-playlist',
    '--print', 'after_move:Downloaded %(resolution)s %(fps)sfps %(vcodec)s+%(acodec)s [%(filesize_approx)s]',
    '-o', outputPath,
    `https://www.youtube.com/watch?v=${videoId}`
  ];
  
  // Add plugin directory if it exists
  if (fs.existsSync(pluginsDir)) {
    baseArgs.push('--plugin-dirs', path.resolve(pluginsDir));
  }
  
  // Check if bgutil-ytdlp-pot-provider is available and configure accordingly
  checkBgutilAvailability().then(bgutilStatus => {
    if (bgutilStatus.httpAvailable) {
      // bgutil HTTP server is running - yt-dlp will automatically use it
      logger.info('Bgutil HTTP server detected - enhanced YouTube access enabled');
    } else if (bgutilStatus.scriptAvailable) {
      // bgutil script method available
      logger.info('Bgutil script method available');
    } else {
      logger.info('Bgutil not available - using standard YouTube access');
    }
  }).catch(() => {
    // Ignore errors in async check
  });
  
  if (options.verbose) {
    baseArgs.unshift('--verbose');
  }
  
  if (options.alternative) {
    // Alternative strategy for difficult videos
    baseArgs.push('--extractor-args', 'youtube:player_client=tv_embedded');
    baseArgs.push('-f', 'best[height<=1080]/best');
  } else {
    // Primary strategy
    const formatSelector = [
      'bestvideo[height<=1440][fps<=60]+bestaudio[acodec!=none]',
      'bestvideo[height<=1080][fps<=60]+bestaudio[acodec!=none]',
      'best[height<=1440]/best[height<=1080]',
      'bestvideo[height<=720]+bestaudio[acodec!=none]',
      'best[height<=720]',
      'best'
    ].join('/');
    
    baseArgs.push('-f', formatSelector);
  }
  
  // Output format preferences
  baseArgs.push('--merge-output-format', 'mp4');
  baseArgs.push('--fragment-retries', '10');
  baseArgs.push('--abort-on-unavailable-fragment');
  
  return baseArgs;
};

const handleDownloadError = (stderr, stdout) => {
  const stderrLower = stderr.toLowerCase();
  const stdoutLower = stdout.toLowerCase();
  
  // Age restriction errors
  if (stderrLower.includes('sign in to confirm') || stderrLower.includes('age-restricted') ||
      stdoutLower.includes('requires age verification')) {
    return { type: 'age_restricted', retry: true };
  }
  
  // Platform-specific errors
  if (isWindows) {
    if (stderrLower.includes('access is denied')) {
      return { message: 'Permission denied. Try running as administrator or check Windows Defender settings.' };
    }
    if (stderrLower.includes('virus') || stderrLower.includes('blocked')) {
      return { message: 'Download blocked by antivirus. Add Stepwise Studio to your antivirus exclusions.' };
    }
  }
  
  // Common errors
  const errorMap = {
    'video unavailable': 'Video is unavailable or has been removed from YouTube',
    'private video': 'This video is private and cannot be downloaded',
    'too large': 'Video file is too large (>1000MB limit)',
    'http error 403': { type: 'access_denied', retry: true },
    'http error 404': 'Video not found - it may have been deleted',
    'unable to extract': { type: 'extraction_failed', retry: true }
  };
  
  for (const [key, value] of Object.entries(errorMap)) {
    if (stderrLower.includes(key)) {
      return typeof value === 'string' ? { message: value } : value;
    }
  }
  
  return { message: 'Download failed' };
};

// Replace your existing setupPluginsDirectory function with this:
const setupPluginsDirectory = async () => {
  try {
    logger.info('Setting up yt-dlp plugins directory...');
    
    // Create plugins directory
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      logger.info('Created yt-dlp plugins directory:', pluginsDir);
    }
    
    // Install the embedded plugin
    const success = await setupBundledPlugin();
    
    if (success) {
      logger.info('Embedded PO token plugin installed successfully');
      
      // Start the embedded bgutil server
      try {
        embeddedBgutilServer = new EmbeddedBgutilServer();
        await embeddedBgutilServer.start();
        logger.info('✅ Embedded bgutil server started - users get automatic PO tokens!');
      } catch (error) {
        logger.warn('Embedded server failed to start, plugin will work standalone:', error.message);
        // Not fatal - the Python plugin can generate tokens directly
      }
      
      return true;
    } else {
      logger.error('Embedded plugin installation failed');
      return false;
    }
    
  } catch (error) {
    logger.error('Plugin setup failed:', error.message);
    return false;
  }
};

// Replace your existing setupBundledPlugin function with this:
const setupBundledPlugin = async () => {
  try {
    const pluginPath = path.join(pluginsDir, 'stepwise_embedded_pot');
    
    logger.info('Installing embedded PO token plugin...');
    
    // Create directory structure
    const directories = [
      pluginPath,
      path.join(pluginPath, 'yt_dlp_plugins'),
      path.join(pluginPath, 'yt_dlp_plugins', 'postprocessor')
    ];
    
    directories.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Write bundled plugin files (these will be created by the bundle script)
    const bundledPluginFiles = require('./src/bundled-plugin-files.js');
    Object.entries(bundledPluginFiles).forEach(([filePath, content]) => {
      const fullPath = path.join(pluginPath, filePath);
      fs.writeFileSync(fullPath, content, 'utf8');
      logger.debug(`Created plugin file: ${filePath}`);
    });
    
    // Verify installation
    const requiredFiles = Object.keys(bundledPluginFiles);
    const allFilesExist = requiredFiles.every(file => {
      const fullPath = path.join(pluginPath, file);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0;
    });
    
    if (allFilesExist) {
      logger.info('Embedded PO token plugin installed successfully');
      return true;
    } else {
      logger.error('Plugin installation incomplete');
      return false;
    }
    
  } catch (error) {
    logger.error('Failed to install embedded plugin:', error.message);
    return false;
  }
};

// Update your checkPOTokenPluginStatus function:
const checkPOTokenPluginStatus = async () => {
  try {
    const pluginPath = path.join(pluginsDir, 'stepwise_embedded_pot');
    const mainFile = path.join(pluginPath, 'yt_dlp_plugins', 'postprocessor', 'embedded_pot_provider.py');
    
    const installed = fs.existsSync(mainFile);
    
    // Check if embedded server is running
    let serverRunning = false;
    if (embeddedBgutilServer) {
      try {
        const response = await axios.get('http://127.0.0.1:4416/health', { timeout: 1000 });
        serverRunning = response.status === 200;
      } catch (error) {
        // Server not responding
      }
    }
    
    return {
      installed,
      path: installed ? pluginPath : null,
      bundled: true,
      embedded: true,
      serverRunning,
      type: 'embedded_pot_provider',
      automatic: true // This is the key - it's automatic!
    };
  } catch (error) {
    logger.error('Error checking plugin status:', error.message);
    return { 
      installed: false, 
      path: null, 
      bundled: false,
      embedded: false,
      serverRunning: false,
      automatic: false,
      error: error.message 
    };
  }
};

// Update your testYtDlpWithPlugin function:
const testYtDlpWithPlugin = async () => {
  return new Promise((resolve) => {
    const testArgs = [
      '--version',
      '--plugin-dirs', path.resolve(pluginsDir),
      '--list-postprocessors',
      '--verbose'
    ];
    
    const testProcess = spawn(ytDlpPath, testArgs, getSpawnOptions(30000));
    let output = '';
    let error = '';
    
    testProcess.stdout.on('data', (data) => output += data.toString());
    testProcess.stderr.on('data', (data) => error += data.toString());
    
    testProcess.on('close', async (code) => {
      // Check for plugin indicators
      const pluginLoaded = 
        error.includes('stepwise') || 
        error.includes('EmbeddedPotProvider') ||
        error.includes('embedded_pot_provider') ||
        output.includes('EmbeddedPotProvider');
      
      // Check embedded server
      let serverStatus = false;
      try {
        const response = await axios.get('http://127.0.0.1:4416/health', { timeout: 1000 });
        serverStatus = response.status === 200;
      } catch (e) {
        // Server not running
      }
      
      resolve({ 
        success: code === 0,
        version: output.split('\n')[0] || 'unknown',
        pluginLoaded,
        embeddedServerRunning: serverStatus,
        embeddedPotEnabled: pluginLoaded, // Plugin provides tokens directly
        automaticSetup: true, // Key indicator for users
        stderr: error.substring(0, 1000),
        stdout: output.substring(0, 1000)
      });
    });
    
    testProcess.on('error', (error) => {
      resolve({ 
        success: false, 
        error: error.message,
        pluginLoaded: false,
        embeddedServerRunning: false,
        embeddedPotEnabled: false,
        automaticSetup: false
      });
    });
  });
};

function cleanupOldVideos() {
  try {
    const files = fs.readdirSync(videosDir);
    const now = Date.now();
    const maxAge = 0; // 0 hours

    let cleaned = 0;
    files.forEach(file => {
      const filePath = path.join(videosDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (err) {
        logger.warn('Could not clean up file:', file);
      }
    });
    
    if (cleaned > 0) logger.info(`Cleaned up ${cleaned} old video(s)`);
  } catch (err) {
    logger.error('Cleanup error:', err.message);
  }
}

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

// Initialize yt-dlp
async function initializeYtDlp() {
  try {
    logger.info('Initializing yt-dlp...');
    
    const binaryName = isWindows ? 'yt-dlp.exe' : (isMac ? 'yt-dlp-macos' : 'yt-dlp-linux');
    ytDlpPath = findBinary(binaryName);
    
    if (!ytDlpPath) {
      throw new Error(`yt-dlp binary not found for ${binaryName}`);
    }
    
    const stats = fs.statSync(ytDlpPath);
    if (stats.size < 100000) {
      logger.warn('Binary file seems too small, might be corrupted');
    }
    
    if (!isWindows) {
      execSync(`chmod +x "${ytDlpPath}"`);
    }
    
    const testResult = await testYtDlp();
    logger.info(testResult.success ? 'yt-dlp ready' : 'yt-dlp test failed but continuing');
    return true;
    
  } catch (error) {
    logger.error('Failed to initialize yt-dlp:', error.message);
    ytDlpPath = null;
    
    if (app.isReady()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'yt-dlp Warning',
        message: 'Video downloader may not work properly',
        detail: `Warning: ${error.message}`,
        buttons: ['OK']
      });
    }
    return false;
  }
}

async function testYtDlp() {
  return new Promise((resolve) => {
    const testProcess = spawn(ytDlpPath, ['--version'], getSpawnOptions(60000));
    let output = '';
    
    testProcess.stdout.on('data', (data) => output += data.toString());
    testProcess.on('close', (code) => {
      resolve({ 
        success: code === 0 && output.trim(), 
        version: output.trim(),
        error: code !== 0 ? `Exit code ${code}` : null 
      });
    });
    testProcess.on('error', (error) => resolve({ success: false, error: error.message }));
    
    setTimeout(() => {
      testProcess.kill('SIGTERM');
      resolve({ success: false, error: 'Test timeout' });
    }, 60000);
  });
}

// Main download function
const executeDownload = (videoId, outputPath, options = {}) => {
  return new Promise((resolve, reject) => {
    const args = getYtDlpArgs(videoId, outputPath, options);
    const downloadProcess = spawn(ytDlpPath, args, getSpawnOptions());
    
    let stderr = '';
    let stdout = '';
    
    downloadProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      if (options.verbose) logger.info('Download progress:', data.toString().trim());
    });
    
    downloadProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      if (options.verbose) logger.warn('Download stderr:', data.toString().trim());
    });
    
    downloadProcess.on('close', (code) => {
      // Check if file was actually downloaded
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 1024) { // File has content
          const fileUrl = `file:///${outputPath.replace(/\\/g, '/')}`;
          logger.info(`Download successful: ${videoId} (${Math.round(stats.size / 1024)}KB)`);
          resolve({ url: fileUrl });
          return;
        } else {
          // Remove empty file
          fs.unlinkSync(outputPath);
          logger.warn(`Downloaded file was empty: ${videoId}`);
        }
      }
      
      // Download failed - try alternative method
      const error = handleDownloadError(stderr, stdout);
      if (error.retry && !options.alternative) {
        logger.info('Primary method failed, trying alternative download method...');
        
        // Try alternative method with more lenient settings
        executeDownload(videoId, outputPath, { 
          alternative: true,
          verbose: options.verbose 
        })
          .then(resolve)
          .catch(() => {
            // If alternative also fails, try one more time with most basic settings
            logger.info('Alternative method failed, trying basic download...');
            executeDownloadBasic(videoId, outputPath, options)
              .then(resolve)
              .catch(() => reject(new Error(error.message || 'All download methods failed')));
          });
      } else {
        reject(new Error(error.message || 'Download failed'));
      }
    });
    
    downloadProcess.on('error', (error) => {
      let errorMsg = `Failed to start download process: ${error.message}`;
      if (isWindows && error.code === 'ENOENT') {
        errorMsg = 'yt-dlp executable not found. Check if antivirus software quarantined it.';
      }
      reject(new Error(errorMsg));
    });
  });
};

const executeDownloadBasic = (videoId, outputPath, options = {}) => {
  return new Promise((resolve, reject) => {
    // Most basic args that should work for any video
    const basicArgs = [
      '--no-check-certificates',
      '--ignore-errors',
      '--no-playlist',
      '-f', 'best/worst', // Accept ANY available format
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    
    if (options.verbose) {
      basicArgs.unshift('--verbose');
    }
    
    const downloadProcess = spawn(ytDlpPath, basicArgs, getSpawnOptions());
    
    let stderr = '';
    let stdout = '';
    
    downloadProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      if (options.verbose) logger.info('Basic download:', data.toString().trim());
    });
    
    downloadProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      if (options.verbose) logger.warn('Basic download stderr:', data.toString().trim());
    });
    
    downloadProcess.on('close', (code) => {
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 1024) {
          const fileUrl = `file:///${outputPath.replace(/\\/g, '/')}`;
          logger.info(`Basic download successful: ${videoId}`);
          resolve({ url: fileUrl });
          return;
        } else {
          fs.unlinkSync(outputPath);
        }
      }
      
      const error = handleDownloadError(stderr, stdout);
      reject(new Error(error.message || 'Basic download failed'));
    });
    
    downloadProcess.on('error', (error) => {
      reject(new Error(`Basic download process failed: ${error.message}`));
    });
  });
};

// Menu creation
function createMenuTemplate() {
  const shortcuts = {
    new: 'CmdOrCtrl+N', open: 'CmdOrCtrl+O', save: 'CmdOrCtrl+S',
    close: 'CmdOrCtrl+W', quit: isMac ? 'Cmd+Q' : 'Alt+F4',
    undo: 'CmdOrCtrl+Z', redo: isWindows ? 'CmdOrCtrl+Y' : 'CmdOrCtrl+Shift+Z',
    cut: 'CmdOrCtrl+X', copy: 'CmdOrCtrl+C', paste: 'CmdOrCtrl+V'
  };

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: shortcuts.new, click: () => logger.info('New file') },
        { label: 'Open', accelerator: shortcuts.open, click: () => logger.info('Open file') },
        { label: 'Save', accelerator: shortcuts.save, click: () => logger.info('Save') },
        { type: 'separator' },
        { label: 'Close', accelerator: shortcuts.close, click: () => BrowserWindow.getFocusedWindow()?.close() },
        { label: isWindows ? 'Exit' : 'Quit', accelerator: shortcuts.quit, click: () => app.quit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: shortcuts.undo, role: 'undo' },
        { label: 'Redo', accelerator: shortcuts.redo, role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: shortcuts.cut, role: 'cut' },
        { label: 'Copy', accelerator: shortcuts.copy, role: 'copy' },
        { label: 'Paste', accelerator: shortcuts.paste, role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectall' }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        // yt-dlp Testing
        {
          label: 'Test yt-dlp',
          click: async () => {
            if (!ytDlpPath) {
              dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'yt-dlp Not Found',
                message: 'yt-dlp binary is not initialized',
                buttons: ['OK']
              });
              return;
            }
            
            const result = await testYtDlp();
            dialog.showMessageBox(mainWindow, {
              type: result.success ? 'info' : 'warning',
              title: 'yt-dlp Test Result',
              message: result.success ? 'yt-dlp is working correctly' : 'yt-dlp test failed',
              detail: result.error || result.version || 'Binary is ready',
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Test Download',
          click: async () => {
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: 'Test Video Download',
              message: 'Test download with a sample video?',
              detail: 'This will download a short test video to verify the download system is working.',
              buttons: ['Test Download', 'Cancel'],
              defaultId: 0
            });
            
            if (result.response === 0) {
              // Use a short, reliable test video
              const testVideoId = 'jNQXAC9IVRw'; // "Me at the zoo" - first YouTube video, very short
              
              try {
                mainWindow.webContents.send('show-loading', { message: 'Testing download...' });
                
                const downloadResult = await executeDownload(
                  testVideoId, 
                  path.join(videosDir, `test_${testVideoId}.mp4`), 
                  { verbose: true }
                );
                
                mainWindow.webContents.send('hide-loading');
                
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Download Test Success',
                  message: 'Test download completed successfully!',
                  detail: `Video downloaded and ready to play.\nCheck the console for detailed logs.`,
                  buttons: ['OK', 'Play Video']
                }).then((result) => {
                  if (result.response === 1) {
                    // Try to play the video
                    shell.openPath(path.join(videosDir, `test_${testVideoId}.mp4`));
                  }
                });
              } catch (error) {
                mainWindow.webContents.send('hide-loading');
                
                dialog.showMessageBox(mainWindow, {
                  type: 'error', 
                  title: 'Download Test Failed',
                  message: 'Test download failed',
                  detail: `Error: ${error.message}\n\nCheck the console for detailed error logs.`,
                  buttons: ['OK']
                });
              }
            }
          }
        },
        {
          type: 'separator'
        },
        // PO Token Plugin Management
        {
          label: 'PO Token Plugin',
          submenu: [
            {
              label: 'PO Token Status',
              click: async () => {
                const status = await checkPOTokenPluginStatus();
                
                dialog.showMessageBox(mainWindow, {
                  type: status.installed ? 'info' : 'warning',
                  title: 'PO Token Status',
                  message: status.installed ? 'Automatic PO Token Support Active!' : 'PO Token support not available',
                  detail: `
            Plugin: ${status.installed ? '✅ INSTALLED' : '❌ MISSING'}
            Type: ${status.embedded ? 'Embedded (Automatic)' : 'External'}
            Server: ${status.serverRunning ? '✅ RUNNING' : '⚠️  Plugin-based'}
            Location: ${status.path || 'N/A'}

            ${status.automatic ? 
              '🎉 Users get enhanced YouTube access automatically!\nNo setup, no configuration, no external dependencies!' : 
              'Plugin missing. This should not happen in distribution builds.'}
                  `.trim(),
                  buttons: ['OK']
                });
              }
            },
            {
              label: 'Reinstall Plugin',
              click: async () => {
                const result = await dialog.showMessageBox(mainWindow, {
                  type: 'question',
                  title: 'Reinstall Plugin',
                  message: 'Reinstall the PO Token plugin?',
                  detail: 'This will remove the existing plugin and create a fresh installation.',
                  buttons: ['Reinstall', 'Cancel'],
                  defaultId: 0
                });
                
                if (result.response === 0) {
                  try {
                    // Remove existing plugin completely
                    const pluginPath = path.join(pluginsDir, 'bgutil_ytdlp_pot_provider');
                    if (fs.existsSync(pluginPath)) {
                      fs.rmSync(pluginPath, { recursive: true, force: true });
                      logger.info('Removed existing plugin');
                    }
                    
                    // Clear the entire plugins directory and recreate
                    if (fs.existsSync(pluginsDir)) {
                      fs.rmSync(pluginsDir, { recursive: true, force: true });
                    }
                    fs.mkdirSync(pluginsDir, { recursive: true });
                    
                    // Wait a moment for filesystem operations to complete
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Reinstall with the fixed version
                    await createBundledPlugin(pluginPath);
                    
                    // Test the plugin
                    const pluginTest = await testYtDlpWithPlugin();
                    const status = await checkPOTokenPluginStatus();
                    
                    dialog.showMessageBox(mainWindow, {
                      type: pluginTest.pluginLoaded ? 'info' : 'warning',
                      title: 'Plugin Reinstalled',
                      message: pluginTest.pluginLoaded ? 'Plugin installed and detected!' : 'Plugin installed but not detected',
                      detail: `
            Installation: SUCCESS
            Files Created: ${status.installed ? 'YES' : 'NO'}
            Plugin Loaded by yt-dlp: ${pluginTest.pluginLoaded ? 'YES' : 'NO'}
            Location: ${pluginPath}

            ${pluginTest.pluginLoaded ? 
              'The plugin is now working and should provide better video quality.' : 
              'Plugin installed but yt-dlp is not detecting it. Check the console for details.'}
                      `.trim(),
                      buttons: ['OK']
                    });
                  } catch (error) {
                    dialog.showMessageBox(mainWindow, {
                      type: 'error',
                      title: 'Reinstallation Failed',
                      message: 'Failed to reinstall plugin',
                      detail: `Error: ${error.message}\n\nTry restarting the application.`,
                      buttons: ['OK']
                    });
                  }
                }
              }
            },
            {
              label: 'Debug Plugin System',
              click: async () => {
                // Run debug function
                debugPluginDirectory();
                
                // Get detailed status
                const status = await checkPOTokenPluginStatus();
                let pluginFilesList = 'Unknown';
                
                try {
                  const pluginPath = path.join(pluginsDir, 'bgutil_ytdlp_pot_provider');
                  if (fs.existsSync(pluginPath)) {
                    const files = fs.readdirSync(pluginPath);
                    pluginFilesList = files.join(', ');
                  } else {
                    pluginFilesList = 'Directory not found';
                  }
                } catch (error) {
                  pluginFilesList = `Error: ${error.message}`;
                }
                
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Plugin Debug Information',
                  message: 'Plugin System Debug Results',
                  detail: `
    Plugin Directory: ${pluginsDir}
    Directory Exists: ${fs.existsSync(pluginsDir) ? 'YES' : 'NO'}
    Plugin Installed: ${status.installed ? 'YES' : 'NO'}
    Plugin Files: ${pluginFilesList}

    Detailed information has been logged to the console.
    Check the console for complete debug output.
                  `.trim(),
                  buttons: ['OK', 'Open Plugin Folder']
                }).then((result) => {
                  if (result.response === 1) {
                    if (!fs.existsSync(pluginsDir)) {
                      fs.mkdirSync(pluginsDir, { recursive: true });
                    }
                    shell.openPath(pluginsDir);
                  }
                });
              }
            }
          ]
        },
        {
          type: 'separator'
        },
        // File Management
        {
          label: 'Open Videos Folder',
          click: () => {
            if (!fs.existsSync(videosDir)) {
              fs.mkdirSync(videosDir, { recursive: true });
            }
            shell.openPath(videosDir);
          }
        },
        {
          label: 'Open Plugins Folder',
          click: () => {
            if (!fs.existsSync(pluginsDir)) {
              fs.mkdirSync(pluginsDir, { recursive: true });
            }
            shell.openPath(pluginsDir);
          }
        },
        {
          type: 'separator'
        },
        // Maintenance
        {
          label: 'Cleanup Videos',
          click: async () => {
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: 'Cleanup Videos',
              message: 'Clear all cached videos?',
              detail: 'This will delete all downloaded videos from the cache folder. They will be re-downloaded when needed.',
              buttons: ['Clear Cache', 'Cancel'],
              defaultId: 1
            });
            
            if (result.response === 0) {
              try {
                cleanupOldVideos();
                
                // Get count of remaining files
                const remaining = fs.existsSync(videosDir) ? 
                  fs.readdirSync(videosDir).filter(f => f.endsWith('.mp4')).length : 0;
                
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Cleanup Complete',
                  message: 'Video cache has been cleared',
                  detail: `Remaining video files: ${remaining}`,
                  buttons: ['OK']
                });
              } catch (error) {
                dialog.showMessageBox(mainWindow, {
                  type: 'error',
                  title: 'Cleanup Failed',
                  message: 'Failed to clear video cache',
                  detail: error.message,
                  buttons: ['OK']
                });
              }
            }
          }
        },
        {
          label: 'System Information',
          click: () => {
            const health = getDiskSpace();
            const platform = process.platform;
            const arch = process.arch;
            const nodeVersion = process.version;
            const electronVersion = process.versions.electron;
            
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'System Information',
              message: 'Stepwise Studio System Info',
              detail: `
    App Version: ${app.getVersion()}
    Platform: ${platform} (${arch})
    Node.js: ${nodeVersion}
    Electron: ${electronVersion}

    Videos Directory: ${videosDir}
    Cached Videos: ${health.videoFiles || 0}
    Total Files: ${health.fileCount || 0}

    yt-dlp: ${ytDlpPath ? 'Available' : 'Not Found'}
    Plugins: ${fs.existsSync(pluginsDir) ? 'Directory Ready' : 'Not Setup'}
              `.trim(),
              buttons: ['OK']
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
              detail: 'Precision • Dance • Control',
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  if (isMac) {
    template.unshift({
      label: 'Stepwise Studio',
      submenu: [
        { label: 'About Stepwise Studio', role: 'about' },
        { type: 'separator' },
        { label: 'Hide Stepwise Studio', accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Command+Shift+H', role: 'hideothers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() }
      ]
    });
  }

  return template;
}

function createMenu() {
  const menu = Menu.buildFromTemplate(createMenuTemplate());
  Menu.setApplicationMenu(menu);
}

// Window management
class WindowStateManager {
  constructor() {
    this.stateFile = path.join(app.getPath('userData'), 'window-state.json');
    this.defaultState = {
      width: 1400, height: 900, x: undefined, y: undefined,
      isMaximized: false, isFullScreen: false
    };
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        return { ...this.defaultState, ...state };
      }
    } catch (error) {
      logger.warn('Could not load window state:', error.message);
    }
    return this.defaultState;
  }

  saveState(window) {
    try {
      const bounds = window.getBounds();
      const state = {
        ...bounds,
        isMaximized: window.isMaximized(),
        isFullScreen: window.isFullScreen()
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      logger.warn('Could not save window state:', error.message);
    }
  }

  manage(window) {
    const saveState = () => this.saveState(window);
    ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'close']
      .forEach(event => window.on(event, saveState));
  }
}

// Preferences management
class UserPreferencesManager {
  constructor() {
    this.preferencesFile = path.join(app.getPath('userData'), 'user-preferences.json');
    this.defaultPreferences = {
      volume: 1, playbackRate: 1, loopMode: false, loopStartTime: 0, loopEndTime: 10,
      mirrorMode: false, lastSearchQuery: '', savedVideos: [], recentVideos: [],
      theme: 'default', lastVideoId: null, lastVideoTitle: '', lastThumbnail: '',
      currentVideoTime: 0, totalPracticeTime: 0, sessionCount: 0, lastSessionDate: null
    };
  }

  loadPreferences() {
    try {
      if (fs.existsSync(this.preferencesFile)) {
        const preferences = JSON.parse(fs.readFileSync(this.preferencesFile, 'utf8'));
        return { ...this.defaultPreferences, ...preferences };
      }
    } catch (error) {
      logger.warn('Could not load preferences:', error.message);
    }
    return this.defaultPreferences;
  }

  savePreferences(preferences) {
    try {
      fs.writeFileSync(this.preferencesFile, JSON.stringify(preferences, null, 2));
    } catch (error) {
      logger.warn('Could not save preferences:', error.message);
    }
  }

  update(updates) {
    const preferences = this.loadPreferences();
    Object.assign(preferences, updates);
    this.savePreferences(preferences);
  }
}

// Initialize managers
const windowStateManager = new WindowStateManager();
const preferencesManager = new UserPreferencesManager();

// Window creation
function createWindow() {
  const windowState = windowStateManager.loadState();
  
  const windowOptions = {
    ...windowState,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    autoHideMenuBar: false
  };

  const iconPath = path.join(__dirname, 'assets', 'stepwise-icon.png');
  if (fs.existsSync(iconPath)) windowOptions.icon = iconPath;

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.once('ready-to-show', () => {
    if (windowState.isMaximized) mainWindow.maximize();
    if (windowState.isFullScreen) mainWindow.setFullScreen(true);
    mainWindow.show();
    logger.info('Window ready');
  });

  windowStateManager.manage(mainWindow);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => mainWindow = null);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// IPC Handlers
ipcMain.handle('download-video', async (event, videoId) => {
  try {
    if (!videoId?.trim()) throw new Error('Video ID is required');
    if (!ytDlpPath) throw new Error('yt-dlp not available');
    if (!fs.existsSync(ytDlpPath)) throw new Error(`yt-dlp binary does not exist at: ${ytDlpPath}`);

    const outputPath = path.join(videosDir, `${videoId}.mp4`);
    
    // Check if video already exists
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size > 1024) {
        const fileUrl = `file:///${outputPath.replace(/\\/g, '/')}`;
        logger.info('Video already cached:', videoId);
        return { url: fileUrl };
      } else {
        fs.unlinkSync(outputPath);
      }
    }

    logger.info('Starting video download:', videoId);
    return await executeDownload(videoId, outputPath, { verbose: true });

  } catch (error) {
    logger.error('Download failed:', error.message);
    throw error;
  }
});

ipcMain.handle('youtube-search', async (event, query) => {
  try {
    if (!query?.trim()) throw new Error('Search query is required');

    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet', type: 'video', maxResults: 12,
        q: query.trim() + ' dance tutorial',
        key: 'AIzaSyCnYR4E6pNBl-oHscWZOE_akXbmOtT7FfI',
        safeSearch: 'strict'
      },
      timeout: 10000
    });

    logger.info(`Found ${response.data.items?.length || 0} videos`);
    return response.data;

  } catch (error) {
    logger.error('YouTube API error:', error.message);
    
    let errorMessage = 'Failed to search YouTube';
    if (error.response?.status === 403) {
      errorMessage = 'YouTube API quota exceeded or invalid key';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = isWindows ? 'No internet connection. Check Windows Firewall settings.' : 'No internet connection';
    }
    
    throw new Error(errorMessage);
  }
});

ipcMain.handle('check-po-token-plugin', async () => {
  return await checkPOTokenPluginStatus();
});

// Additional IPC handlers
const ipcHandlers = {
  'get-app-version': () => app.getVersion(),
  'show-message-box': async (event, options) => await dialog.showMessageBox(mainWindow, options),
  'get-health': () => ({
    status: 'healthy', timestamp: new Date().toISOString(), videosDir: fs.existsSync(videosDir),
    diskSpace: getDiskSpace(), ytDlpReady: !!ytDlpPath, platform: process.platform
  }),
  'cleanup-videos': () => { cleanupOldVideos(); return { success: true }; },
  'get-video-list': () => {
    try {
      return fs.readdirSync(videosDir)
        .filter(f => f.endsWith('.mp4'))
        .map(file => {
          const filePath = path.join(videosDir, file);
          const stats = fs.statSync(filePath);
          return { id: path.basename(file, '.mp4'), filename: file, size: stats.size, created: stats.birthtime };
        });
    } catch (err) {
      return [];
    }
  },
  'test-ytdlp': async () => {
    try {
      if (!ytDlpPath) return { ready: false, error: 'yt-dlp not initialized' };
      const result = await testYtDlp();
      return { ready: result.success, path: ytDlpPath, error: result.error, version: result.version };
    } catch (error) {
      return { ready: false, error: error.message };
    }
  },
  'reinitialize-ytdlp': async () => {
    try {
      const success = await initializeYtDlp();
      return { success, path: ytDlpPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
  'get-preferences': () => preferencesManager.loadPreferences(),
  'save-preferences': (event, preferences) => { preferencesManager.savePreferences(preferences); return true; },
  'update-preferences': (event, updates) => { preferencesManager.update(updates); return true; }
};

Object.entries(ipcHandlers).forEach(([channel, handler]) => {
  ipcMain.handle(channel, handler);
});

// Session tracking
let sessionStartTime = Date.now();

ipcMain.handle('get-session-time', () => Date.now() - sessionStartTime);
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

// App event handlers
// Add this to your app.whenReady() function:
app.whenReady().then(async () => {
  try {
    logger.info('Starting Stepwise Studio with embedded bgutil...');
    
    createWindow();
    createMenu();
    
    // This now sets up everything automatically - no user action needed!
    await setupPluginsDirectory();
    await initializeYtDlp();
    
    logger.info('🎉 Stepwise Studio ready with automatic PO token support!');
    logger.info('📊 Users get enhanced YouTube access with zero configuration!');
  } catch (err) {
    logger.error('Failed to start application:', err);
    dialog.showErrorBox('Startup Error', `Failed to start Stepwise Studio: ${err.message}`);
  }
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    windowStateManager.saveState(mainWindow);
    mainWindow.webContents.send('app-closing');
  }
  
  // Stop embedded server
  if (embeddedBgutilServer) {
    embeddedBgutilServer.stop();
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('Application Error', error.message);
  }
});

logger.info('Videos directory:', videosDir);
logger.info('Stepwise Studio main process loaded');

// Export the functions for use in your main app
module.exports = {
  setupPluginsDirectory,
  setupBundledPlugin,
  getYtDlpArgs,
  testYtDlpWithPlugin,
  checkPOTokenPluginStatus,
  checkBgutilAvailability
};