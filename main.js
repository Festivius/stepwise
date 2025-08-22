// main.js

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ytdlp = require('yt-dlp-exec');

// Constants
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const videosDir = path.join(app.getPath('userData'), 'videos');

// Logging utility
const logger = {
  info: (msg, ...args) => console.log(`ℹ️ ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`⚠️ ${msg}`, ...args),
  error: (msg, ...args) => console.error(`❌ ${msg}`, ...args)
};

let mainWindow;

// Initialize directories
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  logger.info('Created videos directory:', videosDir);
}

// Utility functions
function isValidVideoFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size > 1024 * 1024; // At least 1MB
  } catch {
    return false;
  }
}

function cleanupOldVideos() {
  try {
    const files = fs.readdirSync(videosDir);
    const now = Date.now();
    const maxAge = 0;

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

// ---------- Format helpers (place near other utilities) ----------
function pick1080PolicyFormats(formats) {
  // Keep only actual video formats with a height
  const vfmts = formats.filter(f => f.vcodec && f.vcodec !== 'none' && Number.isFinite(f.height));
  const afmts = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));

  if (!vfmts.length) return { format: 'best', note: 'no-video-formats', summary: 'No video formats found' };

  // Determine the best height we are allowed to fetch (<=1080) and prefer exactly 1080
  const heights = [...new Set(vfmts.map(f => f.height))].sort((a, b) => b - a);
  const has1080 = heights.includes(1080);
  const bestAllowedHeight = heights.find(h => h <= 1080);
  const targetHeight = has1080 ? 1080 : (bestAllowedHeight ?? heights[0]);

  // Prefer progressive mp4 at targetHeight when available (simplest path)
  const progressiveAtTarget = vfmts
    .filter(f => f.height === targetHeight && f.acodec && f.acodec !== 'none')
    .sort((a, b) => {
      // prioritize mp4 + h264/aac, then higher tbr/fps
      const score = fmt => (
        (fmt.ext === 'mp4' ? 3 : 0) +
        (/avc1|h264/i.test(fmt.vcodec) ? 2 : 0) +
        (/m4a|aac/i.test(fmt.acodec) ? 1 : 0)
      );
      return (score(b) - score(a)) || ((b.tbr || 0) - (a.tbr || 0)) || ((b.fps || 0) - (a.fps || 0));
    });

  if (progressiveAtTarget.length) {
    const p = progressiveAtTarget[0];
    return {
      format: `${p.format_id}`,
      targetHeight,
      requiresRecode: p.ext !== 'mp4' || !/avc1|h264/i.test(p.vcodec) || !/m4a|aac/i.test(p.acodec),
      note: 'progressive',
      summary: `${p.height}p • ${p.fps || 30}fps • ${p.vcodec}+${p.acodec} • ${p.ext}`
    };
  }

  // Otherwise, prefer video-only + audio merge at target height
  const videoOnlyAtTarget = vfmts
    .filter(f => f.height === targetHeight && (!f.acodec || f.acodec === 'none'))
    .sort((a, b) => {
      // prefer mp4 container and avc1/h264 for mp4-friendly merge
      const score = fmt => (
        (fmt.ext === 'mp4' ? 3 : 0) +
        (/avc1|h264/i.test(fmt.vcodec) ? 2 : 0) +
        ((fmt.fps || 0) >= 60 ? 1 : 0)
      );
      return (score(b) - score(a)) || ((b.tbr || 0) - (a.tbr || 0));
    });

  const bestAudio = afmts
    .sort((a, b) => {
      const score = fmt => (
        (/m4a|aac/i.test(fmt.acodec) ? 2 : 0) + // mp4-friendly first
        (fmt.ext === 'm4a' ? 1 : 0)
      );
      return (score(b) - score(a)) || ((b.abr || 0) - (a.abr || 0));
    })[0];

  if (videoOnlyAtTarget.length && bestAudio) {
    const v = videoOnlyAtTarget[0];
    const a = bestAudio;
    const mp4Friendly = (v.ext === 'mp4' && /avc1|h264/i.test(v.vcodec)) && (/m4a|aac/i.test(a.acodec));
    return {
      format: `${v.format_id}+${a.format_id}`,
      targetHeight,
      requiresRecode: !mp4Friendly,
      note: 'separate-av',
      summary: `${v.height}p${v.fps ? ` • ${v.fps}fps` : ''} • ${v.vcodec}+${a.acodec} • ${v.ext}+${a.ext}`
    };
  }

  // Fallback: best ≤1080 (whatever it is)
  return {
    format: "bv*[height=1080]+ba/b[height=1080]/bv*[height<=1080]+ba/b[height<=1080]",
    targetHeight,
    requiresRecode: false,
    note: 'fallback-selector',
    summary: `best ≤${targetHeight}p (auto)`
  };
}

async function probeVideoInfo(videoUrl, baseOptions = {}) {
  const result = await ytdlp(videoUrl, {
    ...baseOptions,
    dumpSingleJson: true,
    noPlaylist: true,
    simulate: true,
    skipDownload: true,
    noWarnings: true,
    quiet: true
  });

  // yt-dlp-exec may already parse JSON for us
  if (typeof result === 'string' || Buffer.isBuffer(result)) {
    return JSON.parse(String(result));
  } else if (typeof result === 'object' && result !== null) {
    return result; // already parsed
  } else {
    throw new Error('Unexpected yt-dlp probe output type: ' + typeof result);
  }
}

// ---------- Enforced 1080p-or-lower downloader ----------
async function downloadVideo(videoId, options = {}) {
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputTemplate = path.join(videosDir, `${videoId}.%(ext)s`);
    const finalMp4Path = path.join(videosDir, `${videoId}.mp4`);

    // use cached file if valid
    if (fs.existsSync(finalMp4Path) && isValidVideoFile(finalMp4Path)) {
      const fileUrl = `file:///${finalMp4Path.replace(/\\/g, '/')}`;
      logger.info('Video already cached:', videoId);
      return { url: fileUrl };
    }

    logger.info('Starting video download with 1080p policy:', videoId);

    // Client strategies reused for both probing and download
    const clientStrategies = [
      {
        name: "Fresh Session (Web-like)",
        base: {
          addHeader: [
            'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept-Language:en-US,en;q=0.9'
          ],
          geoBypass: true,
          noPlaylist: true,
          retries: 10,
          fragmentRetries: 15,
          socketTimeout: 120
        },
        extractorArgs: null
      },
      {
        name: "Android Client",
        base: {
          addHeader: ['User-Agent:com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip'],
          geoBypass: true,
          noPlaylist: true,
          retries: 10
        },
        extractorArgs: 'youtube:player_client=android'
      },
      {
        name: "TV Client",
        base: {
          addHeader: ['User-Agent:Mozilla/5.0 (ChromiumStylePlatform) Cobalt/40.13031.0'],
          geoBypass: true,
          noPlaylist: true,
          retries: 10
        },
        extractorArgs: 'youtube:player_client=tv_embedded'
      },
      {
        name: "Web Client (explicit)",
        base: {
          addHeader: [
            'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language:en-US,en;q=0.9',
            'Sec-Fetch-Mode:navigate'
          ],
          geoBypass: true,
          noPlaylist: true,
          retries: 15
        },
        extractorArgs: 'youtube:player_client=web'
      }
    ];

    // try each client for probing + download
    for (const client of clientStrategies) {
      try {
        logger.info(`Probing formats via ${client.name}...`);

        const probeInfo = await probeVideoInfo(videoUrl, {
          ...(client.base || {}),
          ...(client.extractorArgs ? { extractorArgs: client.extractorArgs } : {})
        });

        const { formats = [], title } = probeInfo || {};
        if (!formats || !Array.isArray(formats) || formats.length === 0) {
          throw new Error('No formats found during probe');
        }

        const selection = pick1080PolicyFormats(formats);
        logger.info(
          `🎯 Format decision via ${client.name}: ${selection.summary} ` +
          `(target ${selection.targetHeight}p, note=${selection.note}, recode=${selection.requiresRecode})`
        );

        // Build final download options
        const dlOpts = {
          ...(client.base || {}),
          ...(client.extractorArgs ? { extractorArgs: client.extractorArgs } : {}),
          format: selection.format,
          // We want a final .mp4 on disk for caching consistency
          output: outputTemplate,
          mergeOutputFormat: 'mp4',
          addMetadata: true,
          writeThumbnail: false,
          embedThumbnail: false,
          // force sorting to prefer 1080 when our format expression has branches
          formatSort: ['res:1080', 'fps', 'vcodec:avc1', 'acodec:m4a', 'ext:mp4'],
          formatSortForce: true,
          noPlaylist: true,
          retries: Math.max(10, (client.base?.retries || 0)),
          fragmentRetries: 15,
          continue: true,
          noAbortOnUnavailableFragment: true,
          verbose: !!options.verbose
        };

        // If our chosen pair/progressive isn’t mp4-friendly, explicitly recode to mp4
        if (selection.requiresRecode) {
          dlOpts.recodeVideo = 'mp4'; // may be slower but guarantees .mp4
        }

        logger.info(`Downloading via ${client.name}...`);
        await ytdlp(videoUrl, dlOpts);

        // Verify final .mp4
        if (fs.existsSync(finalMp4Path) && isValidVideoFile(finalMp4Path)) {
          const fileUrl = `file:///${finalMp4Path.replace(/\\/g, '/')}`;
          logger.info(`✅ ${client.name} successful:`, { videoId, title, path: finalMp4Path });
          return { url: fileUrl };
        }

        // Sometimes yt-dlp writes a non-mp4 (e.g., .mkv) when recoding fails; try to normalize
        const altFiles = fs.readdirSync(videosDir).filter(f => f.startsWith(`${videoId}.`));
        const alt = altFiles.find(f => f !== `${videoId}.mp4`);
        if (alt && fs.existsSync(path.join(videosDir, alt)) && isValidVideoFile(path.join(videosDir, alt))) {
          // last-ditch: try to rename if it actually is mp4 in disguise (rare)
          if (alt.endsWith('.mp4')) {
            fs.renameSync(path.join(videosDir, alt), finalMp4Path);
            const fileUrl = `file:///${finalMp4Path.replace(/\\/g, '/')}`;
            logger.info(`ℹ️ Normalized alt file to mp4 for: ${videoId}`);
            return { url: fileUrl };
          }
        }

        throw new Error('Download did not produce a valid .mp4');
      } catch (err) {
        logger.warn(`❌ ${client.name} failed:`, err?.message || String(err));
        // Clean partials for next attempt
        try {
          const partials = fs.readdirSync(videosDir).filter(f => f.startsWith(`${videoId}.`));
          for (const f of partials) {
            try { fs.unlinkSync(path.join(videosDir, f)); } catch {}
          }
        } catch {}
        // try next client…
      }
    }

    throw new Error('All strategies failed under 1080p policy');

  } catch (error) {
    logger.error('Download failed for', videoId, ':', error.message);
    const msg = error.message.toLowerCase();
    if (msg.includes('all strategies failed')) {
      throw new Error('Unable to bypass restrictions - video may be genuinely restricted');
    } else if (msg.includes('unavailable')) {
      throw new Error('Video is unavailable or has been removed');
    } else if (msg.includes('private')) {
      throw new Error('This video is private and cannot be downloaded');
    } else {
      throw new Error(`Download failed: ${error.message}`);
    }
  }
}

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
        {
          label: 'Test yt-dlp',
          click: async () => {
            try {
              // Test with a simple version check
              await ytdlp('--version');
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'yt-dlp Test Result',
                message: 'yt-dlp is working correctly',
                buttons: ['OK']
              });
            } catch (error) {
              dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'yt-dlp Test Failed',
                message: 'yt-dlp is not working properly',
                detail: error.message,
                buttons: ['OK']
              });
            }
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
              const testVideoId = 'jNQXAC9IVRw'; // "Me at the zoo" - first YouTube video, very short
              
              try {
                mainWindow.webContents.send('show-loading', { message: 'Testing download...' });
                
                const downloadResult = await downloadVideo(testVideoId, { 
                  verbose: true, 
                  enhancedQuality: true 
                });
                
                mainWindow.webContents.send('hide-loading');
                
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Download Test Success',
                  message: 'Test download completed successfully!',
                  detail: `Video downloaded and ready to play.`,
                  buttons: ['OK', 'Play Video']
                }).then((result) => {
                  if (result.response === 1) {
                    shell.openPath(path.join(videosDir, `${testVideoId}.mp4`));
                  }
                });
              } catch (error) {
                mainWindow.webContents.send('hide-loading');
                
                dialog.showMessageBox(mainWindow, {
                  type: 'error', 
                  title: 'Download Test Failed',
                  message: 'Test download failed',
                  detail: `Error: ${error.message}`,
                  buttons: ['OK']
                });
              }
            }
          }
        },
        {
          type: 'separator'
        },
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
          label: 'Reset All Data',
          click: async () => {
            const userDataPath = app.getPath('userData');
            // Clear contents but keep directory
            fs.rmSync(userDataPath, { recursive: true, force: true });
            app.relaunch();
            app.exit();
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [

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

yt-dlp: Available via yt-dlp-exec
              `.trim(),
              buttons: ['OK']
            });
          }
        },
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
ipcMain.handle('download-video', async (event, videoId, enhancedQuality = true) => {
  try {
    if (!videoId?.trim()) throw new Error('Video ID is required');

    logger.info('Download request for:', videoId);
    return await downloadVideo(videoId, { 
      verbose: true, 
      enhancedQuality 
    });

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
        q: query.trim() + ' dance',
        key: process.env.YT_API_KEY || 'AIzaSyDm4UJfp6WtooikGqBXIROuvTwce6v5aY0',
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

// Additional IPC handlers
const ipcHandlers = {
  'get-app-version': () => app.getVersion(),
  'show-message-box': async (event, options) => await dialog.showMessageBox(mainWindow, options),
  'get-health': () => ({
    status: 'healthy', 
    timestamp: new Date().toISOString(), 
    videosDir: fs.existsSync(videosDir),
    diskSpace: getDiskSpace(), 
    ytDlpReady: true, // Always true with yt-dlp-exec
    platform: process.platform
  }),
  'cleanup-videos': () => { cleanupOldVideos(); return { success: true }; },
  'get-video-list': () => {
    try {
      return fs.readdirSync(videosDir)
        .filter(f => f.endsWith('.mp4'))
        .map(file => {
          const filePath = path.join(videosDir, file);
          const stats = fs.statSync(filePath);
          return { 
            id: path.basename(file, '.mp4'), 
            filename: file, 
            size: stats.size, 
            created: stats.birthtime 
          };
        });
    } catch (err) {
      return [];
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

// App lifecycle
app.whenReady().then(async () => {
  try {
    logger.info('🚀 Starting Stepwise Studio...');
    
    createWindow();
    createMenu();
    
    logger.info('🚀 Stepwise Studio ready with yt-dlp-exec');
    
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