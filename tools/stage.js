/*
 * Assemble dist/: what gets uploaded to Azure, and nothing else. build.js
 * writes into the repo root, so the root is both source tree and site, and an
 * unfiltered upload would carry build.js, src/ and tools/ with it.
 *
 * A deny list, not an allow list: a new page directory deploys automatically,
 * a new build tool goes in tools/ and is excluded by name.
 *
 * Usage: node tools/stage.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname + '/..';
const DIST = path.join(ROOT, 'dist');

/** Never deployed: source, tooling, dependency and VCS metadata. */
const DENY = new Set([
  'dist',
  'node_modules',
  'src',
  'tools',
  'shots',
  '.git',
  '.gitea',
  '.github',
  '.gitignore',
  '.htmlvalidate.json',
  '.lastmod.json',
  'build.js',
  'tailwind.config.js',
  'package.json',
  'package-lock.json',
  'README.md',
]);

/** Files that must exist in dist/ or the deploy is not worth shipping. */
const REQUIRED = [
  'index.html',
  '404.html',
  'staticwebapp.config.json',
  'sitemap.xml',
  'robots.txt',
  'favicon.ico',
  'site.webmanifest',
  'assets/site.css',
  'assets/site.js',
  // Nothing links to these, so a missing one is silent until an answer engine
  // or a security researcher goes looking and finds a 404.
  'llms.txt',
  '.well-known/security.txt',
  // The BIMI mark. Only the DNS record points at it, so a missing file shows
  // up as a mailbox provider quietly dropping the logo from inbox headers.
  'logo.svg',
  // Apple Pay domain verification. Its absence is invisible until it fails.
  '.well-known/apple-developer-merchantid-domain-association',
];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let files = 0;
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (DENY.has(entry.name)) continue;
  const src = path.join(ROOT, entry.name);
  const dest = path.join(DIST, entry.name);
  if (entry.isDirectory()) copyDir(src, dest);
  else fs.copyFileSync(src, dest);
  files++;
}

/* Point the staged pages at Front Door.
 *
 * Only dist/ is rewritten. The repo root keeps root-relative /assets/ URLs so
 * `npm run serve` still runs offline against local files, and a diff of the
 * generated pages stays readable.
 *
 * Assets are still copied into dist/ as well as uploaded to the CDN: the web
 * manifest, favicon and the Apple touch icon are fetched from the site origin
 * and resolve their icons relative to it.
 *
 * Stylesheets are deliberately left alone. site.css reaches its fonts with
 * root-relative URLs, which resolve against the stylesheet's own origin — so
 * once the CSS is served from the CDN, its fonts come from the CDN too.
 *
 * Set ASSET_CDN='' to stage a build that serves everything from the origin.
 */
const CDN = process.env.ASSET_CDN ?? 'https://cdn.vybe.net.in';

function distHtml(dir = DIST) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...distHtml(p));
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

if (CDN) {
  // Only where /assets/ opens an attribute value or a srcset entry, so that an
  // already-absolute https://vybe.net.in/assets/og-image.png is left intact —
  // social scrapers want a URL on the canonical domain.
  const re = /(["'\s,(])\/assets\//g;

  /* Open the TLS connection to the CDN while the parser is still in <head>,
     instead of paying a fresh DNS + TCP + TLS round trip at the moment the
     stylesheet is requested. Two hints, not one: a crossorigin connection is
     pooled separately from a plain one, and the fonts (CORS, because of the
     crossorigin attribute on their preloads) cannot reuse the stylesheet's. */
  const preconnect =
    `<link rel="preconnect" href="${CDN}">\n` +
    `<link rel="preconnect" href="${CDN}" crossorigin>\n`;

  let rewritten = 0;
  for (const file of distHtml()) {
    const before = fs.readFileSync(file, 'utf8');
    let after = before.replace(re, `$1${CDN}/assets/`);
    after = after.replace(/<link rel="preload"/, `${preconnect}$&`);
    if (after !== before) {
      fs.writeFileSync(file, after);
      rewritten++;
    }
  }
  console.log(`stage: pointed ${rewritten} pages at ${CDN}`);
}

// The IndexNow key file must be at the site root or submissions 403. Matched
// by pattern because it is named for the key it holds.
const hasIndexNowKey = fs.readdirSync(DIST).some((f) => /^[a-f0-9]{8,128}\.txt$/i.test(f));
if (!hasIndexNowKey) console.warn('stage: no IndexNow key file in dist/ — submissions will 403');

const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(DIST, f)));
if (missing.length) {
  console.error(`stage: missing from dist/ — ${missing.join(', ')}`);
  console.error('stage: did you run `npm run build` first?');
  process.exit(1);
}

const count = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);

console.log(`staged ${count(DIST)} files into dist/ (${files} top-level entries)`);
