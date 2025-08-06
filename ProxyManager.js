// ProxyManager.js - Advanced proxy rotation and IP management
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.currentProxyIndex = 0;
    this.proxyStats = new Map();
    this.bannedProxies = new Set();
    this.lastRotation = Date.now();
    this.rotationInterval = 5 * 60 * 1000; // 5 minutes
  }

  // Initialize with free proxy services (for testing - use paid proxies in production)
  async initializeProxies() {
    console.log('🔄 Initializing proxy rotation system...');
    
    // Add your proxy sources here
    const proxySources = [
      'https://api.proxyscrape.com/v2/?request=getproxies&format=textplain&protocol=http&timeout=10000&country=all',
      'https://www.proxy-list.download/api/v1/get?type=http',
      // Add more proxy sources as needed
    ];

    for (const source of proxySources) {
      try {
        const response = await axios.get(source, { timeout: 10000 });
        const proxyList = response.data.split('\n')
          .filter(proxy => proxy.trim())
          .map(proxy => {
            const [host, port] = proxy.trim().split(':');
            return { host, port: parseInt(port), source };
          })
          .filter(proxy => proxy.host && proxy.port);

        this.proxies.push(...proxyList.slice(0, 20)); // Limit to 20 per source
        console.log(`✅ Loaded ${proxyList.length} proxies from source`);
      } catch (error) {
        console.log(`❌ Failed to load proxies from source: ${error.message}`);
      }
    }

    // Add manual proxy entries (replace with your own)
    const manualProxies = [
      // { host: 'proxy1.example.com', port: 8080, auth: { username: 'user', password: 'pass' } },
      // { host: 'proxy2.example.com', port: 3128 },
    ];
    
    this.proxies.push(...manualProxies);

    console.log(`🎯 Proxy system initialized with ${this.proxies.length} proxies`);
    
    // Test initial proxies
    await this.testProxies();
  }

  async testProxies() {
    console.log('🧪 Testing proxy connectivity...');
    
    const testPromises = this.proxies.slice(0, 10).map(async (proxy, index) => {
      try {
        const agent = new HttpsProxyAgent(`http://${proxy.host}:${proxy.port}`);
        const response = await axios.get('https://httpbin.org/ip', {
          httpsAgent: agent,
          timeout: 10000
        });
        
        this.proxyStats.set(`${proxy.host}:${proxy.port}`, {
          working: true,
          lastTested: Date.now(),
          responseTime: Date.now(),
          ip: response.data.origin
        });
        
        console.log(`✅ Proxy ${index + 1} working: ${proxy.host}:${proxy.port}`);
        return true;
      } catch (error) {
        this.proxyStats.set(`${proxy.host}:${proxy.port}`, {
          working: false,
          lastTested: Date.now(),
          error: error.message
        });
        console.log(`❌ Proxy ${index + 1} failed: ${proxy.host}:${proxy.port}`);
        return false;
      }
    });

    await Promise.all(testPromises);
    const workingProxies = Array.from(this.proxyStats.values()).filter(stats => stats.working).length;
    console.log(`🎉 ${workingProxies} proxies are working`);
  }

  getNextProxy() {
    if (this.proxies.length === 0) {
      return null;
    }

    // Filter out banned proxies
    const availableProxies = this.proxies.filter(proxy => 
      !this.bannedProxies.has(`${proxy.host}:${proxy.port}`)
    );

    if (availableProxies.length === 0) {
      // Reset banned list if all proxies are banned
      this.bannedProxies.clear();
      console.log('🔄 Reset banned proxy list');
    }

    // Rotate to next proxy
    const proxy = availableProxies[this.currentProxyIndex % availableProxies.length];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % availableProxies.length;

    return proxy;
  }

  banProxy(proxy, duration = 30 * 60 * 1000) { // 30 minutes default
    const proxyKey = `${proxy.host}:${proxy.port}`;
    this.bannedProxies.add(proxyKey);
    console.log(`🚫 Banned proxy: ${proxyKey}`);

    // Auto-unban after duration
    setTimeout(() => {
      this.bannedProxies.delete(proxyKey);
      console.log(`✅ Unbanned proxy: ${proxyKey}`);
    }, duration);
  }

  createProxyAgent(proxy) {
    if (!proxy) return null;

    const proxyUrl = proxy.auth 
      ? `http://${proxy.auth.username}:${proxy.auth.password}@${proxy.host}:${proxy.port}`
      : `http://${proxy.host}:${proxy.port}`;

    return new HttpsProxyAgent(proxyUrl);
  }

  async makeProxiedRequest(url, options = {}) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const proxy = this.getNextProxy();
      
      if (!proxy) {
        throw new Error('No available proxies');
      }

      try {
        const agent = this.createProxyAgent(proxy);
        const response = await axios({
          url,
          ...options,
          httpsAgent: agent,
          timeout: options.timeout || 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...options.headers
          }
        });

        console.log(`✅ Request successful via proxy: ${proxy.host}:${proxy.port}`);
        return response;

      } catch (error) {
        console.log(`❌ Request failed via proxy ${proxy.host}:${proxy.port}: ${error.message}`);
        lastError = error;

        // Ban proxy if it's consistently failing
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          this.banProxy(proxy);
        }
      }
    }

    throw lastError || new Error('All proxy attempts failed');
  }

  getStats() {
    const total = this.proxies.length;
    const banned = this.bannedProxies.size;
    const working = Array.from(this.proxyStats.values()).filter(stats => stats.working).length;

    return {
      total_proxies: total,
      working_proxies: working,
      banned_proxies: banned,
      available_proxies: total - banned,
      current_proxy_index: this.currentProxyIndex
    };
  }
}

// Enhanced Puppeteer with proxy support
class ProxyEnabledStealthBrowser {
  constructor(proxyManager) {
    this.proxyManager = proxyManager;
    this.browsers = [];
  }

  async createBrowserWithProxy() {
    const proxy = this.proxyManager.getNextProxy();
    
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-extensions',
      '--disable-ipc-flooding-protection',
      '--enable-automation=false',
      '--password-store=basic',
      '--use-mock-keychain',
      '--lang=en-US,en'
    ];

    // Add proxy configuration if available
    if (proxy) {
      if (proxy.auth) {
        args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
        // Note: Proxy auth needs to be handled differently in Puppeteer
      } else {
        args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
      }
      console.log(`🌐 Creating browser with proxy: ${proxy.host}:${proxy.port}`);
    }

    const browser = await puppeteer.launch({
      headless: process.env.NODE_ENV === 'production' ? 'new' : false,
      args,
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: { width: 1366, height: 768 }
    });

    // Set up proxy authentication if needed
    if (proxy && proxy.auth) {
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      await page.authenticate({
        username: proxy.auth.username,
        password: proxy.auth.password
      });
    }

    return { browser, proxy };
  }

  async extractWithProxy(videoId) {
    const { browser, proxy } = await this.createBrowserWithProxy();
    
    try {
      const page = await browser.newPage();
      
      // Apply stealth techniques
      await this.setupStealthMode(page);
      
      // Navigate to video
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Extract video data
      const videoData = await this.extractVideoData(page);
      
      console.log(`✅ Extraction successful via proxy: ${proxy?.host}:${proxy?.port || 'direct'}`);
      return videoData;
      
    } catch (error) {
      console.error(`❌ Extraction failed via proxy: ${proxy?.host}:${proxy?.port || 'direct'}`);
      
      // Ban proxy if extraction consistently fails
      if (proxy && (error.message.includes('timeout') || error.message.includes('blocked'))) {
        this.proxyManager.banProxy(proxy);
      }
      
      throw error;
    } finally {
      await browser.close();
    }
  }

  async setupStealthMode(page) {
    // Same stealth setup as before
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      
      window.chrome = {
        runtime: {},
        loadTimes: function() { return {}; },
        csi: function() { return {}; },
        app: {}
      };
      
      delete navigator.__proto__.webdriver;
    });

    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    });
  }

  async extractVideoData(page) {
    await page.waitForSelector('video, .html5-video-player', { timeout: 20000 });
    
    return await page.evaluate(() => {
      // Video extraction logic here
      const video = document.querySelector('video');
      const title = document.querySelector('h1.title yt-formatted-string')?.textContent || document.title;
      
      return {
        available: !!video,
        title: title,
        videoUrls: [] // Add extraction logic
      };
    });
  }
}

module.exports = { ProxyManager, ProxyEnabledStealthBrowser };