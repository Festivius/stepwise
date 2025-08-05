require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(cors());

// Path configurations
const VIDEOS_DIR = path.join(__dirname, 'videos');
const FRONTEND_DIR = path.join(__dirname, '../frontend'); // Path to your frontend

console.log('VIDEOS_DIR:', VIDEOS_DIR);
console.log('FRONTEND_DIR:', FRONTEND_DIR);
console.log('index.html exists:', fs.existsSync(path.join(FRONTEND_DIR, 'index.html')));

// Ensure directories exist
[VIDEOS_DIR, FRONTEND_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Serve frontend files
//app.use(express.static(FRONTEND_DIR));

// API Endpoints
app.get('/youtube-search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing search query' });

    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/search`,
      {
        params: {
          part: 'snippet',
          type: 'video',
          maxResults: 10,
          q: query,
          key: process.env.YOUTUBE_API_KEY
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('YouTube API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to search YouTube' });
  }
});

app.get('/download', (req, res) => {
  const videoId = req.query.id;
  if (!videoId) return res.status(400).json({ error: 'Missing video ID' });

  const outputPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);

  if (fs.existsSync(outputPath)) {
    return res.json({ url: `/api/videos/${videoId}.mp4` }); // Changed path
  }

  const cmd = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best" --merge-output-format mp4 -o "${outputPath}" https://www.youtube.com/watch?v=${videoId}`;
  
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error('Download error:', stderr);
      return res.status(500).json({ error: 'Failed to download video' });
    }
    res.json({ url: `/api/videos/${videoId}.mp4` }); // Changed path
  });
});

// Serve videos through API route
app.use('/api/videos', express.static(VIDEOS_DIR));

// Fallback to frontend
app.use(express.static(FRONTEND_DIR));
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));