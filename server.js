// Enhanced server.js with improved bot detection bypass
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

const VIDEOS_DIR = path.join(__dirname, 'videos');
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

// Enhanced YT-DLP configuration with multiple fallback strategies
const YT_DLP_PATH = process.env.NODE_ENV === 'production' 
  ? path.join(__dirname, 'bin', 'yt-dlp')
  : 'yt-dlp';

// Cookie management for bot detection bypass
class CookieManager {
  constructor() {
    this.cookiesPath = path.join(__dirname, 'youtube-cookies.txt');
    this.lastCookieUpdate = 0;
    this.cookieUpdateInterval = 30 * 60 * 1000; // 30 minutes
  }

  // Create realistic YouTube cookies
  async generateFreshCookies() {
    const browser = await puppeteer.launch(await getPuppeteerConfig());
    
    try {
      const page = await browser.newPage();
      
      // Set realistic browser fingerprints
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Visit YouTube homepage to get initial cookies
      await page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait a bit to let cookies settle
      await page.waitForTimeout(3000);

      // Get cookies from the page
      const cookies = await page.cookies();
      
      // Convert to Netscape cookie format for yt-dlp
      let cookieString = '# Netscape HTTP Cookie File\n';
      cookieString += '# This is a generated file! Do not edit.\n\n';
      
      cookies.forEach(cookie => {
        const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
        const secure = cookie.secure ? 'TRUE' : 'FALSE';
        const httpOnly = cookie.httpOnly ? 'TRUE' : 'FALSE';
        const expiry = cookie.expires ? Math.floor(cookie.expires) : '0';
        
        cookieString += `${domain}\t${httpOnly}\t${cookie.path}\t${secure}\t${expiry}\t${cookie.name}\t${cookie.value}\n`;
      });

      // Write cookies to file
      fs.writeFileSync(this.cookiesPath, cookieString);
      this.lastCookieUpdate = Date.now();
      
      console.log('🍪 Fresh YouTube cookies generated');
      return true;

    } catch (error) {
      console.error('❌ Cookie generation failed:', error.message);
      return false;
    } finally {
      await browser.close();
    }
  }

  async ensureFreshCookies() {
    const now = Date.now();
    
    if (!fs.existsSync(this.cookiesPath) || 
        (now - this.lastCookieUpdate) > this.cookieUpdateInterval) {
      return await this.generateFreshCookies();
    }
    
    return true;
  }
}

const cookieManager = new CookieManager();

// Enhanced download strategies with multiple fallbacks
const downloadStrategies = [
  // Strategy 1: yt-dlp with fresh cookies and iOS client
  async function strategyWithCookies(videoId, outputPath) {
    console.log('🎯 Strategy 1: yt-dlp with fresh cookies and iOS client...');
    
    await cookieManager.ensureFreshCookies();
    
    const args = [
      '--cookies', cookieManager.cookiesPath,
      '--format', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
      '--merge-output-format', 'mp4',
      '--extractor-args', 'youtube:player_client=ios,mweb,tv_embedded',
      '--user-agent', 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
      '--referer', 'https://www.youtube.com/',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--socket-timeout', '30',
      '--retries', '3',
      '--fragment-retries', '5',
      '--no-warnings',
      '--no-playlist',
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    await execFileAsync(YT_DLP_PATH, args, {
      timeout: 180000,
      env: { ...process.env, PATH: process.env.PATH }
    });
    
    return { success: true, method: 'yt-dlp-cookies-ios' };
  },

  // Strategy 2: yt-dlp with Android client (often bypasses restrictions)
  async function strategyAndroidClient(videoId, outputPath) {
    console.log('🎯 Strategy 2: yt-dlp with Android client...');
    
    const args = [
      '--format', 'worst[height<=360]/best[height<=480]/best',
      '--extractor-args', 'youtube:player_client=android,android_music,android_creator',
      '--user-agent', 'com.google.android.youtube/18.11.34 (Linux; U; Android 11; en_US)',
      '--add-header', 'X-YouTube-Client-Name:3',
      '--add-header', 'X-YouTube-Client-Version:18.11.34',
      '--socket-timeout', '30',
      '--retries', '2',
      '--no-warnings',
      '--no-playlist',
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    await execFileAsync(YT_DLP_PATH, args, {
      timeout: 120000,
      env: { ...process.env, PATH: process.env.PATH }
    });
    
    return { success: true, method: 'yt-dlp-android' };
  },

  // Strategy 3: Enhanced Puppeteer with better stealth
  async function strategyStealthPuppeteer(videoId, outputPath) {
    console.log('🎯 Strategy 3: Enhanced stealth Puppeteer...');
    
    const browser = await browserPool.getBrowser();
    const page = await browser.newPage();
    
    try {
      // Enhanced stealth configuration
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // More comprehensive bot detection bypass
      await page.evaluateOnNewDocument(() => {
        // Remove webdriver property
        delete navigator.__proto__.webdriver;
        
        // Mock plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });
        
        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
        
        // Mock permissions
        Object.defineProperty(navigator, 'permissions', {
          get: () => ({
            query: () => Promise.resolve({ state: 'granted' })
          })
        });
      });

      // Set realistic viewport
      await page.setViewport({ width: 1366, height: 768 });
      
      // Add realistic headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none'
      });

      // Navigate with realistic timing
      await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
        waitUntil: 'networkidle0',
        timeout: 45000
      });

      // Random human-like delay
      await page.waitForTimeout(2000 + Math.random() * 3000);

      // Look for and handle consent dialogs
      try {
        const consentButton = await page.$('button[aria-label*="Accept"], button[aria-label*="Reject"], .VfPpkd-LgbsSe[jsname="tWT92d"]');
        if (consentButton) {
          await consentButton.click();
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        // Consent dialog might not exist
      }

      // Wait for video player
      await page.waitForSelector('video', { timeout: 20000 });
      
      // Extract video data using multiple methods
      const videoData = await page.evaluate(async (videoId) => {
        // Method 1: Try to find ytInitialPlayerResponse
        const scripts = Array.from(document.querySelectorAll('script'));
        
        for (const script of scripts) {
          if (script.textContent && script.textContent.includes('ytInitialPlayerResponse')) {
            const matches = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
            if (matches) {
              try {
                const playerResponse = JSON.parse(matches[1]);
                const streamingData = playerResponse.streamingData;
                
                if (streamingData && (streamingData.formats || streamingData.adaptiveFormats)) {
                  const formats = [
                    ...(streamingData.formats || []),
                    ...(streamingData.adaptiveFormats || [])
                  ];
                  
                  // Filter for video formats
                  const videoFormats = formats.filter(f => 
                    f.mimeType && f.mimeType.includes('video/mp4') && f.url
                  );
                  
                  if (videoFormats.length > 0) {
                    // Sort by quality preference
                    videoFormats.sort((a, b) => {
                      const heightA = parseInt(a.height) || 0;
                      const heightB = parseInt(b.height) || 0;
                      return heightA - heightB; // Prefer lower quality for reliability
                    });
                    
                    return {
                      title: document.title,
                      url: videoFormats[0].url,
                      quality: videoFormats[0].qualityLabel || 'unknown'
                    };
                  }
                }
              } catch (e) {
                console.log('Error parsing ytInitialPlayerResponse:', e);
              }
            }
          }
        }
        
        return null;
      }, videoId);

      if (!videoData?.url) {
        throw new Error('No video URL found');
      }

      console.log('📹 Found video URL, quality:', videoData.quality);

      // Download the video stream
      const response = await axios({
        method: 'GET',
        url: videoData.url,
        responseType: 'stream',
        timeout: 180000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
          'Accept': '*/*',
          'Accept-Encoding': 'identity'
        },
        maxRedirects: 5
      });

      // Stream to file
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      return { success: true, method: 'puppeteer-stealth', title: videoData.title };

    } finally {
      await page.close();
    }
  },

  // Strategy 4: Alternative extraction using embed player
  async function strategyEmbedPlayer(videoId, outputPath) {
    console.log('🎯 Strategy 4: Embed player extraction...');
    
    const args = [
      '--format', 'worst[height<=360]/best[height<=480]/best',
      '--extractor-args', 'youtube:player_client=tv_embedded,web_embedded',
      '--user-agent', 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1',
      '--add-header', 'X-YouTube-Client-Name:85',
      '--add-header', 'X-YouTube-Client-Version:2.0',
      '--socket-timeout', '30',
      '--retries', '1',
      '--no-warnings',
      '--no-playlist',
      '-o', outputPath,
      `https://www.youtube.com/embed/${videoId}`
    ];

    await execFileAsync(YT_DLP_PATH, args, {
      timeout: 90000,
      env: { ...process.env, PATH: process.env.PATH }
    });
    
    return { success: true, method: 'yt-dlp-embed' };
  }
];

// Enhanced download function with multiple strategies
async function downloadVideoWithMultipleStrategies(videoId) {
  const outputTemplate = path.join(VIDEOS_DIR, `${videoId}.%(ext)s`);
  const finalVideoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  // Try each strategy in sequence
  for (let i = 0; i < downloadStrategies.length; i++) {
    try {
      console.log(`\n🎬 Attempting download strategy ${i + 1}/${downloadStrategies.length} for ${videoId}`);
      
      const result = await downloadStrategies[i](videoId, outputTemplate);
      
      // Verify the download worked
      if (fs.existsSync(finalVideoPath)) {
        const stats = fs.statSync(finalVideoPath);
        if (stats.size > 1000) { // At least 1KB
          console.log(`✅ Success with strategy ${i + 1}: ${result.method} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
          return result;
        } else {
          console.log(`⚠️ Strategy ${i + 1} created empty file, trying next...`);
          fs.unlinkSync(finalVideoPath);
        }
      }
      
    } catch (error) {
      console.log(`❌ Strategy ${i + 1} failed: ${error.message}`);
      
      // Clean up any partial files
      try {
        if (fs.existsSync(finalVideoPath)) {
          fs.unlinkSync(finalVideoPath);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      // If this is not the last strategy, continue to next
      if (i < downloadStrategies.length - 1) {
        console.log(`⏭️ Trying next strategy...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause between attempts
      }
    }
  }

  throw new Error(`All ${downloadStrategies.length} download strategies failed`);
}

// Update the main download endpoint
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

  console.log('⬇️ Starting multi-strategy download for video:', videoId);

  try {
    const result = await downloadVideoWithMultipleStrategies(videoId);
    
    // Final verification
    const stats = fs.statSync(finalVideoPath);
    if (stats.size === 0) {
      fs.unlinkSync(finalVideoPath);
      throw new Error('Downloaded video file is empty');
    }

    console.log(`🎉 Download completed successfully: ${videoId} using ${result.method}`);
    res.json({ 
      url: `/videos/${videoId}.mp4`,
      method: result.method,
      size: stats.size
    });

  } catch (error) {
    console.error('❌ All download strategies failed for', videoId);
    console.error('Final error:', error.message);
    
    // Clean up any remaining partial files
    try {
      if (fs.existsSync(finalVideoPath)) {
        fs.unlinkSync(finalVideoPath);
      }
    } catch (cleanupError) {
      console.error('❌ Cleanup error:', cleanupError.message);
    }
    
    // Return user-friendly error based on the type of failure
    let userMessage = 'Unable to download video';
    let userDetails = 'This video may be restricted or unavailable. Please try a different video.';
    
    if (error.message.includes('bot') || error.message.includes('Sign in')) {
      userMessage = 'Video temporarily unavailable';
      userDetails = 'YouTube is currently blocking downloads. Please try again in a few minutes or try a different video.';
    } else if (error.message.includes('timeout')) {
      userMessage = 'Download timeout';
      userDetails = 'The download took too long. Please try a shorter or different video.';
    } else if (error.message.includes('unavailable') || error.message.includes('private')) {
      userMessage = 'Video not accessible';
      userDetails = 'This video may be private, deleted, or region-restricted.';
    }
    
    res.status(500).json({ 
      error: userMessage, 
      details: userDetails,
      suggestion: 'Try searching for dance tutorials with clear, simple titles for better success rates.'
    });
  }
});

// Add a health check for download capabilities
app.get('/download-health', async (req, res) => {
  try {
    // Test if yt-dlp binary works
    const { stdout } = await execFileAsync(YT_DLP_PATH, ['--version'], { timeout: 10000 });
    
    const health = {
      status: 'healthy',
      ytdlpVersion: stdout.trim(),
      cookiesAvailable: fs.existsSync(cookieManager.cookiesPath),
      lastCookieUpdate: new Date(cookieManager.lastCookieUpdate).toISOString(),
      strategiesAvailable: downloadStrategies.length,
      puppeteerEnabled: true
    };
    
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      strategiesAvailable: downloadStrategies.length
    });
  }
});

// Periodic cookie refresh (every 30 minutes)
setInterval(async () => {
  try {
    console.log('🍪 Refreshing YouTube cookies...');
    await cookieManager.generateFreshCookies();
  } catch (error) {
    console.error('❌ Scheduled cookie refresh failed:', error.message);
  }
}, cookieManager.cookieUpdateInterval);

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