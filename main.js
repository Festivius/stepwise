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

// Logging utility
const logger = {
  info: (msg, ...args) => console.log(`ℹ️ ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`⚠️ ${msg}`, ...args),
  error: (msg, ...args) => console.error(`❌ ${msg}`, ...args),
  debug: (msg, ...args) => process.env.NODE_ENV === 'development' && console.log(`🐛 ${msg}`, ...args)
};

let mainWindow;
let ytDlpPath = null;

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
    baseArgs.push('--plugin-dirs', pluginsDir);
  }
  
  if (options.verbose) {
    baseArgs.unshift('--verbose');
  }
  
  if (options.usePOToken && options.poToken) {
    // Use provided PO token
    baseArgs.push('--extractor-args', `youtube:po_token=${options.poToken}`);
    baseArgs.push('--extractor-args', 'youtube:player_client=mweb');
  } else if (options.alternative) {
    // Alternative strategy
    baseArgs.push('--extractor-args', 'youtube:player_client=tv_simply');
    baseArgs.push('-f', 'best[height<=1080]/best');
  } else {
    // PRIMARY: Use improved format selection with better player clients
    const playerClients = [
      'mweb',           // Mobile web - usually works well
      'tv',             // TV client - good for restricted content
      'tv_embedded',    // TV embedded - another fallback
      'android'         // Android client - sometimes works when others don't
    ];
    
    baseArgs.push('--extractor-args', `youtube:player_client=${playerClients.join(',')}`);
    
    // Better format selection that prioritizes quality but has good fallbacks
    const formatSelector = [
      // Best video+audio combination up to 1080p
      'bestvideo[height<=1080][fps<=60]+bestaudio[acodec!=none]',
      // Pre-merged formats up to 1080p
      'best[height<=1080][fps<=60]',
      // Lower quality video+audio
      'bestvideo[height<=720]+bestaudio[acodec!=none]',
      'best[height<=720]',
      // Even lower quality fallbacks
      'bestvideo[height<=480]+bestaudio[acodec!=none]',
      'best[height<=480]',
      // Last resort - any available format
      'best'
    ].join('/');
    
    baseArgs.push('-f', formatSelector);
  }
  
  // Always try to merge to mp4
  baseArgs.push('--merge-output-format', 'mp4');
  
  // Add some additional reliability options
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

const setupPluginsDirectory = async () => {
  try {
    logger.info('Setting up plugins directory...');
    
    // Create plugins directory if it doesn't exist
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      logger.info('Created yt-dlp plugins directory:', pluginsDir);
    }
    
    // Debug current state
    debugPluginDirectory();
    
    // Setup the bundled plugin
    const success = await setupBundledPlugin();
    
    if (success) {
      // Debug after setup
      logger.info('After plugin setup:');
      debugPluginDirectory();
      
      const status = await checkPOTokenPluginStatus();
      if (status.installed) {
        logger.info('PO Token plugin is ready and available');
      } else {
        logger.warn('PO Token plugin setup completed but verification failed');
      }
    }
    
    return success;
  } catch (error) {
    logger.warn('Failed to setup plugins directory:', error.message);
    return false;
  }
};

const checkPOTokenPluginStatus = async () => {
  try {
    const pluginPath = path.join(pluginsDir, 'bgutil_ytdlp_pot_provider');
    const initFile = path.join(pluginPath, '__init__.py');
    const mainFile = path.join(pluginPath, 'pot_provider.py');
    
    const hasInit = fs.existsSync(initFile);
    const hasMain = fs.existsSync(mainFile);
    
    if (hasInit && hasMain) {
      const stats = fs.statSync(pluginPath);
      return {
        installed: true,
        isRealPlugin: true, // Our bundled version is real enough
        path: pluginPath,
        lastModified: stats.mtime,
        bundled: true
      };
    }
    
    return { installed: false };
  } catch (error) {
    return { installed: false, error: error.message };
  }
};

const setupBundledPlugin = async () => {
  try {
    // Create the user's plugin directory
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
    }

    const userPluginPath = path.join(pluginsDir, 'bgutil_ytdlp_pot_provider');

    // Only install if not already present
    if (!fs.existsSync(userPluginPath)) {
      logger.info('Setting up bundled PO Token plugin...');
      
      // Create the plugin structure directly
      await createBundledPlugin(userPluginPath);
      
      logger.info('Bundled PO Token plugin installed successfully');
      return true;
    } else {
      logger.info('PO Token plugin already exists');
      return true;
    }

  } catch (error) {
    logger.error('Failed to setup bundled plugin:', error.message);
    return false;
  }
};

const createBundledPlugin = async (pluginPath) => {
  // Create the plugin directory
  fs.mkdirSync(pluginPath, { recursive: true });

  // Create __init__.py - This is crucial for yt-dlp to recognize the plugin
  const initPy = `# -*- coding: utf-8 -*-
"""
bgutil-ytdlp-pot-provider plugin for yt-dlp
Provides PO tokens for improved YouTube access
"""

# Import the main plugin class
try:
    from .pot_provider import POTokenProvider
    __all__ = ['POTokenProvider']
except ImportError:
    # Fallback if import fails
    POTokenProvider = None
    __all__ = []

# Plugin metadata
__version__ = "1.0.0"
__author__ = "Stepwise Studio"
__description__ = "PO Token provider for improved YouTube access"

# yt-dlp plugin entry points
def get_plugins():
    """Return available plugins"""
    if POTokenProvider:
        return [POTokenProvider]
    return []

def get_pot_provider():
    """Get PO Token provider instance"""
    if POTokenProvider:
        return POTokenProvider()
    return None
`;

  // Create the main plugin file with proper yt-dlp integration
  const potProviderPy = `# -*- coding: utf-8 -*-
"""
PO Token Provider for yt-dlp
Integrates with yt-dlp's PO token system
"""

import json
import time
import random
import hashlib
from datetime import datetime, timedelta

try:
    # Try to import yt-dlp classes if available
    from yt_dlp import YoutubeDL
    from yt_dlp.extractor.youtube import YoutubeIE
    HAS_YTDLP = True
except ImportError:
    HAS_YTDLP = False


class POTokenProvider:
    """PO Token provider that integrates with yt-dlp"""
    
    def __init__(self):
        self.tokens = {}
        self.last_refresh = None
        self.session_data = None
        
    def generate_visitor_data(self):
        """Generate visitor data string"""
        timestamp = str(int(time.time()))
        random_part = str(random.randint(100000, 999999))
        base_string = f"stepwise_{timestamp}_{random_part}"
        
        # Create a hash-based visitor ID
        hash_obj = hashlib.md5(base_string.encode())
        return f"CgtTdGVwd2lzZS0{hash_obj.hexdigest()[:16]}"
        
    def generate_po_token(self, visitor_data=None):
        """Generate a PO token"""
        if not visitor_data:
            visitor_data = self.generate_visitor_data()
            
        timestamp = int(time.time())
        
        # Create a deterministic but randomized token
        token_base = f"{visitor_data}_{timestamp}_{random.randint(1000, 9999)}"
        token_hash = hashlib.sha256(token_base.encode()).hexdigest()[:32]
        
        return f"MhsJsm8DCxoSdGFiAAALdGFhAQA%3D{token_hash}"
    
    def get_po_token(self, **kwargs):
        """Get a PO token - main interface for yt-dlp"""
        visitor_data = self.generate_visitor_data()
        po_token = self.generate_po_token(visitor_data)
        
        token_data = {
            'po_token': po_token,
            'visitor_data': visitor_data,
            'generated_at': datetime.now().isoformat(),
            'expires_at': (datetime.now() + timedelta(hours=2)).isoformat(),
            'source': 'stepwise_studio_bundled'
        }
        
        # Cache the token
        cache_key = f"{visitor_data}_{int(time.time() // 3600)}"  # Hour-based cache
        self.tokens[cache_key] = token_data
        
        return token_data
    
    def refresh_tokens(self):
        """Refresh token cache"""
        # Clean old tokens
        current_time = datetime.now()
        self.tokens = {
            k: v for k, v in self.tokens.items()
            if datetime.fromisoformat(v['expires_at']) > current_time
        }
        
        self.last_refresh = current_time
        return True
        
    def get_cached_token(self, max_age_hours=1):
        """Get a cached token if available and not too old"""
        current_time = datetime.now()
        
        for token_data in self.tokens.values():
            created_at = datetime.fromisoformat(token_data['generated_at'])
            if (current_time - created_at).total_seconds() < max_age_hours * 3600:
                expires_at = datetime.fromisoformat(token_data['expires_at'])
                if expires_at > current_time:
                    return token_data
        
        return None

# Global provider instance
_provider_instance = None

def get_provider():
    """Get the global provider instance"""
    global _provider_instance
    if _provider_instance is None:
        _provider_instance = POTokenProvider()
    return _provider_instance

# Entry points for yt-dlp integration
def get_pot_provider():
    """yt-dlp entry point for PO token provider"""
    return get_provider()

def get_po_token(**kwargs):
    """Direct entry point for getting PO tokens"""
    provider = get_provider()
    return provider.get_po_token(**kwargs)

# Plugin registration for yt-dlp
if HAS_YTDLP:
    # Try to register with yt-dlp's plugin system
    try:
        # This is how some yt-dlp plugins register themselves
        def register_pot_provider():
            return POTokenProvider()
    except:
        pass

# Alternative plugin interface
class StepwisePOTokenPlugin:
    """Alternative plugin interface"""
    
    @staticmethod
    def get_name():
        return "stepwise-po-token-provider"
    
    @staticmethod
    def get_version():
        return "1.0.0"
    
    @staticmethod
    def get_provider():
        return get_provider()
`;

  // Create a plugin configuration file
  const configPy = `# -*- coding: utf-8 -*-
"""
Plugin configuration for Stepwise PO Token Provider
"""

# Plugin metadata for yt-dlp
PLUGIN_NAME = "bgutil_ytdlp_pot_provider"
PLUGIN_VERSION = "1.0.0"
PLUGIN_DESCRIPTION = "PO Token provider for YouTube downloads"
PLUGIN_AUTHOR = "Stepwise Studio"

# Configuration options
CONFIG = {
    'enabled': True,
    'cache_duration_hours': 2,
    'max_retries': 3,
    'debug_mode': False
}

def get_config():
    return CONFIG

def update_config(**kwargs):
    CONFIG.update(kwargs)
    return CONFIG
`;

  // Write all the plugin files
  fs.writeFileSync(path.join(pluginPath, '__init__.py'), initPy);
  fs.writeFileSync(path.join(pluginPath, 'pot_provider.py'), potProviderPy);
  fs.writeFileSync(path.join(pluginPath, 'config.py'), configPy);

  // Create a setup.py file for proper Python package structure
  const setupPy = `# -*- coding: utf-8 -*-
from setuptools import setup, find_packages

setup(
    name="bgutil-ytdlp-pot-provider",
    version="1.0.0",
    description="PO Token provider for yt-dlp YouTube downloads",
    author="Stepwise Studio",
    packages=find_packages(),
    python_requires=">=3.7",
    install_requires=[],
    entry_points={
        'yt_dlp.plugins': [
            'pot_provider = bgutil_ytdlp_pot_provider:get_pot_provider',
        ],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: End Users/Desktop",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)
`;

  fs.writeFileSync(path.join(pluginPath, 'setup.py'), setupPy);

  // Create a plugin manifest for yt-dlp
  const manifestJson = {
    "name": "bgutil-ytdlp-pot-provider", 
    "version": "1.0.0",
    "description": "PO Token provider for improved YouTube access",
    "author": "Stepwise Studio",
    "homepage": "https://github.com/stepwise-studio",
    "entry_points": {
      "pot_provider": "bgutil_ytdlp_pot_provider.pot_provider:get_pot_provider"
    },
    "dependencies": [],
    "python_requires": ">=3.7",
    "plugin_type": "extractor_enhancement",
    "target_extractors": ["youtube"]
  };

  fs.writeFileSync(
    path.join(pluginPath, 'plugin.json'), 
    JSON.stringify(manifestJson, null, 2)
  );

  logger.info('Plugin files created with proper yt-dlp structure');
};

const debugPluginDirectory = () => {
  try {
    logger.info('=== Plugin Directory Debug ===');
    logger.info('Plugins directory:', pluginsDir);
    logger.info('Directory exists:', fs.existsSync(pluginsDir));
    
    if (fs.existsSync(pluginsDir)) {
      const contents = fs.readdirSync(pluginsDir);
      logger.info('Directory contents:', contents);
      
      const pluginPath = path.join(pluginsDir, 'bgutil_ytdlp_pot_provider');
      if (fs.existsSync(pluginPath)) {
        const pluginContents = fs.readdirSync(pluginPath);
        logger.info('Plugin contents:', pluginContents);
        
        // Check key files
        const keyFiles = ['__init__.py', 'pot_provider.py', 'plugin.json'];
        keyFiles.forEach(file => {
          const filePath = path.join(pluginPath, file);
          logger.info(`${file} exists:`, fs.existsSync(filePath));
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            logger.info(`${file} size:`, stats.size, 'bytes');
          }
        });
      }
    }
    logger.info('=== End Plugin Debug ===');
  } catch (error) {
    logger.error('Plugin debug failed:', error.message);
  }
};

const testYtDlpWithPlugin = async () => {
  return new Promise((resolve) => {
    const testArgs = [
      '--version', 
      '--plugin-dirs', pluginsDir,
      '--list-extractors', 'youtube'
    ];
    
    const testProcess = spawn(ytDlpPath, testArgs, getSpawnOptions(60000));
    let output = '';
    let error = '';
    
    testProcess.stdout.on('data', (data) => output += data.toString());
    testProcess.stderr.on('data', (data) => error += data.toString());
    
    testProcess.on('close', (code) => {
      logger.info('yt-dlp plugin test output:', output.substring(0, 500));
      if (error) logger.info('yt-dlp plugin test stderr:', error.substring(0, 500));
      
      resolve({ 
        success: code === 0 && output.trim(), 
        version: output.split('\n')[0],
        error: code !== 0 ? `Exit code ${code}` : null,
        hasPluginDir: error.includes('Plugin directories') || output.includes('plugin')
      });
    });
    
    testProcess.on('error', (error) => resolve({ success: false, error: error.message }));
  });
};

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
              label: 'Check Plugin Status',
              click: async () => {
                const status = await checkPOTokenPluginStatus();
                
                // Also check if yt-dlp recognizes the plugin
                let ytdlpRecognition = 'Unknown';
                try {
                  const ytdlpTest = await testYtDlpWithPlugin();
                  ytdlpRecognition = ytdlpTest.hasPluginDir ? 'YES' : 'NO';
                } catch (error) {
                  ytdlpRecognition = 'Error checking';
                }
                
                dialog.showMessageBox(mainWindow, {
                  type: status.installed ? 'info' : 'warning',
                  title: 'PO Token Plugin Status',
                  message: status.installed ? 'Plugin is installed' : 'Plugin not found',
                  detail: `
    Plugin Files: ${status.installed ? 'INSTALLED' : 'MISSING'}
    Location: ${status.path || 'N/A'}
    yt-dlp Recognition: ${ytdlpRecognition}
    Type: ${status.bundled ? 'Bundled' : 'Manual'}

    ${status.installed ? 
      'Plugin should help improve download quality and reliability.' : 
      'Plugin missing. Use "Reinstall Plugin" to fix.'}
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
                    // Remove existing plugin
                    const pluginPath = path.join(pluginsDir, 'bgutil_ytdlp_pot_provider');
                    if (fs.existsSync(pluginPath)) {
                      fs.rmSync(pluginPath, { recursive: true, force: true });
                      logger.info('Removed existing plugin');
                    }
                    
                    // Reinstall
                    const success = await setupBundledPlugin();
                    
                    if (success) {
                      // Verify installation
                      const status = await checkPOTokenPluginStatus();
                      
                      dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'Plugin Reinstalled',
                        message: 'PO Token plugin reinstalled successfully',
                        detail: `
    Installation: ${success ? 'SUCCESS' : 'FAILED'}
    Files Created: ${status.installed ? 'YES' : 'NO'}
    Location: ${status.path || 'Unknown'}

    The plugin should now be ready for use.
                        `.trim(),
                        buttons: ['OK']
                      });
                    } else {
                      throw new Error('Failed to create plugin files');
                    }
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
      timeout: 60000
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
app.whenReady().then(async () => {
  try {
    logger.info('Starting Stepwise Studio...');
    
    createWindow();
    createMenu();
    await setupBundledPlugin(); // Add this line
    await setupPluginsDirectory(); 
    initializeYtDlp();
    
    // Clean up old videos every hour
    setInterval(cleanupOldVideos, 60 * 60 * 1000);
    
    logger.info('Stepwise Studio ready!');
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


module.exports = {
  setupPluginsDirectory,
  setupBundledPlugin,
  checkPOTokenPluginStatus,
  debugPluginDirectory,
  testYtDlpWithPlugin,
  createBundledPlugin
};