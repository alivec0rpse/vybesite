/*
 * Blog posts and their authors.
 *
 * Posts are written and published at /vyb-admin/, but read by nobody through
 * the API: the deploy pulls every published post (GET /api/blog/export) and
 * build.js turns each into a static page. Static is the point. A post is then
 * as fast, as crawlable and as cacheable as every other page on the site,
 * with its JSON-LD, canonical and sitemap entry written at build time, and no
 * function cold start between Google and the HTML.
 *
 * A slug is fixed when the post is created. It is the post's URL, and a URL
 * that has been shared or indexed must not move.
 *
 * The body is markdown (see markdown.js). It is stored split across body0,
 * body1, …: a Table Storage string property tops out at 32K characters.
 */
const crypto = require('node:crypto');
const { HttpError } = require('./http');
const md = require('./markdown');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHUNK = 30000;
const MAX_CHUNKS = 15;

const text = (v, max, field, required = false) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (${max} characters at most).`);
  return s;
};

function slug(v, field = 'Slug') {
  const s = text(v, 80, field, true).toLowerCase();
  if (!SLUG_RE.test(s)) throw new HttpError(400, `${field} may use lower-case letters, digits and single dashes only, e.g. rfid-cards-for-schools.`);
  return s;
}

/** An image the build can fetch: an upload, or an asset already on the site. */
function image(v, field) {
  const s = text(v, 300, field);
  if (!s) return '';
  if (/^\/api\/media\/[a-z0-9-]+\.(jpg|png|webp)$/.test(s) || /^\/assets\/[\w./-]+\.(jpg|jpeg|png|webp)$/.test(s)) return s;
  throw new HttpError(400, `${field} must be an uploaded image.`);
}

function links(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(/\s+/)).map((s) => String(s).trim()).filter(Boolean);
  if (list.length > 6) throw new HttpError(400, 'At most 6 profile links.');
  for (const u of list) {
    let ok = false;
    try {
      ok = new URL(u).protocol === 'https:';
    } catch {}
    if (!ok || u.length > 300) throw new HttpError(400, `Profile links must be https:// URLs (${u.slice(0, 40)}).`);
  }
  return list;
}

function tags(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(','))
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (list.length > 8) throw new HttpError(400, 'At most 8 tags.');
  for (const t of list) if (t.length > 40) throw new HttpError(400, 'Each tag can be 40 characters at most.');
  return [...new Set(list)];
}

function date(v, field) {
  const s = text(v, 30, field);
  if (!s) return '';
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new HttpError(400, `${field} is not a valid date.`);
  return new Date(t).toISOString();
}

/* ------------------------------------------------------------------ posts */

const splitBody = (body) => {
  const parts = {};
  for (let i = 0; i < MAX_CHUNKS; i++) parts[`body${i}`] = body.slice(i * CHUNK, (i + 1) * CHUNK);
  return parts;
};
const joinBody = (e) => Array.from({ length: MAX_CHUNKS }, (_, i) => e[`body${i}`] || '').join('');

/** Editable fields of a post, validated. `partial` accepts a subset, for edits. */
function postFields(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.hasOwn(input, k);
  if (has('title')) out.title = text(input.title, 120, 'Title', true);
  if (has('seoTitle')) out.seoTitle = text(input.seoTitle, 70, 'Search title');
  if (has('description')) out.description = text(input.description, 200, 'Meta description');
  if (has('author')) out.author = input.author ? slug(input.author, 'Author') : '';
  if (has('tags')) out.tags = JSON.stringify(tags(input.tags));
  if (has('cover')) out.cover = image(input.cover, 'Cover image');
  if (has('coverAlt')) out.coverAlt = text(input.coverAlt, 200, 'Cover alt text');
  if (has('body')) {
    const body = typeof input.body === 'string' ? input.body.replace(/\r\n?/g, '\n') : '';
    if (body.length > CHUNK * MAX_CHUNKS) throw new HttpError(400, 'That post is too long.');
    Object.assign(out, splitBody(body));
  }
  if (has('publishedAt')) out.publishedAt = date(input.publishedAt, 'Publish date');
  return out;
}

/**
 * Everything a post must have before it goes on the public site. Drafts can
 * be saved half-written; publishing is where the SEO basics are enforced.
 */
function readyToPublish(p) {
  const problems = [];
  if (!p.author) problems.push('choose an author');
  if (!p.description || p.description.length < 50) problems.push('write a meta description of at least 50 characters');
  if (p.cover && !p.coverAlt) problems.push('describe the cover image (alt text)');
  if (md.render(p.body).words < 150) problems.push('write at least 150 words');
  if (problems.length) throw new HttpError(400, `Before publishing: ${problems.join('; ')}.`);
}

const postView = (e) => ({
  slug: e.rowKey,
  title: e.title || '',
  seoTitle: e.seoTitle || '',
  description: e.description || '',
  author: e.author || '',
  tags: JSON.parse(e.tags || '[]'),
  cover: e.cover || '',
  coverAlt: e.coverAlt || '',
  body: joinBody(e),
  status: e.status || 'draft',
  publishedAt: e.publishedAt || '',
  updatedAt: e.updatedAt || '',
  createdAt: e.createdAt || '',
  createdBy: e.createdBy || '',
  editedAt: e.editedAt || '',
  editedBy: e.editedBy || '',
});

/* ---------------------------------------------------------------- authors */

function authorFields(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.hasOwn(input, k);
  if (has('name')) out.name = text(input.name, 100, 'Name', true);
  if (has('jobTitle')) out.jobTitle = text(input.jobTitle, 100, 'Job title');
  if (has('bio')) out.bio = text(input.bio, 800, 'Bio');
  if (has('photo')) out.photo = image(input.photo, 'Photo');
  if (has('sameAs')) out.sameAs = JSON.stringify(links(input.sameAs));
  if (has('card')) {
    // The person's visiting card on this site (/tejas/), if they have one.
    const c = text(input.card, 60, 'Visiting card');
    if (c && !/^\/[a-z0-9-]+\/$/.test(c)) throw new HttpError(400, 'Visiting card must be a path like /tejas/.');
    out.card = c;
  }
  return out;
}

const authorView = (e) => ({
  slug: e.rowKey,
  name: e.name,
  jobTitle: e.jobTitle || '',
  bio: e.bio || '',
  photo: e.photo || '',
  sameAs: JSON.parse(e.sameAs || '[]'),
  card: e.card || '',
});

/* ----------------------------------------------------------------- export */

/**
 * The published blog as the build consumes it, plus a stamp: a hash of
 * exactly that content. The build writes the stamp to /blogs/stamp.txt, and
 * the scheduled workflow compares the two to decide whether the live site is
 * behind what staff have published.
 */
function exportBlog(postEntities, authorEntities) {
  const posts = postEntities
    .map(postView)
    .filter((p) => p.status === 'published' && p.publishedAt && Date.parse(p.publishedAt) <= Date.now())
    .map(({ status, createdAt, createdBy, editedAt, editedBy, ...p }) => p)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
  const used = new Set(posts.map((p) => p.author));
  const authors = authorEntities.map(authorView).filter((a) => used.has(a.slug)).sort((a, b) => a.slug.localeCompare(b.slug));
  const stamp = crypto.createHash('sha256').update(JSON.stringify({ posts, authors })).digest('hex').slice(0, 16);
  return { stamp, posts, authors };
}

module.exports = { SLUG_RE, slug, postFields, readyToPublish, postView, joinBody, authorFields, authorView, exportBlog };
