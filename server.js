// Add this at the TOP of server.js
if (process.env.NODE_ENV === 'production') {
  process.env.PATH = `${process.env.PATH}:/opt/render/project/poetry/bin`;
}

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const execFileAsync = promisify(execFile);
const app = express();

// Configure yt-dlp binary path
const YT_DLP_PATH = process.env.NODE_ENV === 'production' 
  ? path.join(__dirname, 'bin', 'yt-dlp')
  : 'yt-dlp';

// Puppeteer configuration for Render
const getPuppeteerConfig = async () => ({
  args: [
    ...chromium.args,
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--single-process'
  ],
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(),
  headless: chromium.headless,
  ignoreHTTPSErrors: true,
  defaultViewport: {
    width: 1366,
    height: 768
  },
  timeout: 30000
});

// Simplified BrowserPool class for Render
class BrowserPool {
  constructor() {
    this.browser = null;
  }

  async getBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch(await getPuppeteerConfig());
      
      const page = await this.browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Basic stealth settings
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      
      await page.close();
    }
    return this.browser;
  }

  async closeAll() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        console.error('Error closing browser:', err);
      }
      this.browser = null;
    }
  }
}

const browserPool = new BrowserPool();

// Simplified YouTube URL extraction
async function extractVideoUrlWithPuppeteer(videoId) {
  let browser;
  let page;
  
  try {
    console.log('🤖 Starting Puppeteer extraction for:', videoId);
    
    browser = await browserPool.getBrowser();
    page = await browser.newPage();
    
    // Basic headers
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Navigate to YouTube
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    await page.goto(videoUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for video player
    await page.waitForSelector('video', { timeout: 15000 });

    // Get direct video URL if available
    const videoInfo = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video || !video.src) return null;
      
      return {
        url: video.src.includes('blob:') ? null : video.src,
        title: document.title
      };
    });

    if (!videoInfo?.url) {
      throw new Error('No direct video URL found');
    }

    console.log('✅ Extracted video URL');
    return videoInfo;

  } catch (error) {
    console.error('❌ Puppeteer extraction failed:', error.message);
    throw error;
  } finally {
    if (page) await page.close().catch(console.error);
  }
}

// Modified download function with simplified fallback
async function downloadVideoWithFallbacks(videoId) {
  const outputTemplate = path.join(VIDEOS_DIR, `${videoId}.%(ext)s`);
  const finalVideoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  // Try yt-dlp first
  try {
    console.log('🎯 Attempting yt-dlp download...');
    await downloadVideoWithYtDlp(`https://www.youtube.com/watch?v=${videoId}`, outputTemplate);
    
    if (fs.existsSync(finalVideoPath)) {
      console.log('✅ yt-dlp download successful');
      return { success: true, method: 'yt-dlp' };
    }
  } catch (ytDlpError) {
    console.log('⚠️ yt-dlp failed, trying Puppeteer method...');
  }

  // Fallback to Puppeteer only if absolutely necessary
  if (process.env.ENABLE_PUPPETEER === 'true') {
    try {
      console.log('🤖 Attempting Puppeteer extraction...');
      const videoInfo = await extractVideoUrlWithPuppeteer(videoId);
      
      if (!videoInfo.url) {
        throw new Error('No video URL found');
      }

      // Download the video directly
      const response = await axios({
        method: 'GET',
        url: videoInfo.url,
        responseType: 'stream',
        timeout: 300000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/'
        }
      });

      const writer = fs.createWriteStream(finalVideoPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      // Verify download
      const stats = fs.statSync(finalVideoPath);
      if (stats.size > 0) {
        console.log('✅ Direct download successful');
        return { success: true, method: 'puppeteer-direct' };
      } else {
        fs.unlinkSync(finalVideoPath);
        throw new Error('Downloaded file is empty');
      }

    } catch (puppeteerError) {
      console.error('❌ Puppeteer method failed:', puppeteerError.message);
    }
  }

  throw new Error('All download methods failed');
}

// Middleware
app.use(cors());
app.use(express.json());

// Path configurations
const VIDEOS_DIR = path.join(__dirname, 'videos');
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

console.log('🎬 Stepwise Studio starting...');
console.log('📁 Videos directory:', VIDEOS_DIR);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('📺 yt-dlp path:', YT_DLP_PATH);
console.log('🤖 Puppeteer configured for bot detection bypass');

// Ensure directories exist
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  console.log('📁 Created videos directory');
}

// Create basic cookies file if it doesn't exist
if (!fs.existsSync(COOKIES_PATH)) {
  fs.writeFileSync(COOKIES_PATH, '# Netscape HTTP Cookie File\n');
  console.log('🍪 Created cookies file');
}

// Rate limiting for downloads
const downloadQueue = new Map();
const DOWNLOAD_COOLDOWN = 5000;

function checkDownloadRateLimit(ip) {
  const now = Date.now();
  const lastDownload = downloadQueue.get(ip) || 0;
  
  if (now - lastDownload < DOWNLOAD_COOLDOWN) {
    return {
      allowed: false,
      timeRemaining: Math.ceil((DOWNLOAD_COOLDOWN - (now - lastDownload)) / 1000)
    };
  }
  
  downloadQueue.set(ip, now);
  return { allowed: true };
}

// Serve static files
app.use(express.static(__dirname, {
  setHeaders: (res, path) => {
    if (path.endsWith('.mp4')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    videosDir: fs.existsSync(VIDEOS_DIR),
    ytDlpBinary: fs.existsSync(YT_DLP_PATH),
    puppeteerEnabled: true,
    environment: process.env.NODE_ENV || 'development'
  });
});

// YouTube search endpoint (unchanged)
app.get('/youtube-search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Missing search query' });
    }

    if (!process.env.YOUTUBE_API_KEY) {
      console.error('❌ YouTube API key not configured');
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    console.log('🔍 Searching YouTube for:', query);

    const response = await axios.get(
      'https://www.googleapis.com/youtube/v3/search',
      {
        params: {
          part: 'snippet',
          type: 'video',
          maxResults: 12,
          q: query + ' dance tutorial',
          key: process.env.YOUTUBE_API_KEY,
          safeSearch: 'strict'
        },
        timeout: 10000
      }
    );

    console.log('✅ Found', response.data.items?.length || 0, 'videos');
    res.json(response.data);

  } catch (error) {
    console.error('❌ YouTube API error:', error.response?.data || error.message);
    
    if (error.response?.status === 403) {
      return res.status(403).json({ error: 'YouTube API quota exceeded or invalid key' });
    }
    
    res.status(500).json({ 
      error: 'Failed to search YouTube',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// Enhanced download endpoint with Puppeteer
app.get('/download', async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) {
    return res.status(400).json({ error: 'Missing video ID' });
  }

  // Rate limiting check
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const rateCheck = checkDownloadRateLimit(clientIP);
  
  if (!rateCheck.allowed) {
    return res.status(429).json({ 
      error: 'Too many download requests',
      details: `Please wait ${rateCheck.timeRemaining} seconds before downloading another video`
    });
  }

  const finalVideoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  // Check if video already exists
  if (fs.existsSync(finalVideoPath)) {
    console.log('✅ Video already cached:', videoId);
    return res.json({ url: `/videos/${videoId}.mp4` });
  }

  console.log('⬇️ Starting enhanced download for video:', videoId);

  try {
    const result = await downloadVideoWithFallbacks(videoId);
    
    // Verify the file exists and is not empty
    const stats = fs.statSync(finalVideoPath);
    if (stats.size === 0) {
      fs.unlinkSync(finalVideoPath);
      throw new Error('Downloaded video file is empty');
    }

    console.log(`✅ Download completed using ${result.method}:`, videoId, `(${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    res.json({ 
      url: `/videos/${videoId}.mp4`,
      method: result.method,
      size: stats.size
    });

  } catch (error) {
    console.error('❌ All download methods failed for', videoId);
    console.error('Error details:', error.message);
    
    // Clean up any partial files
    try {
      if (fs.existsSync(finalVideoPath)) {
        fs.unlinkSync(finalVideoPath);
      }
    } catch (cleanupError) {
      console.error('❌ Cleanup error:', cleanupError.message);
    }
    
    // User-friendly error messages
    let userMessage = 'Failed to download video';
    let userDetails = 'Please try again or select a different video';
    
    if (error.message.includes('Sign in to confirm') || error.message.includes('bot detection')) {
      userMessage = 'Video temporarily unavailable';
      userDetails = 'YouTube is currently blocking automated downloads. Please try again in a few minutes.';
    } else if (error.message.includes('Video unavailable')) {
      userMessage = 'Video not accessible';
      userDetails = 'This video may be private, deleted, or restricted.';
    } else if (error.message.includes('timeout')) {
      userMessage = 'Download timeout';
      userDetails = 'The video took too long to download. Please try a shorter video.';
    }
    
    res.status(500).json({ 
      error: userMessage, 
      details: userDetails
    });
  }
});

// Original yt-dlp download function (keeping as fallback)
async function downloadVideoWithYtDlp(videoUrl, outputTemplate) {
  const args = [
    '--cookies', COOKIES_PATH,
    '--format', 'bestvideo[height<=480]+bestaudio/best[height<=480]',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--socket-timeout', '30',
    '--fragment-retries', '3',
    '--retries', '3',
    '--max-filesize', '100M',
    '-o', outputTemplate,
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--referer', 'https://www.youtube.com/',
    '--extractor-args', 'youtube:player_client=ios,web',
    '--no-warnings',
    '--sleep-interval', '1',
    '--max-sleep-interval', '3',
    videoUrl
  ];

  const { stdout, stderr } = await execFileAsync(YT_DLP_PATH, args, {
    timeout: 300000,
    maxBuffer: 1024 * 1024 * 10,
    cwd: __dirname,
    env: {
      ...process.env,
      PATH: process.env.PATH
    }
  });
  
  return { success: true, stdout, stderr };
}

// Serve video files
app.use('/videos', express.static(VIDEOS_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    console.log('🎥 Serving video:', path.basename(filePath));
  }
}));

// Cleanup old videos
function cleanupOldVideos() {
  try {
    const files = fs.readdirSync(VIDEOS_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    files.forEach(file => {
      const filePath = path.join(VIDEOS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        console.log('🗑️ Cleaned up old video:', file);
      }
    });
  } catch (err) {
    console.error('❌ Cleanup error:', err.message);
  }
}

setInterval(cleanupOldVideos, 60 * 60 * 1000);

// Catch-all handler
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/videos/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📴 Shutting down gracefully...');
  await browserPool.closeAll();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📴 Shutting down gracefully...');
  await browserPool.closeAll();
  process.exit(0);
});

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Stepwise Studio server running on port ${PORT}`);
  console.log(`🔑 YouTube API configured: ${!!process.env.YOUTUBE_API_KEY}`);
  console.log(`📁 Videos directory: ${VIDEOS_DIR}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 Puppeteer bot detection bypass: ENABLED`);
});