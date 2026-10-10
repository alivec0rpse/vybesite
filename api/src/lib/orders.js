/*
 * The order record: tracking codes, input validation, and the two views of an
 * order — everything for staff, and the much smaller slice a customer sees.
 *
 * The tracking code is the only thing standing between a stranger and an
 * order's details, so it is random rather than sequential: 10 characters from
 * a 31-letter alphabet is ~49 bits, far too many to walk. It prints as
 * VYB-XXXXX-XXXXX. The alphabet drops 0/O, 1/I/L so a code read out over the
 * phone survives the trip.
 */
const crypto = require('node:crypto');
const { STATUSES, MODES, PAYMENTS, flowFor } = require('./catalog');
const { HttpError } = require('./http');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 10;

const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

/** "vyb-7k2mq 9xap3", "VYB7K2MQ9XAP3", "7K2MQ-9XAP3" -> "7K2MQ9XAP3", else null. */
function parseCode(input) {
  let s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('VYB') && s.length === CODE_LEN + 3) s = s.slice(3);
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

const formatCode = (body) => `VYB-${body.slice(0, 5)}-${body.slice(5)}`;

/* ------------------------------------------------------------ validation */

const str = (v, max, field) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${field} must be text.`);
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `${field} is too long (${max} characters at most).`);
  return s;
};

function items(v) {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'Add at least one item.');
  if (v.length > 50) throw new HttpError(400, 'At most 50 items per order.');
  return v.map((it, i) => {
    const name = str(it && it.name, 200, `Item ${i + 1} name`);
    if (!name) throw new HttpError(400, `Item ${i + 1} needs a name.`);
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) throw new HttpError(400, `Item ${i + 1} needs a whole-number quantity.`);
    return { name, qty };
  });
}

function url(v) {
  const s = str(v, 500, 'Tracking link');
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, 'The partner tracking link is not a valid URL.');
  }
  // Rendered as a link on a public page: anything but https is refused, which
  // is what keeps a javascript: URL off it.
  if (u.protocol !== 'https:') throw new HttpError(400, 'The partner tracking link must start with https://');
  return u.toString();
}

function date(v) {
  const s = str(v, 10, 'Expected date');
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, 'Expected date must be YYYY-MM-DD.');
  return s;
}

function mode(v) {
  if (!Object.hasOwn(MODES, v)) throw new HttpError(400, 'Choose a delivery mode.');
  return v;
}

function payment(v) {
  if (!Object.hasOwn(PAYMENTS, v)) throw new HttpError(400, 'Choose how the customer pays.');
  return v;
}

/** Rupees, up to two decimals. Blank means "not stated". Stored as a string: Table Storage doubles are not money. */
function amount(v) {
  if (v === undefined || v === null || String(v).trim() === '') return '';
  const s = String(v).replace(/[₹,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new HttpError(400, 'Amount must be a number of rupees, e.g. 1250 or 1250.50.');
  return Number(s).toFixed(2);
}

function status(v) {
  if (!Object.hasOwn(STATUSES, v)) throw new HttpError(400, 'Choose a status.');
  return v;
}

/**
 * The editable fields of an order, validated. `partial` accepts a subset, for
 * edits; a create must carry the lot.
 */
function details(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.hasOwn(input, k);
  if (has('customerName')) {
    out.customerName = str(input.customerName, 120, 'Customer name');
    if (!out.customerName) throw new HttpError(400, 'Enter the customer name.');
  }
  if (has('customerPhone')) out.customerPhone = str(input.customerPhone, 30, 'Phone');
  if (has('customerEmail')) out.customerEmail = str(input.customerEmail, 200, 'Email');
  if (has('address')) out.address = str(input.address, 1000, 'Address');
  if (has('reference')) out.reference = str(input.reference, 60, 'Reference');
  if (has('items')) out.items = JSON.stringify(items(input.items));
  if (has('deliveryMode')) out.deliveryMode = mode(input.deliveryMode);
  if (has('partner')) out.partner = str(input.partner, 120, 'Delivery partner');
  if (has('partnerRef')) out.partnerRef = str(input.partnerRef, 120, 'Partner reference');
  if (has('partnerUrl')) out.partnerUrl = url(input.partnerUrl);
  if (has('expectedBy')) out.expectedBy = date(input.expectedBy);
  if (has('publicNote')) out.publicNote = str(input.publicNote, 1000, 'Note for the customer');
  if (has('internalNote')) out.internalNote = str(input.internalNote, 2000, 'Internal note');
  if (has('payment')) out.payment = payment(input.payment ?? 'prepaid');
  if (has('amount')) out.amount = amount(input.amount);
  if (has('dueBy')) out.dueBy = date(input.dueBy);
  if (has('paid')) out.paid = !!input.paid;
  return out;
}

/* ----------------------------------------------------------------- views */

const parse = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

const events = (e) => parse(e.events, []);

// Orders from before payment types existed were all prepaid.
const isPaid = (e) => !e.payment || e.payment === 'prepaid' || !!e.paid;

/** Everything, for signed-in staff. */
const staffView = (e) => ({
  code: formatCode(e.rowKey),
  customerName: e.customerName || '',
  customerPhone: e.customerPhone || '',
  customerEmail: e.customerEmail || '',
  address: e.address || '',
  reference: e.reference || '',
  items: parse(e.items, []),
  deliveryMode: e.deliveryMode,
  partner: e.partner || '',
  partnerRef: e.partnerRef || '',
  partnerUrl: e.partnerUrl || '',
  expectedBy: e.expectedBy || '',
  publicNote: e.publicNote || '',
  internalNote: e.internalNote || '',
  payment: e.payment || 'prepaid',
  amount: e.amount || '',
  dueBy: e.dueBy || '',
  paid: isPaid(e),
  paidAt: e.paidAt || '',
  status: e.status,
  events: events(e),
  createdAt: e.createdAt,
  createdBy: e.createdBy,
  updatedAt: e.updatedAt,
});

/**
 * What anybody holding the code sees. No phone, email, address or internal
 * note and no staff names. The customer's name is shown in full, so they can
 * tell at a glance the order is theirs; the code is what keeps it private.
 */
function publicView(e) {
  const m = MODES[e.deliveryMode] || MODES.other;
  const pay = e.payment || 'prepaid';
  const history = events(e);
  const current = e.status;

  // Most recent time each status was reached, for the stepper.
  const reached = {};
  for (const ev of history) reached[ev.status] = ev.at;

  const flow = flowFor(e.deliveryMode, pay);
  const at = flow.indexOf(current);
  // An exception status (on hold, cancelled) or an off-flow one leaves the
  // stepper where the last on-flow status put it.
  let upTo = at;
  if (upTo < 0) for (const ev of history) upTo = Math.max(upTo, flow.indexOf(ev.status));

  return {
    code: formatCode(e.rowKey),
    customerName: e.customerName || '',
    reference: e.reference || '',
    items: parse(e.items, []),
    deliveryMode: { key: e.deliveryMode, label: m.label },
    partner: e.partner || '',
    partnerRef: e.partnerRef || '',
    partnerUrl: e.partnerUrl || '',
    expectedBy: e.expectedBy || '',
    publicNote: e.publicNote || '',
    payment: {
      key: pay,
      label: PAYMENTS[pay].label,
      amount: e.amount || '',
      dueBy: pay === 'credit' ? e.dueBy || '' : '',
      paid: isPaid(e),
      paidAt: pay === 'prepaid' ? '' : e.paidAt || '',
    },
    status: { key: current, ...STATUSES[current] },
    steps: flow.map((key, i) => ({
      key,
      label: STATUSES[key].label,
      done: i <= upTo,
      current: i === at,
      at: i <= upTo ? reached[key] || null : null,
    })),
    history: history
      .map((ev) => ({ status: ev.status, label: (STATUSES[ev.status] || {}).label || ev.status, at: ev.at, note: ev.note || '' }))
      .reverse(),
    placedAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

module.exports = { newCode, parseCode, formatCode, details, status, events, isPaid, staffView, publicView };
