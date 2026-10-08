/*
 * Staff accounts. Admins only, all of it.
 *
 *   GET    /api/users
 *   POST   /api/users                 { email, name, role, password }
 *   PATCH  /api/users?email=…         { name?, role?, disabled?, password? }
 *   DELETE /api/users?email=…
 *
 * The email rides in the query string, not the path: an address ends in
 * something that looks like a file extension, and path routing is not where
 * that should be gambled on.
 *
 * A password set here — on a new account or as a reset — is temporary: the
 * person must replace it at their next sign-in, and a reset also signs them
 * out everywhere and lifts any lockout.
 *
 * Two guard rails: nobody can demote, disable or delete the owner, and an
 * admin cannot demote, disable or delete themselves. Between them the site
 * always has at least one working admin.
 */
const { app } = require('@azure/functions');
const { json, body, route, HttpError } = require('../lib/http');
const store = require('../lib/store');
const auth = require('../lib/auth');
const { ROLES } = require('../lib/catalog');

function role(v) {
  if (!ROLES.includes(v)) throw new HttpError(400, `Role must be ${ROLES.join(' or ')}.`);
  return v;
}

const name = (v) => String(v || '').trim().slice(0, 120);

async function target(req, users) {
  const email = auth.normEmail(req.query.get('email'));
  const u = email && (await store.get(users, store.USER_PK, email));
  if (!u) throw new HttpError(404, 'No such account.');
  return u;
}

async function list(req) {
  await auth.requireStaff(req, { admin: true });
  const { users } = await store.tables();
  const all = (await store.list(users, store.USER_PK)).map(auth.publicUser);
  all.sort((a, b) => b.owner - a.owner || a.email.localeCompare(b.email));
  return json(200, { users: all });
}

async function create(req, ctx) {
  const me = await auth.requireStaff(req, { admin: true });
  const input = await body(req);
  const email = auth.normEmail(input.email);
  if (!auth.EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email address.');
  auth.checkNewPassword(input.password);

  const user = {
    partitionKey: store.USER_PK,
    rowKey: email,
    name: name(input.name),
    role: role(input.role || 'user'),
    owner: false,
    disabled: false,
    mustChangePassword: true,
    passwordHash: await auth.hashPassword(input.password),
    tokenVersion: 0,
    failedLogins: 0,
    createdAt: new Date().toISOString(),
    createdBy: me.rowKey,
  };
  const { users } = await store.tables();
  try {
    await users.createEntity(user);
  } catch (e) {
    if (store.conflict(e)) throw new HttpError(409, 'An account with that email already exists.');
    throw e;
  }
  ctx.log(`account ${email} (${user.role}) created by ${me.rowKey}`);
  return json(201, { user: auth.publicUser(user) });
}

async function update(req, ctx) {
  const me = await auth.requireStaff(req, { admin: true });
  const input = await body(req);
  const { users } = await store.tables();
  const u = await target(req, users);
  const self = u.rowKey === me.rowKey;

  const patch = { partitionKey: store.USER_PK, rowKey: u.rowKey };
  if (Object.hasOwn(input, 'name')) patch.name = name(input.name);
  if (Object.hasOwn(input, 'role')) {
    patch.role = role(input.role);
    if (patch.role !== u.role && u.owner) throw new HttpError(403, 'The owner is always an admin.');
    if (patch.role !== u.role && self) throw new HttpError(403, 'You cannot change your own role.');
  }
  if (Object.hasOwn(input, 'disabled')) {
    patch.disabled = !!input.disabled;
    if (patch.disabled && u.owner) throw new HttpError(403, 'The owner cannot be disabled.');
    if (patch.disabled && self) throw new HttpError(403, 'You cannot disable your own account.');
  }
  if (Object.hasOwn(input, 'password')) {
    if (u.owner && !self) throw new HttpError(403, "Only the owner can change the owner's password.");
    auth.checkNewPassword(input.password);
    patch.passwordHash = await auth.hashPassword(input.password);
    patch.mustChangePassword = true;
    patch.failedLogins = 0;
    patch.lockedUntil = '';
  }
  // Anything that changes what this person may do ends their current sessions.
  if (patch.passwordHash || patch.disabled || (patch.role && patch.role !== u.role))
    patch.tokenVersion = (u.tokenVersion || 0) + 1;

  await users.updateEntity(patch, 'Merge');
  ctx.log(`account ${u.rowKey} updated by ${me.rowKey}: ${Object.keys(input).join(', ')}`);
  return json(200, { user: auth.publicUser({ ...u, ...patch }) });
}

async function remove(req, ctx) {
  const me = await auth.requireStaff(req, { admin: true });
  const { users } = await store.tables();
  const u = await target(req, users);
  if (u.owner) throw new HttpError(403, 'The owner account cannot be deleted.');
  if (u.rowKey === me.rowKey) throw new HttpError(403, 'You cannot delete your own account.');
  await users.deleteEntity(store.USER_PK, u.rowKey);
  ctx.log(`account ${u.rowKey} deleted by ${me.rowKey}`);
  return json(200, { ok: true });
}

const anon = { authLevel: 'anonymous', route: 'users' };
app.http('users-list', { ...anon, methods: ['GET'], handler: route(list) });
app.http('users-create', { ...anon, methods: ['POST'], handler: route(create) });
app.http('users-update', { ...anon, methods: ['PATCH'], handler: route(update) });
app.http('users-delete', { ...anon, methods: ['DELETE'], handler: route(remove) });

module.exports = { list, create, update, remove };
