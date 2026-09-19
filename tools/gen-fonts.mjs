/* =========================================================================
 * Regenerates assets/fonts/material-symbols-subset.woff2.
 *
 * Scans every built page for Material Symbols ligature names and asks Google
 * Fonts for a subset containing only those glyphs, pinned to the single
 * instance the site actually renders (opsz 20, wght 400, FILL 1, GRAD 0).
 * Full variable font: ~200KB. This: ~7KB.
 *
 *   node tools/gen-fonts.mjs
 * ========================================================================= */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function htmlFiles() {
  const out = [];
  for (const entry of readdirSync(ROOT)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'src') continue;
    const p = join(ROOT, entry);
    if (entry.endsWith('.html')) out.push(p);
    else if (statSync(p).isDirectory()) {
      const idx = join(p, 'index.html');
      try {
        statSync(idx);
        out.push(idx);
      } catch {
        /* not a page directory */
      }
    }
  }
  return out;
}

const icons = new Set();
for (const file of htmlFiles()) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) {
    icons.add(m[1]);
  }
}

const names = [...icons].sort();
if (!names.length) throw new Error('no icons found — run `node build.js` first');

const css = await fetch(
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,1,0' +
    `&icon_names=${names.join(',')}&display=block`,
  { headers: { 'User-Agent': UA } }
).then((r) => r.text());

const url = css.match(/https:\/\/fonts\.gstatic\.com[^)]+/)?.[0];
if (!url) throw new Error(`no font URL in Google response:\n${css}`);

const font = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()));
const dest = join(ROOT, 'assets/fonts/material-symbols-subset.woff2');
writeFileSync(dest, font);

console.log(`${names.length} icons -> ${dest} (${font.length} bytes)`);
console.log(names.join(', '));
