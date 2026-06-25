// main.js

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
// `ytdlp` is bound to an unpacked binary path below (see binary resolution).

// Constants
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const videosDir = path.join(app.getPath('userData'), 'videos');
const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails');

// Logging utility
const logger = {
  info: (msg, ...args) => console.log(`ℹ️ ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`⚠️ ${msg}`, ...args),
  error: (msg, ...args) => console.error(`❌ ${msg}`, ...args)
};

// ---------- Binary resolution (works in dev AND packaged/asar builds) ----------
// In a packaged app, bundled binaries are extracted to app.asar.unpacked rather than
// living inside the (non-executable) app.asar archive.
function toUnpacked(p) {
  if (!p) return p;
  const packed = `app.asar${path.sep}`;
  if (p.includes(packed) && !p.includes('app.asar.unpacked')) {
    return p.replace(packed, `app.asar.unpacked${path.sep}`);
  }
  return p;
}

// GUI apps launched from Finder/Dock inherit only a minimal PATH; add common locations
// so a system ffmpeg/yt-dlp can still be found as a fallback.
(function augmentPath() {
  const extra = isMac
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    : isWindows ? [] : ['/usr/local/bin', '/usr/bin', '/bin'];
  const parts = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  process.env.PATH = [...new Set([...parts, ...extra])].join(path.delimiter);
})();

// Resolve bundled ffmpeg (ffmpeg-static); null falls back to ffmpeg on PATH.
const ffmpegPath = (() => {
  try {
    const p = toUnpacked(require('ffmpeg-static'));
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return null;
})();
logger.info(ffmpegPath
  ? `Using bundled ffmpeg: ${ffmpegPath}`
  : 'No bundled ffmpeg; relying on system ffmpeg via PATH');

// Resolve the yt-dlp binary. Prefer the self-contained standalone shipped in binaries/
// (no system Python required, and kept current); fall back to the yt-dlp-exec zipapp.
function resolveYtDlpBinary() {
  const standalone = isWindows ? 'yt-dlp.exe' : isMac ? 'yt-dlp-macos' : 'yt-dlp-linux';
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'binaries', standalone), // packaged
    path.join(__dirname, 'binaries', standalone)                                        // dev
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Fallback: yt-dlp-exec's bundled binary (Python zipapp — needs system Python).
  try {
    const dir = path.dirname(require.resolve('yt-dlp-exec'));
    return toUnpacked(path.join(dir, '..', 'bin', isWindows ? 'yt-dlp.exe' : 'yt-dlp'));
  } catch {
    return null;
  }
}

const ytDlpBinary = resolveYtDlpBinary();
const ytdlp = ytDlpBinary && fs.existsSync(ytDlpBinary)
  ? require('yt-dlp-exec').create(ytDlpBinary)
  : require('yt-dlp-exec');
logger.info(`Using yt-dlp binary: ${ytDlpBinary || '(yt-dlp-exec default)'}`);

let mainWindow;

// Initialize directories
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
  logger.info('Created videos directory:', videosDir);
}
if (!fs.existsSync(thumbnailsDir)) {
  fs.mkdirSync(thumbnailsDir, { recursive: true });
}

// Cache a video's thumbnail to disk so saved/offline lists never break on expired URLs.
function cacheThumbnail(videoId) {
  try {
    const dest = path.join(thumbnailsDir, `${videoId}.jpg`);
    if (fs.existsSync(dest)) return;
    const url = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    axios.get(url, { responseType: 'arraybuffer', timeout: 8000 })
      .then(res => fs.writeFileSync(dest, Buffer.from(res.data)))
      .catch(() => {});
  } catch {}
}
function thumbnailPath(videoId) {
  const p = path.join(thumbnailsDir, `${videoId}.jpg`);
  return fs.existsSync(p) ? `file:///${p.replace(/\\/g, '/')}` : null;
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

function pathToFileUrl(p) {
  return `file:///${p.replace(/\\/g, '/')}`;
}

// Read a downloaded video's title from its yt-dlp .info.json sidecar (if present).
function readVideoTitle(videoId) {
  try {
    const p = path.join(videosDir, `${videoId}.info.json`);
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return j.title || null;
    }
  } catch {}
  return null;
}

function cleanPartials(videoId) {
  try {
    fs.readdirSync(videosDir)
      .filter(f => f.startsWith(`${videoId}.`))
      .forEach(f => { try { fs.unlinkSync(path.join(videosDir, f)); } catch {} });
  } catch {}
}

// Lossless container remux to .mp4 (stream copy, no re-encode).
function remuxToMp4(src, dest) {
  if (!ffmpegPath) return false;
  try {
    require('child_process').execFileSync(
      ffmpegPath,
      ['-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', dest],
      { stdio: 'ignore' }
    );
    return fs.existsSync(dest) && isValidVideoFile(dest);
  } catch {
    return false;
  }
}

// Return a valid .mp4 path for this video, normalizing any other container if needed.
function ensureMp4(videoId) {
  const finalMp4Path = path.join(videosDir, `${videoId}.mp4`);
  if (fs.existsSync(finalMp4Path) && isValidVideoFile(finalMp4Path)) return finalMp4Path;

  const alts = fs.readdirSync(videosDir)
    .filter(f => f.startsWith(`${videoId}.`) && isValidVideoFile(path.join(videosDir, f)));
  if (!alts.length) return null;

  const altPath = path.join(videosDir, alts[0]);
  if (altPath.endsWith('.mp4')) {
    if (altPath !== finalMp4Path) fs.renameSync(altPath, finalMp4Path);
    return finalMp4Path;
  }
  if (remuxToMp4(altPath, finalMp4Path)) {
    try { fs.unlinkSync(altPath); } catch {}
    return finalMp4Path;
  }
  return altPath; // best effort (Chromium can usually still play it)
}

// Browser to pull cookies from for higher-quality, PO-token-gated formats.
// Reads the user preference (configurable via Tools ▸ Video Quality); 'chrome' by default.
function getCookieBrowser() {
  try {
    const v = preferencesManager.loadPreferences().cookieBrowser;
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  } catch {}
  return 'chrome';
}

// Build the ordered list of download strategies. When a cookie browser is configured,
// a cookie-authenticated attempt is tried first (it unlocks 1080p that is otherwise
// gated behind PO tokens); plain attempts always follow as a guaranteed fallback.
// NOTE: never inject a custom web User-Agent — that forces the PO-token-gated web
// client and silently downgrades to a 360p progressive stream.
function buildClientStrategies(cookieBrowser) {
  const strategies = [];
  if (cookieBrowser && cookieBrowser !== 'none') {
    strategies.push({
      name: `Cookies (${cookieBrowser}) + auto clients`,
      base: { cookiesFromBrowser: cookieBrowser, geoBypass: true, noPlaylist: true, retries: 3, fragmentRetries: 5 },
      extractorArgs: 'youtube:player_client=default,web_safari,mweb,tv'
    });
  }
  strategies.push(
    {
      name: 'Default (auto clients)',
      base: { geoBypass: true, noPlaylist: true, retries: 3, fragmentRetries: 5, socketTimeout: 60 },
      extractorArgs: null
    },
    {
      name: 'Explicit multi-client',
      base: { geoBypass: true, noPlaylist: true, retries: 3, fragmentRetries: 5 },
      extractorArgs: 'youtube:player_client=default,android,ios,web_safari,tv'
    },
    {
      name: 'TV/MWeb fallback',
      base: { geoBypass: true, noPlaylist: true, retries: 2 },
      extractorArgs: 'youtube:player_client=tv,mweb'
    }
  );
  return strategies;
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
      cacheThumbnail(videoId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', { videoId, percent: 100 });
      }
      return { url: fileUrl, title: readVideoTitle(videoId), thumb: thumbnailPath(videoId) };
    }

    // Max resolution from preferences (user-selectable: 1080 / 720 / 480).
    let maxH = 1080;
    try { maxH = parseInt(preferencesManager.loadPreferences().maxHeight, 10) || 1080; } catch {}
    logger.info(`Starting video download (≤${maxH}p):`, videoId);

    const clientStrategies = buildClientStrategies(getCookieBrowser());

    // Select by RESOLUTION only (cap at maxH); never hard-gate on codec here, or a video
    // whose top resolution is AV1/VP9-only would silently fall back to a low-res H.264 stream.
    // Codec/container preferences are expressed as SOFT tiebreakers via FORMAT_SORT, so we
    // get the highest allowed resolution and prefer H.264+AAC+mp4 (fast lossless mux).
    const FORMAT = [
      `bv*[height<=${maxH}]+ba`,
      `b[height<=${maxH}]`,
      'bv*+ba/b'
    ].join('/');
    // Must be a single comma-joined string: yt-dlp does NOT accumulate repeated
    // --format-sort flags (the last one would override), and yt-dlp-exec renders a
    // JS array as multiple flags — which silently collapsed sorting to "ext:mp4" only.
    const FORMAT_SORT = `res:${maxH},fps,vcodec:h264,vcodec:vp9,acodec:m4a,ext:mp4`;

    // Try each client in a single pass (download + merge directly — no separate probe).
    for (const client of clientStrategies) {
      try {
        logger.info(`Downloading via ${client.name}...`);

        const dlOpts = {
          ...(client.base || {}),
          ...(client.extractorArgs ? { extractorArgs: client.extractorArgs } : {}),
          format: FORMAT,
          formatSort: FORMAT_SORT,
          formatSortForce: true,
          output: outputTemplate,
          mergeOutputFormat: 'mp4',
          ...(ffmpegPath ? { ffmpegLocation: ffmpegPath } : {}),
          addMetadata: true,
          writeInfoJson: true,   // gives us the title (for paste-URL + offline library)
          newline: true,         // one progress line per update → easy to parse
          noPlaylist: true,
          // retries/fragmentRetries come from the per-strategy base (kept low for fast failover)
          continue: true,
          noAbortOnUnavailableFragment: true,
          noWarnings: true,
          verbose: !!options.verbose
        };

        // Stream real download progress to the renderer.
        const sub = ytdlp.exec(videoUrl, dlOpts);
        const onChunk = (buf) => {
          const m = String(buf).match(/\[download\]\s+([\d.]+)%/g);
          if (m && m.length) {
            const pct = parseFloat(m[m.length - 1].match(/([\d.]+)%/)[1]);
            if (!isNaN(pct) && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('download-progress', { videoId, percent: pct });
            }
          }
        };
        if (sub.stdout) sub.stdout.on('data', onChunk);
        if (sub.stderr) sub.stderr.on('data', onChunk);
        await sub;

        // Verify, normalizing any non-mp4 container to .mp4 via a lossless remux.
        const produced = ensureMp4(videoId);
        if (produced) {
          const title = readVideoTitle(videoId);
          cacheThumbnail(videoId);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', { videoId, percent: 100 });
          }
          logger.info(`✅ ${client.name} successful:`, { videoId, path: produced });
          return { url: pathToFileUrl(produced), title, thumb: thumbnailPath(videoId) };
        }

        throw new Error('Download did not produce a valid video file');
      } catch (err) {
        logger.warn(`❌ ${client.name} failed:`, err?.message || String(err));
        cleanPartials(videoId);
        // try next client…
      }
    }

    throw new Error('All strategies failed');

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
          label: 'Video Quality',
          submenu: (() => {
            let current = 'chrome';
            try { current = preferencesManager.loadPreferences().cookieBrowser || 'chrome'; } catch {}
            const choices = [
              { label: 'Higher quality — Chrome cookies', value: 'chrome' },
              { label: 'Higher quality — Safari cookies', value: 'safari' },
              { label: 'Higher quality — Firefox cookies', value: 'firefox' },
              { label: 'Higher quality — Edge cookies', value: 'edge' },
              { label: 'Higher quality — Brave cookies', value: 'brave' },
              { type: 'separator' },
              { label: "Don't use cookies (may cap quality)", value: 'none' }
            ];
            return choices.map(c => c.type === 'separator'
              ? { type: 'separator' }
              : {
                  label: c.label,
                  type: 'radio',
                  checked: current === c.value,
                  click: () => {
                    preferencesManager.update({ cookieBrowser: c.value });
                    logger.info('Cookie browser set to:', c.value);
                  }
                });
          })()
        },
        {
          label: 'Max Resolution',
          submenu: (() => {
            let cur = 1080;
            try { cur = parseInt(preferencesManager.loadPreferences().maxHeight, 10) || 1080; } catch {}
            return [1080, 720, 480].map(h => ({
              label: `${h}p`,
              type: 'radio',
              checked: cur === h,
              click: () => {
                preferencesManager.update({ maxHeight: h });
                logger.info('Max resolution set to:', h + 'p');
              }
            }));
          })()
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
      currentVideoTime: 0, totalPracticeTime: 0, sessionCount: 0, lastSessionDate: null,
      // Per-video settings keyed by videoId: { playbackRate, loopOn, loopStartTime,
      // loopEndTime, mirror, lastPosition, title, updatedAt }. Top-level fields above
      // act as global defaults for never-seen videos.
      videos: {},
      // Gemini API key for the AI coach (optional; free tier). Empty = rule-based fallback.
      geminiApiKey: '',
      // Max download resolution (height). 1080 | 720 | 480. Configurable via Tools ▸ Video Quality.
      maxHeight: 1080,
      // Browser to pull cookies from for higher-quality (PO-token-gated) downloads.
      // 'none' disables cookies. Configurable via Tools ▸ Video Quality.
      cookieBrowser: 'chrome'
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
      verbose: process.env.NODE_ENV === 'development',
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
        q: query.trim(),
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
  'delete-video': (event, videoId) => {
    try {
      if (!videoId) return { success: false };
      fs.readdirSync(videosDir)
        .filter(f => f.startsWith(`${videoId}.`))
        .forEach(f => { try { fs.unlinkSync(path.join(videosDir, f)); } catch {} });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  'get-video-list': () => {
    try {
      return fs.readdirSync(videosDir)
        .filter(f => f.endsWith('.mp4'))
        .map(file => {
          const filePath = path.join(videosDir, file);
          const stats = fs.statSync(filePath);
          const id = path.basename(file, '.mp4');
          return {
            id,
            filename: file,
            size: stats.size,
            created: stats.birthtime,
            title: readVideoTitle(id),
            thumb: thumbnailPath(id)
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