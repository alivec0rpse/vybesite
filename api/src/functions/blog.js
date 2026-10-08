/*
 * The blog, for staff, and the export the build reads.
 *
 *   GET    /api/blog/posts                      list (no bodies)
 *   POST   /api/blog/posts                      new draft { slug, title, … }
 *   GET    /api/blog/posts/{slug}               one post
 *   PATCH  /api/blog/posts/{slug}               edit
 *   POST   /api/blog/posts/{slug}/publish       { publishedAt? } — future dates schedule it
 *   POST   /api/blog/posts/{slug}/unpublish     back to draft
 *   DELETE /api/blog/posts/{slug}               admin only
 *   GET    /api/blog/authors                    POST to add; PATCH/DELETE /api/blog/authors/{slug}
 *   POST   /api/blog/preview                    { body } -> rendered HTML, exactly as published
 *   POST   /api/blog/deploy                     ask Gitea to rebuild the site now
 *   GET    /api/blog/export                     build only, X-Build-Token header
 *   GET    /api/blog/stamp                      public: hash of what is published
 *
 * Saving never touches the live site. A published post reaches /blogs/ when
 * the site is next built: by the scheduled workflow, which rebuilds within
 * minutes once the stamp moves, or at once via /api/blog/deploy when a Gitea
 * token is configured.
 */
const crypto = require('node:crypto');
const { app } = require('@azure/functions');
const { json, body, route, HttpError } = require('../lib/http');
const store = require('../lib/store');
const auth = require('../lib/auth');
const blog = require('../lib/blog');
const md = require('../lib/markdown');

/* ------------------------------------------------------------------ posts */

async function loadPost(t, req) {
  const s = String(req.params.slug || '');
  const e = blog.SLUG_RE.test(s) && (await store.get(t.posts, store.POST_PK, s));
  if (!e) throw new HttpError(404, 'No post with that slug.');
  return e;
}

// What a reader sees. Changing any of these on a published post moves its
// dateModified; fixing an internal field does not.
const CONTENT = ['title', 'seoTitle', 'description', 'tags', 'cover', 'coverAlt', 'author', ...Array.from({ length: 15 }, (_, i) => `body${i}`)];

async function listPosts(req) {
  await auth.requireStaff(req);
  const t = await store.tables();
  const posts = (await store.list(t.posts, store.POST_PK))
    .map(blog.postView)
    .map(({ body, ...p }) => ({ ...p, words: md.render(body).words }))
    .sort((a, b) => String(b.editedAt || b.createdAt).localeCompare(String(a.editedAt || a.createdAt)));
  return json(200, { posts });
}

async function createPost(req, ctx) {
  const user = await auth.requireStaff(req);
  const input = await body(req);
  const slug = blog.slug(input.slug);
  const f = blog.postFields({ body: '', tags: [], ...input });
  const now = new Date().toISOString();
  const e = { partitionKey: store.POST_PK, rowKey: slug, ...f, status: 'draft', publishedAt: '', updatedAt: '', createdAt: now, createdBy: user.rowKey, editedAt: now, editedBy: user.rowKey };
  const t = await store.tables();
  try {
    await t.posts.createEntity(e);
  } catch (err) {
    if (store.conflict(err)) throw new HttpError(409, `A post at /blogs/${slug}/ already exists.`);
    throw err;
  }
  ctx.log(`post ${slug} created by ${user.rowKey}`);
  return json(201, { post: blog.postView(e) });
}

async function getPost(req) {
  await auth.requireStaff(req);
  const t = await store.tables();
  return json(200, { post: blog.postView(await loadPost(t, req)) });
}

async function editPost(req) {
  const user = await auth.requireStaff(req);
  const input = await body(req);
  const t = await store.tables();
  const e = await loadPost(t, req);
  const f = blog.postFields(input, { partial: true });
  const next = { ...store.strip(e), ...f, editedAt: new Date().toISOString(), editedBy: user.rowKey };
  if (next.status === 'published') {
    blog.readyToPublish(blog.postView(next));
    if (CONTENT.some((k) => (next[k] || '') !== (e[k] || ''))) next.updatedAt = next.editedAt;
  }
  try {
    await t.posts.updateEntity(next, 'Replace', { etag: e.etag });
  } catch (err) {
    if (store.conflict(err)) throw new HttpError(409, 'Somebody else saved this post while you were editing. Reload it and make your change again.');
    throw err;
  }
  return json(200, { post: blog.postView(next) });
}

async function publish(req, ctx) {
  const user = await auth.requireStaff(req);
  const input = await body(req);
  const t = await store.tables();
  const e = await loadPost(t, req);
  const post = blog.postView(e);
  blog.readyToPublish(post);
  const now = new Date().toISOString();
  const when = blog.postFields({ publishedAt: input.publishedAt || post.publishedAt || now }, { partial: true }).publishedAt;
  if (e.author && !(await store.get(t.authors, store.AUTHOR_PK, e.author))) throw new HttpError(400, 'That author no longer exists. Choose another.');
  const next = { ...store.strip(e), status: 'published', publishedAt: when, updatedAt: e.updatedAt && e.updatedAt > when ? e.updatedAt : when, editedAt: now, editedBy: user.rowKey };
  await t.posts.updateEntity(next, 'Replace', { etag: e.etag });
  ctx.log(`post ${e.rowKey} published by ${user.rowKey} for ${when}`);
  return json(200, { post: blog.postView(next) });
}

async function unpublish(req, ctx) {
  const user = await auth.requireStaff(req);
  const t = await store.tables();
  const e = await loadPost(t, req);
  const next = { ...store.strip(e), status: 'draft', editedAt: new Date().toISOString(), editedBy: user.rowKey };
  await t.posts.updateEntity(next, 'Replace', { etag: e.etag });
  ctx.log(`post ${e.rowKey} unpublished by ${user.rowKey}`);
  return json(200, { post: blog.postView(next) });
}

async function deletePost(req, ctx) {
  const user = await auth.requireStaff(req, { admin: true });
  const t = await store.tables();
  const e = await loadPost(t, req);
  await t.posts.deleteEntity(store.POST_PK, e.rowKey);
  ctx.log(`post ${e.rowKey} deleted by ${user.rowKey}`);
  return json(200, { ok: true });
}

async function preview(req) {
  await auth.requireStaff(req);
  const input = await body(req);
  const r = md.render(String(input.body || '').slice(0, 450000));
  return json(200, { html: r.html, headings: r.headings, words: r.words });
}

/* ---------------------------------------------------------------- authors */

async function listAuthors(req) {
  await auth.requireStaff(req);
  const t = await store.tables();
  const authors = (await store.list(t.authors, store.AUTHOR_PK)).map(blog.authorView).sort((a, b) => a.name.localeCompare(b.name));
  return json(200, { authors });
}

async function createAuthor(req) {
  await auth.requireStaff(req);
  const input = await body(req);
  const slug = blog.slug(input.slug || md.slugify(input.name || ''), 'Author slug');
  const e = { partitionKey: store.AUTHOR_PK, rowKey: slug, ...blog.authorFields(input) };
  const t = await store.tables();
  try {
    await t.authors.createEntity(e);
  } catch (err) {
    if (store.conflict(err)) throw new HttpError(409, `An author with the slug ${slug} already exists.`);
    throw err;
  }
  return json(201, { author: blog.authorView(e) });
}

async function loadAuthor(t, req) {
  const s = String(req.params.slug || '');
  const e = blog.SLUG_RE.test(s) && (await store.get(t.authors, store.AUTHOR_PK, s));
  if (!e) throw new HttpError(404, 'No such author.');
  return e;
}

async function editAuthor(req) {
  await auth.requireStaff(req);
  const input = await body(req);
  const t = await store.tables();
  const e = await loadAuthor(t, req);
  const next = { ...store.strip(e), ...blog.authorFields(input, { partial: true }) };
  await t.authors.updateEntity(next, 'Replace', { etag: e.etag });
  return json(200, { author: blog.authorView(next) });
}

async function deleteAuthor(req) {
  await auth.requireStaff(req, { admin: true });
  const t = await store.tables();
  const e = await loadAuthor(t, req);
  const using = (await store.list(t.posts, store.POST_PK)).filter((p) => p.author === e.rowKey).map((p) => p.rowKey);
  if (using.length) throw new HttpError(409, `Still the author of: ${using.slice(0, 5).join(', ')}${using.length > 5 ? '…' : ''}. Reassign those posts first.`);
  await t.authors.deleteEntity(store.AUTHOR_PK, e.rowKey);
  return json(200, { ok: true });
}

/* ---------------------------------------------------- build and deploying */

async function current() {
  const t = await store.tables();
  return blog.exportBlog(await store.list(t.posts, store.POST_PK), await store.list(t.authors, store.AUTHOR_PK));
}

function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

async function exportForBuild(req) {
  const want = process.env.VYB_BUILD_TOKEN || '';
  if (want.length < 32 || !sameSecret(req.headers.get('x-build-token') || '', want)) throw new HttpError(401, 'Build token required.');
  return json(200, await current());
}

/** Public, and deliberately says nothing but a hash. */
async function stamp() {
  return json(200, { stamp: (await current()).stamp });
}

/**
 * Trigger the deploy workflow through Gitea's API. Optional: without
 * VYB_GITEA_TOKEN the scheduled run still picks the change up.
 */
async function deploy(req, ctx) {
  const user = await auth.requireStaff(req);
  const token = process.env.VYB_GITEA_TOKEN;
  const repo = process.env.VYB_GITEA_REPO || 'Ankit_Sabu/VYBE_site';
  const base = (process.env.VYB_GITEA_URL || 'https://git.vybe.net.in').replace(/\/+$/, '');
  if (!token) return json(200, { dispatched: false, message: 'Instant rebuilds are not set up, so the site will update on its next scheduled check, within about 15 minutes.' });

  const r = await fetch(`${base}/api/v1/repos/${repo}/actions/workflows/deploy.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!r.ok) {
    ctx.warn(`gitea dispatch failed: ${r.status} ${await r.text().catch(() => '')}`);
    return json(200, { dispatched: false, message: `Gitea refused the rebuild (HTTP ${r.status}). The site will still update on its next scheduled check, within about 15 minutes.` });
  }
  ctx.log(`site rebuild requested by ${user.rowKey}`);
  return json(200, { dispatched: true, message: 'Rebuild started. The site updates in two or three minutes.' });
}

const anon = { authLevel: 'anonymous' };
app.http('blog-posts-list', { ...anon, methods: ['GET'], route: 'blog/posts', handler: route(listPosts) });
app.http('blog-posts-create', { ...anon, methods: ['POST'], route: 'blog/posts', handler: route(createPost) });
app.http('blog-posts-get', { ...anon, methods: ['GET'], route: 'blog/posts/{slug}', handler: route(getPost) });
app.http('blog-posts-edit', { ...anon, methods: ['PATCH'], route: 'blog/posts/{slug}', handler: route(editPost) });
app.http('blog-posts-delete', { ...anon, methods: ['DELETE'], route: 'blog/posts/{slug}', handler: route(deletePost) });
app.http('blog-posts-publish', { ...anon, methods: ['POST'], route: 'blog/posts/{slug}/publish', handler: route(publish) });
app.http('blog-posts-unpublish', { ...anon, methods: ['POST'], route: 'blog/posts/{slug}/unpublish', handler: route(unpublish) });
app.http('blog-authors-list', { ...anon, methods: ['GET'], route: 'blog/authors', handler: route(listAuthors) });
app.http('blog-authors-create', { ...anon, methods: ['POST'], route: 'blog/authors', handler: route(createAuthor) });
app.http('blog-authors-edit', { ...anon, methods: ['PATCH'], route: 'blog/authors/{slug}', handler: route(editAuthor) });
app.http('blog-authors-delete', { ...anon, methods: ['DELETE'], route: 'blog/authors/{slug}', handler: route(deleteAuthor) });
app.http('blog-preview', { ...anon, methods: ['POST'], route: 'blog/preview', handler: route(preview) });
app.http('blog-deploy', { ...anon, methods: ['POST'], route: 'blog/deploy', handler: route(deploy) });
app.http('blog-export', { ...anon, methods: ['GET'], route: 'blog/export', handler: route(exportForBuild) });
app.http('blog-stamp', { ...anon, methods: ['GET'], route: 'blog/stamp', handler: route(stamp) });

module.exports = { listPosts, createPost, getPost, editPost, publish, unpublish, deletePost, preview, listAuthors, createAuthor, editAuthor, deleteAuthor, exportForBuild, stamp, deploy };
