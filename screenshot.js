const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('file:///C:/Users/이진영/Desktop/플래너 8.29/index.html');
  // Wait for a bit
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  await browser.close();
})();
