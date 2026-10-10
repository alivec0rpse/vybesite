/*
 * The order book, for signed-in staff.
 *
 *   GET    /api/orders?q=&show=open|closed|all   list, newest activity first
 *   POST   /api/orders                           create; starts at `status` (default: payment confirmed,
 *                                                 or order confirmed for cash on delivery and credit)
 *   GET    /api/orders/{code}                    one order, everything
 *   PATCH  /api/orders/{code}                    edit details (items, mode, partner, payment, notes…)
 *   POST   /api/orders/{code}/status             { status, note } — the update the customer sees
 *   DELETE /api/orders/{code}/status             undo the latest update
 *   DELETE /api/orders/{code}                    admin only
 *
 * Two people can update the same order at once, so every write is a
 * read-modify-write against the entity's ETag and retries on a clash rather
 * than letting the second write silently drop the first one's status update.
 */
const { app } = require('@azure/functions');
const { json, body, route, HttpError } = require('../lib/http');
const store = require('../lib/store');
const auth = require('../lib/auth');
const orders = require('../lib/orders');
const { isFinal, firstStatus } = require('../lib/catalog');

const NOT_FOUND = 'No order with that tracking code.';

async function load(table, req) {
  const code = orders.parseCode(req.params.code);
  const e = code && (await store.get(table, store.ORDER_PK, code));
  if (!e) throw new HttpError(404, NOT_FOUND);
  return e;
}

/** Apply `change` to the latest copy of the order, retrying if it moved underneath us. */
async function mutate(req, change) {
  const { orders: table } = await store.tables();
  for (let attempt = 0; ; attempt++) {
    const e = await load(table, req);
    const next = change(e);
    try {
      await table.updateEntity(next, 'Replace', { etag: e.etag });
      return next;
    } catch (err) {
      if (!store.conflict(err) || attempt >= 4) throw err;
    }
  }
}

async function list(req) {
  await auth.requireStaff(req);
  const q = String(req.query.get('q') || '').trim().toLowerCase();
  const show = req.query.get('show') || 'open';
  const { orders: table } = await store.tables();

  const rows = (await store.list(table, store.ORDER_PK))
    // Delivered but not yet paid (cash on delivery, credit) is still open:
    // the order is not done until the money is in.
    .filter((e) => show === 'all' || (show === 'closed') === (isFinal(e.status) && (e.status === 'cancelled' || orders.isPaid(e))))
    .map(orders.staffView)
    .filter(
      (o) =>
        !q ||
        [o.code, o.code.replace(/-/g, ''), o.customerName, o.customerPhone, o.reference, o.partnerRef]
          .join(' ')
          .toLowerCase()
          .includes(q)
    )
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 500)
    .map(({ events, internalNote, address, ...o }) => o);

  return json(200, { orders: rows });
}

async function create(req, ctx) {
  const user = await auth.requireStaff(req);
  const input = await body(req);
  const fields = orders.details(input);
  const first = orders.status(input.status || firstStatus(fields.payment));
  const now = new Date().toISOString();
  if (fields.paid && fields.payment !== 'prepaid') fields.paidAt = now;
  const { orders: table } = await store.tables();

  // A clash on a random 49-bit code is next to impossible, but createEntity
  // says so rather than overwriting, so it costs nothing to handle.
  for (let attempt = 0; attempt < 5; attempt++) {
    const entity = {
      partitionKey: store.ORDER_PK,
      rowKey: orders.newCode(),
      ...fields,
      status: first,
      events: JSON.stringify([{ status: first, at: now, note: String(input.note || '').slice(0, 1000), by: user.rowKey }]),
      createdAt: now,
      createdBy: user.rowKey,
      updatedAt: now,
    };
    try {
      await table.createEntity(entity);
      ctx.log(`order ${entity.rowKey} created by ${user.rowKey}`);
      return json(201, { order: orders.staffView(entity) });
    } catch (e) {
      if (!store.conflict(e)) throw e;
    }
  }
  throw new HttpError(503, 'Could not allocate a tracking code. Try again.');
}

async function getOne(req) {
  await auth.requireStaff(req);
  const { orders: table } = await store.tables();
  return json(200, { order: orders.staffView(await load(table, req)) });
}

async function edit(req) {
  await auth.requireStaff(req);
  const fields = orders.details(await body(req), { partial: true });
  const saved = await mutate(req, (e) => {
    const now = new Date().toISOString();
    const next = { ...store.strip(e), ...fields, updatedAt: now };
    // Stamp the moment a COD or credit payment was marked received, once;
    // un-marking it (a mistake, a bounced cheque) clears the stamp.
    if (next.paid && !e.paid) next.paidAt = now;
    if (!next.paid) next.paidAt = '';
    return next;
  });
  return json(200, { order: orders.staffView(saved) });
}

async function setStatus(req) {
  const user = await auth.requireStaff(req);
  const input = await body(req);
  const next = orders.status(input.status);
  const note = String(input.note || '').trim().slice(0, 1000);
  const saved = await mutate(req, (e) => {
    const now = new Date().toISOString();
    const evs = orders.events(e);
    evs.push({ status: next, at: now, note, by: user.rowKey });
    if (evs.length > 300) throw new HttpError(400, 'This order has reached its limit of updates.');
    return { ...store.strip(e), status: next, events: JSON.stringify(evs), updatedAt: now };
  });
  return json(200, { order: orders.staffView(saved) });
}

async function undoStatus(req) {
  await auth.requireStaff(req);
  const saved = await mutate(req, (e) => {
    const evs = orders.events(e);
    if (evs.length < 2) throw new HttpError(400, 'The first update cannot be undone. Delete the order instead.');
    evs.pop();
    return { ...store.strip(e), status: evs[evs.length - 1].status, events: JSON.stringify(evs), updatedAt: new Date().toISOString() };
  });
  return json(200, { order: orders.staffView(saved) });
}

async function remove(req, ctx) {
  const user = await auth.requireStaff(req, { admin: true });
  const { orders: table } = await store.tables();
  const e = await load(table, req);
  await table.deleteEntity(store.ORDER_PK, e.rowKey);
  ctx.log(`order ${e.rowKey} deleted by ${user.rowKey}`);
  return json(200, { ok: true });
}

const anon = { authLevel: 'anonymous' };
app.http('orders-list', { ...anon, methods: ['GET'], route: 'orders', handler: route(list) });
app.http('orders-create', { ...anon, methods: ['POST'], route: 'orders', handler: route(create) });
app.http('orders-get', { ...anon, methods: ['GET'], route: 'orders/{code}', handler: route(getOne) });
app.http('orders-edit', { ...anon, methods: ['PATCH'], route: 'orders/{code}', handler: route(edit) });
app.http('orders-delete', { ...anon, methods: ['DELETE'], route: 'orders/{code}', handler: route(remove) });
app.http('orders-status', { ...anon, methods: ['POST'], route: 'orders/{code}/status', handler: route(setStatus) });
app.http('orders-undo', { ...anon, methods: ['DELETE'], route: 'orders/{code}/status', handler: route(undoStatus) });

module.exports = { list, create, getOne, edit, setStatus, undoStatus, remove };
