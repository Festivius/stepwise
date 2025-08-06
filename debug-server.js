// debug-server.js - Check server configuration and dependencies
const fs = require('fs');
const path = require('path');

console.log('🔍 Stepwise Studio Server Debug\n');

// Check environment
console.log('📋 Environment Check:');
console.log('- Node version:', process.version);
console.log('- Working directory:', process.cwd());
console.log('- Environment:', process.env.NODE_ENV || 'development');

// Check required files
console.log('\n📁 File Structure Check:');
const requiredFiles = [
  'src/server.js',
  'src/index.html',
  'package.json',
  'main.js',
  'preload.js',
  'menu.js'
];

requiredFiles.forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`- ${file}: ${exists ? '✅' : '❌'}`);
});

// Check package.json dependencies
console.log('\n📦 Dependencies Check:');
try {
  const pkg = require('./package.json');
  const requiredDeps = [
    'express',
    'axios',
    'cors',
    'dotenv',
    'youtube-dl-exec'
  ];

  requiredDeps.forEach(dep => {
    const installed = pkg.dependencies && pkg.dependencies[dep];
    console.log(`- ${dep}: ${installed ? `✅ (${installed})` : '❌'}`);
  });
} catch (error) {
  console.log('❌ Could not read package.json:', error.message);
}

// Check environment variables
console.log('\n🔐 Environment Variables:');
require('dotenv').config();
console.log('- YOUTUBE_API_KEY:', process.env.YOUTUBE_API_KEY ? '✅ Set' : '❌ Not set');
console.log('- VIDEOS_DIR:', process.env.VIDEOS_DIR || 'Not set (will use default)');

// Check videos directory
console.log('\n📹 Videos Directory:');
const videosDir = process.env.VIDEOS_DIR || path.join(__dirname, 'videos');
console.log('- Path:', videosDir);
console.log('- Exists:', fs.existsSync(videosDir) ? '✅' : '❌');

if (fs.existsSync(videosDir)) {
  try {
    const files = fs.readdirSync(videosDir);
    console.log('- Files:', files.length);
    const videos = files.filter(f => f.endsWith('.mp4'));
    console.log('- Videos:', videos.length);
  } catch (error) {
    console.log('- Error reading directory:', error.message);
  }
}

// Check for yt-dlp or youtube-dl
console.log('\n⬇️  Download Tool Check:');
const { exec } = require('child_process');

function checkCommand(command) {
  return new Promise((resolve) => {
    exec(`${command} --version`, (error, stdout) => {
      if (error) {
        console.log(`- ${command}: ❌ Not found`);
        resolve(false);
      } else {
        console.log(`- ${command}: ✅ Found (${stdout.trim().split('\n')[0]})`);
        resolve(true);
      }
    });
  });
}

Promise.all([
  checkCommand('yt-dlp'),
  checkCommand('youtube-dl')
]).then(([ytdlp, youtubedl]) => {
  if (!ytdlp && !youtubedl) {
    console.log('\n⚠️  Warning: No download tool found. Install yt-dlp or youtube-dl:');
    console.log('   npm install -g yt-dlp');
    console.log('   or');
    console.log('   pip install yt-dlp');
  }
  
  console.log('\n🏁 Debug completed!');
}).catch(console.error);