/*
 * Staff accounts and sessions.
 *
 * Two roles. `user` can create and update orders. `admin` can do that, delete
 * orders, and manage staff accounts — creating, promoting, disabling and
 * resetting them. Nobody can sign up: every account is made by an admin.
 *
 * The first admin (the "owner") is created on first sign-in from two app
 * settings, VYB_ADMIN_EMAIL and VYB_ADMIN_PASSWORD, and only while no owner
 * exists. That account must choose a new password straight away, after which
 * the setting is inert and can be deleted. The owner cannot be demoted,
 * disabled or deleted by anybody, so the site can never be left with no
 * admin at all.
 *
 * Sessions are a signed cookie, not a server-side table: the token carries the
 * email, the account's tokenVersion and an expiry, HMAC-signed with
 * VYB_SESSION_SECRET. Every request re-reads the account, so disabling a
 * person, changing their role or bumping their tokenVersion (sign out,
 * password change, reset) takes effect on their very next request.
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError } = require('./http');
const store = require('./store');

const scrypt = promisify(crypto.scrypt);

const COOKIE = 'vyb_session';
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 10;

/* ------------------------------------------------------------- passwords */

// N=2^15 costs ~50 ms and 32 MiB per hash: slow enough to matter to somebody
// with a stolen table, fast enough not to matter to a person signing in.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, {
    N: +N,
    r: +r,
    p: +p,
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(got, want);
}

// Hashed against when the email is unknown, so a wrong email takes as long as
// a wrong password and the timing does not say which accounts exist.
let decoy = null;
const burnTime = async (password) => {
  decoy ??= await hashPassword('decoy-password-never-matches');
  await verifyPassword(password, decoy);
};

function checkNewPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD)
    throw new HttpError(400, `Use a password of at least ${MIN_PASSWORD} characters.`);
  if (password.length > 200) throw new HttpError(400, 'That password is too long.');
}

/* -------------------------------------------------------------- sessions */

function secret() {
  const s = process.env.VYB_SESSION_SECRET || '';
  // A short secret is a guessable one; refuse to sign anything with it.
  if (s.length < 32) throw new Error('VYB_SESSION_SECRET must be at least 32 characters');
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function issueToken(user, now = Date.now()) {
  const payload = b64url(JSON.stringify({ e: user.rowKey, v: user.tokenVersion || 0, x: now + SESSION_SECONDS * 1000 }));
  return `${payload}.${sign(payload)}`;
}

function readToken(token, now = Date.now()) {
  const [payload, mac] = String(token || '').split('.');
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return t.x > now ? t : null;
  } catch {
    return null;
  }
}

// Path=/api: the browser only ever sends the session to the API, never with a
// page or asset request.
const sessionCookie = (token) =>
  `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
const clearCookie = () => `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function cookieFrom(req) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

/* -------------------------------------------------------------- accounts */

const normEmail = (s) => String(s || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the admin page is allowed to see of an account. Never the hash. */
const publicUser = (u) => ({
  email: u.rowKey,
  name: u.name || '',
  role: u.role,
  owner: !!u.owner,
  disabled: !!u.disabled,
  mustChangePassword: !!u.mustChangePassword,
  createdAt: u.createdAt || null,
  createdBy: u.createdBy || null,
  lastLoginAt: u.lastLoginAt || null,
});

function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * First sign-in of the owner. Returns the new account, or null when the
 * credentials are not the bootstrap pair or an owner already exists.
 */
async function bootstrapOwner(email, password) {
  const want = normEmail(process.env.VYB_ADMIN_EMAIL);
  const pass = process.env.VYB_ADMIN_PASSWORD || '';
  if (!want || !pass || email !== want || !sameSecret(password, pass)) return null;

  const { users } = await store.tables();
  const all = await store.list(users, store.USER_PK);
  if (all.some((u) => u.owner)) return null;

  const user = {
    partitionKey: store.USER_PK,
    rowKey: email,
    name: 'Owner',
    role: 'admin',
    owner: true,
    disabled: false,
    mustChangePassword: true,
    passwordHash: await hashPassword(password),
    tokenVersion: 0,
    failedLogins: 0,
    createdAt: new Date().toISOString(),
    createdBy: 'bootstrap',
  };
  try {
    await users.createEntity(user);
  } catch (e) {
    if (!store.conflict(e)) throw e;
  }
  return store.get(users, store.USER_PK, email);
}

async function login(emailIn, password) {
  const email = normEmail(emailIn);
  if (!email || typeof password !== 'string' || !password) throw new HttpError(400, 'Enter your email and password.');

  const { users } = await store.tables();
  let user = await store.get(users, store.USER_PK, email);
  if (!user) {
    user = await bootstrapOwner(email, password);
    if (!user) {
      await burnTime(password);
      throw new HttpError(401, 'That email and password do not match.');
    }
  }

  const now = Date.now();
  if (user.lockedUntil && Date.parse(user.lockedUntil) > now)
    throw new HttpError(429, `Too many wrong passwords. Try again after ${LOCK_MINUTES} minutes, or ask an admin to reset it.`);

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = (user.failedLogins || 0) + 1;
    const patch = { partitionKey: store.USER_PK, rowKey: email, failedLogins: failed >= MAX_FAILED ? 0 : failed };
    if (failed >= MAX_FAILED) patch.lockedUntil = new Date(now + LOCK_MINUTES * 60 * 1000).toISOString();
    await users.updateEntity(patch, 'Merge');
    throw new HttpError(401, 'That email and password do not match.');
  }
  if (user.disabled) throw new HttpError(403, 'This account has been disabled. Ask an admin.');

  await users.updateEntity(
    { partitionKey: store.USER_PK, rowKey: email, failedLogins: 0, lockedUntil: '', lastLoginAt: new Date(now).toISOString() },
    'Merge'
  );
  return user;
}

/**
 * The signed-in account, or a 401/403.
 *
 * `admin` limits the route to the admin role. A person who must change their
 * password can reach nothing but the routes that pass `passwordChange`, so a
 * reset password handed over on WhatsApp is good for exactly one thing.
 */
async function requireStaff(req, { admin = false, passwordChange = false } = {}) {
  const token = readToken(cookieFrom(req));
  if (!token) throw new HttpError(401, 'Sign in first.');

  const { users } = await store.tables();
  const user = await store.get(users, store.USER_PK, token.e);
  if (!user || user.disabled || (user.tokenVersion || 0) !== token.v) throw new HttpError(401, 'Sign in again.');
  if (user.mustChangePassword && !passwordChange) throw new HttpError(403, 'Choose a new password first.');
  if (admin && user.role !== 'admin') throw new HttpError(403, 'Only an admin can do that.');
  return user;
}

module.exports = {
  COOKIE,
  EMAIL_RE,
  MIN_PASSWORD,
  hashPassword,
  verifyPassword,
  checkNewPassword,
  issueToken,
  readToken,
  sessionCookie,
  clearCookie,
  normEmail,
  publicUser,
  login,
  requireStaff,
};
