/*
 * End-to-end over the handlers with Table Storage swapped for an in-memory
 * fake. No Functions host, no Azurite: `npm test` in api/ runs anywhere.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.VYB_SESSION_SECRET = 'x'.repeat(64);
process.env.VYB_ADMIN_EMAIL = 'Owner@Vybe.net.in';
process.env.VYB_ADMIN_PASSWORD = 'bootstrap-password';

const store = require('../src/lib/store');
const orders = require('../src/lib/orders');

/* ------------------------------------------------------------- the fake */

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
    async deleteEntity(pk, rk) {
      if (!rows.delete(key(pk, rk))) throw err(404);
    },
    async *listEntities({ queryOptions: { filter } }) {
      const pk = /PartitionKey eq '([^']+)'/.exec(filter)[1];
      for (const e of rows.values()) if (e.partitionKey === pk) yield out(e);
    },
  };
}

const db = { orders: fakeTable(), users: fakeTable() };
store.useClients(db);

const authFns = require('../src/functions/auth');
const orderFns = require('../src/functions/orders');
const userFns = require('../src/functions/users');
const { track } = require('../src/functions/track');
const { route } = require('../src/lib/http');

/* ------------------------------------------------------------ requests */

const ctx = { log() {}, error(e) { throw e; } };

/** Call a handler the way the Functions host would, through route(). */
async function call(fn, { cookie, body, params = {}, query = {}, type = 'application/json' } = {}) {
  const headers = new Headers();
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
  return { status: res.status, body: res.jsonBody, cookie: set ? set.split(';')[0] : null, headers: res.headers };
}

async function signIn(email, password) {
  const r = await call(authFns.login, { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.cookie;
}

const ORDER = {
  customerName: 'Ramesh Kumar',
  customerPhone: '+91 98450 00000',
  customerEmail: 'ramesh@example.com',
  address: '12, 5th Cross, Jayanagar',
  reference: 'INV-2026-114',
  items: [
    { name: 'RFID cards', qty: 500 },
    { name: 'Lanyards', qty: 500 },
  ],
  deliveryMode: 'courier',
  partner: 'DTDC',
  partnerRef: 'D12345678',
  partnerUrl: 'https://www.dtdc.in/tracking',
  internalNote: 'Paid by UPI',
};

/* --------------------------------------------------------------- tests */

let owner;
let staff;
let code;

test('tracking codes normalise and reject junk', () => {
  for (let i = 0; i < 200; i++) {
    const c = orders.newCode();
    assert.equal(orders.parseCode(orders.formatCode(c)), c);
    assert.equal(orders.parseCode(orders.formatCode(c).toLowerCase().replace(/-/g, ' ')), c);
  }
  assert.equal(orders.parseCode('VYB-00000-00000'), null); // 0 is not in the alphabet
  assert.equal(orders.parseCode('short'), null);
  assert.equal(orders.parseCode(''), null);
});

test('unknown email and wrong bootstrap password are refused', async () => {
  assert.equal((await call(authFns.login, { body: { email: 'nobody@x.com', password: 'whatever-123' } })).status, 401);
  assert.equal((await call(authFns.login, { body: { email: 'owner@vybe.net.in', password: 'not-it' } })).status, 401);
  assert.equal(db.users.rows.size, 0);
});

test('owner is bootstrapped from app settings and must change password', async () => {
  owner = await signIn('owner@vybe.net.in', 'bootstrap-password');
  const me = await call(authFns.me, { cookie: owner });
  assert.equal(me.status, 200);
  assert.deepEqual([me.body.user.role, me.body.user.owner, me.body.user.mustChangePassword], ['admin', true, true]);
  assert.ok(me.body.meta.modes.courier);

  // Everything but the password change is closed until then.
  assert.equal((await call(orderFns.list, { cookie: owner })).status, 403);

  assert.equal((await call(authFns.password, { cookie: owner, body: { current: 'bootstrap-password', next: 'short' } })).status, 400);
  const r = await call(authFns.password, { cookie: owner, body: { current: 'bootstrap-password', next: 'owner-real-password' } });
  assert.equal(r.status, 200);
  assert.equal((await call(orderFns.list, { cookie: owner })).status, 401, 'old cookie is dead');
  owner = r.cookie;
  assert.equal((await call(orderFns.list, { cookie: owner })).status, 200);

  // The bootstrap pair cannot mint a second owner.
  assert.equal((await call(authFns.login, { body: { email: 'owner@vybe.net.in', password: 'bootstrap-password' } })).status, 401);
});

test('mutations require JSON', async () => {
  const r = await call(orderFns.create, { cookie: owner, body: 'customerName=x', type: 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415);
});

test('admin creates a user-role account; that account cannot manage accounts', async () => {
  const r = await call(userFns.create, {
    cookie: owner,
    body: { email: 'Staff@vybe.net.in', name: 'Staff', role: 'user', password: 'temporary-pass' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.email, 'staff@vybe.net.in');
  assert.equal((await call(userFns.create, { cookie: owner, body: { email: 'staff@vybe.net.in', password: 'temporary-pass' } })).status, 409);

  staff = await signIn('staff@vybe.net.in', 'temporary-pass');
  staff = (await call(authFns.password, { cookie: staff, body: { current: 'temporary-pass', next: 'staff-own-password' } })).cookie;

  assert.equal((await call(userFns.list, { cookie: staff })).status, 403);
  assert.equal((await call(userFns.create, { cookie: staff, body: { email: 'x@y.com', password: 'temporary-pass' } })).status, 403);
});

test('staff create an order and the public view hides private fields', async () => {
  const r = await call(orderFns.create, { cookie: staff, body: ORDER });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  code = r.body.order.code;
  assert.match(code, /^VYB-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(r.body.order.status, 'payment_confirmed');

  const t = await call(track, { params: { code: code.toLowerCase() } });
  assert.equal(t.status, 200);
  assert.equal(t.headers['Cache-Control'], 'no-store');
  assert.equal(t.body.firstName, 'Ramesh');
  assert.equal(t.body.items.length, 2);
  assert.equal(t.body.deliveryMode.label, 'Courier');
  const text = JSON.stringify(t.body);
  for (const secret of ['98450', 'ramesh@example.com', 'Jayanagar', 'Paid by UPI', 'staff@vybe.net.in', 'Kumar'])
    assert.ok(!text.includes(secret), `public view leaks ${secret}`);
  assert.deepEqual(
    t.body.steps.map((s) => [s.key, s.done, s.current]),
    [
      ['payment_confirmed', true, true],
      ['processing', false, false],
      ['packed', false, false],
      ['dispatched', false, false],
      ['in_transit', false, false],
      ['out_for_delivery', false, false],
      ['delivered', false, false],
    ]
  );
});

test('bad order input is refused', async () => {
  const bad = [
    { ...ORDER, items: [] },
    { ...ORDER, items: [{ name: 'x', qty: 0 }] },
    { ...ORDER, items: [{ name: 'x', qty: 1.5 }] },
    { ...ORDER, deliveryMode: 'teleport' },
    { ...ORDER, partnerUrl: 'javascript:alert(1)' },
    { ...ORDER, partnerUrl: 'http://insecure.example' },
    { ...ORDER, customerName: '' },
    { ...ORDER, expectedBy: '12/10/2026' },
  ];
  for (const b of bad) assert.equal((await call(orderFns.create, { cookie: staff, body: b })).status, 400, JSON.stringify(b));
});

test('status updates move the stepper; undo walks back', async () => {
  const p = { code };
  for (const s of ['processing', 'packed', 'dispatched'])
    assert.equal((await call(orderFns.setStatus, { cookie: staff, params: p, body: { status: s, note: s === 'dispatched' ? 'AWB D12345678' : '' } })).status, 200);
  assert.equal((await call(orderFns.setStatus, { cookie: staff, params: p, body: { status: 'nonsense' } })).status, 400);

  let t = (await call(track, { params: p })).body;
  assert.equal(t.status.key, 'dispatched');
  assert.equal(t.steps.filter((s) => s.done).length, 4);
  assert.ok(t.steps[3].current && t.steps[3].at);
  assert.equal(t.history[0].note, 'AWB D12345678');

  // An exception status keeps the stepper where it was.
  await call(orderFns.setStatus, { cookie: staff, params: p, body: { status: 'on_hold', note: 'Address check' } });
  t = (await call(track, { params: p })).body;
  assert.equal(t.status.key, 'on_hold');
  assert.equal(t.steps.filter((s) => s.done).length, 4);
  assert.ok(!t.steps.some((s) => s.current));

  assert.equal((await call(orderFns.undoStatus, { cookie: staff, params: p })).body.order.status, 'dispatched');
});

test('concurrent writes do not lose an update', async () => {
  const p = { code };
  const before = (await call(orderFns.getOne, { cookie: staff, params: p })).body.order.events.length;
  await Promise.all([
    call(orderFns.setStatus, { cookie: staff, params: p, body: { status: 'in_transit', note: 'a' } }),
    call(orderFns.setStatus, { cookie: owner, params: p, body: { status: 'in_transit', note: 'b' } }),
    call(orderFns.edit, { cookie: staff, params: p, body: { publicNote: 'Call before arriving' } }),
  ]);
  const o = (await call(orderFns.getOne, { cookie: staff, params: p })).body.order;
  assert.equal(o.events.length, before + 2);
  assert.equal(o.publicNote, 'Call before arriving');
});

test('edits are partial and validated', async () => {
  const p = { code };
  const r = await call(orderFns.edit, { cookie: staff, params: p, body: { deliveryMode: 'porter', partner: 'Porter' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.order.customerName, 'Ramesh Kumar');
  assert.equal(r.body.order.deliveryMode, 'porter');
  assert.equal((await call(orderFns.edit, { cookie: staff, params: p, body: { items: [] } })).status, 400);
});

test('list filters open and closed orders and searches', async () => {
  let r = await call(orderFns.list, { cookie: staff, query: { q: 'ramesh' } });
  assert.equal(r.body.orders.length, 1);
  assert.equal(r.body.orders[0].internalNote, undefined);
  await call(orderFns.setStatus, { cookie: staff, params: { code }, body: { status: 'delivered' } });
  assert.equal((await call(orderFns.list, { cookie: staff })).body.orders.length, 0);
  assert.equal((await call(orderFns.list, { cookie: staff, query: { show: 'closed' } })).body.orders.length, 1);
  assert.equal((await call(orderFns.list, { cookie: staff, query: { show: 'all', q: code.replace(/-/g, '') } })).body.orders.length, 1);
});

test('only admins delete orders', async () => {
  const p = { code };
  assert.equal((await call(orderFns.remove, { cookie: staff, params: p })).status, 403);
  assert.equal((await call(orderFns.remove, { cookie: owner, params: p })).status, 200);
  assert.equal((await call(track, { params: p })).status, 404);
});

test('owner and self guard rails', async () => {
  // Promote staff to admin; their old session dies with the role change.
  const up = await call(userFns.update, { cookie: owner, query: { email: 'staff@vybe.net.in' }, body: { role: 'admin' } });
  assert.equal(up.body.user.role, 'admin');
  assert.equal((await call(authFns.me, { cookie: staff })).status, 401);
  const admin2 = await signIn('staff@vybe.net.in', 'staff-own-password');

  const ownerQ = { email: 'owner@vybe.net.in' };
  assert.equal((await call(userFns.update, { cookie: admin2, query: ownerQ, body: { role: 'user' } })).status, 403);
  assert.equal((await call(userFns.update, { cookie: admin2, query: ownerQ, body: { disabled: true } })).status, 403);
  assert.equal((await call(userFns.update, { cookie: admin2, query: ownerQ, body: { password: 'hijacked-password' } })).status, 403);
  assert.equal((await call(userFns.remove, { cookie: admin2, query: ownerQ })).status, 403);
  assert.equal((await call(userFns.remove, { cookie: admin2, query: { email: 'staff@vybe.net.in' } })).status, 403);
  assert.equal((await call(userFns.update, { cookie: admin2, query: { email: 'staff@vybe.net.in' }, body: { role: 'user' } })).status, 403);

  // The second admin can create admins too.
  const r = await call(userFns.create, { cookie: admin2, body: { email: 'third@vybe.net.in', role: 'admin', password: 'temporary-pass' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'admin');
});

test('disabled accounts and resets', async () => {
  const q = { email: 'third@vybe.net.in' };
  await call(userFns.update, { cookie: owner, query: q, body: { disabled: true } });
  assert.equal((await call(authFns.login, { body: { email: 'third@vybe.net.in', password: 'temporary-pass' } })).status, 403);
  await call(userFns.update, { cookie: owner, query: q, body: { disabled: false, password: 'reset-password-1' } });
  const c = await signIn('third@vybe.net.in', 'reset-password-1');
  assert.equal((await call(authFns.me, { cookie: c })).body.user.mustChangePassword, true);
  assert.equal((await call(orderFns.list, { cookie: c })).status, 403);
});

test('five wrong passwords lock the account', async () => {
  for (let i = 0; i < 5; i++)
    assert.equal((await call(authFns.login, { body: { email: 'third@vybe.net.in', password: `wrong-${i}` } })).status, 401);
  assert.equal((await call(authFns.login, { body: { email: 'third@vybe.net.in', password: 'reset-password-1' } })).status, 429);
  // An admin reset lifts the lock.
  await call(userFns.update, { cookie: owner, query: { email: 'third@vybe.net.in' }, body: { password: 'reset-password-2' } });
  await signIn('third@vybe.net.in', 'reset-password-2');
});

test('tampered and absent cookies are refused; logout ends every session', async () => {
  const [payload, mac] = owner.split('=')[1].split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'owner@vybe.net.in', v: 99, x: Date.now() + 1e6 })).toString('base64url');
  assert.equal((await call(authFns.me, { cookie: `vyb_session=${forged}.${mac}` })).status, 401);
  assert.equal((await call(authFns.me, { cookie: `vyb_session=${payload}.${mac}x` })).status, 401);
  assert.equal((await call(authFns.me, {})).status, 401);

  const out = await call(authFns.logout, { cookie: owner });
  assert.equal(out.status, 200);
  assert.match(out.headers['Set-Cookie'], /Max-Age=0/);
  assert.equal((await call(authFns.me, { cookie: owner })).status, 401);
});
