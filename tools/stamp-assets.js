/*
 * Cache-busting stamp. /assets/* is served `max-age=31536000, immutable` but
 * the filenames never change, so a returning visitor would keep last month's
 * site.css and icon font for a year: new icons render as their literal
 * ligature text and new layout rules never arrive. A content hash on each URL
 * gives every changed asset a new cache key, which is what makes `immutable`
 * safe in the first place.
 *
 * Runs last, after Tailwind has written the final assets/site.css:
 *
 *   node build.js && npm run css && node tools/stamp-assets.js
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

// Fonts first: their hashes are baked into site.css, which moves its own hash.
const FONTS = ['assets/fonts/inter-var.woff2', 'assets/fonts/plus-jakarta-sans-var.woff2', 'assets/fonts/material-symbols-subset.woff2'];
const CSS = 'assets/site.css';
const JS = 'assets/site.js';

const hashOf = (rel) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 8);

/** `/assets/x.woff2` or `/assets/x.woff2?v=deadbeef` -> `/assets/x.woff2?v=<new>`. */
function stamp(text, rel, hash) {
  const url = '/' + rel;
  const re = new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?v=[0-9a-f]+)?', 'g');
  return text.replace(re, `${url}?v=${hash}`);
}

function htmlFiles(dir = ROOT) {
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'src' || entry === 'dist' || entry === 'tools' || entry === 'shots') continue;
    const p = path.join(dir, entry);
    if (entry.endsWith('.html')) out.push(p);
    else if (fs.statSync(p).isDirectory()) out.push(...htmlFiles(p));
  }
  return out;
}

/* 1. Stamp the font URLs inside the stylesheet, so the @font-face src and the
      <link rel=preload> end up byte-identical. Otherwise the browser treats
      the preload as a miss and downloads each font twice. */
const fontHashes = Object.fromEntries(FONTS.map((f) => [f, hashOf(f)]));
const cssPath = path.join(ROOT, CSS);
let css = fs.readFileSync(cssPath, 'utf8');
for (const [rel, h] of Object.entries(fontHashes)) css = stamp(css, rel, h);
fs.writeFileSync(cssPath, css);

/* 2. Now that site.css is final, hash every file under assets/. Images too: a
      replaced photo that kept its URL would sit in the edge cache for a year.
      Stamping everything is what lets the deploy skip a CDN purge. */
const assetFiles = (dir) =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? assetFiles(`${dir}/${e.name}`) : [`${dir}/${e.name}`]
  );

const assetHashes = Object.fromEntries(assetFiles('assets').map((rel) => [rel, hashOf(rel)]));

/* 3. Rewrite every reference in the emitted pages. */
let pages = 0;
for (const file of htmlFiles()) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [rel, h] of Object.entries(assetHashes)) after = stamp(after, rel, h);
  if (after !== before) {
    fs.writeFileSync(file, after);
    pages++;
  }
}

console.log(`stamped ${pages} pages against ${Object.keys(assetHashes).length} assets:`);
for (const [rel, h] of Object.entries(assetHashes)) console.log(`  /${rel}?v=${h}`);
