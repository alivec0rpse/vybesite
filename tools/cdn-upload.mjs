/*
 * Upload dist/assets/ to the CDN origin (the `$web` container on vybecdn),
 * skipping every file the container already holds byte for byte.
 *
 * This replaced two `az storage blob upload-batch` calls. Those needed the
 * Azure CLI, which CI installed from scratch on every run, and they re-sent
 * every asset every time. Here the blob listing already carries each blob's
 * Content-MD5, so a deploy that changed one page uploads one stylesheet and
 * nothing else.
 *
 * Asset filenames do not change when their content does (stamp-assets.js puts
 * the hash in the query string), so a blob is compared on its MD5, content
 * type and cache header, not just its name. Nothing is ever deleted: a page
 * still cached somewhere may reference an asset this build dropped.
 *
 *   AZURE_CLIENT_ID=… AZURE_CLIENT_SECRET=… AZURE_TENANT_ID=… node tools/cdn-upload.mjs
 *
 * --dry-run lists what would upload and writes nothing. Without the three
 * variables it signs in as your local `az login`, so it works from a laptop.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { AzureCliCredential, ClientSecretCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'dist/assets');
const ACCOUNT = process.env.CDN_ACCOUNT || 'vybecdn';
const CONTAINER = '$web';
const PREFIX = 'assets/';
const CACHE = 'public, max-age=31536000, immutable';

// Explicit, because a guessed type is how the fonts once landed as
// application/octet-stream.
const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

const DRY = process.argv.includes('--dry-run');
const SP = ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID'];
const missing = SP.filter((v) => !process.env[v]);
if (missing.length && !DRY) {
  console.error(`${missing.join(', ')} not set. Add them under Settings -> Actions -> Secrets in this repository.`);
  process.exit(1);
}

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

const credential = missing.length
  ? new AzureCliCredential()
  : new ClientSecretCredential(process.env.AZURE_TENANT_ID, process.env.AZURE_CLIENT_ID, process.env.AZURE_CLIENT_SECRET);
const container = new BlobServiceClient(`https://${ACCOUNT}.blob.core.windows.net`, credential).getContainerClient(CONTAINER);

const remote = new Map();
for await (const b of container.listBlobsFlat({ prefix: PREFIX })) remote.set(b.name, b.properties);

const todo = [];
for (const file of files(SRC)) {
  const name = PREFIX + relative(SRC, file).split('\\').join('/');
  const body = readFileSync(file);
  const md5 = createHash('md5').update(body).digest();
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const have = remote.get(name);
  const same =
    have &&
    have.contentMD5 &&
    Buffer.from(have.contentMD5).equals(md5) &&
    have.contentType === type &&
    have.cacheControl === CACHE;
  if (!same) todo.push({ name, body, md5, type });
}

if (DRY) {
  for (const t of todo) console.log(`  would upload ${t.name} (${remote.has(t.name) ? 'changed' : 'new'})`);
  console.log(`cdn: ${todo.length} to upload, ${files(SRC).length - todo.length} unchanged (dry run)`);
  process.exit(0);
}

// A handful at a time: plenty for a few dozen small files, gentle on the account.
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < todo.length) {
      const { name, body, md5, type } = todo[next++];
      await container.getBlockBlobClient(name).uploadData(body, {
        blobHTTPHeaders: { blobContentType: type, blobCacheControl: CACHE, blobContentMD5: md5 },
      });
      console.log(`  uploaded ${name}`);
    }
  })
);

console.log(`cdn: ${todo.length} uploaded, ${files(SRC).length - todo.length} unchanged`);
