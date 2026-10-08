/*
 * Sign in, sign out, who am I, and change my own password.
 *
 *   POST /api/auth/login      { email, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *   POST /api/auth/password   { current, next }
 */
const { app } = require('@azure/functions');
const { json, body, route, HttpError } = require('../lib/http');
const store = require('../lib/store');
const auth = require('../lib/auth');
const { STATUSES, MODES, ROLES } = require('../lib/catalog');

async function login(req) {
  const { email, password } = await body(req);
  const user = await auth.login(email, password);
  return json(200, { user: auth.publicUser(user) }, { 'Set-Cookie': auth.sessionCookie(auth.issueToken(user)) });
}

/**
 * Bumps tokenVersion, so signing out on one device signs out everywhere. For
 * a handful of staff accounts that is the safer default: a session left open
 * on a shared office PC dies the moment its owner signs out on their phone.
 */
async function logout(req) {
  try {
    const user = await auth.requireStaff(req, { passwordChange: true });
    const { users } = await store.tables();
    await users.updateEntity(
      { partitionKey: store.USER_PK, rowKey: user.rowKey, tokenVersion: (user.tokenVersion || 0) + 1 },
      'Merge'
    );
  } catch (e) {
    // Already signed out is still signed out.
    if (!(e instanceof HttpError)) throw e;
  }
  return json(200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
}

/** The account plus the catalog the admin page builds its forms from. */
async function me(req) {
  const user = await auth.requireStaff(req, { passwordChange: true });
  return json(200, { user: auth.publicUser(user), meta: { statuses: STATUSES, modes: MODES, roles: ROLES } });
}

async function password(req) {
  const user = await auth.requireStaff(req, { passwordChange: true });
  const { current, next } = await body(req);
  if (!(await auth.verifyPassword(String(current || ''), user.passwordHash)))
    throw new HttpError(400, 'Your current password is not right.');
  auth.checkNewPassword(next);
  if (next === current) throw new HttpError(400, 'Pick a password different from the current one.');

  const updated = {
    partitionKey: store.USER_PK,
    rowKey: user.rowKey,
    passwordHash: await auth.hashPassword(next),
    mustChangePassword: false,
    tokenVersion: (user.tokenVersion || 0) + 1,
  };
  const { users } = await store.tables();
  await users.updateEntity(updated, 'Merge');
  // Every other session is now dead; hand this one a fresh cookie.
  const fresh = { ...user, ...updated };
  return json(200, { user: auth.publicUser(fresh) }, { 'Set-Cookie': auth.sessionCookie(auth.issueToken(fresh)) });
}

app.http('auth-login', { methods: ['POST'], authLevel: 'anonymous', route: 'auth/login', handler: route(login) });
app.http('auth-logout', { methods: ['POST'], authLevel: 'anonymous', route: 'auth/logout', handler: route(logout) });
app.http('auth-me', { methods: ['GET'], authLevel: 'anonymous', route: 'auth/me', handler: route(me) });
app.http('auth-password', { methods: ['POST'], authLevel: 'anonymous', route: 'auth/password', handler: route(password) });

module.exports = { login, logout, me, password };
