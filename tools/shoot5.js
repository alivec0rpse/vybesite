/* Home FAQ, first two answers expanded. node tools/shoot5.js */
const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto('http://localhost:8099/', { waitUntil: 'networkidle0' });
  await p.evaluate(() => {
    document.querySelectorAll('#faq details').forEach((d, i) => i < 2 && d.setAttribute('open', ''));
    document.querySelector('#faq').scrollIntoView();
  });
  await new Promise((r) => setTimeout(r, 800));
  await p.screenshot({ path: 'shots/home-faq.png' });
  await b.close();
  console.log('ok');
})();
