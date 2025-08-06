require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { ok } = require('assert');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Path configurations
const VIDEOS_DIR = path.join(__dirname, 'videos');

console.log('🎬 Stepwise Studio starting...');
console.log('📁 Videos directory:', VIDEOS_DIR);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

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

// Video download endpoint
app.get('/download', (req, res) => {
  const videoId = req.query.id;
  if (!videoId) {
    return res.status(400).json({ error: 'Missing video ID' });
  }

  const outputPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  // Check if video already exists
  if (fs.existsSync(outputPath)) {
    console.log('✅ Video already cached:', videoId);
    return res.json({ url: `/videos/${videoId}.mp4` });
  }

  console.log('⬇️ Starting download for video:', videoId);

  // Enhanced yt-dlp command with better error handling
  const ytDlpCmd = [
    'yt-dlp',
    '--format', '"bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best"',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--max-filesize', '100M', // Limit file size to 100MB
    '--socket-timeout', '30',
    '--retries', '3',
    '--output', `"${outputPath}"`,
    `"https://www.youtube.com/watch?v=${videoId}"`
  ].join(' ');

  console.log('🎬 Executing:', ytDlpCmd);

  const downloadProcess = exec(ytDlpCmd, {
    timeout: 300000, // 5 minute timeout
    maxBuffer: 1024 * 1024 * 10 // 10MB buffer
  }, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Download failed for', videoId);
      console.error('Error:', error.message);
      console.error('Stderr:', stderr);
      
      // Clean up partial file
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      
      return res.status(500).json({ 
        error: 'Failed to download video',
        details: stderr || error.message,
        videoId: videoId
      });
    }

    // Verify file was created and has content
    if (!fs.existsSync(outputPath)) {
      console.error('❌ Video file not created:', videoId);
      return res.status(500).json({ error: 'Video file not created' });
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      console.error('❌ Video file is empty:', videoId);
      fs.unlinkSync(outputPath);
      return res.status(500).json({ error: 'Downloaded video file is empty' });
    }

    console.log('✅ Download completed:', videoId, `(${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    res.json({ url: `/videos/${videoId}.mp4` });
  });

  // Handle process errors
  downloadProcess.on('error', (error) => {
    console.error('❌ Process error:', error);
    res.status(500).json({ error: 'Download process failed', details: error.message });
  });
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
  // Don't serve index.html for API routes
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
});



// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});


// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});
