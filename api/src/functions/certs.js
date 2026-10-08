/*
 * The certificate register.
 *
 *   GET    /api/verify/{number}        public lookup behind /verify/
 *   GET    /api/certs                  staff: the whole register
 *   POST   /api/certs                  staff: issue one
 *   PATCH  /api/certs?number=…         staff: edit, withdraw, reinstate
 *   DELETE /api/certs?number=…         admin only
 *
 * Withdrawing is an edit, not a delete: a withdrawn number must keep resolving,
 * as "withdrawn", or a holder could pass off a revoked certificate as one this
 * register has simply never heard of. Delete is for mistakes.
 */
const { app } = require('@azure/functions');
const { json, body, route, HttpError } = require('../lib/http');
const store = require('../lib/store');
const auth = require('../lib/auth');
const certs = require('../lib/certs');

let seeded = null;

/** Write certs.SEED once per storage account, ever. */
function seed(tables) {
  seeded ??= (async () => {
    if (await store.get(tables.meta, store.META_PK, 'certs-seeded')) return;
    const now = new Date().toISOString();
    for (const c of certs.SEED) {
      try {
        await tables.certs.createEntity({ partitionKey: store.CERT_PK, rowKey: certs.key(c.number), ...c, createdAt: now, createdBy: 'seed' });
      } catch (e) {
        if (!store.conflict(e)) throw e;
      }
    }
    await tables.meta.upsertEntity({ partitionKey: store.META_PK, rowKey: 'certs-seeded', at: now }, 'Replace');
  })().catch((e) => {
    seeded = null;
    throw e;
  });
  return seeded;
}

async function register() {
  const t = await store.tables();
  await seed(t);
  return t;
}

async function verify(req) {
  const t = await register();
  const k = certs.key(req.params.number);
  const e = k && (await store.get(t.certs, store.CERT_PK, k));
  // Deliberately not logged: the page promises nobody records who checked what.
  if (!e) throw new HttpError(404, 'No certificate on the register carries that number.');
  return json(200, { certificate: certs.publicView(e) });
}

async function target(req, t) {
  const k = certs.key(req.query.get('number'));
  const e = k && (await store.get(t.certs, store.CERT_PK, k));
  if (!e) throw new HttpError(404, 'No such certificate.');
  return e;
}

async function list(req) {
  await auth.requireStaff(req);
  const t = await register();
  const all = (await store.list(t.certs, store.CERT_PK)).map(certs.staffView);
  all.sort((a, b) => String(b.issued).localeCompare(String(a.issued)) || a.number.localeCompare(b.number));
  return json(200, { certificates: all });
}

async function create(req, ctx) {
  const user = await auth.requireStaff(req);
  const input = await body(req);
  const number = certs.number(input.number);
  const f = certs.fields({ status: 'active', ...input });
  const t = await register();
  const now = new Date().toISOString();
  const e = { partitionKey: store.CERT_PK, rowKey: certs.key(number), number, ...f, createdAt: now, createdBy: user.rowKey, updatedAt: now };
  try {
    await t.certs.createEntity(e);
  } catch (err) {
    if (store.conflict(err)) throw new HttpError(409, `${number} is already on the register.`);
    throw err;
  }
  ctx.log(`certificate ${number} issued by ${user.rowKey}`);
  return json(201, { certificate: certs.staffView(e) });
}

async function update(req, ctx) {
  const user = await auth.requireStaff(req);
  const input = await body(req);
  const t = await register();
  const e = await target(req, t);
  const f = certs.fields(input, { partial: true });
  const next = { ...store.strip(e), ...f, updatedAt: new Date().toISOString(), updatedBy: user.rowKey };
  if (next.expires <= next.issued) throw new HttpError(400, 'The expiry date must be after the issue date.');
  await t.certs.updateEntity(next, 'Replace', { etag: e.etag });
  ctx.log(`certificate ${e.number} updated by ${user.rowKey}: ${Object.keys(f).join(', ')}`);
  return json(200, { certificate: certs.staffView(next) });
}

async function remove(req, ctx) {
  const user = await auth.requireStaff(req, { admin: true });
  const t = await register();
  const e = await target(req, t);
  await t.certs.deleteEntity(store.CERT_PK, e.rowKey);
  ctx.log(`certificate ${e.number} deleted by ${user.rowKey}`);
  return json(200, { ok: true });
}

const anon = { authLevel: 'anonymous' };
app.http('verify', { ...anon, methods: ['GET'], route: 'verify/{number}', handler: route(verify) });
app.http('certs-list', { ...anon, methods: ['GET'], route: 'certs', handler: route(list) });
app.http('certs-create', { ...anon, methods: ['POST'], route: 'certs', handler: route(create) });
app.http('certs-update', { ...anon, methods: ['PATCH'], route: 'certs', handler: route(update) });
app.http('certs-delete', { ...anon, methods: ['DELETE'], route: 'certs', handler: route(remove) });

module.exports = { verify, list, create, update, remove };
