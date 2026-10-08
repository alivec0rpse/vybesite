/*
 * Shared by the test files: in-memory stand-ins for Table Storage and the
 * media container, and a way to call a handler the way the Functions host does.
 */
process.env.VYB_SESSION_SECRET ??= 'x'.repeat(64);
process.env.VYB_ADMIN_EMAIL ??= 'Owner@Vybe.net.in';
process.env.VYB_ADMIN_PASSWORD ??= 'bootstrap-password';

const assert = require('node:assert/strict');
const store = require('../src/lib/store');
const { route } = require('../src/lib/http');

function fakeTable() {
  const rows = new Map();
  let n = 0;
  const key = (pk, rk) => `${pk}\u0000${rk}`;
  const err = (statusCode) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
  const out = (e) => structuredClone(e);
  return {
    rows,
    async createTable() {},
    async getEntity(pk, rk) {
      const e = rows.get(key(pk, rk));
      if (!e) throw err(404);
      return out(e);
    },
    async createEntity(e) {
      const k = key(e.partitionKey, e.rowKey);
      if (rows.has(k)) throw err(409);
      rows.set(k, { ...out(e), etag: `W/"${++n}"` });
    },
    async updateEntity(e, mode = 'Merge', opts = {}) {
      const k = key(e.partitionKey, e.rowKey);
      const cur = rows.get(k);
      if (!cur) throw err(404);
      if (opts.etag && opts.etag !== cur.etag) throw err(412);
      const { etag, ...clean } = out(e);
      rows.set(k, { ...(mode === 'Merge' ? cur : {}), ...clean, etag: `W/"${++n}"` });
    },
    async upsertEntity(e, mode = 'Merge') {
      const k = key(e.partitionKey, e.rowKey);
      const { etag, ...clean } = out(e);
      rows.set(k, { ...(mode === 'Merge' ? rows.get(k) || {} : {}), ...clean, etag: `W/"${++n}"` });
    },
    async deleteEntity(pk, rk) {
      if (!rows.delete(key(pk, rk))) throw err(404);
    },
    async *listEntities({ queryOptions: { filter } }) {
      const pk = /PartitionKey eq '([^']+)'/.exec(filter)[1];
      for (const e of rows.values()) if (e.partitionKey === pk) yield out(e);
    },
  };
}

function fakeMedia() {
  const blobs = new Map();
  return {
    blobs,
    getBlockBlobClient(name) {
      return {
        async uploadData(buf, opts) {
          blobs.set(name, { buf: Buffer.from(buf), opts });
        },
        async downloadToBuffer() {
          const b = blobs.get(name);
          if (!b) throw Object.assign(new Error('nf'), { statusCode: 404 });
          return b.buf;
        },
      };
    },
  };
}

function install() {
  const db = Object.fromEntries(['orders', 'users', 'certs', 'posts', 'authors', 'meta'].map((t) => [t, fakeTable()]));
  const media = fakeMedia();
  store.useClients(db, media);
  return { db, media };
}

const ctx = { log() {}, warn() {}, error(e) { throw e; } };

async function call(fn, { cookie, body, params = {}, query = {}, headers: extra = {}, type = 'application/json' } = {}) {
  const headers = new Headers(extra);
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', type);
  const req = {
    headers,
    params,
    query: new URLSearchParams(query),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
  const res = await route(fn)(req, ctx);
  const set = res.headers && res.headers['Set-Cookie'];
  return { status: res.status, body: res.jsonBody, raw: res.body, cookie: set ? set.split(';')[0] : null, headers: res.headers };
}

/** Sign in, clearing a first-sign-in password change on the way. */
async function staff(email, password, next) {
  const authFns = require('../src/functions/auth');
  const r = await call(authFns.login, { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  if (!next) return r.cookie;
  const p = await call(authFns.password, { cookie: r.cookie, body: { current: password, next } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return p.cookie;
}

module.exports = { install, call, staff, fakeTable };
