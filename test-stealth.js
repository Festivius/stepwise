// test-stealth.js - Test the stealth system
const AdvancedStealthBrowser = require('./AdvancedStealthBrowser');

async function testStealthSystem() {
  console.log('🧪 Testing Advanced Stealth Bot Detection Bypass System');
  console.log('=' .repeat(60));

  const stealthBrowser = new AdvancedStealthBrowser();
  
  // Test video ID - use a popular dance tutorial
  const testVideoId = 'dQw4w9WgXcQ'; // Never Gonna Give You Up - good for testing
  
  try {
    console.log('🎭 Testing stealth browser creation...');
    const { browser, page } = await stealthBrowser.createStealthBrowser();
    
    // Test bot detection evasion
    console.log('🔍 Testing bot detection evasion...');
    const botDetectionResults = await page.evaluate(() => {
      const tests = {
        webdriver: typeof navigator.webdriver,
        chrome: typeof window.chrome,
        permissions: typeof navigator.permissions,
        plugins: navigator.plugins.length,
        languages: navigator.languages.length,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        connection: typeof navigator.connection
      };
      return tests;
    });

    console.log('📊 Bot Detection Test Results:');
    console.table(botDetectionResults);

    // Test YouTube access
    console.log('🎬 Testing YouTube access...');
    await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    const youtubeAccessible = await page.evaluate(() => {
      return {
        title: document.title,
        hasVideoElements: document.querySelectorAll('video').length > 0,
        hasYouTubeElements: document.querySelectorAll('[data-testid], [role="main"]').length > 0
      };
    });

    console.log('✅ YouTube Access Test:', youtubeAccessible.title ? 'PASSED' : 'FAILED');
    
    await page.close();
    await browser.close();

    // Test video extraction (comment out if you want to avoid using quota)
    /*
    console.log('🎯 Testing video data extraction...');
    try {
      const videoData = await stealthBrowser.extractYouTubeVideoData(testVideoId);
      console.log('✅ Video Extraction Test: PASSED');
      console.log(`   - Title: ${videoData.title?.substring(0, 50)}...`);
      console.log(`   - URLs found: ${videoData.videoUrls?.length || 0}`);
      console.log(`   - Qualities available: ${videoData.videoUrls?.map(u => u.quality).join(', ') || 'none'}`);
    } catch (extractError) {
      console.log('❌ Video Extraction Test: FAILED');
      console.log(`   Error: ${extractError.message}`);
    }
    */

    console.log('\n🎉 Stealth system test completed!');
    console.log('💡 Tips for avoiding detection:');
    console.log('   - Use random delays between requests');
    console.log('   - Rotate user agents and viewports');
    console.log('   - Implement proper error handling');
    console.log('   - Monitor success rates and adapt');

  } catch (error) {
    console.error('❌ Stealth system test failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Ensure all dependencies are installed: npm install');
    console.log('   2. Check if Puppeteer can launch browsers in your environment');
    console.log('   3. For production, ensure proper headless mode configuration');
    console.log('   4. Check network connectivity and firewall settings');
  }
}

// Run the test
if (require.main === module) {
  testStealthSystem().catch(console.error);
}

module.exports = { testStealthSystem };