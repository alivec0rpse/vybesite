/*
 * Azure Table Storage. Two tables, one partition each: the order book and the
 * staff list are both small enough that a single partition is the simplest
 * thing that works, and a point read by RowKey is the only hot path.
 *
 *   orders  PartitionKey 'order'  RowKey = tracking code body (10 chars, no prefix)
 *   users   PartitionKey 'user'   RowKey = lower-cased email
 *
 * Arrays (items, events) are stored as JSON strings: Table Storage has no
 * array type, and a property holds up to 64 KiB, which is a few hundred
 * status updates.
 */
const { TableClient } = require('@azure/data-tables');

const ORDER_PK = 'order';
const USER_PK = 'user';

let clients = null;
let ready = null;

function connection() {
  const conn = process.env.VYB_TABLES_CONNECTION;
  if (!conn) throw new Error('VYB_TABLES_CONNECTION is not set');
  return conn;
}

function tables() {
  if (!clients) {
    const conn = connection();
    clients = {
      orders: TableClient.fromConnectionString(conn, 'orders'),
      users: TableClient.fromConnectionString(conn, 'users'),
    };
  }
  // createTable is a no-op on an existing table; once per cold start is enough.
  if (!ready) ready = Promise.all([clients.orders.createTable(), clients.users.createTable()]).catch((e) => {
    ready = null;
    throw e;
  });
  return ready.then(() => clients);
}

/** Tests swap in an in-memory fake with the same four methods. */
function useClients(fake) {
  clients = fake;
  ready = Promise.resolve();
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

module.exports = { tables, useClients, get, list, conflict, ORDER_PK, USER_PK };
