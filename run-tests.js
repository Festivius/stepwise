#!/usr/bin/env node
// run-tests.js - Comprehensive test suite for Stepwise Studio

const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs');

let serverProcess;
const SERVER_PORT = 3000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

async function startServer() {
  console.log('🚀 Starting server...');
  
  serverProcess = spawn('node', ['src/server.js'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, PORT: SERVER_PORT }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`);
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));
}

async function stopServer() {
  if (serverProcess) {
    console.log('🛑 Stopping server...');
    serverProcess.kill();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function waitForServer(maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await axios.get(`${BASE_URL}/health`);
      return true;
    } catch (error) {
      console.log(`Waiting for server... (${i + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function runTests() {
  console.log('🧪 Stepwise Studio Test Suite\n');

  try {
    // Start server
    await startServer();

    // Wait for server to be ready
    const serverReady = await waitForServer();
    if (!serverReady) {
      throw new Error('Server failed to start');
    }

    console.log('✅ Server is running\n');

    // Run tests
    const testResults = {
      health: await testHealth(),
      static: await testStaticFiles(),
      search: await testYouTubeSearch(),
      download: await testDownload()
    };

    // Summary
    console.log('\n📊 Test Summary:');
    Object.entries(testResults).forEach(([test, passed]) => {
      console.log(`- ${test}: ${passed ? '✅' : '❌'}`);
    });

    const allPassed = Object.values(testResults).every(result => result);
    console.log(`\n${allPassed ? '🎉 All tests passed!' : '⚠️  Some tests failed'}`);

  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
  } finally {
    await stopServer();
  }
}

async function testHealth() {
  try {
    console.log('🏥 Testing health endpoint...');
    const response = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check passed');
    return true;
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return false;
  }
}

async function testStaticFiles() {
  try {
    console.log('📄 Testing static files...');
    const response = await axios.get(BASE_URL);
    console.log('✅ Static files served');
    return true;
  } catch (error) {
    console.log('❌ Static files failed:', error.message);
    return false;
  }
}

async function testYouTubeSearch() {
  try {
    console.log('🔍 Testing YouTube search...');
    const response = await axios.get(`${BASE_URL}/youtube-search?q=dance`);
    console.log(`✅ Search returned ${response.data.items?.length || 0} results`);
    return true;
  } catch (error) {
    console.log('❌ YouTube search failed:', error.response?.data?.error || error.message);
    return false;
  }
}

async function testDownload() {
  // This is a basic test - in practice, you'd want to test with a known video ID
  try {
    console.log('⬇️  Testing download endpoint...');
    // Test with invalid ID to check error handling
    const response = await axios.get(`${BASE_URL}/download?id=invalid`);
    console.log('⚠️  Download test - error handling needs checking');
    return false;
  } catch (error) {
    if (error.response?.status === 500) {
      console.log('✅ Download endpoint properly handles invalid requests');
      return true;
    }
    console.log('❌ Download test failed unexpectedly:', error.message);
    return false;
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Test suite interrupted');
  await stopServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await stopServer();
  process.exit(0);
});

// Run tests
runTests().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Test suite error:', error);
  process.exit(1);
});