/*
 * Mobile render audit. Loads every page at an iPhone-sized viewport and
 * reports console errors, failed requests, horizontal overflow, and any
 * Material Symbols span that is still showing its literal ligature text.
 *
 *   node tools/audit-mobile.js [path ...]
 */
const puppeteer = require('puppeteer');

const BASE = 'http://localhost:8099';
const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '/',
      '/erp/',
      '/cms/',
      '/it-solutions/',
      '/smart-classroom/',
      '/workspace/',
      '/printing/',
      '/registrations/',
      '/audits/',
      '/audits/schools-institutions/',
      '/contact/',
    ];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  for (const p of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );

    const errors = [];
    const failed = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => r.status() >= 400 && failed.push(`${r.url()} HTTP ${r.status()}`));

    await page.goto(BASE + p, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);

    const report = await page.evaluate(() => {
      const doc = document.documentElement;
      // Anything sticking out past the viewport is what makes a page feel janky.
      const overflow = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          const style = getComputedStyle(el);
          if (style.position === 'fixed' || style.visibility === 'hidden' || style.opacity === '0') continue;
          overflow.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 110),
            left: Math.round(r.left),
            right: Math.round(r.right),
          });
        }
      }

      // An icon that failed to render is a span whose box is far wider than a
      // glyph: the browser laid out the ligature name as ordinary text.
      const badIcons = [];
      const icons = [...document.querySelectorAll('.material-symbols-outlined')];
      for (const el of icons) {
        const r = el.getBoundingClientRect();
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (r.width > fs * 1.6) badIcons.push({ name: el.textContent.trim(), w: Math.round(r.width), fs });
      }

      // Tap targets below the 24x24 CSS px floor Lighthouse checks for.
      const smallTaps = [];
      for (const el of document.querySelectorAll('a[href], button')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 24 || r.width < 24) {
          smallTaps.push({ tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }

      return {
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
        iconCount: icons.length,
        fontLoaded: document.fonts.check('24px "Material Symbols Outlined"'),
        overflow: overflow.slice(0, 12),
        overflowTotal: overflow.length,
        badIcons: badIcons.slice(0, 12),
        badIconTotal: badIcons.length,
        smallTaps: smallTaps.slice(0, 8),
        smallTapTotal: smallTaps.length,
      };
    });

    const slug = p.replace(/\//g, '_') || '_root';
    await page.screenshot({ path: `shots/mobile${slug}.png`, fullPage: false });

    console.log(`\n=== ${p} ===`);
    console.log(
      `scrollWidth ${report.scrollW} / clientWidth ${report.clientW}` +
        (report.scrollW > report.clientW ? '  <-- HORIZONTAL SCROLL' : '')
    );
    console.log(`icons ${report.iconCount}, font loaded: ${report.fontLoaded}, broken: ${report.badIconTotal}`);
    if (report.badIcons.length) console.log('  broken icons:', JSON.stringify(report.badIcons));
    if (report.overflowTotal) {
      console.log(`  overflow elements: ${report.overflowTotal}`);
      for (const o of report.overflow) console.log(`   - <${o.tag}> ${o.left}..${o.right} .${o.cls}`);
    }
    if (report.smallTapTotal) {
      console.log(`  small tap targets: ${report.smallTapTotal}`, JSON.stringify(report.smallTaps));
    }
    if (errors.length) console.log('  console errors:', errors.slice(0, 6));
    if (failed.length) console.log('  failed requests:', [...new Set(failed)].slice(0, 8));

    await page.close();
  }

  await browser.close();
})();
