/* Mobile menu verification. node tools/shoot4.js */
const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch();
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto('http://localhost:8099/erp/', { waitUntil: 'networkidle0' });
  await p.click('#mobile-nav summary');
  await new Promise((r) => setTimeout(r, 400));
  await p.screenshot({ path: 'shots/m-menu.png' });

  // click-away should close it
  await p.mouse.click(60, 600);
  await new Promise((r) => setTimeout(r, 300));
  console.log('open after click-away:', await p.evaluate(() => document.getElementById('mobile-nav').open));

  await b.close();
})();
