/*
 * Cache-busting stamp. staticwebapp.config.json serves /assets/* with
 * `max-age=31536000, immutable`, but the filenames never change — so a phone
 * that visited last month keeps last month's site.css and icon font for a
 * year. New icons then render as their literal ligature text ("school",
 * "receipt_long") and new layout rules never arrive. Appending a content hash
 * to each URL gives every changed asset a new cache key, which is what makes
 * `immutable` safe in the first place.
 *
 * Runs last, after Tailwind has written the final assets/site.css:
 *
 *   node build.js && npm run css && node tools/stamp-assets.js
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

/* Assets whose URLs get stamped. Fonts are listed first because their hashes
   are baked into site.css, which then changes site.css's own hash. */
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
      <link rel=preload> in the HTML end up byte-identical — otherwise the
      browser treats the preload as a miss and downloads each font twice. */
const fontHashes = Object.fromEntries(FONTS.map((f) => [f, hashOf(f)]));
const cssPath = path.join(ROOT, CSS);
let css = fs.readFileSync(cssPath, 'utf8');
for (const [rel, h] of Object.entries(fontHashes)) css = stamp(css, rel, h);
fs.writeFileSync(cssPath, css);

/* 2. Now that site.css is final, hash it and site.js. */
const assetHashes = { ...fontHashes, [CSS]: hashOf(CSS), [JS]: hashOf(JS) };

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

console.log(`stamped ${pages} pages:`);
for (const [rel, h] of Object.entries(assetHashes)) console.log(`  /${rel}?v=${h}`);
