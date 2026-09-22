/*
 * Ligature check. For every Material Symbols name used anywhere on the site,
 * measures the rendered advance width against a probe styled exactly like the
 * real icons. A name present in the subset collapses to a single ~1em glyph;
 * a missing one lays out as ordinary text and comes back far wider.
 *
 *   node tools/audit-icons.js
 */
const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function htmlFiles(dir = ROOT) {
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'src' || entry === 'dist') continue;
    const p = path.join(dir, entry);
    if (entry.endsWith('.html')) out.push(p);
    else if (fs.statSync(p).isDirectory()) out.push(...htmlFiles(p));
  }
  return out;
}

const used = new Map(); // icon name -> Set of pages
for (const file of htmlFiles()) {
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(rel);
  }
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8099/', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  const names = [...used.keys()].sort();
  const widths = await page.evaluate((list) => {
    const probe = document.createElement('span');
    probe.className = 'material-symbols-outlined';
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:24px;width:auto;display:inline-block;';
    document.body.appendChild(probe);
    const out = {};
    for (const n of list) {
      probe.textContent = n;
      out[n] = Math.round(probe.getBoundingClientRect().width);
    }
    probe.remove();
    return out;
  }, names);

  const missing = names.filter((n) => widths[n] > 34); // one 24px glyph is 24px wide
  console.log(`${names.length} distinct icon names used across the built pages.`);
  if (!missing.length) {
    console.log('All of them render from the subset font.');
  } else {
    console.log(`\nMISSING FROM THE SUBSET (${missing.length}) — these render as literal text:`);
    for (const n of missing) {
      console.log(`  ${n.padEnd(28)} ${String(widths[n]).padStart(4)}px   ${[...used.get(n)].join(', ')}`);
    }
  }
  await browser.close();
})();
