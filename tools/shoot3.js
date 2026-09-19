/* Mobile + FAQ-icon verification pass. node tools/shoot3.js */
const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch();

  // 1. FAQ accordion at desktop — confirms the "add" icon ligature resolves.
  const d = await b.newPage();
  await d.setViewport({ width: 1440, height: 900 });
  await d.goto('http://localhost:8099/', { waitUntil: 'networkidle0' });
  await d.evaluate(() => {
    document.querySelector('#faq details')?.setAttribute('open', '');
    document.querySelector('#faq')?.scrollIntoView();
  });
  await new Promise((r) => setTimeout(r, 900));
  await d.screenshot({ path: 'shots/faq-icon.png' });

  // 2. Every page at a phone viewport.
  const m = await b.newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const [url, name] of [
    ['/', 'm-home'],
    ['/erp/', 'm-erp'],
    ['/cms/', 'm-cms'],
    ['/it-solutions/', 'm-it'],
    ['/cloud/', 'm-cloud'],
    ['/terms/', 'm-terms'],
    ['/404.html', 'm-404'],
  ]) {
    const errs = [];
    m.on('pageerror', (e) => errs.push('js: ' + e.message));
    m.on('requestfailed', (r) => errs.push('req: ' + r.url()));
    await m.goto('http://localhost:8099' + url, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));
    await m.screenshot({ path: `shots/${name}.png` });
    // Horizontal overflow is the classic mobile-usability failure in GSC.
    const info = await m.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      wide: [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 5)
        .map((el) => el.tagName + '.' + (el.className.toString().slice(0, 60) || '')),
    }));
    console.log(
      name,
      info.scrollW <= info.clientW ? 'no-overflow' : `OVERFLOW ${info.scrollW}>${info.clientW} ${JSON.stringify(info.wide)}`,
      errs.length ? errs : 'clean'
    );
  }

  await b.close();
})();
