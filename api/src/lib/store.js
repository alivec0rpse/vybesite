/*
 * Azure Table Storage, plus one blob container for uploaded files. Every
 * table holds one partition: the data is small enough that a single partition
 * is the simplest thing that works, and a point read by RowKey is the only
 * hot path.
 *
 *   orders   PartitionKey 'order'   RowKey = tracking code body (10 chars, no prefix)
 *   users    PartitionKey 'user'    RowKey = lower-cased email
 *   certs    PartitionKey 'cert'    RowKey = certificate number, letters and digits only
 *   posts    PartitionKey 'post'    RowKey = URL slug
 *   authors  PartitionKey 'author'  RowKey = URL slug
 *   meta     PartitionKey 'meta'    RowKey = flag name (one-time seeds)
 *
 *   blob container 'media': images for posts, certificate PDFs.
 *
 * Arrays are stored as JSON strings: Table Storage has no array type, and a
 * property holds up to 64 KiB.
 */
const { TableClient } = require('@azure/data-tables');

const ORDER_PK = 'order';
const USER_PK = 'user';
const CERT_PK = 'cert';
const POST_PK = 'post';
const AUTHOR_PK = 'author';
const META_PK = 'meta';

const TABLES = ['orders', 'users', 'certs', 'posts', 'authors', 'meta'];
const MEDIA = 'media';

let clients = null;
let ready = null;
let media = null;

function connection() {
  const conn = process.env.VYB_TABLES_CONNECTION;
  if (!conn) throw new Error('VYB_TABLES_CONNECTION is not set');
  return conn;
}

function tables() {
  if (!clients) {
    const conn = connection();
    clients = Object.fromEntries(TABLES.map((t) => [t, TableClient.fromConnectionString(conn, t)]));
  }
  // createTable is a no-op on an existing table; once per cold start is enough.
  if (!ready)
    ready = Promise.all(TABLES.map((t) => clients[t].createTable())).catch((e) => {
      ready = null;
      throw e;
    });
  return ready.then(() => clients);
}

/**
 * The media container. Private: files are read back through /api/media/{name},
 * so the storage account never needs public access switched on.
 */
async function mediaContainer() {
  if (!media) {
    // Required lazily, so the order and auth routes never load the blob SDK.
    const { BlobServiceClient } = require('@azure/storage-blob');
    const c = BlobServiceClient.fromConnectionString(connection()).getContainerClient(MEDIA);
    media = c.createIfNotExists().then(() => c, (e) => {
      media = null;
      throw e;
    });
  }
  return media;
}

/** Tests swap in in-memory fakes with the same methods. */
function useClients(fake, fakeMedia) {
  clients = fake;
  ready = Promise.resolve();
  if (fakeMedia) media = Promise.resolve(fakeMedia);
}

const notFound = (e) => e && (e.statusCode === 404 || e.code === 'ResourceNotFound');
const conflict = (e) => e && (e.statusCode === 409 || e.statusCode === 412);

async function get(table, pk, rk) {
  try {
    return await table.getEntity(pk, rk);
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

async function list(table, pk) {
  const out = [];
  const filter = `PartitionKey eq '${pk}'`;
  for await (const e of table.listEntities({ queryOptions: { filter } })) out.push(e);
  return out;
}

/** Drop the bookkeeping Table Storage adds to every entity it returns. */
const strip = ({ etag, timestamp, 'odata.etag': _, 'odata.metadata': __, ...rest }) => rest;

module.exports = {
  tables,
  mediaContainer,
  useClients,
  get,
  list,
  strip,
  conflict,
  notFound,
  ORDER_PK,
  USER_PK,
  CERT_PK,
  POST_PK,
  AUTHOR_PK,
  META_PK,
};
