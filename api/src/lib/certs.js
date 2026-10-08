/*
 * The certificate register behind /verify/. It used to be an array in
 * build.js compiled into the page; it lives here now so the register can be
 * kept from /vyb-admin/ and a withdrawal takes effect the moment it is saved,
 * not at the next deploy.
 *
 * `status` is 'active' or 'withdrawn'. Expiry is not a status: the verify page
 * derives it from `expires` against the visitor's date, so a certificate
 * cannot sit here reading "valid" a year after it lapsed.
 *
 * `specimen: true` marks a demonstration record. The result card labels it as
 * one, which is what keeps the published sample from being mistaken for a
 * real certificate.
 */
const { HttpError } = require('./http');

/**
 * Written into the table once, the first time the register is read, so the
 * specimen the verify page links to exists from day one. Deleting it from the
 * admin page afterwards is permanent; it is not re-seeded. build.js reads it
 * too, for the "see a specimen" link.
 */
const SEED = [
  {
    number: 'VYB-QMS-2026-0417',
    specimen: true,
    holder: 'Sample Organisation Pvt Ltd',
    address: '#00, Sample Building, Sample Road, Sample Layout, Bengaluru, Karnataka 560000, India',
    scheme: 'Quality Management System',
    standard: 'ISO 9001:2015',
    scope: 'Distribution, supply and after-sales support of IT hardware, RFID and NFC access cards, and allied accessories.',
    initial: '2026-09-15',
    issued: '2026-09-15',
    expires: '2029-09-14',
    status: 'active',
    pdf: '/assets/certificates/VYB-QMS-2026-0417.pdf',
  },
];

/* Numbers get retyped off paper and pasted out of PDFs, where a dash can
   arrive as an en dash and a space anywhere. The key is letters and digits
   alone, so "vyb qms 2026 0417" finds VYB-QMS-2026-0417. */
const key = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const text = (v, max, field, required = true) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (${max} characters at most).`);
  return s;
};

const ymd = (v, field, required = true) => {
  const s = text(v, 10, field, required);
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD).`);
  return s;
};

/**
 * A link the verify page can safely put in an href: a path on this site, or
 * an https URL. Anything else (javascript:, data:, protocol-relative) is out.
 */
function pdfLink(v) {
  const s = text(v, 500, 'PDF link', false);
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    if (new URL(s).protocol === 'https:') return s;
  } catch {}
  throw new HttpError(400, 'The PDF must be a path on this site (/…) or an https:// link.');
}

/** The fields of a certificate, validated. `partial` accepts a subset, for edits. */
function fields(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.hasOwn(input, k);
  if (has('holder')) out.holder = text(input.holder, 200, 'Holder');
  if (has('address')) out.address = text(input.address, 500, 'Address', false);
  if (has('scheme')) out.scheme = text(input.scheme, 120, 'Scheme', false);
  if (has('standard')) out.standard = text(input.standard, 120, 'Standard');
  if (has('scope')) out.scope = text(input.scope, 2000, 'Scope');
  if (has('issued')) out.issued = ymd(input.issued, 'Issue date');
  if (has('initial')) out.initial = ymd(input.initial, 'Initial certification date', false);
  if (has('expires')) out.expires = ymd(input.expires, 'Expiry date');
  if (has('status')) {
    if (!['active', 'withdrawn'].includes(input.status)) throw new HttpError(400, 'Status must be active or withdrawn.');
    out.status = input.status;
  }
  if (has('specimen')) out.specimen = !!input.specimen;
  if (has('pdf')) out.pdf = pdfLink(input.pdf);
  if (has('internalNote')) out.internalNote = text(input.internalNote, 2000, 'Internal note', false);
  if (out.issued && out.expires && out.expires <= out.issued) throw new HttpError(400, 'The expiry date must be after the issue date.');
  return out;
}

function number(v) {
  const s = text(v, 40, 'Certificate number').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9\-/ ]*[A-Z0-9]$/.test(s) || key(s).length < 4)
    throw new HttpError(400, 'Use letters, digits and dashes for the certificate number, e.g. VYB-QMS-2026-0418.');
  return s;
}

/** What the public verify page receives. No internal note, no staff names. */
const publicView = (e) => ({
  number: e.number,
  specimen: !!e.specimen,
  holder: e.holder,
  address: e.address || '',
  scheme: e.scheme || '',
  standard: e.standard,
  scope: e.scope,
  initial: e.initial || e.issued,
  issued: e.issued,
  expires: e.expires,
  status: e.status,
  pdf: e.pdf || '',
});

const staffView = (e) => ({
  ...publicView(e),
  internalNote: e.internalNote || '',
  createdAt: e.createdAt || null,
  createdBy: e.createdBy || null,
  updatedAt: e.updatedAt || null,
  updatedBy: e.updatedBy || null,
});

module.exports = { SEED, key, fields, number, publicView, staffView };
