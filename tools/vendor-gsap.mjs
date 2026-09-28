/*
 * GSAP is a dependency of the *site*, not of the build, and the production CSP
 * is `script-src 'self' https://cdn.vybe.net.in` — so it cannot come from a
 * public CDN, and node_modules is not deployed. This copies the two minified
 * UMD builds the site actually uses into assets/vendor/, where stamp-assets.js
 * hashes them like every other asset and the year-long `immutable` cache
 * header applies.
 *
 * Runs first in `npm run build`: before build.js emits the pages that
 * reference these URLs, and long before the stamp that rewrites them.
 *
 * Only gsap.min.js and ScrollTrigger.min.js are vendored. Every other plugin
 * in node_modules/gsap/dist stays there — a file in assets/ is a file the
 * public can download, so shipping the unused ones is dead weight on the
 * origin and noise in the stamp manifest.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/vendor');

const FILES = [
  ['node_modules/gsap/dist/gsap.min.js', 'gsap.min.js'],
  ['node_modules/gsap/dist/ScrollTrigger.min.js', 'scroll-trigger.min.js'],
];

const { version } = JSON.parse(readFileSync(join(ROOT, 'node_modules/gsap/package.json'), 'utf8'));

mkdirSync(OUT, { recursive: true });

for (const [from, to] of FILES) {
  const src = readFileSync(join(ROOT, from), 'utf8');

  // The .map files are deliberately not deployed, so the sourceMappingURL
  // comment is a 404 on every page load for anyone with devtools open.
  // GreenSock's `/*! ... @license ... */` banner is left exactly as it is.
  const out = src.replace(/\n?\/\/# sourceMappingURL=\S*\s*$/, '\n');

  writeFileSync(
    join(OUT, to),
    `/* Vendored from node_modules/gsap@${version} by tools/vendor-gsap.mjs. Do not edit. */\n${out}`
  );
  console.log(`vendored assets/vendor/${to}`);
}
