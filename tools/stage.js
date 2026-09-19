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
