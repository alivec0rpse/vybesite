/* Related-products section, light page and dark page. node tools/shoot6.js */
const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch();
  for (const [url, name] of [
    ['/erp/', 'related-light'],
    ['/it-solutions/', 'related-dark'],
  ]) {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    await p.goto('http://localhost:8099' + url, { waitUntil: 'networkidle0' });
    await p.evaluate(() => document.querySelector('#more-from-vybe')?.scrollIntoView({ block: 'start' }));
    await new Promise((r) => setTimeout(r, 900));
    await p.screenshot({ path: `shots/${name}.png` });
    await p.close();
  }
  await b.close();
  console.log('ok');
})();
