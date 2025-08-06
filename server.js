// Complete enhanced server.js with advanced bot detection bypass
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

// Import our advanced stealth browser
const AdvancedStealthBrowser = require('./AdvancedStealthBrowser');

const execFileAsync = promisify(execFile);
const app = express();

// Initialize the stealth browser system
const stealthBrowser = new AdvancedStealthBrowser();

// Configure paths
const YT_DLP_PATH = process.env.NODE_ENV === 'production' 
  ? path.join(__dirname, 'bin', 'yt-dlp')
  : 'yt-dlp';

const VIDEOS_DIR = path.join(__dirname, 'videos');
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

// Middleware
app.use(cors());
app.use(express.json());

console.log('🎬 Stepwise Studio with Advanced Bot Detection Bypass starting...');
console.log('📁 Videos directory:', VIDEOS_DIR);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('📺 yt-dlp path:', YT_DLP_PATH);
console.log('🎭 Advanced stealth mode: ENABLED');

// Ensure directories exist
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  console.log('📁 Created videos directory');
}

if (!fs.existsSync(COOKIES_PATH)) {
  fs.writeFileSync(COOKIES_PATH, '# Netscape HTTP Cookie File\n');
  console.log('🍪 Created cookies file');
}

// Enhanced rate limiting with user tracking
const downloadQueue = new Map();
const userAttempts = new Map();
const DOWNLOAD_COOLDOWN = 3000; // Reduced to 3 seconds
const MAX_ATTEMPTS_PER_HOUR = 20;

function checkDownloadRateLimit(ip) {
  const now = Date.now();
  const lastDownload = downloadQueue.get(ip) || 0;
  const hourAgo = now - (60 * 60 * 1000);
  
  // Clean old attempts
  const attempts = userAttempts.get(ip) || [];
  const recentAttempts = attempts.filter(time => time > hourAgo);
  userAttempts.set(ip, recentAttempts);
  
  // Check hourly limit
  if (recentAttempts.length >= MAX_ATTEMPTS_PER_HOUR) {
    return {
      allowed: false,
      error: 'hourly_limit',
      message: 'Too many downloads this hour. Please wait before trying again.'
    };
  }
  
  // Check cooldown
  if (now - lastDownload < DOWNLOAD_COOLDOWN) {
    return {
      allowed: false,
      error: 'cooldown',
      timeRemaining: Math.ceil((DOWNLOAD_COOLDOWN - (now - lastDownload)) / 1000)
    };
  }
  
  // Update tracking
  downloadQueue.set(ip, now);
  recentAttempts.push(now);
  userAttempts.set(ip, recentAttempts);
  
  return { allowed: true };
}

// Multi-method download system
class EnhancedDownloadManager {
  constructor() {
    this.downloadMethods = [
      { name: 'stealth-puppeteer', priority: 1, success: 0, attempts: 0 },
      { name: 'yt-dlp-stealth', priority: 2, success: 0, attempts: 0 },
      { name: 'yt-dlp-fallback', priority: 3, success: 0, attempts: 0 }
    ];
  }

  // Get best method based on recent success rates
  getBestMethod() {
    const methodsWithRate = this.downloadMethods.map(method => ({
      ...method,
      successRate: method.attempts > 0 ? method.success / method.attempts : 0.5
    }));

    // Sort by success rate, then by priority
    methodsWithRate.sort((a, b) => {
      const rateDiff = b.successRate - a.successRate;
      return rateDiff !== 0 ? rateDiff : a.priority - b.priority;
    });

    return methodsWithRate[0];
  }

  updateMethodStats(methodName, success) {
    const method = this.downloadMethods.find(m => m.name === methodName);
    if (method) {
      method.attempts++;
      if (success) method.success++;
    }
  }

  async downloadVideo(videoId) {
    const finalVideoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);
    
    // Check if already exists
    if (fs.existsSync(finalVideoPath)) {
      const stats = fs.statSync(finalVideoPath);
      if (stats.size > 0) {
        console.log('✅ Video already cached:', videoId);
        return { success: true, method: 'cached', path: finalVideoPath };
      } else {
        fs.unlinkSync(finalVideoPath);
      }
    }

    // Try methods in order of success rate
    const methodOrder = [...this.downloadMethods].sort(
      (a, b) => this.getBestMethod().name === a.name ? -1 : 1
    );

    for (const method of methodOrder) {
      console.log(`🔄 Trying ${method.name} for video ${videoId}...`);
      
      try {
        let result;
        
        switch (method.name) {
          case 'stealth-puppeteer':
            result = await this.downloadWithStealthPuppeteer(videoId, finalVideoPath);
            break;
          case 'yt-dlp-stealth':
            result = await this.downloadWithYtDlpStealth(videoId, finalVideoPath);
            break;
          case 'yt-dlp-fallback':
            result = await this.downloadWithYtDlpFallback(videoId, finalVideoPath);
            break;
        }

        if (result && result.success) {
          this.updateMethodStats(method.name, true);
          console.log(`✅ Download successful with ${method.name}`);
          return { ...result, method: method.name };
        }

      } catch (error) {
        console.log(`❌ ${method.name} failed:`, error.message);
        this.updateMethodStats(method.name, false);
        
        // Clean up any partial files
        if (fs.existsSync(finalVideoPath)) {
          try {
            fs.unlinkSync(finalVideoPath);
          } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
          }
        }
      }
    }

    throw new Error('All download methods failed');
  }

  async downloadWithStealthPuppeteer(videoId, outputPath) {
    try {
      console.log('🎭 Starting stealth Puppeteer extraction...');
      
      // Extract video data using stealth browser
      const videoData = await stealthBrowser.extractYouTubeVideoData(videoId);
      
      if (!videoData.available || !videoData.videoUrls.length) {
        throw new Error('No video URLs found');
      }

      // Try downloading from extracted URLs (prefer lower quality for speed)
      const urlsToTry = videoData.videoUrls.slice(0, 3); // Try first 3 URLs
      
      for (let i = 0; i < urlsToTry.length; i++) {
        const videoUrl = urlsToTry[i];
        console.log(`🔄 Attempting direct download ${i + 1}/${urlsToTry.length}: ${videoUrl.quality}`);
        
        try {
          await stealthBrowser.downloadVideoDirectly(videoUrl.url, outputPath);
          
          // Verify download
          const stats = fs.statSync(outputPath);
          if (stats.size > 1000) { // At least 1KB
            console.log(`✅ Stealth download successful: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
            return { success: true, size: stats.size, quality: videoUrl.quality };
          } else {
            fs.unlinkSync(outputPath);
            throw new Error('Downloaded file too small');
          }
          
        } catch (downloadError) {
          console.log(`❌ Direct download attempt ${i + 1} failed:`, downloadError.message);
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        }
      }

      throw new Error('All stealth download attempts failed');

    } catch (error) {
      console.error('❌ Stealth Puppeteer method failed:', error.message);
      throw error;
    }
  }

  async downloadWithYtDlpStealth(videoId, outputPath) {
    const outputTemplate = path.join(VIDEOS_DIR, `${videoId}.%(ext)s`);
    
    const args = [
      // Enhanced stealth arguments
      '--cookies', COOKIES_PATH,
      '--format', 'best[height<=480]/best[height<=720]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--socket-timeout', '30',
      '--fragment-retries', '5',
      '--retries', '10',
      '--max-filesize', '150M',
      '-o', outputTemplate,
      
      // Advanced anti-detection
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--referer', 'https://www.youtube.com/',
      '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--add-header', 'Accept-Encoding:gzip, deflate, br',
      '--add-header', 'DNT:1',
      '--add-header', 'Connection:keep-alive',
      '--add-header', 'Upgrade-Insecure-Requests:1',
      '--add-header', 'sec-ch-ua:"Not_A Brand";v="8", "Chromium";v="120"',
      '--add-header', 'sec-ch-ua-mobile:?0',
      '--add-header', 'sec-ch-ua-platform:"Windows"',
      
      // Multiple extractor strategies
      '--extractor-args', 'youtube:player_client=android,web,ios',
      
      // Rate limiting to avoid detection
      '--sleep-interval', '2',
      '--max-sleep-interval', '5',
      '--sleep-requests', '1',
      '--sleep-subtitles', '1',
      
      // Additional options
      '--no-warnings',
      '--no-call-home',
      '--no-check-certificate',
      
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    try {
      const { stdout, stderr } = await execFileAsync(YT_DLP_PATH, args, {
        timeout: 300000, // 5 minutes
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        cwd: __dirname,
        env: {
          ...process.env,
          PATH: process.env.PATH
        }
      });

      console.log('📺 yt-dlp stealth stdout:', stdout);
      if (stderr) console.log('📺 yt-dlp stealth stderr:', stderr);

      // Check if file was created
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        return { success: true, size: stats.size };
      }

      // Look for file with different extension
      const files = fs.readdirSync(VIDEOS_DIR);
      const downloadedFile = files.find(file => file.startsWith(videoId));
      
      if (downloadedFile) {
        const downloadedPath = path.join(VIDEOS_DIR, downloadedFile);
        if (downloadedFile !== `${videoId}.mp4`) {
          fs.renameSync(downloadedPath, outputPath);
        }
        const stats = fs.statSync(outputPath);
        return { success: true, size: stats.size };
      }

      throw new Error('No output file created');

    } catch (error) {
      console.error('❌ yt-dlp stealth failed:', error.message);
      throw error;
    }
  }

  async downloadWithYtDlpFallback(videoId, outputPath) {
    const outputTemplate = path.join(VIDEOS_DIR, `${videoId}.%(ext)s`);
    
    // Last resort with minimal options
    const args = [
      '-f', 'worst[height<=360]/worst',
      '--no-playlist',
      '--socket-timeout', '60',
      '--retries', '15',
      '--max-filesize', '50M',
      '-o', outputTemplate,
      '--user-agent', 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
      '--extractor-args', 'youtube:player_client=android_music,android_creator',
      '--sleep-interval', '3',
      '--max-sleep-interval', '8',
      '--no-warnings',
      '--ignore-errors',
      '--no-call-home',
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    try {
      const { stdout, stderr } = await execFileAsync(YT_DLP_PATH, args, {
        timeout: 300000,
        maxBuffer: 1024 * 1024 * 10,
        cwd: __dirname,
        env: {
          ...process.env,
          PATH: process.env.PATH
        }
      });

      console.log('📺 yt-dlp fallback stdout:', stdout);

      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        return { success: true, size: stats.size };
      }

      throw new Error('Fallback method failed to create file');

    } catch (error) {
      console.error('❌ yt-dlp fallback failed:', error.message);
      throw error;
    }
  }
}

// Initialize download manager
const downloadManager = new EnhancedDownloadManager();

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
    stealthMode: true,
    environment: process.env.NODE_ENV || 'development',
    downloadStats: downloadManager.downloadMethods.map(m => ({
      method: m.name,
      successRate: m.attempts > 0 ? (m.success / m.attempts * 100).toFixed(1) + '%' : 'N/A',
      attempts: m.attempts
    }))
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

// Enhanced download endpoint
app.get('/download', async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) {
    return res.status(400).json({ error: 'Missing video ID' });
  }

  // Rate limiting check
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const rateCheck = checkDownloadRateLimit(clientIP);
  
  if (!rateCheck.allowed) {
    if (rateCheck.error === 'hourly_limit') {
      return res.status(429).json({ 
        error: 'Download limit reached',
        details: rateCheck.message
      });
    } else {
      return res.status(429).json({ 
        error: 'Too many requests',
        details: `Please wait ${rateCheck.timeRemaining} seconds before downloading another video`
      });
    }
  }

  console.log('⬇️ Starting enhanced download for video:', videoId);

  try {
    const result = await downloadManager.downloadVideo(videoId);
    
    if (!result.success) {
      throw new Error('Download failed');
    }

    const finalVideoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);
    const stats = fs.statSync(finalVideoPath);
    
    console.log(`✅ Download completed using ${result.method}:`, videoId, 
      `(${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    
    res.json({ 
      url: `/videos/${videoId}.mp4`,
      method: result.method,
      size: stats.size,
      quality: result.quality || 'unknown'
    });

  } catch (error) {
    console.error('❌ All download methods failed for', videoId);
    console.error('Error details:', error.message);
    
    // Enhanced error categorization
    let userMessage = 'Failed to download video';
    let userDetails = 'Please try again or select a different video';
    let statusCode = 500;
    
    if (error.message.includes('Sign in to confirm') || error.message.includes('bot detection')) {
      userMessage = 'Video temporarily unavailable';
      userDetails = 'YouTube is currently restricting access to this video. Please try a different video or wait a few minutes.';
      statusCode = 503;
    } else if (error.message.includes('Video unavailable') || error.message.includes('Private video')) {
      userMessage = 'Video not accessible';
      userDetails = 'This video may be private, deleted, or restricted in your region.';
      statusCode = 404;
    } else if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
      userMessage = 'Download timeout';
      userDetails = 'The video took too long to download. Please try a shorter video or try again later.';
      statusCode = 408;
    } else if (error.message.includes('too large') || error.message.includes('filesize')) {
      userMessage = 'Video too large';
      userDetails = 'This video is too large to download. Please try a shorter video.';
      statusCode = 413;
    }
    
    res.status(statusCode).json({ 
      error: userMessage, 
      details: userDetails,
      code: error.code || 'DOWNLOAD_FAILED'
    });
  }
});

// Serve video files
app.use('/videos', express.static(VIDEOS_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    console.log('🎥 Serving video:', path.basename(filePath));
  }
}));

// Enhanced cleanup function
function cleanupOldVideos() {
  try {
    const files = fs.readdirSync(VIDEOS_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cleanedCount = 0;
    let totalSize = 0;

    files.forEach(file => {
      const filePath = path.join(VIDEOS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        totalSize += stats.size;
        fs.unlinkSync(filePath);
        cleanedCount++;
        console.log('🗑️ Cleaned up old video:', file);
      }
    });

    if (cleanedCount > 0) {
      console.log(`🧹 Cleanup completed: ${cleanedCount} files removed, ${(totalSize / 1024 / 1024).toFixed(2)}MB freed`);
    }
  } catch (err) {
    console.error('❌ Cleanup error:', err.message);
  }
}

// Run cleanup every hour
setInterval(cleanupOldVideos, 60 * 60 * 1000);

// Statistics endpoint
app.get('/api/stats', (req, res) => {
  try {
    const files = fs.readdirSync(VIDEOS_DIR);
    const videoFiles = files.filter(f => f.endsWith('.mp4'));
    
    let totalSize = 0;
    videoFiles.forEach(file => {
      const stats = fs.statSync(path.join(VIDEOS_DIR, file));
      totalSize += stats.size;
    });

    res.json({
      cached_videos: videoFiles.length,
      total_cache_size: `${(totalSize / 1024 / 1024).toFixed(2)}MB`,
      download_methods: downloadManager.downloadMethods.map(m => ({
        method: m.name,
        success_rate: m.attempts > 0 ? `${(m.success / m.attempts * 100).toFixed(1)}%` : 'N/A',
        total_attempts: m.attempts,
        successful_downloads: m.success
      })),
      uptime: process.uptime(),
      memory_usage: process.memoryUsage()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

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
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📴 Shutting down gracefully...');
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
  console.log(`🎭 Advanced stealth bot detection bypass: ENABLED`);
  console.log(`📊 Multiple download methods: ${downloadManager.downloadMethods.length} configured`);
  console.log('✨ Ready to serve dance tutorials with enhanced reliability!');
});