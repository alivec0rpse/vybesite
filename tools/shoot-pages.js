/* New service pages: layout, overflow and console health. node tools/shoot-pages.js */
const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch({ protocolTimeout: 180000 });
  const base = 'http://localhost:8099';

  for (const [w, h, tag, mobile] of [[1440, 900, 'd', false], [390, 844, 'm', true]]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
    for (const [url, name] of [['/printing/', 'printing'], ['/registrations/', 'registrations'], ['/', 'home']]) {
      const errs = [];
      p.on('pageerror', (e) => errs.push('js: ' + e.message));
      p.on('requestfailed', (r) => errs.push('req: ' + r.url()));
      await p.goto(base + url, { waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 700));
      await p.screenshot({ path: `shots/${tag}-${name}-top.png` });
      const info = await p.evaluate(() => {
        const target = document.getElementById('quote') || document.getElementById('beyond-software') || document.querySelector('ul');
        if (target) target.scrollIntoView();
        return {
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          wide: [...document.querySelectorAll('body *')]
            .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 4)
            .map((el) => el.tagName + '.' + (el.className.toString().slice(0, 50) || '')),
        };
      });
      await new Promise((r) => setTimeout(r, 700));
      await p.screenshot({ path: `shots/${tag}-${name}-mid.png` });
      console.log(
        `${tag}-${name}`,
        info.scrollW <= info.clientW ? 'no-overflow' : `OVERFLOW ${info.scrollW}>${info.clientW} ${JSON.stringify(info.wide)}`,
        errs.length ? errs : 'clean'
      );
      p.removeAllListeners('pageerror');
      p.removeAllListeners('requestfailed');
    }
    await p.close();
  }

  await b.close();
})();
