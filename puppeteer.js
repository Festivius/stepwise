// Enhanced Puppeteer stealth implementation
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin
puppeteer.use(StealthPlugin());

class AdvancedStealthBrowser {
  constructor() {
    this.browserPool = [];
    this.maxBrowsers = 3;
    this.currentBrowserIndex = 0;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    this.viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1536, height: 864 }
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  getRandomViewport() {
    return this.viewports[Math.floor(Math.random() * this.viewports.length)];
  }

  async createStealthBrowser() {
    const viewport = this.getRandomViewport();
    const userAgent = this.getRandomUserAgent();

    const browser = await puppeteer.launch({
      headless: process.env.NODE_ENV === 'production' ? 'new' : false,
      args: [
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
        '--lang=en-US,en',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-pings',
        '--disable-plugins-discovery',
        '--disable-preconnect',
        `--user-agent=${userAgent}`,
        `--window-size=${viewport.width},${viewport.height}`
      ],
      ignoreDefaultArgs: [
        '--enable-automation',
        '--enable-blink-features=AutomationControlled'
      ],
      defaultViewport: viewport
    });

    // Get the first page
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    // Advanced stealth techniques
    await this.setupAdvancedStealth(page, userAgent, viewport);

    return { browser, page };
  }

  async setupAdvancedStealth(page, userAgent, viewport) {
    // Set user agent
    await page.setUserAgent(userAgent);

    // Set viewport
    await page.setViewport(viewport);

    // Advanced bot detection bypass
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock navigator properties
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          {
            0: {type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: Plugin},
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            length: 1,
            name: "Chrome PDF Plugin"
          },
          {
            0: {type: "application/pdf", suffixes: "pdf", description: "", enabledPlugin: Plugin},
            description: "",
            filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
            length: 1,
            name: "Chrome PDF Viewer"
          },
          {
            0: {type: "application/x-nacl", suffixes: "", description: "Native Client Executable", enabledPlugin: Plugin},
            1: {type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable", enabledPlugin: Plugin},
            description: "",
            filename: "internal-nacl-plugin",
            length: 2,
            name: "Native Client"
          }
        ]
      });

      // Mock screen properties
      Object.defineProperty(screen, 'availHeight', {
        get: () => window.innerHeight,
      });
      Object.defineProperty(screen, 'availWidth', {
        get: () => window.innerWidth,
      });

      // Mock chrome object
      window.chrome = {
        runtime: {
          onConnect: undefined,
          onMessage: undefined,
          connect: function() { return { onMessage: {}, postMessage: function() {} }; }
        },
        loadTimes: function() {
          return {
            connectionInfo: 'h2',
            finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
            finishLoadTime: Date.now() / 1000 - Math.random(),
            firstPaintAfterLoadTime: Date.now() / 1000 - Math.random(),
            firstPaintTime: Date.now() / 1000 - Math.random(),
            navigationType: 'Other',
            npnNegotiatedProtocol: 'h2',
            requestTime: Date.now() / 1000 - Math.random(),
            startLoadTime: Date.now() / 1000 - Math.random(),
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: true,
            wasNpnNegotiated: true
          };
        },
        csi: function() {
          return {
            startE: Date.now() - Math.random() * 1000,
            onloadT: Date.now() - Math.random() * 1000,
            pageT: Math.random() * 1000,
            tran: Math.floor(Math.random() * 20)
          };
        },
        app: {
          InstallState: {
            DISABLED: 'disabled',
            INSTALLED: 'installed',
            NOT_INSTALLED: 'not_installed'
          },
          getDetails: function() { return { id: 'extension_id_here' }; },
          getIsInstalled: function() { return false; }
        }
      };

      // Mock permission API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: 'granted' }) :
          originalQuery(parameters)
      );

      // Mock battery API
      Object.defineProperty(navigator, 'getBattery', {
        get: () => () => Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1
        })
      });

      // Mock connection
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          type: 'wifi',
          downlink: 10,
          downlinkMax: Infinity,
          rtt: 50,
          saveData: false
        })
      });

      // Mock hardware concurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 4 + Math.floor(Math.random() * 4)
      });

      // Mock device memory
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8
      });

      // Remove automation indicators
      delete navigator.__proto__.webdriver;
      
      // Override toString methods
      navigator.webdriver = undefined;
      navigator.webdriver && (navigator.webdriver.toString = () => 'undefined');

      // Mock WebGL properties for consistent fingerprint
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          return 'Intel(R) Iris(TM) Graphics 6100';
        }
        return getParameter(parameter);
      };

      // Mock Date.getTimezoneOffset for consistency
      const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
      Date.prototype.getTimezoneOffset = function() {
        return 300; // EST timezone
      };

      // Add random mouse movements and clicks to mimic human behavior
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.document) {
          const events = ['mousedown', 'mouseup', 'mousemove', 'click'];
          events.forEach(event => {
            document.addEventListener(event, () => {
              // Just adding listeners to make it look more human
            }, { passive: true });
          });
        }
      }, Math.random() * 1000);
    });

    // Set additional headers
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    });

    // Add random delays to mimic human behavior
    await page.evaluateOnNewDocument(() => {
      const originalSetTimeout = window.setTimeout;
      const originalSetInterval = window.setInterval;
      
      window.setTimeout = function(fn, delay) {
        const randomDelay = delay + Math.random() * 10;
        return originalSetTimeout(fn, randomDelay);
      };
      
      window.setInterval = function(fn, delay) {
        const randomDelay = delay + Math.random() * 10;
        return originalSetInterval(fn, randomDelay);
      };
    });
  }

  async humanLikeInteraction(page) {
    // Random mouse movements
    const viewport = page.viewport();
    const moves = 3 + Math.floor(Math.random() * 3);
    
    for (let i = 0; i < moves; i++) {
      const x = Math.random() * viewport.width;
      const y = Math.random() * viewport.height;
      await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
      await page.waitForTimeout(100 + Math.random() * 200);
    }

    // Random scroll
    if (Math.random() > 0.5) {
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * 300);
      });
      await page.waitForTimeout(500 + Math.random() * 1000);
    }
  }

  async extractYouTubeVideoData(videoId) {
    const { browser, page } = await this.createStealthBrowser();
    
    try {
      console.log('🎭 Starting stealth extraction for:', videoId);
      
      // Navigate to video page with realistic timing
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      await page.goto(videoUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Wait a bit like a human would
      await page.waitForTimeout(2000 + Math.random() * 3000);

      // Human-like interactions
      await this.humanLikeInteraction(page);

      // Handle consent dialogs
      try {
        const consentSelectors = [
          'button[aria-label*="Accept"]',
          'button[aria-label*="I agree"]',
          'button:has-text("Accept all")',
          '[role="button"]:has-text("Accept")',
          '.VfPpkd-LgbsSe:has-text("Accept")'
        ];

        for (const selector of consentSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 3000 });
            await page.click(selector);
            await page.waitForTimeout(2000);
            console.log('✅ Accepted consent dialog');
            break;
          } catch (e) {
            // Continue to next selector
          }
        }
      } catch (consentError) {
        console.log('ℹ️ No consent dialog found');
      }

      // Wait for video player
      await page.waitForSelector('video, .html5-video-player', { timeout: 20000 });
      await page.waitForTimeout(3000);

      // More human-like behavior
      await this.humanLikeInteraction(page);

      // Extract video data with multiple fallback methods
      const videoData = await page.evaluate(() => {
        const extractors = {
          // Method 1: Direct video element
          directVideo: () => {
            const video = document.querySelector('video');
            if (video && video.src && !video.src.includes('blob:')) {
              return [{
                url: video.src,
                quality: 'direct',
                format: 'mp4'
              }];
            }
            return [];
          },

          // Method 2: ytInitialPlayerResponse
          playerResponse: () => {
            const urls = [];
            try {
              const scripts = document.querySelectorAll('script');
              for (let script of scripts) {
                const content = script.textContent || '';
                if (content.includes('ytInitialPlayerResponse')) {
                  const matches = content.match(/ytInitialPlayerResponse["\s]*[:=]["\s]*(\{.+?\});/);
                  if (matches && matches[1]) {
                    const playerData = JSON.parse(matches[1]);
                    const streamingData = playerData.streamingData;
                    
                    if (streamingData) {
                      // Progressive formats (video + audio combined)
                      if (streamingData.formats) {
                        streamingData.formats.forEach(format => {
                          if (format.url && format.mimeType && format.mimeType.includes('mp4')) {
                            urls.push({
                              url: format.url,
                              quality: format.qualityLabel || format.quality || 'unknown',
                              format: 'mp4',
                              filesize: format.contentLength,
                              fps: format.fps,
                              bitrate: format.bitrate
                            });
                          }
                        });
                      }

                      // Adaptive formats (video only, higher quality)
                      if (streamingData.adaptiveFormats) {
                        streamingData.adaptiveFormats.forEach(format => {
                          if (format.url && format.mimeType && 
                              format.mimeType.includes('mp4') && 
                              !format.mimeType.includes('audio')) {
                            urls.push({
                              url: format.url,
                              quality: format.qualityLabel || format.quality || 'unknown',
                              format: 'mp4-video-only',
                              filesize: format.contentLength,
                              fps: format.fps,
                              bitrate: format.bitrate
                            });
                          }
                        });
                      }
                    }
                    break;
                  }
                }
              }
            } catch (e) {
              console.log('Error parsing ytInitialPlayerResponse:', e);
            }
            return urls;
          },

          // Method 3: ytInitialData
          initialData: () => {
            const urls = [];
            try {
              const scripts = document.querySelectorAll('script');
              for (let script of scripts) {
                const content = script.textContent || '';
                if (content.includes('ytInitialData')) {
                  const match = content.match(/ytInitialData["\s]*[:=]["\s]*(\{.+?\});/);
                  if (match && match[1]) {
                    const data = JSON.parse(match[1]);
                    // This might contain additional video info
                    // Implementation depends on YouTube's current structure
                  }
                }
              }
            } catch (e) {
              console.log('Error parsing ytInitialData:', e);
            }
            return urls;
          },

          // Method 4: Network requests monitoring
          networkRequests: () => {
            // This would be implemented with page.on('response') listener
            // For now, returning empty array
            return [];
          }
        };

        // Combine all extraction methods
        let allUrls = [];
        Object.keys(extractors).forEach(method => {
          try {
            const urls = extractors[method]();
            allUrls = allUrls.concat(urls);
          } catch (e) {
            console.log(`Error in ${method}:`, e);
          }
        });

        // Get video metadata
        const title = document.querySelector('h1.title yt-formatted-string')?.textContent ||
                     document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                     document.title;
        
        const duration = document.querySelector('.ytp-time-duration')?.textContent ||
                        document.querySelector('meta[itemprop="duration"]')?.getAttribute('content');

        const channelName = document.querySelector('#upload-info #channel-name a')?.textContent ||
                           document.querySelector('meta[itemprop="author"]')?.getAttribute('content');

        return {
          videoUrls: allUrls,
          title: title,
          duration: duration,
          channel: channelName,
          available: allUrls.length > 0,
          extractionMethods: Object.keys(extractors),
          timestamp: Date.now()
        };
      });

      if (!videoData.available) {
        throw new Error('No video URLs found - video may be private or restricted');
      }

      // Sort URLs by quality preference (lower quality first for faster download)
      const sortedUrls = videoData.videoUrls.sort((a, b) => {
        const qualityOrder = { 
          '144p': 1, '240p': 2, '360p': 3, '480p': 4, '720p': 5, '1080p': 6,
          'small': 2, 'medium': 3, 'large': 4, 'hd720': 5, 'hd1080': 6
        };
        const aOrder = qualityOrder[a.quality] || 999;
        const bOrder = qualityOrder[b.quality] || 999;
        return aOrder - bOrder;
      });

      console.log('✅ Stealth extraction successful:', {
        title: videoData.title,
        urlCount: sortedUrls.length,
        qualities: sortedUrls.map(u => u.quality)
      });

      return {
        ...videoData,
        videoUrls: sortedUrls
      };

    } catch (error) {
      console.error('❌ Stealth extraction failed:', error.message);
      throw error;
    } finally {
      await page.close();
      await browser.close();
    }
  }

  async downloadVideoDirectly(videoUrl, outputPath) {
    const axios = require('axios');
    const fs = require('fs');

    console.log('📥 Starting direct download...');

    try {
      // Create a realistic request
      const response = await axios({
        method: 'GET',
        url: videoUrl,
        responseType: 'stream',
        timeout: 300000, // 5 minutes
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Referer': 'https://www.youtube.com/',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'DNT': '1',
          'Origin': 'https://www.youtube.com',
          'Pragma': 'no-cache',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'Sec-Fetch-Dest': 'video',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site'
        },
        maxRedirects: 5,
        // Add download progress tracking
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            if (percentCompleted % 10 === 0) {
              console.log(`📊 Download progress: ${percentCompleted}%`);
            }
          }
        }
      });

      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log('✅ Direct download completed');
          resolve();
        });
        
        writer.on('error', (error) => {
          console.error('❌ Write error:', error);
          reject(error);
        });
        
        response.data.on('error', (error) => {
          console.error('❌ Download error:', error);
          reject(error);
        });
      });

    } catch (error) {
      console.error('❌ Direct download failed:', error.message);
      throw error;
    }
  }
}

module.exports = AdvancedStealthBrowser;