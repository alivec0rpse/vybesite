/* =========================================================================
 * Assemble dist/ — exactly what gets uploaded to Azure, and nothing else.
 *
 * build.js writes its output into the repo root, which means the root is
 * both the source tree and the site. That is convenient locally and wrong
 * for a deploy: without this step the upload would also carry build.js,
 * src/, tools/ and package.json. staticwebapp.config.json 404s those paths,
 * so it was never a hole, but shipping your own build scripts to a public
 * CDN is not something to rely on a routing rule to hide.
 *
 * The list below is a DENY list rather than an allow list on purpose: a new
 * page directory should be deployed automatically, whereas a new build tool
 * is something you add to tools/ and therefore excluded by name.
 *
 * Usage: node tools/stage.js
 * ========================================================================= */
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
  // Apple Pay domain verification. Listed because its absence is invisible:
  // the site looks perfect and Apple Pay just stops verifying the domain.
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

// The IndexNow key file has to be reachable at the site root or the engines
// reject every submission with a 403. It is named for the key it holds, so it
// is matched by pattern rather than listed above.
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
