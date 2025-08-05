const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// Add stealth plugin
puppeteer.use(StealthPlugin());

async function downloadWithPuppeteer(videoId) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process'
    ]
  });

  const page = await browser.newPage();
  
  // Set realistic viewport and UA
  await page.setViewport({ width: 1280, height: 720 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

  try {
    // Navigate to YouTube with human-like delays
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Simulate human interaction
    await page.mouse.move(100, 100);
    await page.waitForTimeout(2000);
    await page.mouse.click(100, 100);
    await page.waitForSelector('video', { visible: true });

    // Extract video URL (method 1 - direct src)
    const videoUrl = await page.evaluate(() => {
      const video = document.querySelector('video');
      return video ? video.src : null;
    });

    // If no direct URL, try method 2 (network interception)
    if (!videoUrl) {
      console.log('Falling back to network interception...');
      return await interceptVideoUrl(page, videoId);
    }

    return videoUrl;
  } finally {
    await browser.close();
  }
}

async function interceptVideoUrl(page, videoId) {
  let videoUrl = null;
  
  // Capture network responses
  page.on('response', async (response) => {
    if (response.url().includes('googlevideo.com') && 
        response.url().includes('mime=video')) {
      videoUrl = response.url();
    }
  });

  // Trigger video load
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (video) video.play();
  });

  await page.waitForTimeout(5000); // Wait for video to load
  return videoUrl;
}

module.exports = downloadWithPuppeteer;