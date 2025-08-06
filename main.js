const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const serverApp = require('./src/server');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Set up videos directory in user data
const userDataPath = app.getPath('userData');
const VIDEOS_DIR = path.join(userDataPath, 'videos');
process.env.VIDEOS_DIR = VIDEOS_DIR;

let mainWindow;
let expressServer;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      sandbox: false // Set to false to allow file access
    },
    icon: path.join(__dirname, 'assets', 'stepwise-icon.png'),
    title: 'Stepwise Studio',
    autoHideMenuBar: true,
    show: false // Don't show until ready
  });

  // Load the HTML file from src directory
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Start Express server after window is created
  expressServer = serverApp.listen(3001, '127.0.0.1', () => {
    console.log('Express server running on port 3001 in Electron');
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Development: Open DevTools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// App event handlers
app.whenReady().then(() => {
  const createMenu = require('./menu');
  createMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (expressServer) {
    expressServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Clean up when app quits
app.on('before-quit', () => {
  if (expressServer) {
    expressServer.close();
  }
});

// IPC Handlers
ipcMain.handle('youtube-search', async (_, query) => {
  try {
    const response = await fetch(`http://127.0.0.1:3001/youtube-search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search failed');
    return data;
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
});

ipcMain.handle('download-video', async (_, videoId) => {
  try {
    const response = await fetch(`http://127.0.0.1:3001/download?id=${videoId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Download failed');
    return data;
  } catch (error) {
    console.error('Download error:', error);
    throw error;
  }
});

ipcMain.handle('show-message-box', async (_, options) => {
  if (mainWindow) {
    const result = await dialog.showMessageBox(mainWindow, options);
    return result;
  }
  return null;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Auto-updater setup
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', () => {
  console.log('Update available.');
  if (mainWindow) {
    mainWindow.webContents.send('update-available');
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('Update not available.');
});

autoUpdater.on('error', (err) => {
  console.log('Error in auto-updater:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  let log_message = "Download speed: " + progressObj.bytesPerSecond;
  log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
  log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
  console.log(log_message);
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded');
  }
});

ipcMain.on('restart-app', () => {
  autoUpdater.quitAndInstall();
});

// Check for updates after app is ready
app.on('ready', () => {
  if (process.env.NODE_ENV !== 'development') {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 5000); // Wait 5 seconds before checking
  }
});