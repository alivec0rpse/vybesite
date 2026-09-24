/*
 * Regenerates assets/fonts/material-symbols-subset.woff2. Scans the built
 * pages for ligature names and fetches only those glyphs, pinned to the one
 * instance the site renders (opsz 20, wght 400, FILL 1, GRAD 0). ~200KB full,
 * ~7KB subset.
 *
 *   node tools/gen-fonts.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* Page directories nest (e.g. /printing/large-format/), so this walks down
   rather than reading one level and stopping. */
function htmlFiles(dir = ROOT) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'src') continue;
    const p = join(dir, entry);
    if (entry.endsWith('.html')) out.push(p);
    else if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
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

/* assets/verify.js builds the certificate result card by concatenation, so its
   ligature names never sit next to the class name in any file the walk above
   reads. build.js writes them into a `material-symbols-outlined:` line in that
   file's header for exactly this reason; drop it and those glyphs get subset
   out and render as their literal names. */
for (const m of readFileSync(join(ROOT, 'assets/verify.js'), 'utf8').matchAll(/material-symbols-outlined:\s*([a-z0-9_,\s]+)/g)) {
  for (const n of m[1].split(/[,\s]+/).filter(Boolean)) icons.add(n);
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
