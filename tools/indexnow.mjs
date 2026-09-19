/*
 * Tell the IndexNow engines which pages actually changed. Bing, Yandex,
 * Seznam, Naver and DuckDuckGo all consume the shared api.indexnow.org
 * endpoint. Google does not, so this adds to the sitemap, never replaces it.
 *
 * Submitting every URL on every deploy is treated as spam, and a CSS tweak
 * does not change nine pages. .lastmod.json only moves a date when a page's
 * content hash moves, so this diffs it against the copy in the last commit
 * and submits exactly the pages that changed.
 *
 * The key is public by design: the engines fetch it from the site root to
 * prove the submitter controls the domain, so it is committed, not held in CI.
 *
 * Usage:
 *   node tools/indexnow.mjs              # changed pages only
 *   node tools/indexnow.mjs --all        # every URL in the sitemap
 *   node tools/indexnow.mjs --dry-run    # print the payload, send nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/') + '/..';
const ENDPOINT = 'https://api.indexnow.org/IndexNow';

const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');

const die = (msg) => {
  console.error(`indexnow: ${msg}`);
  process.exit(1);
};

/* ------------------------------------------------------------------ key */

/**
 * The key file is named for the key it contains, as the protocol expects.
 * Found by pattern, so rotating the key is one rename and nothing else.
 */
const keyFiles = fs.readdirSync(ROOT).filter((f) => /^[a-f0-9]{8,128}\.txt$/i.test(f));
if (keyFiles.length !== 1) {
  die(
    keyFiles.length === 0
      ? 'no key file at the repo root. Expected one named <key>.txt, e.g. a 32-char hex string.'
      : `expected exactly one key file at the repo root, found ${keyFiles.length}: ${keyFiles.join(', ')}`
  );
}
const keyFile = keyFiles[0];
const key = fs.readFileSync(path.join(ROOT, keyFile), 'utf8').trim();
if (key !== path.basename(keyFile, '.txt')) {
  die(`${keyFile} does not contain its own name. The engines verify exactly that.`);
}

/* ----------------------------------------------------------- url list */

const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) die('sitemap.xml is missing. Run `npm run build` first.');

const sitemap = fs.readFileSync(sitemapPath, 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!sitemapUrls.length) die('sitemap.xml contains no <loc> entries.');

const origin = new URL(sitemapUrls[0]).origin;
const host = new URL(origin).host;

/**
 * Git is the only record of the previous build. If .lastmod.json is
 * unreachable (shallow clone, fresh repo) there is no diff to take, and the
 * full list is the safe fallback rather than silently submitting nothing.
 */
function previousLastmod() {
  try {
    const raw = execFileSync('git', ['show', 'HEAD:.lastmod.json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

let urls;
let why;

if (all) {
  urls = sitemapUrls;
  why = 'every URL in the sitemap (--all)';
} else {
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, '.lastmod.json'), 'utf8'));
  const previous = previousLastmod();

  if (!previous) {
    urls = sitemapUrls;
    why = 'every URL in the sitemap (no previous .lastmod.json in git)';
  } else {
    const changed = Object.keys(current).filter((u) => current[u].hash !== previous[u]?.hash);
    urls = changed.map((u) => origin + u).filter((u) => sitemapUrls.includes(u));
    why = `${changed.length} page(s) whose content hash moved since the last commit`;
  }
}

if (!urls.length) {
  console.log('indexnow: no pages changed since the last commit, nothing to submit.');
  process.exit(0);
}

/* -------------------------------------------------------------- submit */

const payload = {
  host,
  key,
  keyLocation: `${origin}/${keyFile}`,
  urlList: urls,
};

console.log(`indexnow: submitting ${why}`);
for (const u of urls) console.log('  ', u);

if (dryRun) {
  console.log('\nindexnow: --dry-run, nothing sent. Payload would be:');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});

const body = await res.text();

/**
 * 200 and 202 are both successes. Nothing here fails a deploy: the pages are
 * already live and in the sitemap. This is a hint to the engines, not a gate.
 */
const MEANING = {
  200: 'accepted',
  202: 'accepted, key validation pending',
  400: 'bad request — malformed payload',
  403: 'key not valid for this host — check the key file is deployed and readable',
  422: 'URLs do not belong to the host, or the key does not match the schema',
  429: 'too many requests — back off',
};

const note = MEANING[res.status] || 'unexpected status';
console.log(`indexnow: HTTP ${res.status} (${note})${body ? ` ${body.trim()}` : ''}`);

if (res.status >= 400) {
  console.warn('indexnow: submission rejected. The deploy itself is unaffected.');
}
