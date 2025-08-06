// test-server.js - Run this to test your server endpoints
const axios = require('axios');

const BASE_URL = 'http://localhost:3000'; // Adjust port if different

async function testServer() {
  console.log('🧪 Testing Stepwise Studio Server...\n');

  // Test 1: Health Check
  try {
    console.log('1. Testing health endpoint...');
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check passed:', health.data);
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return; // Stop if server isn't running
  }

  // Test 2: YouTube Search (requires API key)
  try {
    console.log('\n2. Testing YouTube search...');
    const search = await axios.get(`${BASE_URL}/youtube-search?q=dance tutorial`);
    console.log('✅ YouTube search passed, found', search.data.items?.length || 0, 'videos');
    
    // Test a download if we found videos
    if (search.data.items && search.data.items.length > 0) {
      const videoId = search.data.items[0].id.videoId;
      console.log('📹 Testing download with video ID:', videoId);
      
      try {
        const download = await axios.get(`${BASE_URL}/download?id=${videoId}`, {
          timeout: 30000 // 30 second timeout for download
        });
        console.log('✅ Download test passed:', download.data);
      } catch (downloadError) {
        console.log('⚠️  Download test failed:', downloadError.message);
      }
    }
  } catch (error) {
    console.log('❌ YouTube search failed:', error.response?.data || error.message);
  }

  // Test 3: Static file serving
  try {
    console.log('\n3. Testing static file serving...');
    const index = await axios.get(BASE_URL);
    console.log('✅ Index page served successfully, length:', index.data.length);
  } catch (error) {
    console.log('❌ Static file serving failed:', error.message);
  }

  console.log('\n🏁 Server testing completed!');
}

// Run the tests
testServer().catch(console.error);