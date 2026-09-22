/*
 * SEO audit across every emitted page. Static checks on the HTML plus a
 * sitemap/link reachability pass. Reports only, changes nothing.
 *
 *   node tools/audit-seo.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://vybe.net.in';

function htmlFiles(dir = ROOT) {
  const out = [];
  for (const e of fs.readdirSync(dir)) {
    if (e.startsWith('.') || ['node_modules', 'src', 'dist', 'tools', 'shots'].includes(e)) continue;
    const p = path.join(dir, e);
    if (e.endsWith('.html')) out.push(p);
    else if (fs.statSync(p).isDirectory()) out.push(...htmlFiles(p));
  }
  return out;
}

const issues = [];
const add = (sev, page, msg) => issues.push({ sev, page, msg });

const one = (re, s) => (re.exec(s) || [])[1];
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);

const files = htmlFiles().sort();
const pages = [];

for (const file of files) {
  const rel = '/' + path.relative(ROOT, file).replace(/\\/g, '/').replace(/index\.html$/, '').replace(/^\/+/, '');
  const url = rel === '/404.html' ? '/404.html' : '/' + rel.replace(/^\//, '');
  const html = fs.readFileSync(file, 'utf8');

  const p = {
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    url,
    title: one(/<title>([\s\S]*?)<\/title>/, html),
    desc: one(/<meta name="description" content="([^"]*)"/, html),
    canonical: one(/<link rel="canonical" href="([^"]*)"/, html),
    robots: one(/<meta name="robots" content="([^"]*)"/, html),
    h1s: all(/<h1[^>]*>([\s\S]*?)<\/h1>/g, html).map((h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()),
    ogTitle: one(/<meta property="og:title" content="([^"]*)"/, html),
    ogImage: one(/<meta property="og:image" content="([^"]*)"/, html),
    html,
  };
  pages.push(p);

  const L = (s) => (s || '').replace(/&amp;/g, '&').length;

  if (!p.title) add('ERROR', p.url, 'no <title>');
  else if (L(p.title) > 60) add('WARN', p.url, `title ${L(p.title)} chars (>60, Google truncates): "${p.title}"`);
  else if (L(p.title) < 25) add('WARN', p.url, `title only ${L(p.title)} chars: "${p.title}"`);

  if (!p.desc) add('ERROR', p.url, 'no meta description');
  else if (L(p.desc) > 160) add('WARN', p.url, `description ${L(p.desc)} chars (>160, truncated)`);
  else if (L(p.desc) < 70) add('WARN', p.url, `description only ${L(p.desc)} chars`);

  if (!p.canonical && !/noindex/.test(p.robots || '')) add('ERROR', p.url, 'no canonical');

  if (p.h1s.length === 0) add('ERROR', p.url, 'no <h1>');
  else if (p.h1s.length > 1) add('WARN', p.url, `${p.h1s.length} <h1> elements: ${JSON.stringify(p.h1s)}`);

  // Images: alt text and intrinsic dimensions (CLS).
  for (const tag of html.match(/<img\b[^>]*>/g) || []) {
    if (!/\balt=/.test(tag)) add('ERROR', p.url, `<img> without alt: ${tag.slice(0, 100)}`);
    if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag))
      add('WARN', p.url, `<img> without width/height (causes layout shift): ${tag.slice(0, 100)}`);
  }

  // Heading order: a jump from h2 straight to h4 breaks the outline.
  const levels = all(/<h([1-6])\b/g, html).map(Number);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      add('WARN', p.url, `heading jumps h${levels[i - 1]} -> h${levels[i]}`);
      break;
    }
  }

  // JSON-LD must parse.
  for (const block of all(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, html)) {
    try {
      JSON.parse(block.replace(/\\u003c/g, '<'));
    } catch (e) {
      add('ERROR', p.url, `invalid JSON-LD: ${e.message}`);
    }
  }
}

/* ---------------------------------------------------------- cross-page */

const byKey = (key) => {
  const m = new Map();
  for (const p of pages) {
    if (/noindex/.test(p.robots || '')) continue;
    const v = (p[key] || '').trim();
    if (!v) continue;
    if (!m.has(v)) m.set(v, []);
    m.get(v).push(p.url);
  }
  return m;
};
for (const [t, urls] of byKey('title')) if (urls.length > 1) add('ERROR', urls.join(', '), `duplicate title: "${t}"`);
for (const [d, urls] of byKey('desc')) if (urls.length > 1) add('ERROR', urls.join(', '), `duplicate description: "${d.slice(0, 70)}..."`);
for (const [c, urls] of byKey('canonical')) if (urls.length > 1) add('ERROR', urls.join(', '), `duplicate canonical: ${c}`);

// Canonical must point at the page's own URL.
for (const p of pages) {
  if (!p.canonical) continue;
  const expect = SITE + (p.url === '/404.html' ? '/404.html' : p.url);
  if (p.canonical !== expect) add('ERROR', p.url, `canonical is ${p.canonical}, expected ${expect}`);
}

/* ------------------------------------------------------------- sitemap */

const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const smUrls = new Set(all(/<loc>([^<]+)<\/loc>/g, sitemap).map((u) => u.replace(SITE, '')));
const indexable = pages.filter((p) => !/noindex/.test(p.robots || '') && p.url !== '/404.html');

for (const p of indexable) if (!smUrls.has(p.url)) add('ERROR', p.url, 'indexable page missing from sitemap.xml');
for (const u of smUrls) if (!indexable.some((p) => p.url === u)) add('ERROR', u, 'sitemap URL has no corresponding page');

/* -------------------------------------------------------- internal links */

const linked = new Set();
const targets = new Set(indexable.map((p) => p.url));
for (const p of pages) {
  for (const href of all(/<a\b[^>]*href="([^"]*)"/g, p.html)) {
    if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    linked.add(clean);
    if (!targets.has(clean) && !fs.existsSync(path.join(ROOT, clean))) {
      add('ERROR', p.url, `internal link 404s: ${href}`);
    }
  }
}
for (const p of indexable) {
  if (p.url !== '/' && !linked.has(p.url)) add('WARN', p.url, 'orphan: no internal link points here');
}

/* ------------------------------------------------------------- site files */

const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
if (!/Sitemap:/i.test(robots)) add('ERROR', 'robots.txt', 'no Sitemap: directive');

/* --------------------------------------------------------------- report */

const order = { ERROR: 0, WARN: 1 };
issues.sort((a, b) => order[a.sev] - order[b.sev] || a.page.localeCompare(b.page));
const errors = issues.filter((i) => i.sev === 'ERROR');
console.log(`${pages.length} pages, ${indexable.length} indexable.`);
console.log(`${errors.length} errors, ${issues.length - errors.length} warnings.\n`);
for (const i of issues) console.log(`[${i.sev}] ${i.page}\n        ${i.msg}`);
