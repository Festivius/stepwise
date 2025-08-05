require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const app = express();

// Configure yt-dlp binary path
const YT_DLP_PATH = process.env.NODE_ENV === 'production' 
  ? path.join(__dirname, 'bin', 'yt-dlp')  // Production path on Render
  : 'yt-dlp'; // Local development (assumes yt-dlp is in PATH)

// Middleware
app.use(cors());
app.use(express.json());

// Path configurations
const VIDEOS_DIR = path.join(__dirname, 'videos');

console.log('🎬 Stepwise Studio starting...');
console.log('📁 Videos directory:', VIDEOS_DIR);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('📺 yt-dlp path:', YT_DLP_PATH);

// Set up Python environment for yt-dlp in production
function setupPythonEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    // On Render with Poetry, the virtual environment is already activated
    // We just need to ensure the current environment variables are preserved
    console.log('🐍 Python environment configured for Poetry virtual environment');
    console.log('🐍 Python executable:', process.env.VIRTUAL_ENV || 'System Python');
  }
}

// Setup Python environment
setupPythonEnvironment();

// Check if yt-dlp binary exists and works
async function checkYtDlp() {
  try {
    if (process.env.NODE_ENV === 'production') {
      if (fs.existsSync(YT_DLP_PATH)) {
        console.log('✅ yt-dlp binary found at:', YT_DLP_PATH);
        
        // Make sure it's executable
        try {
          fs.chmodSync(YT_DLP_PATH, 0o755);
        } catch (chmodErr) {
          console.log('⚠️ Could not set permissions on yt-dlp binary:', chmodErr.message);
        }
        
        // Test the binary with Poetry virtual environment
        try {
          const { stdout } = await execFileAsync(YT_DLP_PATH, ['--version'], { 
            timeout: 10000,
            env: {
              ...process.env,
              // Poetry virtual environment variables are already set
              PATH: process.env.PATH
            }
          });
          console.log('📺 yt-dlp version:', stdout.trim());
          return true;
        } catch (testErr) {
          console.log('❌ yt-dlp test failed:', testErr.message);
          return false;
        }
      } else {
        console.log('❌ yt-dlp binary not found at:', YT_DLP_PATH);
        return false;
      }
    } else {
      // For local development, check if yt-dlp is in PATH
      try {
        const { stdout } = await execFileAsync('yt-dlp', ['--version'], { timeout: 5000 });
        console.log('📺 yt-dlp version (local):', stdout.trim());
        return true;
      } catch (err) {
        console.log('❌ yt-dlp not found in PATH (local development)');
        return false;
      }
    }
  } catch (error) {
    console.log('❌ Error checking yt-dlp:', error.message);
    return false;
  }
}

// Global flag to track yt-dlp status
let ytDlpWorking = false;

// Check yt-dlp availability on startup
checkYtDlp().then(working => {
  ytDlpWorking = working;
  console.log(`📺 yt-dlp status: ${working ? 'Working' : 'Not working'}`);
});

// Ensure videos directory exists
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  console.log('📁 Created videos directory');
}

// Serve static files (your HTML, CSS, JS, assets)
app.use(express.static(__dirname, {
  setHeaders: (res, path) => {
    if (path.endsWith('.mp4')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache videos for 1 day
    }
  }
}));

// Health check endpoint (important for Render)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    videosDir: fs.existsSync(VIDEOS_DIR),
    ytDlpBinary: fs.existsSync(YT_DLP_PATH),
    ytDlpWorking: ytDlpWorking,
    environment: process.env.NODE_ENV || 'development',
    virtualEnv: process.env.VIRTUAL_ENV || 'Not set',
    diskSpace: getDiskSpace()
  });
});

// Get disk space info
function getDiskSpace() {
  try {
    const stats = fs.statSync(VIDEOS_DIR);
    const files = fs.readdirSync(VIDEOS_DIR);
    return {
      exists: true,
      fileCount: files.length,
      videoFiles: files.filter(f => f.endsWith('.mp4')).length
    };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

// YouTube search endpoint
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
          q: query + ' dance tutorial', // Add dance context
          key: process.env.YOUTUBE_API_KEY,
          safeSearch: 'strict'
        },
        timeout: 10000 // 10 second timeout
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

// Custom yt-dlp wrapper function
async function downloadVideoWithYtDlp(videoUrl, outputTemplate) {
  const args = [
    // Format selection - prefer 720p or lower, mp4 format
    '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best',
    // Output format
    '--merge-output-format', 'mp4',
    // Don't download playlists
    '--no-playlist',
    // Timeout settings
    '--socket-timeout', '30',
    '--fragment-retries', '3',
    '--retries', '3',
    // File size limit
    '--max-filesize', '100M',
    // Output template
    '-o', outputTemplate,
    // Add user agent to avoid detection
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    // Add referer
    '--referer', 'https://www.youtube.com/',
    // Extract flat for faster processing
    '--no-warnings',
    // The video URL
    videoUrl
  ];

  console.log('🔧 Running yt-dlp with args:', args.join(' '));

  try {
    const { stdout, stderr } = await execFileAsync(YT_DLP_PATH, args, {
      timeout: 300000, // 5 minutes timeout
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      cwd: __dirname,
      env: {
        ...process.env,
        // Poetry virtual environment is already activated
        PATH: process.env.PATH
      }
    });
    
    console.log('📺 yt-dlp stdout:', stdout);
    if (stderr) {
      console.log('📺 yt-dlp stderr:', stderr);
    }
    
    return { success: true, stdout, stderr };
  } catch (error) {
    console.error('❌ yt-dlp execution error:', error.message);
    if (error.stdout) console.error('stdout:', error.stdout);
    if (error.stderr) console.error('stderr:', error.stderr);
    throw new Error(`yt-dlp failed: ${error.message}`);
  }
}

// Video download endpoint
app.get('/download', async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) {
    return res.status(400).json({ error: 'Missing video ID' });
  }

  // Check if yt-dlp is working
  if (!ytDlpWorking) {
    console.error('❌ yt-dlp is not working properly');
    return res.status(500).json({ 
      error: 'Video download service not available',
      details: 'yt-dlp binary is not functioning properly'
    });
  }

  // Define output paths
  const outputTemplate = path.join(VIDEOS_DIR, `${videoId}.%(ext)s`);
  const finalVideoPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  // Check if video already exists
  if (fs.existsSync(finalVideoPath)) {
    console.log('✅ Video already cached:', videoId);
    return res.json({ url: `/videos/${videoId}.mp4` });
  }

  console.log('⬇️ Starting download for video:', videoId);

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Download the video
    await downloadVideoWithYtDlp(videoUrl, outputTemplate);

    // Check if the downloaded file exists
    if (!fs.existsSync(finalVideoPath)) {
      // Sometimes the file might have a different extension, check for any file with the videoId
      const files = fs.readdirSync(VIDEOS_DIR);
      const downloadedFile = files.find(file => file.startsWith(videoId));
      
      if (downloadedFile) {
        const downloadedPath = path.join(VIDEOS_DIR, downloadedFile);
        // If it's not already .mp4, rename it
        if (downloadedFile !== `${videoId}.mp4`) {
          fs.renameSync(downloadedPath, finalVideoPath);
          console.log('📁 Renamed file from', downloadedFile, 'to', `${videoId}.mp4`);
        }
      } else {
        console.error('❌ No video file created for:', videoId);
        return res.status(500).json({ error: 'Video file not created after download' });
      }
    }

    // Verify the file is not empty
    const stats = fs.statSync(finalVideoPath);
    if (stats.size === 0) {
      console.error('❌ Video file is empty:', videoId);
      fs.unlinkSync(finalVideoPath);
      return res.status(500).json({ error: 'Downloaded video file is empty' });
    }

    console.log('✅ Download completed:', videoId, `(${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    res.json({ url: `/videos/${videoId}.mp4` });

  } catch (error) {
    console.error('❌ Download failed for', videoId);
    console.error('Error details:', error.message);
    
    // Clean up any partial files
    try {
      const files = fs.readdirSync(VIDEOS_DIR);
      files.forEach(file => {
        if (file.startsWith(videoId)) {
          const filePath = path.join(VIDEOS_DIR, file);
          fs.unlinkSync(filePath);
          console.log('🗑️ Cleaned up partial file:', file);
        }
      });
    } catch (cleanupError) {
      console.error('❌ Cleanup error:', cleanupError.message);
    }
    
    res.status(500).json({ 
      error: 'Failed to download video', 
      details: error.message
    });
  }
});

// Serve video files with proper headers
app.use('/videos', express.static(VIDEOS_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    console.log('🎥 Serving video:', path.basename(filePath));
  }
}));

// Cleanup old videos (optional - saves disk space)
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

// Run cleanup every hour
setInterval(cleanupOldVideos, 60 * 60 * 1000);

// Catch-all handler for SPA routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/videos/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
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
  console.log(`📺 yt-dlp binary path: ${YT_DLP_PATH}`);
  console.log(`🐍 Virtual environment: ${process.env.VIRTUAL_ENV || 'Not set'}`);
});