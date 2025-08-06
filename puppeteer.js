// scripts/setup-puppeteer.js
const fs = require('fs');
const path = require('path');

console.log('🤖 Setting up Puppeteer for bot detection bypass...');

// Create scripts directory if it doesn't exist
const scriptsDir = path.join(__dirname);
if (!fs.existsSync(scriptsDir)) {
  fs.mkdirSync(scriptsDir, { recursive: true });
}

// Create a stealth configuration file
const stealthConfig = {
  // Puppeteer stealth plugin configuration
  enabledEvasions: [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    'defaultArgs',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    'navigator.webdriver',
    'sourceurl',
    'user-agent-override',
    'webgl.vendor',
    'window.outerdimensions'
  ]
};

const configPath = path.join(__dirname, '..', 'puppeteer-stealth-config.json');
fs.writeFileSync(configPath, JSON.stringify(stealthConfig, null, 2));

console.log('✅ Puppeteer stealth configuration created');

// Check if we're in production environment
if (process.env.NODE_ENV === 'production') {
  console.log('🚀 Production environment detected');
  console.log('📦 Puppeteer will run in headless mode with optimized settings');
} else {
  console.log('🛠️ Development environment detected');
  console.log('👀 Puppeteer will run in headless mode for debugging');
}

console.log('🎯 Setup complete! Your app now has enhanced bot detection bypass capabilities.');