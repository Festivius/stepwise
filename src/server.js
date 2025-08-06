require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Path configurations - Use Electron's userData directory when available
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.join(__dirname, 'videos');

console.log('🎬 Stepwise Studio server starting...');
console.log('📁 Videos directory:', VIDEOS_DIR);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

// Ensure videos directory exists
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  console.log('📁 Created videos directory');
}

// Serve static files from src directory for Electron
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp4')) {
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
    diskSpace: getDiskSpace(),
    isElectron: !!process.env.VIDEOS_DIR
  });
});

function getDiskSpace() {
  try {
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
          q: query + ' dance tutorial',
          key: process.env.YOUTUBE_API_KEY,
          safeSearch: 'strict'
        },
        timeout: 15000
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

// Video download endpoint - Updated for better Electron compatibility
app.get('/download', (req, res) => {
  const videoId = req.query.id;
  if (!videoId) {
    return res.status(400).json({ error: 'Missing video ID' });
  }

  const outputPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  // Check if video already exists
  if (fs.existsSync(outputPath)) {
    console.log('✅ Video already cached:', videoId);
    // Return file:// URL for Electron
    const videoUrl = process.env.VIDEOS_DIR ? 
      `file://${outputPath}` : 
      `/videos/${videoId}.mp4`;
    return res.json({ url: videoUrl });
  }

  console.log('⬇️ Starting download for video:', videoId);

  // Use youtube-dl-exec for better cross-platform compatibility
  const ytDlp = require('youtube-dl-exec');
  
  ytDlp(`https://www.youtube.com/watch?v=${videoId}`, {
    format: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
    mergeOutputFormat: 'mp4',
    output: outputPath,
    maxFilesize: '100M',
    socketTimeout: 30,
    retries: 3
  })
  .then(() => {
    // Verify file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Video file not created');
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      fs.unlinkSync(outputPath);
      throw new Error('Downloaded video file is empty');
    }

    console.log('✅ Download completed:', videoId, `(${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    
    // Return appropriate URL based on environment
    const videoUrl = process.env.VIDEOS_DIR ? 
      `file://${outputPath}` : 
      `/videos/${videoId}.mp4`;
    
    res.json({ url: videoUrl });
  })
  .catch((error) => {
    console.error('❌ Download failed for', videoId, error.message);
    
    // Clean up partial file
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    
    res.status(500).json({ 
      error: 'Failed to download video',
      details: error.message,
      videoId: videoId
    });
  });
});

// Serve video files (for web version)
app.use('/videos', express.static(VIDEOS_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    console.log('🎥 Serving video:', path.basename(filePath));
  }
}));

// Cleanup old videos periodically
function cleanupOldVideos() {
  try {
    const files = fs.readdirSync(VIDEOS_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    let cleaned = 0;
    files.forEach(file => {
      const filePath = path.join(VIDEOS_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          console.log('🗑️ Cleaned up old video:', file);
          cleaned++;
        }
      } catch (err) {
        console.warn('⚠️ Could not clean up file:', file, err.message);
      }
    });
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old video(s)`);
    }
  } catch (err) {
    console.error('❌ Cleanup error:', err.message);
  }
}

// Run cleanup every hour in Electron
if (process.env.VIDEOS_DIR) {
  setInterval(cleanupOldVideos, 60 * 60 * 1000);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
if (!module.parent) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Stepwise Studio server running on port ${PORT}`);
  });
} else {
  // Export for Electron
  module.exports = app;
}