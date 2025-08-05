const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.goto('https://accounts.google.com');
  await page.type('input[type="email"]', process.env.YT_EMAIL);
  await page.click('#identifierNext');
  
  await page.waitForSelector('input[type="password"]', {visible: true});
  await page.type('input[type="password"]', process.env.YT_PASSWORD);
  await page.click('#passwordNext');
  
  await page.waitForNavigation();
  const cookies = await page.cookies();
  
  const cookieTxt = cookies.map(c => 
    `${c.name}=${c.value}; domain=${c.domain}; path=${c.path}`
  ).join('\n');
  
  fs.writeFileSync('cookies.txt', cookieTxt);
  await browser.close();
})();