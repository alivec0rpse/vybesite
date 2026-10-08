/*
 * Pull the published blog from the live API into the build.
 *
 *   VYB_BUILD_TOKEN=… node tools/fetch-blog.mjs
 *
 * Writes:
 *   src/blog-data/blog.json      posts, authors, the stamp, and an image map
 *   src/blog-data/changed.json   post URLs new or updated since the live site
 *                                was built, for tools/indexnow.mjs
 *   assets/blog/*                every image a post or author uses, re-encoded
 *
 * Images are uploaded at whatever size a phone camera produced. Here each one
 * becomes a WebP for the page and a JPEG for og:image (social cards do not all
 * read WebP), at most 1600px wide, with its real dimensions recorded so the
 * page can reserve the space and not shift on load. Upload names never change
 * content, so an image already in assets/blog/ is not fetched again.
 *
 * Without a token (a laptop build), the last fetched blog.json is reused, or
 * the blog builds empty. In CI a missing token is an error: an empty blog
 * deployed over a real one would delete every post from the site.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.VYB_SITE || 'https://vybe.net.in').replace(/\/+$/, '');
const DATA = join(ROOT, 'src/blog-data');
const OUT = join(ROOT, 'assets/blog');
const TOKEN = process.env.VYB_BUILD_TOKEN || '';
const CI = !!process.env.CI;
const MAX_W = 1600;

mkdirSync(DATA, { recursive: true });
mkdirSync(OUT, { recursive: true });

const EMPTY = { stamp: 'empty', posts: [], authors: [], images: {} };
const save = (name, v) => writeFileSync(join(DATA, name), JSON.stringify(v, null, 2) + '\n');

/** The live site's record of what it was last built with, or null. */
async function liveManifest() {
  try {
    const r = await fetch(`${SITE}/blogs/stamp.json`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

if (!TOKEN) {
  if (CI) {
    console.error('fetch-blog: VYB_BUILD_TOKEN is not set. Add it under Settings -> Actions -> Secrets.');
    process.exit(1);
  }
  if (!existsSync(join(DATA, 'blog.json'))) save('blog.json', EMPTY);
  save('changed.json', []);
  console.warn('fetch-blog: no VYB_BUILD_TOKEN, building with the last fetched blog (or none).');
  process.exit(0);
}

const live = await liveManifest();
const res = await fetch(`${SITE}/api/blog/export`, { headers: { 'X-Build-Token': TOKEN, Accept: 'application/json' }, cache: 'no-store' });

let data;
if (res.status === 404 && !live) {
  // The export route is not live yet and the blog has never shipped: this is
  // the first deploy of the blog itself, so there is nothing to lose.
  console.warn('fetch-blog: /api/blog/export not deployed yet; building an empty blog this once.');
  data = { ...EMPTY };
} else if (!res.ok) {
  console.error(`fetch-blog: export failed with HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  console.error('fetch-blog: refusing to build, so a broken fetch cannot unpublish the live blog.');
  process.exit(1);
} else {
  data = await res.json();
}

/* ---------------------------------------------------------------- images */

const refs = new Set();
for (const p of data.posts) {
  if (p.cover) refs.add(p.cover);
  for (const m of p.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) refs.add(m[1]);
}
for (const a of data.authors) if (a.photo) refs.add(a.photo);

const images = {};
for (const src of refs) {
  try {
    if (src.startsWith('/assets/')) {
      // Already on the site: use it as it is, just measure it.
      const meta = await sharp(join(ROOT, src)).metadata();
      images[src] = { webp: src, jpg: src, width: meta.width, height: meta.height };
      continue;
    }
    if (!/^\/api\/media\/[a-z0-9-]+\.(jpg|png|webp)$/.test(src)) continue;
    const stem = basename(src).replace(/\.[a-z]+$/, '');
    const webp = join(OUT, `${stem}.webp`);
    const jpg = join(OUT, `${stem}.jpg`);
    if (!existsSync(webp) || !existsSync(jpg)) {
      const r = await fetch(SITE + src);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const img = sharp(Buffer.from(await r.arrayBuffer()), { failOn: 'error' }).rotate().resize({ width: MAX_W, withoutEnlargement: true });
      await img.clone().webp({ quality: 80 }).toFile(webp);
      await img.clone().flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toFile(jpg);
    }
    const meta = await sharp(webp).metadata();
    images[src] = { webp: `/assets/blog/${stem}.webp`, jpg: `/assets/blog/${stem}.jpg`, width: meta.width, height: meta.height };
  } catch (e) {
    // One broken image must not take the whole blog down; the page renders
    // without it and the log says which.
    console.warn(`fetch-blog: skipped image ${src}: ${e.message}`);
  }
}

save('blog.json', { ...data, images });

/* -------------------------------------------------------------- changes */

const before = (live && live.pages) || {};
const changed = data.posts.map((p) => [`/blogs/${p.slug}/`, p.updatedAt || p.publishedAt]).filter(([u, at]) => before[u] !== at).map(([u]) => u);
if (changed.length) changed.push('/blogs/');
save('changed.json', changed);

console.log(`fetch-blog: ${data.posts.length} post(s), ${data.authors.length} author(s), ${Object.keys(images).length} image(s); ${changed.length} changed URL(s); stamp ${data.stamp}`);
