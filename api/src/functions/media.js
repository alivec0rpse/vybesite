/*
 * Uploaded files: images for blog posts, PDFs for certificates.
 *
 *   POST /api/media          staff: { name, data: base64 } -> { url }
 *   GET  /api/media/{name}   anyone: the file
 *
 * The type is decided by the file's first bytes, never by the name or by what
 * the browser claims, and only JPEG, PNG, WebP and PDF are accepted. No SVG:
 * an SVG is a document that can carry script, and these are served from the
 * site's own origin.
 *
 * Names are random and a file is never overwritten, so a URL's content never
 * changes and can be cached for a year. Blog images are only fetched from here
 * by the build (tools/fetch-blog.mjs), which re-encodes them and ships them
 * through the CDN like every other asset; certificate PDFs are linked here
 * directly.
 */
const crypto = require('node:crypto');
const { app } = require('@azure/functions');
const { json, body, route, HttpError } = require('../lib/http');
const store = require('../lib/store');
const auth = require('../lib/auth');

const MAX_BYTES = 6 * 1024 * 1024;

const KINDS = [
  { ext: 'jpg', type: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', type: 'image/webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'pdf', type: 'application/pdf', magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];
const TYPE_OF = Object.fromEntries(KINDS.map((k) => [k.ext, k.type]));

const NAME_RE = /^[a-z0-9]{12}-[a-z0-9-]{1,60}\.(jpg|png|webp|pdf)$/;

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file';

async function upload(req, ctx) {
  const user = await auth.requireStaff(req);
  const input = await body(req);
  if (typeof input.data !== 'string' || !input.data) throw new HttpError(400, 'No file received.');
  const bytes = Buffer.from(input.data.replace(/^data:[^,]*,/, ''), 'base64');
  if (bytes.length > MAX_BYTES) throw new HttpError(413, `Files can be ${MAX_BYTES / 1024 / 1024} MB at most. Resize the image or compress the PDF.`);
  const kind = KINDS.find((k) => bytes.length > 12 && k.magic(bytes));
  if (!kind) throw new HttpError(415, 'Only JPEG, PNG, WebP images and PDF files can be uploaded.');

  const rand = crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12);
  const name = `${rand}-${slug(input.name)}.${kind.ext}`;
  const container = await store.mediaContainer();
  await container.getBlockBlobClient(name).uploadData(bytes, {
    blobHTTPHeaders: { blobContentType: kind.type, blobCacheControl: 'public, max-age=31536000, immutable' },
    metadata: { uploadedby: user.rowKey.replace(/[^a-z0-9]/g, '_') },
  });
  ctx.log(`media ${name} (${bytes.length} bytes) uploaded by ${user.rowKey}`);
  return json(201, { name, url: `/api/media/${name}`, type: kind.type, bytes: bytes.length });
}

async function read(req) {
  const name = String(req.params.name || '');
  if (!NAME_RE.test(name)) throw new HttpError(404, 'Not found.');
  const container = await store.mediaContainer();
  let buf;
  try {
    buf = await container.getBlockBlobClient(name).downloadToBuffer();
  } catch (e) {
    if (store.notFound(e) || e.statusCode === 404) throw new HttpError(404, 'Not found.');
    throw e;
  }
  return {
    status: 200,
    body: buf,
    headers: {
      'Content-Type': TYPE_OF[name.split('.').pop()],
      'Cache-Control': 'public, max-age=31536000, immutable',
      // globalHeaders in staticwebapp.config.json do not reach API responses.
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  };
}

app.http('media-upload', { authLevel: 'anonymous', methods: ['POST'], route: 'media', handler: route(upload) });
app.http('media-read', { authLevel: 'anonymous', methods: ['GET'], route: 'media/{name}', handler: route(read) });

module.exports = { upload, read, NAME_RE };
