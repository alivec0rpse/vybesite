/*
 * Assemble dist/: what gets uploaded to Azure, and nothing else. build.js
 * writes into the repo root, so the root is both source tree and site.
 *
 * A deny list, not an allow list: a new page directory deploys automatically.
 *
 *   node tools/stage.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname + '/..';
const DIST = path.join(ROOT, 'dist');

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

/** Missing any of these fails the stage. */
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
  // Nothing on the site links to these four, so a missing one is silent: the
  // BIMI mark is reached from DNS, the rest only by crawlers and Apple.
  'llms.txt',
  '.well-known/security.txt',
  'logo.svg',
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

/* Point the staged pages at Front Door. Only dist/ is rewritten, so
 * `npm run serve` still runs offline against the repo root.
 *
 * Assets go to dist/ as well as the CDN: the manifest, favicon and Apple touch
 * icon are fetched from the site origin and resolve relative to it.
 *
 * site.css is left alone. Its font URLs are root-relative, so they resolve
 * against the stylesheet's own origin and follow it to the CDN.
 *
 * ASSET_CDN='' stages a build that serves everything from the origin.
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
  // Only where /assets/ opens an attribute or srcset entry, leaving an
  // already-absolute https://vybe.net.in/assets/og-image.png alone.
  const re = /(["'\s,(])\/assets\//g;

  /* Two hints, not one: a crossorigin connection is pooled separately from a
     plain one, so the CORS font preloads cannot reuse the stylesheet's. */
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

// Named for the key it holds, so matched by pattern.
const hasIndexNowKey = fs.readdirSync(DIST).some((f) => /^[a-f0-9]{8,128}\.txt$/i.test(f));
if (!hasIndexNowKey) console.warn('stage: no IndexNow key file in dist/, submissions will 403');

const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(DIST, f)));
if (missing.length) {
  console.error(`stage: missing from dist/: ${missing.join(', ')}`);
  console.error('stage: did you run `npm run build` first?');
  process.exit(1);
}

const count = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);

console.log(`staged ${count(DIST)} files into dist/ (${files} top-level entries)`);
