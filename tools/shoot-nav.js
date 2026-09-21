/* Cascading nav + new service pages verification pass. node tools/shoot-nav.js */
const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch();
  const base = 'http://localhost:8099';

  /* 1. Desktop: each nav group opened by hover. */
  const d = await b.newPage();
  await d.setViewport({ width: 1440, height: 900 });
  await d.goto(base + '/', { waitUntil: 'networkidle0' });
  for (const [i, name] of [[0, 'technology'], [1, 'printing'], [2, 'legal']]) {
    const btn = (await d.$$('nav[aria-label="Primary"] .group > button'))[i];
    await btn.hover();
    await new Promise((r) => setTimeout(r, 450));
    await d.screenshot({ path: `shots/nav-${name}.png`, clip: { x: 0, y: 0, width: 1440, height: 420 } });
  }

  /* 2. Keyboard only: focus must open the same panel (no JS involved). */
  await d.goto(base + '/', { waitUntil: 'networkidle0' });
  await d.evaluate(() => document.querySelector('nav[aria-label="Primary"] .group > button').focus());
  await new Promise((r) => setTimeout(r, 400));
  const kb = await d.evaluate(() => {
    const panel = document.querySelector('nav[aria-label="Primary"] .group > div');
    return getComputedStyle(panel).visibility + ' opacity=' + getComputedStyle(panel).opacity;
  });
  console.log('keyboard-focus panel:', kb);
  await d.screenshot({ path: 'shots/nav-focus.png', clip: { x: 0, y: 0, width: 1440, height: 420 } });

  /* 3. Mobile: tap the burger, then tap a section. */
  const m = await b.newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.goto(base + '/', { waitUntil: 'networkidle0' });
  await m.tap('#mobile-nav summary');
  await new Promise((r) => setTimeout(r, 300));
  await m.screenshot({ path: 'shots/m-nav-closed-groups.png' });
  await m.evaluate(() => {
    const s = document.querySelectorAll('#mobile-nav details summary')[1];
    s.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await m.screenshot({ path: 'shots/m-nav-open-group.png' });

  /* 4. The new pages, desktop full page and mobile, with overflow + error checks. */
  for (const [url, name] of [['/printing/', 'printing'], ['/registrations/', 'registrations'], ['/', 'home']]) {
    for (const [page, tag] of [[d, ''], [m, 'm-']]) {
      const errs = [];
      const onErr = (e) => errs.push('js: ' + e.message);
      const onReq = (r) => errs.push('req: ' + r.url());
      page.on('pageerror', onErr);
      page.on('requestfailed', onReq);
      await page.goto(base + url, { waitUntil: 'networkidle0' });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 800));
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((r) => setTimeout(r, 300));
      await page.screenshot({ path: `shots/${tag}${name}.png`, fullPage: true });
      const info = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        wide: [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 5)
          .map((el) => el.tagName + '.' + (el.className.toString().slice(0, 60) || '')),
      }));
      console.log(
        (tag || 'd-') + name,
        info.scrollW <= info.clientW ? 'no-overflow' : `OVERFLOW ${info.scrollW}>${info.clientW} ${JSON.stringify(info.wide)}`,
        errs.length ? errs : 'clean'
      );
      page.off('pageerror', onErr);
      page.off('requestfailed', onReq);
    }
  }

  await b.close();
})();
