/*
 * Certificates, uploads and the blog, end to end over the handlers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.VYB_BUILD_TOKEN = 'b'.repeat(40);

const { install, call, staff } = require('./helpers');
const { db, media } = install();

const userFns = require('../src/functions/users');
const certFns = require('../src/functions/certs');
const mediaFns = require('../src/functions/media');
const blogFns = require('../src/functions/blog');
const md = require('../src/lib/markdown');

let owner;
let writer;

test('sign in an admin and a user', async () => {
  owner = await staff('owner@vybe.net.in', 'bootstrap-password', 'owner-real-password');
  await call(userFns.create, { cookie: owner, body: { email: 'writer@vybe.net.in', role: 'user', password: 'temporary-pass' } });
  writer = await staff('writer@vybe.net.in', 'temporary-pass', 'writer-own-password');
});

/* ---------------------------------------------------------- certificates */

const CERT = {
  number: 'vyb-qms-2026-0418',
  holder: 'Acme Foods Pvt Ltd',
  address: 'Bengaluru',
  scheme: 'Food Safety',
  standard: 'ISO 22000:2018',
  scope: 'Preparation and service of meals in a campus kitchen.',
  issued: '2026-10-01',
  expires: '2029-09-30',
  internalNote: 'Invoice 55',
};

test('the specimen is seeded once and verifies publicly', async () => {
  const r = await call(certFns.verify, { params: { number: 'vyb qms 2026 0417' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.certificate.specimen, true);
  assert.equal(db.certs.rows.size, 1);

  // Deleted by an admin, it stays deleted.
  assert.equal((await call(certFns.remove, { cookie: owner, query: { number: 'VYB-QMS-2026-0417' } })).status, 200);
  assert.equal((await call(certFns.verify, { params: { number: 'VYB-QMS-2026-0417' } })).status, 404);
  assert.equal(db.certs.rows.size, 0);
});

test('staff issue, edit and withdraw certificates; only admins delete', async () => {
  const r = await call(certFns.create, { cookie: writer, body: CERT });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.certificate.number, 'VYB-QMS-2026-0418');
  assert.equal(r.body.certificate.status, 'active');
  assert.equal((await call(certFns.create, { cookie: writer, body: CERT })).status, 409);

  const pub = await call(certFns.verify, { params: { number: 'VYBQMS20260418' } });
  assert.equal(pub.body.certificate.holder, 'Acme Foods Pvt Ltd');
  assert.ok(!JSON.stringify(pub.body).includes('Invoice 55'), 'internal note leaks');
  assert.ok(!JSON.stringify(pub.body).includes('writer@'), 'staff email leaks');

  const q = { number: 'VYB-QMS-2026-0418' };
  assert.equal((await call(certFns.update, { cookie: writer, query: q, body: { status: 'withdrawn' } })).body.certificate.status, 'withdrawn');
  assert.equal((await call(certFns.verify, { params: { number: q.number } })).body.certificate.status, 'withdrawn');
  assert.equal((await call(certFns.update, { cookie: writer, query: q, body: { expires: '2020-01-01' } })).status, 400);
  assert.equal((await call(certFns.remove, { cookie: writer, query: q })).status, 403);
  assert.equal((await call(certFns.list, {})).status, 401);
  assert.equal((await call(certFns.list, { cookie: writer })).body.certificates.length, 1);
});

test('certificate input is validated', async () => {
  const bad = [
    { ...CERT, number: 'x' },
    { ...CERT, number: 'VYB<script>' },
    { ...CERT, number: 'VYB-1', holder: '' },
    { ...CERT, number: 'VYB-2', issued: '01/10/2026' },
    { ...CERT, number: 'VYB-3', expires: '2026-09-01' },
    { ...CERT, number: 'VYB-4', pdf: 'javascript:alert(1)' },
    { ...CERT, number: 'VYB-5', pdf: '//evil.example/x.pdf' },
    { ...CERT, number: 'VYB-6', status: 'revoked' },
  ];
  for (const b of bad) assert.equal((await call(certFns.create, { cookie: writer, body: b })).status, 400, JSON.stringify(b));
});

/* ----------------------------------------------------------------- media */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

test('uploads are typed by content and served back', async () => {
  const r = await call(mediaFns.upload, { cookie: writer, body: { name: 'Cover Photo.PNG', data: PNG.toString('base64') } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.url, /^\/api\/media\/[a-z0-9]{12}-cover-photo\.png$/);

  const name = r.body.name;
  const got = await call(mediaFns.read, { params: { name } });
  assert.equal(got.status, 200);
  assert.equal(got.headers['Content-Type'], 'image/png');
  assert.equal(got.headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(got.raw.equals(PNG));

  // An SVG (or anything else) is refused whatever it is called.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await call(mediaFns.upload, { cookie: writer, body: { name: 'x.png', data: svg.toString('base64') } })).status, 415);
  assert.equal((await call(mediaFns.upload, { body: { name: 'x.png', data: PNG.toString('base64') } })).status, 401);
  assert.equal((await call(mediaFns.read, { params: { name: '../users' } })).status, 404);
  assert.equal(media.blobs.size, 1);
});

/* ------------------------------------------------------------------ blog */

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const POST = {
  slug: 'rfid-cards-for-schools',
  title: 'RFID cards for schools: a buyer’s guide',
  description: 'How to choose RFID ID cards for a school: chip types, printing, lanyards and what a fair price looks like in Bengaluru.',
  tags: 'RFID, Schools, RFID',
  body: `## Why RFID\n\n${words(120)}\n\n## Choosing a chip\n\n${words(60)}\n\n![Card](/api/media/abc123abc123-card.png)`,
};

test('authors are created and required before publishing', async () => {
  const a = await call(blogFns.createAuthor, {
    cookie: writer,
    body: { name: 'Tejas C', jobTitle: 'Founder', bio: 'Builds things.', sameAs: ['https://www.linkedin.com/in/example'], card: '/tejas/' },
  });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.author.slug, 'tejas-c');
  assert.equal((await call(blogFns.createAuthor, { cookie: writer, body: { name: 'X', sameAs: ['http://insecure'] } })).status, 400);
  assert.equal((await call(blogFns.createAuthor, { cookie: writer, body: { name: 'Y', card: 'https://evil/' } })).status, 400);
});

test('drafts save freely; publishing enforces the basics', async () => {
  const r = await call(blogFns.createPost, { cookie: writer, body: POST });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.post.tags, ['RFID', 'Schools']);
  assert.equal(r.body.post.status, 'draft');
  assert.equal((await call(blogFns.createPost, { cookie: writer, body: POST })).status, 409);
  assert.equal((await call(blogFns.createPost, { cookie: writer, body: { ...POST, slug: 'Bad Slug!' } })).status, 400);

  const p = { slug: POST.slug };
  let pub = await call(blogFns.publish, { cookie: writer, params: p, body: {} });
  assert.equal(pub.status, 400);
  assert.match(pub.body.error, /author/);

  await call(blogFns.editPost, { cookie: writer, params: p, body: { author: 'tejas-c', cover: '/api/media/abc123abc123-card.png' } });
  pub = await call(blogFns.publish, { cookie: writer, params: p, body: {} });
  assert.match(pub.body.error, /alt text/);

  await call(blogFns.editPost, { cookie: writer, params: p, body: { coverAlt: 'A white RFID card on a lanyard' } });
  pub = await call(blogFns.publish, { cookie: writer, params: p, body: { publishedAt: '2026-10-01T09:00:00+05:30' } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.post.status, 'published');
  assert.equal(pub.body.post.publishedAt, '2026-10-01T03:30:00.000Z');
  assert.equal(pub.body.post.updatedAt, pub.body.post.publishedAt);

  // A published post cannot be edited back below the bar.
  assert.equal((await call(blogFns.editPost, { cookie: writer, params: p, body: { description: 'short' } })).status, 400);
  // A content change moves dateModified; it stays after the publish date.
  const ed = await call(blogFns.editPost, { cookie: writer, params: p, body: { title: 'RFID cards for schools: the 2026 guide' } });
  assert.ok(ed.body.post.updatedAt > ed.body.post.publishedAt);
});

test('long bodies survive the 32K property limit', async () => {
  const long = `## Long\n\n${'Lorem ipsum dolor sit amet. '.repeat(4000)}`;
  assert.ok(long.length > 100000);
  const r = await call(blogFns.createPost, { cookie: writer, body: { slug: 'long-one', title: 'Long', body: long } });
  assert.equal(r.status, 201);
  for (const [, e] of db.posts.rows) for (const [k, v] of Object.entries(e)) if (typeof v === 'string') assert.ok(v.length <= 32000, `${k} too long`);
  assert.equal((await call(blogFns.getPost, { cookie: writer, params: { slug: 'long-one' } })).body.post.body, long);
});

test('export: build token only, published and due posts only, stable stamp', async () => {
  assert.equal((await call(blogFns.exportForBuild, {})).status, 401);
  assert.equal((await call(blogFns.exportForBuild, { headers: { 'x-build-token': 'wrong' } })).status, 401);
  const r = await call(blogFns.exportForBuild, { headers: { 'x-build-token': process.env.VYB_BUILD_TOKEN } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.posts.map((p) => p.slug), ['rfid-cards-for-schools']);
  assert.deepEqual(r.body.authors.map((a) => a.slug), ['tejas-c']);
  assert.equal(r.body.posts[0].createdBy, undefined);

  const s1 = (await call(blogFns.stamp, {})).body.stamp;
  assert.equal(s1, r.body.stamp);
  // Editing a draft does not move the stamp; publishing it would.
  await call(blogFns.editPost, { cookie: writer, params: { slug: 'long-one' }, body: { title: 'Longer' } });
  assert.equal((await call(blogFns.stamp, {})).body.stamp, s1);

  // A future publish date schedules: not exported until then.
  await call(blogFns.editPost, { cookie: writer, params: { slug: 'long-one' }, body: { author: 'tejas-c', description: POST.description } });
  const later = await call(blogFns.publish, { cookie: writer, params: { slug: 'long-one' }, body: { publishedAt: '2099-01-01T00:00:00Z' } });
  assert.equal(later.status, 200, JSON.stringify(later.body));
  assert.equal((await call(blogFns.stamp, {})).body.stamp, s1);
});

test('authors in use cannot be deleted; only admins delete posts', async () => {
  assert.equal((await call(blogFns.deleteAuthor, { cookie: owner, params: { slug: 'tejas-c' } })).status, 409);
  assert.equal((await call(blogFns.deletePost, { cookie: writer, params: { slug: 'long-one' } })).status, 403);
  assert.equal((await call(blogFns.deletePost, { cookie: owner, params: { slug: 'long-one' } })).status, 200);
  assert.equal((await call(blogFns.unpublish, { cookie: writer, params: { slug: POST.slug } })).body.post.status, 'draft');
  assert.equal((await call(blogFns.exportForBuild, { headers: { 'x-build-token': process.env.VYB_BUILD_TOKEN } })).body.posts.length, 0);
});

test('deploy without a Gitea token says so instead of failing', async () => {
  delete process.env.VYB_GITEA_TOKEN;
  const r = await call(blogFns.deploy, { cookie: writer, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.dispatched, false);
});

test('preview renders exactly what the build will', async () => {
  const r = await call(blogFns.preview, { cookie: writer, body: { body: POST.body } });
  assert.equal(r.body.html, md.render(POST.body).html);
  assert.equal(r.body.headings.length, 2);
  assert.equal((await call(blogFns.preview, { body: { body: 'x' } })).status, 401);
});
