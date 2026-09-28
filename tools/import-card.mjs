/*
 * Import a digital visiting card export into the site.
 *
 * The cards are generated elsewhere and land as zips built for a standalone
 * origin (their own *.pages.dev). Dropping one under vybe.net.in/<slug>/ needs
 * the same handful of edits every time, and doing them by hand across four
 * cards is how they drift apart. This applies the lot, and fails loudly if the
 * upstream template changed shape under an edit rather than silently skipping.
 *
 *   node tools/import-card.mjs <slug> <path-to-zip-or-directory>
 *   node tools/import-card.mjs tejas ~/Downloads/vybe-card-tejas.zip
 *
 * Afterwards: add the slug's routes to staticwebapp.config.json (the script
 * prints them if they are missing), add the person to TEAM in build.js, then
 * `npm run build && npm run validate`.
 *
 * The card is meant to rank for the person's name, so it is left indexable
 * here and build.js finishes the job: it rewrites the export's robots meta,
 * title and description and injects the Person graph. Skipping the build
 * leaves a card that is indexable but anonymous to a crawler. Only qr.html
 * stays noindex — it duplicates the card with none of the content.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const [slug, source] = process.argv.slice(2);

if (!slug || !source) {
  console.error('usage: node tools/import-card.mjs <slug> <path-to-zip-or-directory>');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`slug "${slug}" must be lowercase letters, digits and dashes: it becomes the URL path.`);
  process.exit(1);
}

/** Every edit asserts its anchor, so a changed template fails the import. */
function edit(file, label, fn) {
  const p = path.join(ROOT, slug, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`${slug}/${file}: ${label} changed nothing — has the template moved?`);
  fs.writeFileSync(p, after);
  console.log(`  ${slug}/${file}: ${label}`);
}

function replaceOnce(text, needle, replacement, where) {
  if (!text.includes(needle)) throw new Error(`${where}: could not find ${JSON.stringify(needle.slice(0, 70))}`);
  return text.replace(needle, replacement);
}

/* ------------------------------------------------------------ unpack */

const src = path.resolve(source.replace(/^~/, os.homedir()));
if (!fs.existsSync(src)) throw new Error(`no such source: ${src}`);

let dir = src;
let temp;
if (fs.statSync(src).isFile()) {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), `card-${slug}-`));
  execFileSync('unzip', ['-q', src, '-d', temp]);
  // Some exports wrap everything in a single top-level folder.
  const entries = fs.readdirSync(temp);
  dir = entries.length === 1 && fs.statSync(path.join(temp, entries[0])).isDirectory()
    ? path.join(temp, entries[0])
    : temp;
}
if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error(`${dir}: no index.html — is this a card export?`);

/* The download filename the card ships for its vCard. Read before _headers is
   dropped, because the Azure config has to reproduce it. */
const headersFile = path.join(dir, '_headers');
const vcfName = fs.existsSync(headersFile)
  ? fs.readFileSync(headersFile, 'utf8').match(/filename="([^"]+)"/)?.[1]
  : undefined;

const dest = path.join(ROOT, slug);
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(dir, dest, { recursive: true });
if (temp) fs.rmSync(temp, { recursive: true, force: true });
console.log(`${slug}: unpacked into ${slug}/`);

/* Cloudflare Pages control files. _headers is a format Azure never reads, and
   a robots.txt under a subdirectory governs nothing; both are reproduced by
   staticwebapp.config.json instead. */
for (const f of ['_headers', 'robots.txt']) {
  const p = path.join(dest, f);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    console.log(`  ${slug}/${f}: removed (superseded by staticwebapp.config.json)`);
  }
}

/* ------------------------------------------------------------ index.html */

const DISABLE = '<!-- [html-validate-disable-block prefer-native-element -- a WAI-ARIA radio '
  + 'group: these carry aria-checked and a styled thumb/pill treatment that a '
  + 'native <input type="radio"> cannot take] -->';

edit('index.html', 'doctype uppercased, <base> pinned, canonical and og:url set, lint directives added', (s) => {
  const where = `${slug}/index.html`;

  s = replaceOnce(s, '<!doctype html>', '<!DOCTYPE html>', where);

  /* Azure resolves a real directory to its index document before it consults
     the redirect rules, so the page is served at /<slug> as well as /<slug>/.
     That trailing slash is what relative URLs resolve against, so without a
     base the slashless URL pulls styles.css and app.js from the site root and
     the card arrives as bare HTML. */
  s = replaceOnce(s, '<meta charset="utf-8">',
    '<meta charset="utf-8">\n'
    + `<!-- Azure serves this folder at /${slug} as well as /${slug}/, and that trailing slash\n`
    + '     decides what every relative URL below resolves against. Pin it. -->\n'
    + `<base href="/${slug}/">`, where);

  const og = s.match(/<meta property="og:image" content="https:\/\/[^"]+\/assets\/og\.png">/);
  if (!og) throw new Error(`${where}: og:image not found`);
  s = s.replace(og[0],
    `<meta property="og:url" content="https://vybe.net.in/${slug}/">\n`
    + `<meta property="og:image" content="https://vybe.net.in/${slug}/assets/og.png">`);

  s = replaceOnce(s, '<link rel="manifest" href="manifest.webmanifest">',
    `<link rel="canonical" href="https://vybe.net.in/${slug}/">\n`
    + '<link rel="manifest" href="manifest.webmanifest">', where);

  // Groups populated by JS are empty in the markup and trip nothing.
  const out = [];
  for (const line of s.split('\n')) {
    out.push(line);
    if (line.includes('role="radiogroup"') && !line.trimEnd().endsWith('></div>')) {
      out.push(`${line.match(/^\s*/)[0]}  ${DISABLE}`);
    }
  }
  return out.join('\n');
});

/* ------------------------------------------------------------ qr.html */

edit('qr.html', 'doctype uppercased', (s) =>
  replaceOnce(s, '<!doctype html>', '<!DOCTYPE html>', `${slug}/qr.html`));

/* ------------------------------------------------------------ the card URL */

/* The export hardcodes its own origin and appends "/", which under vybe.net.in
   would put the site root in the QR code and the share link. document.baseURI
   follows the <base> on index.html and the document's own directory on
   qr.html, so both pages agree and neither depends on the trailing slash. */
for (const [file, varName] of [['app.js', 'CARD_URL'], ['qrpage.js', 'URL_']]) {
  edit(file, `${varName} resolved from document.baseURI`, (s) => {
    const re = new RegExp(
      `var ${varName} = \\(/\\^https\\?:\\$/\\.test\\(location\\.protocol\\) \\? location\\.origin : "https://[^"]+"\\) \\+ "/";`);
    const m = s.match(re);
    if (!m) throw new Error(`${slug}/${file}: ${varName} assignment not found`);
    return s.replace(m[0],
      `var ${varName} = /^https?:$/.test(location.protocol) ? new URL("./", document.baseURI).href : "https://vybe.net.in/${slug}/";`);
  });
}

/* ------------------------------------------------------------ service worker */

edit('sw.js', 'cache namespaced to this card, activate sweep scoped to it', (s) => {
  const m = s.match(/^const V = "(vybe-[0-9a-f]+)";/m);
  if (!m) throw new Error(`${slug}/sw.js: cache version not found`);
  const version = m[1].replace(/^vybe-/, '');

  /* Every card shares one origin now, and CacheStorage is per-origin rather
     than per-scope, so an unqualified sweep has each card deleting the others'
     offline copies. */
  s = s.replace(m[0],
    '/* One origin hosts every card, and CacheStorage is shared across the whole\n'
    + ' * origin rather than per scope. The activate sweep below must therefore only\n'
    + " * touch this card's own caches, or each card evicts the others' offline copy. */\n"
    + `const PREFIX = "vybe-${slug}-";\n`
    + `const V = PREFIX + "${version}";`);

  return replaceOnce(s, 'ks.filter((k) => k !== V)',
    'ks.filter((k) => k.startsWith(PREFIX) && k !== V)', `${slug}/sw.js`);
});

/* ------------------------------------------------------------ routes */

const config = fs.readFileSync(path.join(ROOT, 'staticwebapp.config.json'), 'utf8');
if (!config.includes(`"/${slug}/*"`)) {
  console.log(`\n${slug}: staticwebapp.config.json has no routes for this card. Add:\n`);
  console.log(`    { "route": "/${slug}", "redirect": "/${slug}/", "statusCode": 301 },
    {
      "route": "/${slug}/contact.vcf",
      "headers": {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": "inline; filename=${JSON.stringify(vcfName ?? `${slug}.vcf`).replace(/"/g, '\\"')}",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow, noarchive"
      }
    },
    {
      "route": "/${slug}/sw.js",
      "headers": { "Cache-Control": "no-cache", "X-Robots-Tag": "noindex, nofollow, noarchive" }
    },
    {
      "route": "/${slug}/assets/*",
      "headers": { "Cache-Control": "public, max-age=604800" }
    },
    {
      "route": "/${slug}/qr.html",
      "headers": { "Cache-Control": "public, max-age=0, must-revalidate", "X-Robots-Tag": "noindex, nofollow, noarchive" }
    },
    {
      "route": "/${slug}/*",
      "headers": { "Cache-Control": "public, max-age=0, must-revalidate" }
    },`);
} else if (vcfName && !config.includes(vcfName)) {
  console.log(`\n${slug}: the export serves its vCard as ${vcfName}, which staticwebapp.config.json does not mention. Check the Content-Disposition on /${slug}/contact.vcf.`);
}

console.log(`\n${slug}: imported.`);
