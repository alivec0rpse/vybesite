/*
 * Static site builder. Turns the single-page app in src/app.html into one real
 * HTML document per section, wrapped in the shared head, nav and footer.
 *
 *   node build.js && npm run css
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const SITE = 'https://vybe.net.in';
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/**
 * Google's ProfilePage parser rejects a bare `YYYY-MM-DD` for datePublished and
 * dateModified — it wants a full ISO 8601 datetime with an offset. Everything
 * here is stamped in the office's timezone, so anchor the day at local midnight.
 */
const IST_OFFSET = '+05:30';
const isoDateTime = (date) => `${date}T00:00:00${IST_OFFSET}`;

const ORG = {
  name: 'Vybe Technologies',
  legalName: 'Vybe Technologies',
  // How people actually type the brand. Google uses these to match a bare
  // "vybe" query to this entity rather than to an unrelated one.
  alsoKnownAs: ['Vybe', 'Vybe Tech', 'Vybe Technologies Bengaluru'],
  slogan: 'Smart. Simple. Affordable.',
  phone: '+91-99641-77677',
  phoneSupport: '+91-90198-01319',
  phoneOffice: '+91-99641-77877',
  sales: 'sales@vybe.net.in',
  support: 'support@vybe.net.in',
  legal: 'legal@vybe.net.in',
  // Escalation of last resort. A person, not a role alias, on purpose.
  grievance: 'manjunath@vybe.net.in',
  // The registered office, and the address every legal document carries. It is
  // a temporary premises: once the NOC for the corporate office below comes
  // through, that one becomes both headquarters and registered address, and
  // this entry goes away. `streetLines` is the same address broken for display;
  // `street` is the one-line form schema.org and prose want.
  street: '#103, First Floor, 10th Main, Gaurav Nagar, J.P Nagar 7th Phase',
  streetLines: ['#103, First Floor, 10th Main', 'Gaurav Nagar, J.P Nagar 7th Phase'],
  locality: 'Bengaluru',
  region: 'Karnataka',
  postal: '560078',
  country: 'IN',
  /*
   * The corporate office, which is where the work actually happens. It is a
   * second address today rather than a replacement, because the registered
   * office is still the registered one until the NOC is issued.
   *
   * When that lands: delete the five `street`/`streetLines`/`postal` fields
   * above along with anything that reads them as "registered", change this
   * label to 'Headquarters & Registered Office', and promote these fields into
   * the ORG top level so #organization's `address` picks them up too. #office
   * already carries this address. Nothing else on the site hardcodes either.
   */
  corporate: {
    label: 'Corporate Office',
    street:
      '4th Floor, IIIC, Christ Academy Institute of Advanced Studies, Christ Nagar, Hullahalli, Begur - Koppa Road, Sakkalwara Post',
    streetLines: [
      '4th Floor, IIIC, Christ Academy',
      'Institute of Advanced Studies',
      'Christ Nagar, Hullahalli',
      'Begur &ndash; Koppa Road, Sakkalwara Post',
    ],
    locality: 'Bengaluru',
    region: 'Karnataka',
    postal: '560083',
    country: 'IN',
    // The Google Business Profile listing is pinned here, not at the registered
    // office. The place ID is what Maps links and `sameAs` key on; the
    // coordinates are the listing's own pin, so the schema and Maps agree.
    placeId: 'ChIJ3-UxeUQhf2sRivSq9ceBqaM',
    lat: 12.834939,
    lng: 77.6168055,
  },
  // schema.org accepts 24-hour times only.
  opens: '09:00',
  closes: '18:30',
  openDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  // Every profile here must link back to vybe.net.in, or the claim is weak.
  // The Google Business Profile is the strongest of these for a local brand
  // query, and it is given by place ID so Google matches an ID rather than
  // following a shortener.
  profiles: [
    'https://www.linkedin.com/company/vybe-technologies',
    'https://www.instagram.com/vybe_technologies/',
    'https://www.google.com/maps/place/?q=place_id:ChIJ3-UxeUQhf2sRivSq9ceBqaM',
  ],
  founder: { name: 'Ankit Sabu', profile: 'https://www.linkedin.com/in/ankit-sabu-816769273/', card: 'ankit' },
  // ISO 8601, which is the only format schema.org reads.
  foundingDate: '2026-04-27',
  gstin: '29DGZPC6225F1Z0',
};

/*
 * The staff digital visiting cards under /<slug>/.
 *
 * The card markup itself is imported, not generated — tools/import-card.mjs
 * unpacks an export into the directory. What the import cannot know is how the
 * page should behave as part of this site, so the build owns that: it rewrites
 * each card's robots directive and injects the Person graph below. Running the
 * build after an import is what finishes the job.
 *
 * `slug` is the URL path and the key for everything else. `linkedin` is the
 * only off-site profile that corroborates the person, so it carries the whole
 * weight of `sameAs`: without it a Person node is an unverifiable assertion.
 */
const TEAM = [
  {
    slug: 'ankit',
    name: 'Ankit Sabu',
    role: 'Founder & CEO',
    email: 'ankit@vybe.net.in',
    tel: '+91-99641-77677',
    linkedin: 'https://www.linkedin.com/in/ankit-sabu-816769273/',
    bio: 'Ankit Sabu founded Vybe Technologies in Bengaluru and leads the company across campus ERP, cashless cafeteria, cloud and IT.',
  },
  {
    slug: 'harsha',
    name: 'Harsha R',
    role: 'Chief Operational Officer',
    email: 'harsha@vybe.net.in',
    tel: '+91-99641-77877',
    linkedin: 'https://www.linkedin.com/in/harsha-r-reddy-43a9b441a/',
    bio: 'Harsha R runs delivery and operations at Vybe Technologies in Bengaluru, from campus rollouts to day-to-day support.',
  },
  {
    slug: 'manjunath',
    name: 'Manjunath D',
    role: 'Enterprise Relations Officer',
    email: 'manjunath@vybe.net.in',
    tel: '+91-90198-01319',
    // "Enterprise Relations Officer" pushes the title past the 60 characters
    // Google renders. The page still states the full role; only the tag is cut.
    titleRole: 'Enterprise Relations',
    linkedin: 'https://www.linkedin.com/in/m-d-714137425/',
    bio: 'Manjunath D looks after enterprise and institutional relationships at Vybe Technologies in Bengaluru, and is the registered Grievance Officer.',
  },
  {
    slug: 'tejas',
    name: 'Tejas C',
    role: 'Chief Technology Officer',
    email: 'tejas@vybe.net.in',
    tel: '+91-94565-67283',
    linkedin: 'https://www.linkedin.com/in/tejasc02/',
    bio: 'Tejas C leads engineering at Vybe Technologies in Bengaluru, across Vybe ERP, Vybe CMS, cloud infrastructure and security.',
  },
];

/** One canonical node per person, so the founder is not also a second entity. */
const personId = (slug) => `${SITE}/${slug}/#person`;

/** Drops keys whose value is empty, so unfilled ORG fields never reach the graph. */
const defined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)));

/* ---------------------------------------------------------------- helpers */

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => {
  const full = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, s);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

/* Numbers live in ORG in one canonical form. These two derive the dialable
   href and the readable label from it, so a number can never be changed in
   one place and left stale in another. */
const telHref = (n) => `tel:${n.replace(/[^+\d]/g, '')}`;
const telText = (n) => n.replace(/-/g, '\u00a0').replace('\u00a0', ' ');
/** A `tel:` link, ready to drop into copy. */
const telLink = (n, cls = 'text-brand font-bold') => `<a class="${cls}" href="${telHref(n)}">${telText(n)}</a>`;

// English only. Named once so lang, og:locale and inLanguage cannot disagree.
const LOC = { tag: 'en-IN', og: 'en_IN' };

/**
 * Pull one `<div id="…-view">` out of the source SPA by walking div depth. The
 * wrapper's classes carry the page background so they are kept; only the SPA
 * machinery (`view-section`, `display:none`) is stripped.
 */
function extractView(src, id) {
  const open = new RegExp(`<div id="${id}" class="([^"]*)"[^>]*>`);
  const m = open.exec(src);
  if (!m) throw new Error(`view not found: ${id}`);

  const wrapperClass = m[1].replace(/\bview-section\b/, '').replace(/\bactive\b/, '').replace(/\s+/g, ' ').trim();

  let i = m.index + m[0].length;
  let depth = 1;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = i;
  let t;
  while ((t = tag.exec(src))) {
    depth += t[0] === '</div>' ? -1 : 1;
    if (depth === 0) return { wrapperClass, inner: src.slice(i, t.index) };
  }
  throw new Error(`unbalanced markup in ${id}`);
}

/* ------------------------------------------------- content transformations */

const LOGO_ASPECT = 1447 / 609;
const HREF = {
  'home-view': '/',
  'erp-view': '/erp/',
  'cms-view': '/cms/',
  'it-view': '/it-solutions/',
  'cloud-view': '/cloud/',
  'workspace-view': '/workspace/',
  'classroom-view': '/smart-classroom/',
};

/**
 * Products still in src/app.html but not currently sold. Everything that lists
 * a product filters on this set, and the link check at the end of the file
 * fails the build if anything still points at one. Deleting an entry
 * republishes the page; its 301 in staticwebapp.config.json then has to go.
 */
const UNPUBLISHED = new Set(['cloud']);
const published = (nav) => !UNPUBLISHED.has(nav);

/** <picture> with a WebP source and a PNG fallback, always with intrinsic size. */
function picture({ base, alt, cls, h, aspect, eager = false, hidden = false }) {
  const w = Math.round(h * aspect);
  const a = hidden ? 'alt="" aria-hidden="true"' : `alt="${esc(alt)}"`;
  const prio = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  return `<picture><source srcset="/assets/${base}.webp" type="image/webp"><img src="/assets/${base}.opt.png" ${a} class="${cls}" width="${w}" height="${h}" ${prio} decoding="async"></picture>`;
}

const dedupe = (cls) => [...new Set(cls.split(/\s+/).filter(Boolean))].join(' ');

/** `<div onclick="showPage('x-view')">` -> a real anchor, walking div depth. */
function divClickToAnchor(html) {
  const open = /<div onclick="showPage\('([a-z-]+)'\)" class="([^"]*)"([^>]*)>/;
  let out = html;
  let m;
  while ((m = open.exec(out))) {
    const [full, view, cls, rest] = m;
    const start = m.index;
    let depth = 1;
    let closeAt = -1;
    const tag = /<div\b|<\/div>/g;
    tag.lastIndex = start + full.length;
    let t;
    while ((t = tag.exec(out))) {
      depth += t[0] === '</div>' ? -1 : 1;
      if (depth === 0) {
        closeAt = t.index;
        break;
      }
    }
    if (closeAt < 0) throw new Error(`unbalanced card markup for ${view}`);
    const anchor = `<a href="${HREF[view]}" class="${cls.replace(/\bcursor-pointer\b/, 'block').trim()}"${rest}>`;
    out = out.slice(0, start) + anchor + out.slice(start + full.length, closeAt) + '</a>' + out.slice(closeAt + 6);
  }
  return out;
}

/**
 * Inline `style="…"` -> a class. Anything unmapped is a build error: an
 * unhandled inline style works locally and vanishes under the production CSP.
 */
const STYLE_CLASS = {
  'transition-delay: 100ms;': 'delay-100',
  'transition-delay: 200ms;': 'delay-200',
  'animation-delay: -6s;': 'orb-delay-1',
  'animation-delay: -12s;': 'orb-delay-2',
  'animation-delay: 0.5s;': 'anim-delay-500',
  'animation-delay: 0.5s': 'anim-delay-500',
  'animation-delay: 1s': 'anim-delay-1000',
};

function styleAttrToClass(html) {
  return html.replace(/<([a-z]+)\b([^>]*?)\sstyle="([^"]*)"([^>]*)>/g, (full, tag, before, style, after) => {
    // Matched loosely: the data URI carries escaped quotes.
    const cls = /background-image:\s*url\('data:image\/svg\+xml/.test(style)
      ? 'bg-dot-white'
      : STYLE_CLASS[style.trim()];
    if (!cls) throw new Error(`unmapped inline style (CSP would drop it): ${style}`);

    const rest = before + after;
    const withClass = /\sclass="/.test(rest)
      ? rest.replace(/\sclass="([^"]*)"/, (_, c) => ` class="${dedupe(`${c} ${cls}`)}"`)
      : `${rest} class="${cls}"`;
    return `<${tag}${withClass}>`;
  });
}

function transformView(view, { dark = false } = {}) {
  let out = view.inner;

  // Clickable cards become real anchors, so they are crawlable and focusable.
  out = divClickToAnchor(out);

  // Drop the grid card for any unpublished product. No nested <a>, so
  // matching to the first </a> takes exactly one card. The card's "PILLAR n:"
  // comment goes with it — left behind it is the one trace of an unpublished
  // product that still ships in the emitted HTML.
  for (const nav of UNPUBLISHED) {
    const href = (PRODUCTS.find((p) => p.nav === nav) || {}).href;
    if (!href) continue;
    // [^>]* rather than [\s\S]*? on the comment: a lazy any-character run will
    // happily start at the first comment in the document and swallow the hero
    // on its way here. A comment body cannot contain '>', so this cannot cross
    // a tag boundary.
    out = out.replace(new RegExp(`(?:<!--[^>]*-->\\s*)?<a href="${href}"[^>]*>[\\s\\S]*?</a>\\s*`, 'g'), '');
  }

  // Two columns: an odd count leaves the last card beside an empty cell, so
  // widen it to fill the row.
  const cards = [...out.matchAll(/<a href="\/[a-z-]*\/" class="[^"]*\bp-10\b[^"]*"/g)];
  if (cards.length % 2 === 1) {
    const last = cards[cards.length - 1][0];
    out = out.replace(last, last.replace(/\bflex flex-col\b/, 'md:col-span-2 flex flex-col'));
  }

  // "Back to Home" / "Back" buttons are replaced by breadcrumbs in the shell.
  out = out.replace(/<button onclick="showPage\('home-view'\)"[\s\S]*?<\/button>\s*/g, '');

  // Any remaining showPage() button -> anchor styled the same way.
  out = out.replace(
    /<button onclick="showPage\('([a-z-]+)'\)" class="([^"]*)"([^>]*)>([\s\S]*?)<\/button>/g,
    (_, view, cls, rest, inner) => `<a href="${HREF[view]}" class="${cls} inline-flex"${rest}>${inner}</a>`
  );

  // In-page scroll button -> real fragment link.
  out = out.replace(
    /<button onclick="document\.getElementById\('([a-z-]+)'\)\.scrollIntoView\([^)]*\)" class="([^"]*)"([^>]*)>([\s\S]*?)<\/button>/g,
    (_, target, cls, rest, inner) =>
      `<a href="#${target}" class="${dedupe(`${cls} inline-flex items-center justify-center`)}"${rest}>${inner}</a>`
  );

  // Remote logo -> local, responsive, with intrinsic dimensions.
  out = out.replace(/<img src="https:\/\/caias\.vybe\.net\.in\/vybe_logo\.png"[^>]*class="([^"]*)"[^>]*>/g, (_, cls) => {
    const h = /h-28/.test(cls) ? 112 : /h-16/.test(cls) ? 64 : 24;
    return picture({ base: 'vybe-logo', alt: 'Vybe Technologies', cls, h, aspect: LOGO_ASPECT, eager: h > 24 });
  });
  out = out.replace(/<img src="https:\/\/vybe\.net\.in\/caias_logo\.png"[^>]*class="([^"]*)"[^>]*>/g, (_, cls) =>
    picture({ base: 'caias-logo', alt: 'Christ Academy Institute for Advanced Studies', cls, h: 112, aspect: 3 })
  );

  // A 175KB remote PNG at 3% opacity. A CSS pattern looks the same for free.
  out = out.replace(
    /style="background-image: url\('https:\/\/lh3\.googleusercontent\.com\/[^']*'\);[^"]*"/g,
    'aria-hidden="true"'
  );
  out = out.replace(/<div class="absolute inset-0 opacity-\[0\.03\]" aria-hidden="true">/, '<div class="absolute inset-0 opacity-[0.03] bg-noise-faint" aria-hidden="true">');

  // Decorative-only inline handlers and error fallbacks are no longer needed.
  out = out.replace(/\s*onerror="this\.style\.display='none';"/g, '');

  // Headings were picked visually: the eyebrow label was an <h2> and the real
  // title an <h3>. Promote the title, demote the label to a paragraph.
  out = out.replace(
    /<h2 (class="text-xs[^"]*")>([\s\S]*?)<\/h2>\s*<h3 (class="[^"]*")>([\s\S]*?)<\/h3>/g,
    (_, labelCls, label, titleCls, title) => `<p ${labelCls}>${label}</p>\n<h2 ${titleCls}>${title}</h2>`
  );
  // Card titles then sit one level below their section heading.
  out = out.replace(/<h4 (class="text-2xl[^"]*")>([\s\S]*?)<\/h4>/g, '<h3 $1>$2</h3>');

  // The production CSP drops inline style attributes, so each one becomes a
  // real class. Otherwise the reveals and badges flatten in production only.
  out = styleAttrToClass(out);

  // Marked for JS to animate, but never left invisible if JS fails.
  out = out.replace(/class="([^"]*)\breveal active\b([^"]*)"/g, 'class="$1reveal$2"');

  // Tag headline figures for the count-up in site.js. The final value stays
  // in the HTML, so with JS off the reader still sees "99.9%", not a zero.
  out = out.replace(
    /<p class="(text-3xl md:text-4xl font-black text-brand[^"]*)">([^<]+)<\/p>/g,
    (_, cls, value) => `<p class="${cls} stat-figure" data-count-to="${esc(value.trim())}">${value}</p>`
  );

  return { wrapperClass: view.wrapperClass, inner: out.trim(), dark };
}

/** Wrap a transformed view in its original container, breadcrumbs first. */
/**
 * Close the gap between <h1> and the first <h2>.
 *
 * The hero block on most pages was styled before it was outlined: its cards
 * are <h3>/<h4> because that is the size they wanted, so the document opens
 * h1 -> h3 and the first real <h2> only turns up further down. Assistive
 * technology reads that as a missing level, and it misrepresents which
 * headings are the page's top-level sections.
 *
 * The headings are reused across sections by shared components, so the level
 * cannot simply be corrected at the source without also changing the ones that
 * sit below an <h2> correctly. Promoting only the run that precedes the first
 * <h2> fixes the outline wherever it appears and leaves the rest untouched.
 * Classes are not touched, so nothing moves on screen.
 */
function liftLeadingHeadings(html) {
  const H = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/g;
  const found = [...html.matchAll(H)];
  const firstH2 = found.findIndex((m) => m[1] === '2');
  // No <h2> at all, or one already in the lead: nothing to line up.
  if (firstH2 < 0) return html;
  const lead = found.slice(0, firstH2).filter((m) => Number(m[1]) > 2);
  if (!lead.length) return html;

  // Rebuild rather than replace in place: the same heading text can occur
  // again later in the page, where its level is already right.
  const cut = new Map(lead.map((m) => [m.index, m]));
  let out = '';
  let at = 0;
  for (const [index, m] of cut) {
    const to = Number(m[1]) - 1;
    out += html.slice(at, index) + `<h${to}${m[2]}>${m[3]}</h${to}>`;
    at = index + m[0].length;
  }
  return out + html.slice(at);
}

/* Void elements never open a scope, so they must not go on the tag stack. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Marks the hero for the entrance animation, at build time rather than in
 * site.js, and that timing is the whole point: the hero is already painted by
 * the time a deferred script runs, so a script that hid it to animate it in
 * would flash the text and then pull it away — and would leave the headline
 * invisible for good if site.js ever failed to load. The initial state has to
 * ship in the markup and the stylesheet, which means knowing here which block
 * is the hero.
 *
 * The hero is defined as the element wrapping the page's first <h1>: across
 * every page shape on this site that element is the content column — eyebrow,
 * headline, lede, CTA row — and its direct children are exactly the things
 * that should rise in sequence. `data-hero-section` goes on the enclosing
 * <section> so site.js can find the decorative layers to parallax without
 * hunting for them by class.
 *
 * A hero block that already carries `reveal` is left alone: it is animating on
 * scroll already, and stacking a load-time rise on a scroll reveal reads as a
 * stutter rather than as one movement.
 */
function tagHero(html) {
  const h1 = html.search(/<h1\b/);
  if (h1 < 0) return html;

  // Walk the markup before the <h1>, keeping a stack of tags still open. What
  // is left on top at the end is the <h1>'s parent; the <section> nearest the
  // top of the stack is the hero section.
  const stack = [];
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  TAG.lastIndex = 0;
  for (let m; (m = TAG.exec(html)) && m.index < h1; ) {
    const [full, closing, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (closing) {
      // Tolerate stray closers rather than corrupting the stack under them.
      const at = stack.map((t) => t.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else if (!VOID_TAGS.has(name) && !attrs.endsWith('/')) {
      stack.push({ name, index: m.index, length: full.length });
    }
  }

  const parent = stack[stack.length - 1];
  if (!parent) return html;

  const section = [...stack].reverse().find((t) => t.name === 'section');

  // Right to left: marking the parent first would move the section's offset.
  const marks = [
    [parent, 'data-hero'],
    ...(section && section !== parent ? [[section, 'data-hero-section']] : []),
  ]
    .filter(([tag]) => !/\breveal\b/.test(html.substr(tag.index, tag.length)))
    .sort((a, b) => b[0].index - a[0].index);

  let out = html;
  for (const [tag, attr] of marks) {
    const open = out.substr(tag.index, tag.length);
    if (open.includes(attr)) continue;
    out = out.slice(0, tag.index) + open.replace(/\s*\/?>$/, ` ${attr}>`) + out.slice(tag.index + tag.length);
  }
  return out;
}

/** Index just past the close tag matching the open tag at `start`. */
function closeIndexOf(html, start) {
  const name = /<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(start))[1].toLowerCase();
  const TAG = new RegExp(`<(/?)${name}\\b([^>]*)>`, 'gi');
  TAG.lastIndex = start;
  let depth = 0;
  for (let m; (m = TAG.exec(html)); ) {
    if (m[1]) {
      if (--depth === 0) return m.index + m[0].length;
    } else if (!m[2].endsWith('/')) {
      depth++;
    }
  }
  return html.length;
}

/**
 * The "… in detail →" affordance nudged its arrow by growing the flex `gap` on
 * hover. Gap is a layout property: every frame of that ease ran layout and
 * paint for the card, and the label itself shifted left as the row grew. Same
 * movement, done as a transform on the arrow alone — one compositor property,
 * no layout, and the text stays put.
 *
 * Done here rather than in the 30-odd places the pattern is written, because
 * it is the same pattern every time and a missed one is a hover that behaves
 * differently from its neighbours.
 */
function slideArrowOnHover(html) {
  const GAP = /<[a-zA-Z][^>]*\bclass="[^"]*\b(?:group-)?hover:gap-3\b[^"]*"[^>]*>/g;
  const hits = [...html.matchAll(GAP)];
  if (!hits.length) return html;

  let out = html;
  // Right to left: every edit below shifts the offsets of everything after it.
  for (const hit of hits.reverse()) {
    const end = closeIndexOf(out, hit.index);
    const inner = out.slice(hit.index + hit[0].length, end);

    // The arrow is the trailing icon. Anything else in there is the label.
    const icon = /<span\b[^>]*\bmaterial-symbols-outlined\b[^>]*>\s*(?:arrow_forward|arrow_right_alt|east)\s*<\/span>/.exec(inner);
    if (!icon) continue;

    const nudged = icon[0].replace(
      /\bclass="([^"]*)"/,
      'class="$1 transition-transform duration-300 ease-out group-hover:translate-x-1"'
    );

    // `group` on the element the gap class sat on, so the arrow reacts to the
    // whole affordance and not just to the pointer crossing the glyph. An
    // outer `group` card still triggers it too: group-hover matches any
    // hovered ancestor carrying the class, not only the nearest one.
    const opener = hit[0]
      .replace(/\s*\b(?:group-)?hover:gap-3\b/, '')
      .replace(/\bclass="/, 'class="group ');

    out =
      out.slice(0, hit.index) +
      opener +
      inner.slice(0, icon.index) +
      nudged +
      inner.slice(icon.index + icon[0].length) +
      out.slice(end);
  }
  return out;
}

function renderView(view, page) {
  const cls = [view.wrapperClass, 'w-full'].filter(Boolean).join(' ');
  return `<div class="${dedupe(cls)}">
${breadcrumbs(page.trail, view.dark)}
${view.inner}
${deepDive(page.nav, { dark: view.dark })}
${page.nav === 'home' ? beyondSoftwareSection() : ''}
${page.nav === 'home' ? partnersSection() : ''}
${page.credentials ? credentialsSection({ dark: view.dark, standalone: true }) : ''}
${faqSection(page.faqs, { dark: view.dark })}
${page.nav === 'home' ? '' : relatedSection(page.nav, { dark: view.dark })}
</div>`;
}

/* --------------------------------------------------------------- the shell */

function mobileItem(href, label, id, active) {
  const on = active === id;
  return `<a href="${href}" class="px-4 py-3 rounded-xl transition-colors ${
    on ? 'bg-brand/10 text-brand font-bold' : 'hover:bg-slate-50'
  }"${on ? ' aria-current="page"' : ''}>${label}</a>`;
}

/**
 * The primary nav, grouped into three lines of business. A group opens on
 * hover and on keyboard focus (`group-focus-within`), so the panel is reachable
 * without a pointer and without a line of JavaScript; on small screens the same
 * data renders as nested <details>, which is what makes it tap-to-open.
 *
 * `nav` on an item is the page's nav id, and is what lights the group up as
 * current. Items that are fragments of a page carry no nav id of their own.
 */
const NAV_GROUPS = [
  {
    id: 'technology',
    label: 'Technology',
    blurb: 'Campus software, classrooms, email and custom development.',
    items: [
      { nav: 'erp', href: '/erp/', label: 'Vybe ERP', blurb: 'School and college administration.', icon: 'dashboard_customize' },
      { nav: 'cms', href: '/cms/', label: 'Vybe CMS', blurb: '100% cashless cafeteria.', icon: 'fastfood' },
      { nav: 'classroom', href: '/smart-classroom/', label: 'Smart Classrooms', blurb: 'Logic flat panels, hybrid class rigs, boards.', icon: 'smart_display' },
      { nav: 'workspace', href: '/workspace/', label: 'Workspace &amp; Email', blurb: 'Google Workspace, Microsoft 365, Zoho.', icon: 'alternate_email' },
      { nav: 'it', href: '/it-solutions/', label: 'IT &amp; Cyber', blurb: 'Custom apps, security, managed IT.', icon: 'code_blocks' },
      ...(published('cloud')
        ? [{ nav: 'cloud', href: '/cloud/', label: 'Vybe Cloud', blurb: 'Servers, hosting and DDoS protection.', icon: 'cloud' }]
        : []),
    ],
  },
  {
    id: 'printing',
    label: 'Printing',
    blurb: 'Send us the artwork by email or WhatsApp; we print and deliver.',
    items: [
      { nav: 'printing', href: '/printing/', label: 'All printing services', blurb: 'What we print, and how to send artwork.', icon: 'print' },
      { nav: 'print-stationery', href: '/printing/stationery/', label: 'Paper &amp; stationery', blurb: 'Letterheads, bill books, brochures, flyers.', icon: 'description' },
      { nav: 'print-cards', href: '/printing/cards/', label: 'Business &amp; RFID cards', blurb: 'Visiting cards, ID cards, RFID and NFC cards.', icon: 'badge' },
      { nav: 'print-large-format', href: '/printing/banners-standees/', label: 'Banners &amp; standees', blurb: 'Flex banners, roll-ups, backdrops, signage.', icon: 'flag' },
      { href: '/printing/#quote', label: 'Send artwork for a quote', blurb: 'Email or WhatsApp us the file and quantity.', icon: 'forum' },
    ],
  },
  {
    id: 'legal',
    label: 'Legal',
    blurb: 'Registrations, licences and certification, at a flat professional fee.',
    items: [
      { nav: 'registrations', href: '/registrations/', label: 'All registrations', blurb: 'Every filing we take on, with the fees side by side.', icon: 'receipt_long' },
      { nav: 'reg-gst', href: '/registrations/gst/', label: 'GST registration', blurb: '₹199. No government fee on this one.', icon: 'account_balance' },
      { nav: 'reg-msme', href: '/registrations/msme/', label: 'MSME / Udyam', blurb: '₹199. No government fee on this one.', icon: 'storefront' },
      { nav: 'reg-fssai', href: '/registrations/fssai/', label: 'FSSAI licence', blurb: '₹299 + government charges.', icon: 'soup_kitchen' },
      { nav: 'reg-startup-india', href: '/registrations/startup-india/', label: 'DPIIT / Startup India', blurb: '₹999. Recognition itself is free.', icon: 'rocket_launch' },
      { nav: 'reg-iso', href: '/registrations/iso-certification/', label: 'ISO certification', blurb: 'From ₹1,599. Non-accredited; we say so upfront.', icon: 'workspace_premium' },
      { nav: 'reg-nsdc', href: '/registrations/nsdc-skill-india/', label: 'NSDC &amp; affiliation', blurb: 'Consulting on quote. We review; you file.', icon: 'school' },
      { nav: 'reg-dsc', href: '/registrations/digital-signature-certificate/', label: 'Digital signatures', blurb: 'Class 3 DSC from ₹1,500. Token ₹599.', icon: 'key' },
    ],
  },
  {
    id: 'audits',
    label: 'Audits',
    blurb: 'Hygiene, safety and compliance audits, with a Vybe certificate at the end. Not statutory audits, and we say so up front.',
    items: [
      { nav: 'audits', href: '/audits/', label: 'All audits', blurb: 'Every audit we run, across kitchens, campuses and offices.', icon: 'fact_check' },
      { nav: 'audit-kitchen', href: '/audits/kitchen-food-safety/', label: 'Kitchens &amp; food businesses', blurb: 'FSSAI Schedule 4 hygiene, layout, pest control records.', icon: 'soup_kitchen' },
      { nav: 'audit-institutions', href: '/audits/schools-institutions/', label: 'Schools &amp; institutions', blurb: 'Fire, canteen, POCSO, transport, security, SDG &amp; sustainability.', icon: 'school' },
      { nav: 'audit-workplace', href: '/audits/workplace-compliance/', label: 'Offices &amp; workplaces', blurb: 'POSH, software licensing, DPDP, labour law, office fire.', icon: 'corporate_fare' },
    ],
  },
  {
    id: 'manufacturing',
    label: 'Manufacturing',
    blurb: 'Cards we make, and hardware we supply. Quoted per order, with no prices or stock counts on the site.',
    items: [
      { nav: 'manufacturing', href: '/manufacturing/', label: 'All manufacturing &amp; supply', blurb: 'What we make and what we distribute.', icon: 'precision_manufacturing' },
      { nav: 'mfg-rfid', href: '/manufacturing/rfid-cards/', label: 'RFID &amp; NFC cards', blurb: 'MIFARE, DESFire, NTAG and UHF, encoded to your readers.', icon: 'contactless' },
      { nav: 'mfg-distribution', href: '/manufacturing/distribution/', label: 'IT hardware distribution', blurb: 'Dell, HP, Lenovo, Asus, Apple and Logitech.', icon: 'local_shipping' },
      { nav: 'mfg-iot', href: '/manufacturing/iot/', label: 'IoT solutions', blurb: 'Asset tracking, temperature, humidity and energy monitoring.', icon: 'sensors' },
      { href: '/manufacturing/distribution/#laptops', label: 'Laptops &amp; desktops', blurb: 'Contact us for stock, configuration and warranty.', icon: 'laptop_windows' },
    ],
  },
];

/** Which group, if any, owns the page currently being rendered. */
const groupOf = (active) => NAV_GROUPS.find((g) => g.items.some((i) => i.nav && i.nav === active));

function navbar(active) {
  const item = (href, label, id) =>
    `<a href="${href}" class="hover:text-brand transition-colors${active === id ? ' text-brand font-bold' : ''}"${active === id ? ' aria-current="page"' : ''}>${label}</a>`;

  const openGroup = groupOf(active);

  // One entry in a desktop dropdown: icon, label, one line of what it is.
  const panelItem = (i) =>
    `<li><a href="${i.href}" class="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 transition-colors${
      i.nav && i.nav === active ? ' bg-brand/5' : ''
    }"${i.nav && i.nav === active ? ' aria-current="page"' : ''}>
                                <span class="material-symbols-outlined text-brand text-[22px] shrink-0 mt-0.5" aria-hidden="true">${i.icon}</span>
                                <span class="min-w-0">
                                    <span class="block font-bold text-slate-900 leading-snug">${i.label}</span>
                                    <span class="block text-xs text-slate-500 leading-snug mt-0.5">${i.blurb}</span>
                                </span>
                            </a></li>`;

  const group = (g) => {
    const on = openGroup && openGroup.id === g.id;
    return `<div class="nav-group relative">
                    <button type="button" aria-haspopup="true" aria-expanded="false" aria-controls="nav-panel-${g.id}" class="flex items-center gap-1 hover:text-brand transition-colors${
                      on ? ' text-brand font-bold' : ''
                    }">
                        ${g.label}
                        <span class="material-symbols-outlined nav-caret text-[18px]" aria-hidden="true">expand_more</span>
                    </button>
                    <div class="nav-panel" id="nav-panel-${g.id}">
                        <div class="nav-panel-card rounded-2xl border border-slate-200 bg-white shadow-xl p-2">
                            <p class="px-3 pt-2 pb-3 text-xs text-slate-400 leading-snug">${g.blurb}</p>
                            <ul class="flex flex-col">
                                ${g.items.map(panelItem).join('\n                                ')}
                            </ul>
                        </div>
                    </div>
                </div>`;
  };

  // Same groups, tap-to-open, inside the mobile sheet.
  const mobileGroup = (g) => {
    const on = openGroup && openGroup.id === g.id;
    return `<details class="group/sub"${on ? ' open' : ''}>
                            <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center justify-between px-4 py-3 rounded-xl transition-colors ${
                              on ? 'text-brand font-bold' : 'hover:bg-slate-50'
                            }">
                                ${g.label}
                                <span class="material-symbols-outlined text-[20px] text-slate-400 transition-transform duration-200 group-open/sub:rotate-180" aria-hidden="true">expand_more</span>
                            </summary>
                            <div class="flex flex-col pl-3 pb-2 text-[15px]">
                                ${g.items
                                  .map((i) => mobileItem(i.href, i.label, i.nav, i.nav ? active : null))
                                  .join('\n                                ')}
                            </div>
                        </details>`;
  };

  return `<header class="fixed top-0 w-full z-50 transition-all duration-300 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm" id="navbar">
        <div class="max-w-7xl mx-auto px-6 h-[72px] flex justify-between items-center">
            <a href="/" class="flex items-center gap-3 group" aria-label="Vybe Technologies home">
                ${picture({ base: 'vybe-logo', alt: 'Vybe Technologies', cls: 'h-6 object-contain', h: 24, aspect: LOGO_ASPECT, eager: true })}
                <span class="hidden sm:flex flex-col justify-center border-l border-slate-200 pl-3">
                    <span class="text-[15px] font-bold font-display tracking-tight text-slate-900 leading-none">Technologies</span>
                    <span class="text-[7px] font-bold text-slate-400 uppercase tracking-[0.2em] leading-none mt-1 whitespace-nowrap">Smart. Simple. Affordable.</span>
                </span>
            </a>

            <nav class="primary-nav hidden lg:flex items-center gap-6 xl:gap-8 text-sm font-medium text-slate-600" aria-label="Primary">
                ${item('/', 'Home', 'home')}
                ${NAV_GROUPS.map(group).join('\n                ')}
                ${item('/contact/', 'Contact', 'contact')}
            </nav>

            <div class="flex items-center gap-2 md:gap-4">
                <a href="/contact/" class="bg-corporate hover:bg-slate-800 text-white px-4 md:px-5 py-2.5 rounded-full text-sm font-bold transition-all active:scale-95 whitespace-nowrap">
                    Talk to Sales
                </a>

                <details class="group lg:hidden relative" id="mobile-nav">
                    <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center justify-center w-12 h-12 rounded-full text-slate-700 hover:bg-slate-100 transition-colors" aria-label="Menu">
                        <span class="material-symbols-outlined text-[24px] group-open:hidden" aria-hidden="true">menu</span>
                        <span class="material-symbols-outlined text-[24px] hidden group-open:inline-block" aria-hidden="true">close</span>
                    </summary>
                    <nav class="absolute right-0 top-full mt-3 w-72 max-h-[75vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-xl p-2 flex flex-col text-base font-medium text-slate-700" aria-label="Mobile">
                        ${mobileItem('/', 'Home', 'home', active)}
                        ${NAV_GROUPS.map(mobileGroup).join('\n                        ')}
                        ${mobileItem('/contact/', 'Contact Us', 'contact', active)}
                    </nav>
                </details>
            </div>
        </div>

        <div class="scroll-progress" id="scroll-progress" aria-hidden="true"></div>
    </header>`;
}

function breadcrumbs(trail, dark) {
  // A one-item trail ("Home" on the home page) is noise, not navigation.
  if (trail.length < 2) return '';
  const muted = dark ? 'text-white/50' : 'text-slate-400';
  const hover = dark ? 'hover:text-white' : 'hover:text-brand';
  const items = trail
    .map((c, i) =>
      i === trail.length - 1
        ? `<li class="${dark ? 'text-white/90' : 'text-slate-700'} font-bold" aria-current="page">${esc(c.name)}</li>`
        : `<li><a href="${c.url}" class="${hover} transition-colors font-bold">${esc(c.name)}</a></li><li class="${muted}" aria-hidden="true">/</li>`
    )
    .join('');
  return `<nav aria-label="Breadcrumb" class="max-w-6xl mx-auto px-6 pt-8 relative z-10">
            <ol class="flex items-center gap-2 ${muted} text-xs uppercase tracking-widest">${items}</ol>
        </nav>`;
}

/** A 24x24 brand glyph linking out to one of our own profiles. */
function social(href, label, path) {
  return `<li><a href="${href}" rel="me noopener" target="_blank" aria-label="${esc(label)}" title="${esc(label)}"
                       class="flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-brand text-slate-300 hover:text-white transition-colors">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="${path}"/></svg>
                    </a></li>`;
}

function footer() {
  const link = (href, label) => `<li><a href="${href}" class="hover:text-brand transition-colors">${label}</a></li>`;
  return `<footer class="bg-corporate dark-section text-slate-300 py-16 px-6 mt-auto relative z-20 shrink-0 w-full">
        <div class="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 border-b border-slate-700 pb-12 mb-8">

            <div class="md:col-span-1">
                <div class="flex items-center gap-3 mb-6">
                    ${picture({ base: 'vybe-logo', alt: 'Vybe Technologies', cls: 'h-6 object-contain filter brightness-0 invert', h: 24, aspect: LOGO_ASPECT })}
                    <span class="text-lg font-bold font-display tracking-tight text-white leading-none">Technologies</span>
                </div>
                <p class="text-sm leading-relaxed mb-6">Unified software suites, custom development and secure infrastructure, for campuses and for businesses that need something built to fit.</p>

                <ul class="flex items-center gap-3">
                    ${social(
                      ORG.profiles[0],
                      'LinkedIn',
                      'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'
                    )}
                    ${social(
                      ORG.profiles[1],
                      'Instagram',
                      'M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 01-2.88 0 1.44 1.44 0 012.88 0z'
                    )}
                </ul>
            </div>

            <div>
                <h2 class="text-white font-bold mb-4 uppercase tracking-widest text-xs">Products &amp; Services</h2>
                <ul class="space-y-3 text-sm">
                    ${link('/erp/', 'Educational ERP')}
                    ${link('/cms/', 'Smart Cafeteria (CMS)')}
                    ${link('/smart-classroom/', 'Smart Classrooms')}
                    ${link('/workspace/', 'Workspace &amp; Email')}
                    ${link('/it-solutions/', 'Custom App Development')}
                    ${published('cloud') ? link('/cloud/', 'Cloud &amp; Infrastructure') : ''}
                    ${link('/printing/', 'Printing Services')}
                    ${link('/registrations/', 'Business Registrations')}
                    ${link('/audits/', 'Compliance Audits')}
                    ${link('/manufacturing/', 'Manufacturing &amp; Supply')}
                </ul>
            </div>

            <div>
                <h2 class="text-white font-bold mb-4 uppercase tracking-widest text-xs">Legal &amp; Support</h2>
                <ul class="space-y-3 text-sm">
                    ${link('/privacy-policy/', 'Privacy Policy')}
                    ${link('/terms/', 'Terms of Service')}
                    ${link('/refund-policy/', 'Cancellation &amp; Refund')}
                    ${link('/shipping-policy/', 'Shipping &amp; Exchange')}
                    ${link('/verify/', 'Verify a Certificate')}
                    ${link('/contact/', 'Contact Us')}
                </ul>
            </div>

            <div>
                <h2 class="text-white font-bold mb-4 uppercase tracking-widest text-xs">Our Offices</h2>
                <p class="text-[0.7rem] font-bold text-brand uppercase tracking-[0.2em] mb-2">Registered Office</p>
                <address class="text-sm not-italic leading-relaxed">
                    ${ORG.streetLines.join('<br>\n                    ')}<br>
                    ${ORG.locality}, ${ORG.region} - ${ORG.postal}
                </address>
                <p class="text-[0.7rem] font-bold text-brand uppercase tracking-[0.2em] mt-5 mb-2">${ORG.corporate.label}</p>
                <address class="text-sm not-italic leading-relaxed">
                    ${ORG.corporate.streetLines.join('<br>\n                    ')}<br>
                    ${ORG.corporate.locality}, ${ORG.corporate.region} - ${ORG.corporate.postal}
                </address>
                <address class="text-sm not-italic leading-relaxed mt-5">
                    <a href="${telHref(ORG.phone)}" class="hover:text-brand transition-colors block">${telText(ORG.phone)}</a>
                    <a href="${telHref(ORG.phoneSupport)}" class="hover:text-brand transition-colors block mt-1">${telText(ORG.phoneSupport)}</a>
                    <a href="${telHref(ORG.phoneOffice)}" class="hover:text-brand transition-colors block mt-1">${telText(ORG.phoneOffice)}</a>
                    <a href="mailto:${ORG.sales}" class="hover:text-brand transition-colors block mt-1">${ORG.sales}</a>
                </address>
                <p class="text-sm mt-4 text-slate-400">Mon&ndash;Sat, 9:00&nbsp;AM &ndash; 6:30&nbsp;PM IST</p>
            </div>
        </div>

        <!--
          The team's visiting cards. Deliberately quiet: they are of no use to a
          visitor reading the site, but each card is a real page that needs one
          internal link from somewhere indexable, and this is the least obtrusive
          place to put it.
        -->
        <div class="max-w-7xl mx-auto text-xs text-slate-500 mb-4">
            <p>Virtual Business Cards:
                ${TEAM.map(
                  (p) =>
                    `<a href="/${p.slug}/" class="hover:text-slate-300 transition-colors">${esc(p.name)}</a>`
                ).join('<span class="text-slate-700"> &middot; </span>')}
            </p>
        </div>

        <div class="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center text-xs text-slate-500">
            <p>&copy; ${new Date().getFullYear()} Vybe Technologies. All rights reserved.</p>
            <p class="mt-2 md:mt-0">Designed and operated from our headquarters in Bengaluru, India.</p>
        </div>
    </footer>`;
}

/* --------------------------------------------------------- structured data */

const organization = {
  '@type': 'Organization',
  '@id': `${SITE}/#organization`,
  name: ORG.name,
  alternateName: ORG.alsoKnownAs,
  legalName: ORG.legalName,
  url: `${SITE}/`,
  slogan: ORG.slogan,
  description:
    'Vybe Technologies is a Bengaluru software company. Its products include a cloud ERP for schools and colleges and a 100% cashless cafeteria management system, alongside custom software development, cybersecurity and cloud infrastructure for businesses in any sector.',
  // The full lockup, not the bare glyph: it spells the company name.
  logo: { '@type': 'ImageObject', '@id': `${SITE}/#logo`, url: `${SITE}/assets/vybe-lockup.png`, width: 892, height: 118, caption: ORG.name },
  image: { '@type': 'ImageObject', '@id': `${SITE}/#image`, url: `${SITE}/assets/og-image.png`, width: 1200, height: 630, caption: `${ORG.name} | ${ORG.slogan}` },
  // `address` is the registered one, singular on purpose: it is what the
  // company is registered at and what an invoice carries. The premises people
  // actually visit is #office, and `location` is where schema.org puts that.
  address: {
    '@type': 'PostalAddress',
    streetAddress: ORG.street,
    addressLocality: ORG.locality,
    addressRegion: ORG.region,
    postalCode: ORG.postal,
    addressCountry: ORG.country,
  },
  location: { '@id': `${SITE}/#office` },
  contactPoint: [
    { '@type': 'ContactPoint', telephone: ORG.phone, contactType: 'sales', email: ORG.sales, areaServed: 'IN', availableLanguage: ['en', 'hi', 'kn'] },
    { '@type': 'ContactPoint', telephone: ORG.phoneSupport, contactType: 'customer support', email: ORG.support, areaServed: 'IN', availableLanguage: ['en', 'hi', 'kn'] },
  ],
  areaServed: { '@type': 'Country', name: 'India' },
  sameAs: ORG.profiles,
  ...defined({
    foundingDate: ORG.foundingDate,
    founder: ORG.founder && {
      '@type': 'Person',
      // Where the founder also has a visiting card, this is the same @id that
      // /<slug>/ publishes. Two ids for one human would split the entity and
      // leave Google to guess which of them the name refers to.
      '@id': ORG.founder.card ? personId(ORG.founder.card) : `${SITE}/#founder`,
      name: ORG.founder.name,
      jobTitle: 'Founder',
      worksFor: { '@id': `${SITE}/#organization` },
      ...defined({ sameAs: ORG.founder.profile ? [ORG.founder.profile] : '' }),
    },
    // GSTIN is not a schema.org vocabulary term, so it is stated twice: taxID
    // is the property Google reads, PropertyValue names the scheme.
    taxID: ORG.gstin,
    identifier: ORG.gstin && { '@type': 'PropertyValue', propertyID: 'GSTIN', value: ORG.gstin },
  }),
  knowsAbout: [
    'Educational ERP', 'Campus management software', 'Cashless cafeteria systems',
    'Kitchen display systems', 'Custom software development', 'Cybersecurity', 'Cloud infrastructure',
    'Google Workspace', 'Microsoft 365', 'Zoho Mail', 'Student email', 'Single sign-on',
  ],
  // Vendor programme enrolments, which is what ProgramMembership describes.
  memberOf: [
    { '@type': 'ProgramMembership', programName: 'Ingram Micro Partner Program', hostingOrganization: { '@type': 'Organization', name: 'Ingram Micro', url: 'https://www.ingrammicro.com/' } },
    { '@type': 'ProgramMembership', programName: 'AWS Partner Network', hostingOrganization: { '@type': 'Organization', name: 'Amazon Web Services', url: 'https://aws.amazon.com/partners/' } },
    { '@type': 'ProgramMembership', programName: 'Google Cloud Partner Advantage', hostingOrganization: { '@type': 'Organization', name: 'Google Cloud', url: 'https://cloud.google.com/partners' } },
  ],
  award: 'Azure credits grant, Microsoft for Startups',
};

/**
 * The physical office, kept separate from #organization. Google reads hours,
 * phone and address off this type, not off a bare Organization, and matches it
 * against the Business Profile. So it carries the corporate office, where that
 * listing is pinned, and not the registered address on #organization.
 */
const localBusiness = {
  '@type': 'ProfessionalService',
  '@id': `${SITE}/#office`,
  name: ORG.name,
  alternateName: ORG.alsoKnownAs,
  parentOrganization: { '@id': `${SITE}/#organization` },
  url: `${SITE}/`,
  telephone: [ORG.phone, ORG.phoneSupport, ORG.phoneOffice],
  email: ORG.sales,
  image: { '@id': `${SITE}/#image` },
  logo: { '@id': `${SITE}/#logo` },
  address: {
    '@type': 'PostalAddress',
    streetAddress: ORG.corporate.street,
    addressLocality: ORG.corporate.locality,
    addressRegion: ORG.corporate.region,
    postalCode: ORG.corporate.postal,
    addressCountry: ORG.corporate.country,
  },
  geo: { '@type': 'GeoCoordinates', latitude: ORG.corporate.lat, longitude: ORG.corporate.lng },
  hasMap: `https://www.google.com/maps/place/?q=place_id:${ORG.corporate.placeId}`,
  areaServed: { '@type': 'Country', name: 'India' },
  sameAs: ORG.profiles,
  // Schema.org's band for mid-range. A band, not a quoted price.
  priceRange: '$$',
  openingHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ORG.openDays,
      opens: ORG.opens,
      closes: ORG.closes,
    },
  ],
};

const website = {
  '@type': 'WebSite',
  '@id': `${SITE}/#website`,
  url: `${SITE}/`,
  name: ORG.name,
  alternateName: ORG.alsoKnownAs,
  description: ORG.slogan,
  publisher: { '@id': `${SITE}/#organization` },
  inLanguage: LOC.tag,
};

function breadcrumbSchema(url, trail) {
  if (trail.length < 2) return null;
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: trail.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: i === trail.length - 1 ? url : SITE + c.url,
    })),
  };
}

function faqSchema(url, faqs) {
  if (!faqs || !faqs.length) return null;
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/* -------------------------------------------------------- related products */

const PRODUCTS = [
  { nav: 'erp', href: '/erp/', name: 'Vybe ERP', blurb: 'Cloud ERP for school and college administration.', icon: 'dashboard_customize' },
  { nav: 'cms', href: '/cms/', name: 'Vybe CMS', blurb: '100% cashless cafeteria ordering and payouts.', icon: 'fastfood' },
  { nav: 'classroom', href: '/smart-classroom/', name: 'Smart Classrooms', blurb: 'Logic interactive flat panels, online class rigs and writing boards.', icon: 'smart_display' },
  { nav: 'workspace', href: '/workspace/', name: 'Workspace & Email', blurb: 'Google Workspace, Microsoft 365, Zoho Mail and student email.', icon: 'alternate_email' },
  { nav: 'it', href: '/it-solutions/', name: 'IT & Cyber', blurb: 'Custom software, security and managed IT.', icon: 'code_blocks' },
  { nav: 'cloud', href: '/cloud/', name: 'Vybe Cloud', blurb: 'Scalable servers, hosting and DDoS protection.', icon: 'cloud' },
  { nav: 'printing', href: '/printing/', name: 'Printing', blurb: 'Everything from business cards to banners, standees and RFID cards.', icon: 'print' },
  { nav: 'registrations', href: '/registrations/', name: 'Business Registrations', blurb: 'GST, Udyam (MSME), FSSAI and Startup India recognition, from ₹199, plus ISO, NSDC consulting and digital signatures.', icon: 'receipt_long' },
  { nav: 'audits', href: '/audits/', name: 'Compliance Audits', blurb: 'Hygiene, fire, child safety, SDG, POSH and data protection audits for kitchens, campuses and offices. Report, certificate and badge.', icon: 'fact_check' },
  { nav: 'manufacturing', href: '/manufacturing/', name: 'Manufacturing & Supply', blurb: 'RFID and NFC cards made and encoded to your system, IoT asset and energy monitoring, plus Dell, HP, Lenovo, Asus and Apple hardware. Contact us for stock and pricing.', icon: 'precision_manufacturing' },
];

/**
 * The three lines of business that are not software. The home page hero comes
 * from src/app.html and only knows about the products, so without this they
 * would exist on the site but nowhere on its front door.
 */
function beyondSoftwareSection() {
  const card = (href, icon, title, blurb, points) =>
    `<a href="${href}" class="group flex flex-col h-full rounded-2xl border border-slate-200 bg-white p-8 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${icon}</span>
                        <h3 class="mt-4 text-2xl font-bold font-display tracking-tight text-slate-900">${esc(title)}</h3>
                        <p class="mt-3 text-slate-600 leading-relaxed">${blurb}</p>
                        <ul class="mt-6 pt-6 border-t border-slate-100 grid gap-2 text-sm text-slate-600">
                            ${points
                              .map(
                                (p) => `<li class="flex items-start gap-2">
                                <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                                <span>${esc(p)}</span>
                            </li>`
                              )
                              .join('\n                            ')}
                        </ul>
                        <span class="mt-auto pt-8 inline-flex items-center gap-2 text-sm font-bold text-brand">
                            Read more
                            <span class="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
                        </span>
                    </a>`;

  return `
        <section id="beyond-software" class="bg-surface-main border-t border-slate-200 py-20 md:py-28 px-6 relative z-10" aria-labelledby="beyond-software-heading">
            <div class="max-w-6xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">Separate services</p>
                <h2 id="beyond-software-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-slate-900">Printing, registrations, audits and supply.</h2>
                <p class="mt-5 text-lg leading-relaxed text-slate-600 max-w-3xl">These are not part of the campus platform and do not need it. Any business can buy them on their own, and most of our customers here never touch the software. All four start with a message rather than a meeting.</p>
                <div class="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                    ${card(
                      '/printing/',
                      'print',
                      'Printing',
                      'All types of printing, run to your artwork. Mail us the file or send it on WhatsApp with the size and quantity, and a quote comes back with a turnaround attached.',
                      [
                        'Business, ID, RFID and NFC cards',
                        'Letterheads, bill books, brochures and flyers',
                        'Flex banners, roll-up standees and signage',
                      ]
                    )}
                    ${card(
                      '/registrations/',
                      'receipt_long',
                      'Business registrations',
                      'GST, Udyam (MSME), FSSAI and Startup India recognition, prepared and filed for you at a flat professional fee. Government charges stay separate and are quoted before you commit.',
                      [
                        'GST and Udyam (MSME) registration: ₹199 each',
                        'FSSAI registration and licence: ₹299',
                        'DPIIT / Startup India recognition: ₹999',
                        'ISO certification, non-accredited: from ₹1,599',
                        'NSDC / Skill India and affiliation consulting: on quote',
                        'Class 3 digital signature certificates: from ₹1,500',
                      ]
                    )}
                    ${card(
                      '/audits/',
                      'fact_check',
                      'Compliance audits',
                      'We read your kitchen, campus or office against the standard that applies to it, write down what would be found, and certify what passes. Vybe audits and Vybe certificates, not statutory ones, and every page says so.',
                      [
                        'Kitchens: FSSAI Schedule 4 hygiene, layout, pest records',
                        'Campuses: fire, canteen, POCSO, buses, security, environment',
                        'Offices: POSH, software licences, DPDP, labour law, fire',
                        'Written report, graded findings, and a re-check',
                        'Scoped and quoted before anything is booked',
                      ]
                    )}
                    ${card(
                      '/manufacturing/',
                      'precision_manufacturing',
                      'Manufacturing &amp; supply',
                      'RFID and NFC cards made, encoded and personalised to your readers, and IT hardware supplied from Dell, HP, Lenovo, Asus, Apple and Logitech. No prices or stock counts here on purpose. Both move weekly, so ask and you get a current answer.',
                      [
                        'RFID and NFC cards, fobs, tags and wristbands',
                        'Desktops, all-in-ones, mini PCs, laptops and monitors',
                        'Keyboards, mice, headsets, adapters and spares',
                        'Imaged, domain-joined and asset-tagged before delivery',
                        'Contact us for stock, lead time, warranty and pricing',
                      ]
                    )}
                </div>
            </div>
        </section>`;
}

/** Cross-links the product pages, so none of them is a leaf off the home page. */
function relatedSection(currentNav, { dark = false } = {}) {
  const others = PRODUCTS.filter((p) => p.nav !== currentNav && published(p.nav));
  if (!others.length) return '';

  const bg = dark ? 'bg-slate-900 dark-section text-white' : 'bg-surface-main';
  const border = dark ? 'border-white/10' : 'border-slate-200';
  const card = dark ? 'bg-white/5 border-white/10 hover:border-white/30' : 'bg-white border-slate-200 hover:border-brand/40';
  const title = dark ? 'text-white' : 'text-slate-900';
  const body = dark ? 'text-slate-400' : 'text-slate-600';

  const cards = others
    .map(
      (p) => `<a href="${p.href}" class="group block rounded-2xl border ${card} p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${p.icon}</span>
                        <h3 class="mt-3 text-lg font-bold font-display tracking-tight ${title}">${esc(p.name)}</h3>
                        <p class="mt-1 text-sm ${body} leading-relaxed">${esc(p.blurb)}</p>
                    </a>`
    )
    .join('\n                    ');

  return `
        <section class="${bg} border-t ${border} py-20 px-6 relative z-10" aria-labelledby="more-from-vybe">
            <div class="max-w-6xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">More from Vybe</p>
                <h2 id="more-from-vybe" class="text-3xl md:text-4xl font-black font-display tracking-tight mb-10 ${title}">The rest of the stack.</h2>
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    ${cards}
                </div>
            </div>
        </section>`;
}

/* --------------------------------------------------------- clients/partners */

/**
 * Named organisations, grouped by relationship. `logo` names a pair of files in
 * assets/partners/ built by tools/gen-partner-logos.mjs, all on one canvas so a
 * single size class balances the row. The section is dark because these are the
 * light-on-dark marks their owners publish. Every `url` was checked live.
 */
const PARTNERS = [
  {
    label: 'Clients',
    // Covers both software and hardware: CAIAS runs the ERP, Vendx buys cards.
    note: 'Organisations running Vybe software, hardware and services today.',
    items: [
      {
        name: 'Christ Academy Institute for Advanced Studies',
        short: 'CAIAS',
        meta: 'Bengaluru, India',
        url: 'https://caias.in',
        logo: 'caias',
      },
      {
        name: 'Vendx Global Pvt Ltd',
        meta: 'Automated retail and vending, Bengaluru',
        url: 'https://vendxglobal.com',
        logo: 'vendx',
      },
    ],
  },
  /*
   * Held back until the MoU is signed. Uncomment to publish; the mark is
   * already built into assets/partners/.
   *
  {
    label: 'Trusted Partner',
    note: 'A long-running relationship that goes beyond a single engagement.',
    items: [
      {
        name: 'Milky Mist',
        meta: 'Milky Mist Dairy Food Limited',
        url: 'https://www.milkymist.com/',
        logo: 'milkymist',
      },
    ],
  },
  */
  {
    label: 'Brand Partners',
    note: 'Brands and distributors we are an authorised channel partner or dealer for, and deploy on campus.',
    items: [
      {
        name: 'JS Global Industries',
        meta: 'Authorised distributor, Logic interactive flat panels, Bengaluru',
        url: 'https://www.jsglobalindustries.co.in/',
        logo: 'jsglobal',
      },
    ],
  },
];

/** Every partner mark is rendered from this one canvas. See gen-partner-logos.mjs. */
const PARTNER_LOGO = { w: 960, h: 320 };

/** Flattened, for the WebPage `mentions` node. */
const PARTNER_ORGS = PARTNERS.flatMap((g) =>
  g.items.map((i) => ({
    '@type': 'Organization',
    name: i.name,
    ...(i.short ? { alternateName: i.short } : {}),
    url: i.url,
  }))
);

/* ------------------------------------------------------------- credentials */

/**
 * Vendor programmes we are enrolled in. Text rather than logos: AWS, Google,
 * Microsoft and Ingram Micro all restrict their marks and issue partners a
 * specific badge instead. Every `tier` is the entry-level wording on purpose.
 *
 * These are not accreditations, and the section no longer calls them that. An
 * accreditation is a third party attesting that we meet a standard; enrolling
 * in a reseller programme is a commercial relationship we opted into. `kind`
 * keeps the two apart, because Microsoft for Startups is a grant we received
 * rather than a partnership at all, and lumping it in with the other three
 * overstates it.
 */
const CREDENTIALS = [
  {
    name: 'Ingram Micro',
    tier: 'Distribution partner',
    kind: 'Reseller programme',
    note: 'Registered partner. How we source and license the hardware and software we resell.',
  },
  {
    name: 'AWS Partner Network',
    tier: 'Registered partner',
    kind: 'Vendor programme',
    note: 'Entry tier. Gives us Amazon Web Services support channels for the infrastructure we run.',
  },
  {
    name: 'Google Cloud Partner Advantage',
    tier: 'Programme member',
    kind: 'Vendor programme',
    note: 'Covers Google Cloud Platform and Google Workspace deployments we set up for customers.',
  },
  {
    name: 'Microsoft for Startups',
    tier: 'Azure credits grant',
    kind: 'Startup support',
    note: 'A credits grant awarded to us as a startup. Not a partnership, and not a Microsoft endorsement.',
  },
];

/** Partner-programme strip. Dark under the partner wall, light standalone. */
function credentialsSection({ dark = false, standalone = false } = {}) {
  const head = dark ? 'text-white' : 'text-slate-900';
  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  const label = dark ? 'text-slate-400' : 'text-slate-400';
  const card = dark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white';
  const icon = dark ? 'text-brand' : 'text-brand';

  const items = CREDENTIALS.map(
    (c) => `<li class="rounded-2xl border ${card} p-6">
                            <p class="text-[10px] font-bold uppercase tracking-[0.15em] ${label}">${esc(c.kind)}</p>
                            <h3 class="mt-3 text-base font-bold ${head} tracking-tight">${esc(c.name)}</h3>
                            <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] ${icon}">${esc(c.tier)}</p>
                            <p class="mt-3 text-sm ${muted} leading-relaxed">${esc(c.note)}</p>
                        </li>`
  ).join('\n                        ');

  const body = `<h2 id="partner-programmes-heading" class="text-xs font-bold uppercase tracking-[0.2em] ${label}">Partner programmes &amp; startup support</h2>
                    <p class="mt-2 text-sm ${muted}">Programmes we are enrolled in and a grant we received. None of these is an accreditation, a certification or a vendor endorsement of our work.</p>
                    <ul class="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        ${items}
                    </ul>`;

  if (!standalone) return body;

  return `
        <section id="partner-programmes" class="${
          dark ? 'bg-slate-950 dark-section' : 'bg-surface-main'
        } border-t ${dark ? 'border-white/10' : 'border-slate-200'} py-16 px-6 relative z-10" aria-labelledby="partner-programmes-heading">
            <div class="max-w-6xl mx-auto">
                ${body}
            </div>
        </section>`;
}

function partnersSection() {
  // The declared box is the canvas ratio, so the browser reserves the shape.
  const dh = 128;
  const dw = Math.round((dh * PARTNER_LOGO.w) / PARTNER_LOGO.h);

  const logo = (i) =>
    `<picture><source srcset="/assets/partners/${i.logo}.webp" type="image/webp"><img src="/assets/partners/${i.logo}.png" alt="${esc(
      i.name
    )}" class="h-24 md:h-32 w-auto object-contain opacity-90 group-hover:opacity-100 transition-opacity" width="${dw}" height="${dh}" loading="lazy" decoding="async"></picture>`;

  const groups = PARTNERS.map(
    (g) => `<div>
                        <h3 class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">${esc(g.label)}</h3>
                        <p class="mt-2 text-sm text-slate-400/80">${esc(g.note)}</p>
                        <ul class="mt-6 grid sm:grid-cols-2 gap-4">
                            ${g.items
                              .map(
                                (i) => `<li><a href="${i.url}" target="_blank" rel="noopener"
                                   class="group flex flex-col h-full rounded-2xl border border-white/10 bg-white/5 p-6 hover:border-white/25 hover:bg-white/10 hover:-translate-y-1 transition-all duration-300">
                                    ${logo(i)}
                                    <span class="mt-5 flex items-start gap-3 text-sm text-slate-400">
                                        <span class="min-w-0">${[i.short, i.meta].filter(Boolean).map(esc).join(' &middot; ')}</span>
                                        <span class="material-symbols-outlined text-[18px] text-slate-500 group-hover:text-white transition-colors ml-auto shrink-0" aria-hidden="true">open_in_new</span>
                                    </span>
                                </a></li>`
                              )
                              .join('\n                            ')}
                        </ul>
                    </div>`
  ).join('\n                    ');

  return `
        <section id="partners" class="bg-corporate py-20 md:py-28 px-6 relative z-10" aria-labelledby="partners-heading">
            <div class="max-w-5xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">Who we work with</p>
                <h2 id="partners-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-white">Clients and partners.</h2>
                <p class="mt-5 text-lg leading-relaxed text-slate-300 max-w-3xl">The organisations running our software and hardware, and the brands we go to market alongside.</p>
                <div class="mt-12 space-y-12">
                    ${groups}
                </div>
                <div class="mt-16 pt-12 border-t border-white/10">
                    ${credentialsSection({ dark: true })}
                </div>
            </div>
        </section>`;
}

/* ----------------------------------------------------------- long-form copy */

/**
 * Long-form copy for the product pages, which were built as sales decks and so
 * gave a search engine almost nothing to match a query against. Headings are
 * themselves plausible queries. Nothing here claims more than the page does.
 */
const DEEP_DIVE = {
  erp: {
    kicker: 'How it works',
    heading: 'One system, instead of nine spreadsheets.',
    lede: 'Most campuses do not lack software. They have too much of it. An admissions register in one place, a fee ledger in another, attendance in a third and academics in a fourth, none of which agree with each other by the end of a term. Vybe ERP is the single record those four things should have been sharing all along.',
    blocks: [
      {
        h: 'A student record that runs from admission to alumni',
        p: 'A student is created once, at enquiry, and that record carries forward from there. Admission details, fee history, attendance, marks and staff remarks all hang off the same profile instead of being re-keyed into a new sheet each academic year. When the office needs to tell a parent what was paid, what was missed or what was scored, it is one lookup rather than four.',
      },
      {
        h: 'Fees, collected online and reconciled automatically',
        p: 'Fees are collected online with an instant receipt generated at the moment of payment, so there is no gap between the money arriving and the ledger showing it. Outstanding balances are visible to the office and to the parent at the same time, and the WhatsApp bot pushes reminders directly rather than relying on a note in a diary that never reaches home. Staff payroll logs sit in the same system, which means the institution is not running its outgoings on a separate spreadsheet.',
      },
      {
        h: 'Attendance without a register',
        p: 'The ERP integrates directly with the biometric scanners already installed on campus, so attendance is captured at the door and written straight to the student record. No class register, no end-of-month data entry, no discrepancy between what the teacher wrote and what the office totalled. Parents get attendance alerts on WhatsApp the same day, which is the point at which a pattern of absence is still worth acting on.',
      },
      {
        h: 'The academic work the office actually dreads',
        p: 'Timetables, exam seating plans and report cards are generated rather than assembled by hand. Those are the three jobs that reliably consume a week of somebody’s term. AI assistance goes a step further and helps staff draft exam papers, score sheets and study summaries, so teachers are reviewing and correcting instead of starting from a blank page.',
      },
      {
        h: 'Three portals, three different views of the same truth',
        p: 'Students, parents and staff each get their own login. Parents see academics, attendance and fee status without having to phone the office; students see their own timetable and results; staff see the administrative side. Because all three read from one record, nobody is ever working from a stale copy, and the front desk stops answering questions the system could answer by itself.',
      },
      {
        h: 'Where the data lives',
        p: 'Everything runs on Microsoft Azure. Data is encrypted, automated encrypted backups are taken daily, and we target 99.9% uptime. For an institution this matters most on the two or three days a year when the whole parent body logs in at once, like a fee deadline or a results announcement, and the system simply has to hold.',
      },
      {
        h: 'Customisable, because no two campuses are run the same way',
        p: 'Grading schemes, fee structures, attendance rules and academic calendars differ between a CBSE school, a state-board college and an autonomous institution, and an ERP that insists on one model forces the campus to change its process to suit the software. Vybe ERP is fully customisable, and where a requirement falls outside the product entirely, our development team builds it as part of the deployment rather than logging it as a feature request.',
      },
    ],
  },

  it: {
    kicker: 'What we do',
    heading: 'Software built to fit, and secured once it exists.',
    lede: 'Off-the-shelf software asks you to run your business the way it was designed. That is a fair trade for accounting and a bad one for the process that actually makes you money. Vybe IT Solutions exists for the second case. And because anything we build ends up holding real data, the same team does the security work too.',
    blocks: [
      {
        h: 'What “custom” means in practice',
        p: 'It starts with scoping: what the process looks like today, where it breaks, who touches it and what a good outcome would actually change. That usually shrinks the brief, because a lot of requested features turn out to be workarounds for a problem the new system removes outright. Only then do we quote, so the number is attached to a defined scope rather than to a wish list.',
      },
      {
        h: 'The applications we build',
        p: 'Fast, responsive and scalable web and mobile applications on modern stacks: educational portals, business ERPs, retail point-of-sale systems, bespoke SaaS products and the internal tools that never justify a commercial licence but quietly run the company. Sector is not a constraint. We work with retail, hospitality, healthcare, gaming and professional services as readily as we do with campuses.',
      },
      {
        h: 'Penetration testing: finding it before somebody else does',
        p: 'A security test is only useful if it is adversarial. Ours is ethical hacking in the literal sense: probing an application the way an attacker would, identifying paths that are genuinely exploitable rather than listing theoretical weaknesses, and going deep enough to reach the logic flaws that automated scanners never see. What comes back is a report you can act on, ranked by what an attacker would reach first rather than sorted alphabetically.',
      },
      {
        h: 'ISO 27001 and the DPDP Act',
        p: 'India’s Digital Personal Data Protection Act changed the baseline for any organisation holding personal data: consent has to be specific and revocable, data has to be held for a stated purpose and no longer, and breaches have to be reported. For most businesses the gap is not intent but evidence. There is no record of what data is held, where it sits, or who can reach it. We provide guidance and implementation for both the DPDP Act and ISO 27001, which means doing the mapping and putting the controls in place, not just handing over a policy document.',
      },
      {
        h: 'Managed SecOps, for the hours nobody is watching',
        p: 'Most breaches are not discovered at 11 AM on a Tuesday. Managed SecOps is 24/7 proactive monitoring, incident response when something does fire, and server hardening so there is less to fire about in the first place. That last part means closing the default ports, the stale accounts and the unpatched services that account for the overwhelming majority of real-world compromises.',
      },
      {
        h: 'One team for the build and the defence',
        p: 'Handing a finished application to a separate security vendor means paying someone to learn a codebase from the outside. Because the same team builds and tests, security review happens against code we already understand, and the fixes come back as fixes rather than as findings for somebody else to interpret.',
      },
    ],
  },

  classroom: {
    kicker: 'What it takes',
    heading: 'A room that works on Monday morning.',
    lede: 'Smart classroom projects fail in a consistent and predictable way. The panels arrive, get mounted, work for a term, and then one room has a dead panel nobody has budget to fix, another has a camera pointing at a wall, and in the third the teacher has gone back to the whiteboard because the login never worked. Almost none of that is a hardware problem. It is what happens when a room is bought as a list of items rather than specified, installed and handed over as a working system.',
    blocks: [
      {
        h: 'The panel, and why it is not a projector',
        p: 'An interactive flat panel is the anchor of the room, and for nearly every classroom it is the right call over a projector. A projector needs the lights down, which fights the thing you actually want: students able to read and write while looking at the board. It needs a bulb, which is a recurring cost that arrives as a surprise and usually fails mid-lesson. It drifts out of alignment and dims so gradually that nobody notices until it is genuinely bad. A panel has no consumables, is readable in full daylight, and is touch-interactive from the moment it is switched on. The exception is the very large hall where no panel can be read from the back row, and there we will tell you to use a projector rather than sell you a 98-inch panel that still will not work.',
      },
      {
        h: 'Sizing, which is about the back row and nothing else',
        p: 'Panel size is set by the distance to the furthest student, not by the dimensions of the room and definitely not by the budget line. The working rule is that the back row should sit no further from the panel than roughly six times the panel’s height. For a typical 30-to-40-seat classroom that lands on 75 inches; smaller tutorial rooms take 65; wide or deep halls need 86 or 98. This is why we measure rooms before quoting instead of applying one size across a building. A block of classrooms is rarely uniform, and the room that gets the wrong panel is the room that stops being used.',
      },
      {
        h: 'The online class rig, item by item',
        p: 'Teaching the room and a remote cohort at the same time needs five things, and most rooms that claim to do hybrid are missing at least two. A classroom PC to run the session, so it does not depend on whichever laptop the teacher brought. A camera framed on the teaching area rather than bolted wherever there was a spare bracket. A second chat monitor, which is the component everyone skips and the one teachers notice immediately. Without it, reading a remote student’s question means minimising what you are teaching, so in practice remote students stop being answered at all. Lighting, because a camera does not need a bright room, it needs light on the teacher’s face, and a classroom lit from directly above gives you a silhouette. And room audio that picks up students asking questions, not just the person standing at the desk. The panel is the shared surface both audiences are looking at.',
      },
      {
        h: 'Power, the part that is always cut first',
        p: 'This is the least interesting section on this page and the one that decides whether the room is still working in two years. A panel and a PC on an unprotected supply in most of India will eventually meet a surge or an outage mid-period. So the install includes UPS backup sized to carry the panel and PC through a typical cut, surge protection, dedicated power points, and concealed cabling. The alternative is the arrangement you find in a depressing number of smart classrooms: a forty-thousand-rupee panel running off an extension board trailing across a doorway.',
      },
      {
        h: 'Logic interactive flat panels, through an authorised distributor',
        p: 'The panels we fit are Logic, supplied through JS Global Industries in Bengaluru, who are the authorised distributor for the range and who we work with as a partner and dealer. That matters for two unglamorous reasons. The first is warranty: a panel bought through the authorised channel is replaced without an argument, and one bought from whoever quoted lowest very often is not. The second is proximity. The distributor is across town rather than across the country, so a dead panel in the middle of March is a van and an afternoon rather than a freight consignment and a fortnight. Sizes run from 65 to 98 inches, decided by the depth of the room and the back row&rsquo;s eyesight rather than by the budget line.',
      },
      {
        h: 'Teaching content is yours to choose',
        p: 'A panel with nothing on it is a very expensive television, and the room is only worth what gets taught on it. We do not publish curriculum content of our own and we would rather say so than imply otherwise. What we do is make sure whatever you have licensed actually runs on the room we built: the panel and the classroom PC specified against that software rather than against a brochure, accounts provisioned through your <a class="text-brand font-bold" href="/workspace/">Google Workspace or Microsoft 365 tenant</a>, and where the institution runs <a class="text-brand font-bold" href="/erp/">Vybe ERP</a>, the room sitting inside the same timetable and attendance rather than beside it. If you have not settled on a content provider yet, we will tell you what schools around you are using and what they complain about.',
      },
      {
        h: 'Boards, because the panel is not the whole wall',
        p: 'Almost every teacher wants a writing surface beside the panel. Working through a derivation or a correction is faster on a board than on a touchscreen, and the panel should be showing the material while that happens rather than being cleared for it. JS Global Industries, the same partner the panels come through, manufacture classroom display and writing boards here in Bengaluru, so the board and the panel are specified together and the wall gets laid out once instead of being retrofitted after somebody notices.',
      },
      {
        h: 'Handover, and the reason rooms go unused',
        p: 'The single best predictor of whether a smart classroom is still in daily use a year later is whether the teachers were trained on it properly, by someone patient, on the actual hardware, before they had to use it in front of thirty students. Nobody wants to be visibly incompetent in front of a class, so a teacher who is unsure will quietly avoid the panel and it will sit dark. Installation therefore includes hands-on sessions for the staff who have to teach with it, and after handover there is annual maintenance and support, so a failed panel is a phone call rather than a procurement exercise that takes a term.',
      },
      {
        h: 'Where this joins the rest of the campus',
        p: 'A classroom is not a standalone purchase for an institution that already runs software. Where the campus is on Vybe ERP, the room sits inside the same system for timetables, attendance and academics instead of being a parallel setup with its own logins and its own spreadsheet. And the institutional student accounts we set up as part of workspace and email are exactly what make the online side safe: classes admit your own students automatically, a leaked link does not grant entry, and everyone in the session is identifiable. Bought separately, these are three projects. Bought together, they are one room that works.',
      },
    ],
  },

  workspace: {
    kicker: 'What is involved',
    heading: 'Company email is the easy part.',
    lede: 'Almost anyone can point a domain at Google Workspace and create a dozen mailboxes. What takes longer, and is what actually goes wrong later, is the part underneath: who can reach what, what happens when somebody leaves, whether your mail is being delivered or quietly spam-foldered, whether a stranger can walk into your online class, and whether your staff can tell a real invoice from a forged one. That whole picture is the job.',
    blocks: [
      {
        h: 'Google Workspace, Microsoft 365 or Zoho Mail: how to choose',
        p: 'If your team already lives in Excel, uses Teams, or you have Windows laptops you want centrally managed, Microsoft 365 for Business is usually the shorter path, since Entra ID and Intune come with it and you will want both eventually. If your people work mostly in a browser, collaborate heavily on documents at the same time, and nobody is attached to desktop Office, Google Workspace is simpler to run and simpler to explain to staff. Zoho Mail is the one worth taking seriously on cost: it is materially cheaper per user than either, it does the mail part properly, and for an organisation whose real requirement is professional addresses on its own domain rather than a full collaboration suite, it is often the honest recommendation. It is also an Indian company with Indian data centres, which some organisations prefer on data-residency grounds under the DPDP Act. We will tell you which way we would go for your situation and why, including when the answer is that any of the three would do and you should simply take the cheapest.',
      },
      {
        h: 'Student email, and why a campus should not run on personal Gmail',
        p: 'Most institutions arrive at this having quietly standardised on whatever students already had: a personal Gmail address, often created in a hurry, frequently shared with a sibling, occasionally something a prospective employer would rather not see on a CV. The costs are real even when they are invisible. Nobody can tell whether a submission genuinely came from the student who owns it, staff cannot circulate anything sensitive with confidence, there is no way to reach the cohort reliably, and when a student leaves there is no account to close because the institution never owned one. Institution-owned student addresses fix all of that at once, and both Google Workspace for Education and Microsoft 365 Education have tiers that cost qualifying institutions nothing or very little for the core accounts, which usually surprises people, and is the single most common reason this gets postponed for years longer than it needed to be.',
      },
      {
        h: 'Provisioning a whole cohort without typing it in twice',
        p: 'Creating four hundred accounts by hand is how this becomes a fortnight of somebody’s life. We provision in bulk from the roll you already have, and where the institution runs Vybe ERP, from the student records that are already in it, so the address is created at admission rather than as a separate administrative errand months later. Accounts are organised by year and by department, which is what makes it possible to mail one batch or restrict a resource to one course without maintaining a distribution list by hand. Each academic year the structure rolls forward: incoming students provisioned, existing students moved up, and graduating students moved to whatever the institution’s policy actually is, whether that is an alumni address, a period of read-only access, or a clean suspension. The point of writing that policy down is that it stops being a decision somebody has to make individually, four hundred times.',
      },
      {
        h: 'Online classes that do not get crashed',
        p: 'Remote and hybrid teaching has a specific failure mode that has nothing to do with bandwidth: someone who is not in the class gets hold of the link and joins to disrupt it. The link travels, because it only takes one student to forward it, and once an uninvited participant is in a session with forty teenagers the lesson is effectively over. Admitting people manually is not a fix either, because it makes the teacher a doorman for the first ten minutes of every period. Institutional student accounts solve it properly. Meetings are configured so that signed-in members of your own domain are admitted automatically from the lobby, while anyone outside it is held there and never reaches the room. The leaked link stops being a way in, because possession of the link is no longer what grants entry.',
      },
      {
        h: 'Accountability, which is the part that actually changes behaviour',
        p: 'The other half of the problem is anonymity. A participant who joined as "Guest" or under an invented name can disrupt a session and simply rejoin under a different one, and there is nothing for the institution to act on afterwards. When every participant is in the room under a named, institution-owned account, that stops. Each join is attributable, the attendance record is a genuine record rather than a list of nicknames, and if somebody does cause a problem the follow-up is a straightforward disciplinary matter instead of an investigation. In practice the deterrent does most of the work: the incidents largely stop once students understand the room knows exactly who they are. We also set up recording and retention in line with whatever the institution has decided about consent and storage, rather than leaving each teacher to improvise it.',
      },
      {
        h: 'Email on your own domain, set up so it gets delivered',
        p: 'Mail from a new domain is treated with suspicion by default, and the fix is three DNS records that are widely skipped. SPF states which servers may send as you. DKIM signs each message so it cannot be altered in transit. DMARC ties the two together and tells receiving servers what to do when a message fails. Crucially, it also sends you reports on who is attempting to send as your domain. We configure all three and move DMARC to enforcement once the reports are clean, rather than leaving it permanently on the monitoring setting that protects nobody.',
      },
      {
        h: 'Migrating without losing the last six years of mail',
        p: 'The mail history is usually the thing people are most nervous about, and reasonably so: for a lot of businesses the mailbox is the filing system. We migrate existing mail, contacts and calendars across with folder structure intact, run the new tenant in parallel while DNS propagates, and cut over once delivery is confirmed working in both directions. Shared mailboxes such as accounts@ or info@ get set up as shared mailboxes rather than as a personal account four people share a password to, which is where most of the access problems start.',
      },
      {
        h: 'Single sign-on: one identity, everywhere',
        p: 'Single sign-on means your staff have one account, protected by one strong authentication step, that gets them into Workspace or Microsoft 365 and into the other SaaS tools you pay for (your ERP, your accounting package, your CRM) over SAML or OIDC. The benefit people notice is fewer passwords. The benefit that matters is that access is now centralised: multi-factor authentication is enforced in one place, conditional access rules can require a managed device or block sign-ins from countries you do not operate in, and when somebody leaves, disabling one account closes every door at once instead of leaving a forgotten login live for two years.',
      },
      {
        h: 'Joiners, leavers and the accounts nobody closed',
        p: 'Most organisations have a decent process for creating accounts and no process at all for removing them, because creating one is somebody’s urgent problem and removing one is nobody’s. We set up the offboarding side properly: access revoked on the last day, the mailbox converted or delegated to a manager so the work does not vanish with the person, and company data removed from personal devices. Device enrolment through Intune or Google endpoint management makes remote wipe possible for the laptop that gets lost or the phone that does not come back.',
      },
      {
        h: 'Phishing simulation, run against your own staff',
        p: 'A simulated phishing campaign sends your people a realistic but harmless lure and records who clicks, who submits credentials and who reports it. It is done with the organisation’s authorisation and it is not a trap laid for individuals. The useful output is the pattern, broken down by department and by role, showing where the real exposure sits. Finance and reception are usually the answer, because they are the two functions whose job is to open attachments from strangers. Campaigns are run on a schedule rather than once, because the number that matters is whether the click rate falls over the year, not what it was in January.',
      },
      {
        h: 'Training that is worth an hour of your staff’s time',
        p: 'Security awareness training fails when it is a compliance video nobody watches. Ours is short, in-person or live remote, and built around the attacks that actually reach Indian businesses: business email compromise, where an attacker impersonates a director and asks for an urgent transfer; invoice fraud, where a genuine supplier’s bank details are silently changed; credential harvesting pages that look exactly like your own login screen. We also cover the part most training skips, which is what to do in the ten minutes after somebody has clicked, because the difference between an incident and a breach is usually how fast it was reported, and staff who expect to be blamed do not report.',
      },
      {
        h: 'Why this sits next to our security work',
        p: 'Workspace setup is often treated as an IT admin errand and security as a separate, later purchase. In practice the identity layer is the security perimeter for most small and mid-size organisations: the overwhelming majority of intrusions begin with a valid credential rather than an exploit. The same team that configures your tenant also does our penetration testing and managed SecOps, so the configuration is built by people who spend the rest of their week attacking configurations.',
      },
    ],
  },

  cloud: {
    kicker: 'The infrastructure',
    heading: 'Servers sized for the day it matters.',
    lede: 'Infrastructure is easy to get wrong in both directions. Over-provision and you pay every month for capacity you touch twice a year. Under-provision and the one day that actually counts, a results announcement or a launch or a sale, is the day it falls over. Vybe Cloud is about landing in between.',
    blocks: [
      {
        h: 'Private cloud on AWS and Azure',
        p: 'We design and deploy Virtual Private Clouds on AWS and Microsoft Azure: an isolated network you control, with your own subnets, routing and security groups rather than a shared box with neighbours. The architecture auto-scales, so capacity follows demand up during a traffic spike and back down again afterwards. That is the difference between paying for a peak and paying for a year of peaks. The uptime SLA is 99.99%. We are a registered partner in the AWS Partner Network and a member of the Google Cloud Partner Advantage programme, and we hold an Azure credits grant from Microsoft for Startups, which matters less as a badge than as the reason we can go to the vendor directly when something needs escalating.',
      },
      {
        h: 'AWS or Azure, and why it is usually not a close call',
        p: 'The honest answer is that for most workloads either will do, and the deciding factors are rarely technical. If the organisation already runs on Microsoft 365 and Entra ID, Azure inherits the identity layer and saves a whole category of integration work. If the requirement leans on a specific managed service, breadth of region coverage or an existing reserved-capacity commitment, AWS often wins on that one detail. We pick per project rather than per vendor relationship, and we will say so plainly when the two are genuinely equivalent and the choice comes down to what your team already knows how to operate.',
      },
      {
        h: 'Paying for what you use, not for what you might',
        p: 'Cloud bills grow quietly. The usual causes are dull and consistent: instances sized for a launch that never scaled back, storage snapshots nobody ever expires, environments spun up for a test in March and still running in December, and data egress that only becomes visible on the invoice. Auto-scaling handles the first of those by design; the rest need someone to look. We size to observed load rather than to the number in the original brief, and set the environment up so that what you are paying for is legible on a dashboard instead of being reconstructed from a PDF at the end of the quarter.',
      },
      {
        h: 'Game servers, where latency is the whole product',
        p: 'Multiplayer hosting is a different problem from web hosting. Throughput barely matters and tail latency matters enormously, because a single frame of stutter is the thing a player remembers. We provision bare-metal servers on high clock-speed hardware, since game loops are largely single-threaded and clock speed beats core count, and we target under 20ms ping with zero packet loss. Bare metal also removes the noisy-neighbour jitter that makes virtualised game hosting so unpredictable.',
      },
      {
        h: 'DDoS protection that stays on',
        p: 'A volumetric attack does not try to break your application; it tries to fill the pipe in front of it. Mitigation has to happen upstream, before the traffic reaches your servers at all. We run active traffic scrubbing that separates attack traffic from real users and absorbs the flood, so the service stays reachable for the people you actually want on it.',
      },
      {
        h: 'Migration, without the weekend everybody dreads',
        p: 'Most migrations fail on the things that were never written down: a cron job on an old box, a hard-coded IP address, a certificate somebody has been renewing by hand for six years. We audit what is actually running before anything moves, stand the new environment up alongside the old one, and cut over only once it has been proven. The rollback path stays open throughout.',
      },
      {
        h: 'What running it looks like afterwards',
        p: 'Provisioning is the short part; the long part is the years after. Backups have to be taken and actually restored to be worth anything, patches have to land, and somebody has to be watching when a disk fills at 3 AM. Our cloud work runs alongside Managed SecOps and server hardening, so the environment is monitored and maintained rather than handed over and forgotten.',
      },
    ],
  },
};

function deepDive(nav, { dark = false } = {}) {
  const d = DEEP_DIVE[nav];
  if (!d) return '';

  const bg = dark ? 'bg-slate-950 dark-section text-white' : 'bg-white';
  const border = dark ? 'border-white/10' : 'border-slate-200';
  const head = dark ? 'text-white' : 'text-slate-900';
  const body = dark ? 'text-slate-300' : 'text-slate-600';
  const lede = dark ? 'text-slate-200' : 'text-slate-700';
  const rule = dark ? 'border-white/10' : 'border-slate-100';

  const blocks = d.blocks
    .map(
      (b) => `<div class="border-t ${rule} pt-8">
                        <h3 class="text-xl md:text-2xl font-bold font-display tracking-tight ${head}">${esc(b.h)}</h3>
                        <p class="mt-3 leading-relaxed ${body}">${b.p}</p>
                    </div>`
    )
    .join('\n                    ');

  return `
        <section id="overview" class="${bg} border-t ${border} py-20 md:py-28 px-6 relative z-10" aria-labelledby="overview-heading">
            <div class="max-w-4xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">${esc(d.kicker)}</p>
                <h2 id="overview-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight ${head}">${esc(d.heading)}</h2>
                <p class="mt-5 text-lg leading-relaxed ${lede} max-w-3xl">${d.lede}</p>
                <div class="mt-12 space-y-10">
                    ${blocks}
                </div>
            </div>
        </section>`;
}

/* ------------------------------------------------------------ FAQ rendering */

function faqSection(faqs, { dark = false } = {}) {
  if (!faqs || !faqs.length) return '';
  const bg = dark ? 'bg-slate-900 dark-section text-white' : 'bg-white';
  const border = dark ? 'border-white/10' : 'border-slate-200';
  const q = dark ? 'text-white' : 'text-slate-900';
  const a = dark ? 'text-slate-300' : 'text-slate-600';
  const items = faqs
    .map(
      (f) => `<details class="group border-b ${border} py-6">
                    <summary class="flex items-start justify-between gap-6 cursor-pointer list-none">
                        <h3 class="text-lg md:text-xl font-bold font-display tracking-tight ${q}">${esc(f.q)}</h3>
                        <span class="material-symbols-outlined text-[24px] text-brand shrink-0 transition-transform duration-300 group-open:rotate-45" aria-hidden="true">add</span>
                    </summary>
                    <p class="${a} leading-relaxed mt-4 max-w-3xl">${f.a}</p>
                </details>`
    )
    .join('\n                ');

  return `
        <section id="faq" class="${bg} border-t ${border} py-20 md:py-28 px-6 relative z-10">
            <div class="max-w-4xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">FAQ</p>
                <h2 class="text-3xl md:text-4xl font-black font-display tracking-tight mb-10 ${q}">Questions, answered.</h2>
                ${items}
            </div>
        </section>`;
}

/* ------------------------------------------------------------------- shell */

function shell(page) {
  const url = SITE + page.url;
  const graph = [organization, localBusiness, website];

  graph.push({
    // ContactPage / AboutPage where the page is a named subtype, else WebPage.
    '@type': page.pageType || 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: page.title,
    description: page.description,
    isPartOf: { '@id': `${SITE}/#website` },
    about: { '@id': `${SITE}/#organization` },
    primaryImageOfPage: { '@id': `${SITE}/#image` },
    inLanguage: LOC.tag,
    // Tied to ORG.foundingDate: a page cannot predate the company, and the
    // two sit in the same graph where Google reads them against each other.
    datePublished: ORG.foundingDate,
    dateModified: page.lastmod || BUILD_DATE,
    ...(page.trail.length > 1 ? { breadcrumb: { '@id': `${url}#breadcrumb` } } : {}),
    // Named third-party organisations on the page. `mentions` claims only
    // that the page refers to them, not a relationship.
    ...(page.mentions ? { mentions: page.mentions } : {}),
  });

  const bc = breadcrumbSchema(url, page.trail);
  if (bc) graph.push(bc);
  const fq = faqSchema(url, page.faqs);
  if (fq) graph.push(fq);
  if (page.schema) graph.push(...[].concat(page.schema(url)));

  const bodyClass = page.bodyClass || 'text-slate-900 selection:bg-brand/10 selection:text-brand flex flex-col min-h-screen relative z-0';

  return `<!DOCTYPE html>
<html lang="${LOC.tag}" class="scroll-smooth">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
${page.noindex ? '' : `<link rel="canonical" href="${url}">\n`}<meta name="robots" content="${page.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">

<link rel="preload" href="/assets/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/plus-jakarta-sans-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/material-symbols-subset.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">

<!-- Icons & PWA -->
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/assets/icon-512.png" type="image/png" sizes="512x512">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#e31837">
<meta name="apple-mobile-web-app-title" content="Vybe">

<!-- Open Graph -->
<meta property="og:type" content="${page.ogType || 'website'}">
<meta property="og:site_name" content="${ORG.name}">
<meta property="og:locale" content="${LOC.og}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(page.ogTitle || page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:image" content="${SITE}/assets/og-image.png">
<meta property="og:image:secure_url" content="${SITE}/assets/og-image.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Vybe Technologies | Smart. Simple. Affordable.">

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.ogTitle || page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${SITE}/assets/og-image.png">
<meta name="twitter:image:alt" content="Vybe Technologies | Smart. Simple. Affordable.">

<meta name="author" content="${ORG.name}">
<meta name="publisher" content="${ORG.name}">
<meta name="geo.region" content="IN-KA">
<meta name="geo.placename" content="Bengaluru">
<meta name="format-detection" content="telephone=no">

${ld({ '@context': 'https://schema.org', '@graph': graph })}
</head>
<body class="${bodyClass}">

<a href="#main" class="skip-link">Skip to content</a>

${navbar(page.nav)}

<main id="main" class="flex-grow pt-[72px] page-enter">
${tagHero(slideArrowOnHover(page.body))}
</main>

${footer()}

<!-- GSAP drives the scroll work in site.js: the staggered section reveals and
     the scrubbed parallax. Vendored first-party (the CSP is script-src 'self')
     and deferred, so neither file blocks the parse or the first paint, and
     both are in place before site.js runs — defer keeps document order. -->
<script src="/assets/vendor/gsap.min.js" defer></script>
<script src="/assets/vendor/scroll-trigger.min.js" defer></script>
<script src="/assets/site.js" defer></script>
${(page.scripts || []).map((s) => `<script src="${s}" defer></script>`).join('\n')}
</body>
</html>
`;
}

/* ============================================================== page content */

const src = read('src/app.html');

const home = transformView(extractView(src, 'home-view'));
const erp = transformView(extractView(src, 'erp-view'));
const cms = transformView(extractView(src, 'cms-view'), { dark: false });
const it = transformView(extractView(src, 'it-view'), { dark: true });
const cloud = transformView(extractView(src, 'cloud-view'));
const workspace = transformView(extractView(src, 'workspace-view'));
const classroom = transformView(extractView(src, 'classroom-view'), { dark: true });

const CRUMB_HOME = { name: 'Home', url: '/' };

const PAGES = [
  {
    url: '/',
    file: 'index.html',
    nav: 'home',
    title: 'Vybe Technologies | Campus ERP, Cashless Cafeteria & Cloud',
    ogTitle: 'Vybe Technologies | Smart. Simple. Affordable.',
    description:
      'Campus software for schools, colleges and corporate campuses in India: cloud ERP, a 100% cashless cafeteria, smart classrooms, campus IT and cybersecurity.',
    trail: [CRUMB_HOME],
    priority: '1.0',
    view: home,
    mentions: PARTNER_ORGS,
    faqs: [
      {
        q: 'What does Vybe Technologies do?',
        a: 'Vybe Technologies is a software company based in Bengaluru. Our flagship products are <strong>Vybe ERP</strong> for school and college administration and <strong>Vybe CMS</strong> for 100% cashless cafeterias. We set up <strong>smart classrooms</strong> (interactive flat panels, online and hybrid class systems and writing boards) and handle <strong>workspace and email setup</strong>: Google Workspace, Microsoft 365 and Zoho Mail, staff and student accounts, single sign-on and secure online classes. Alongside those, <strong>Vybe IT Solutions</strong> takes on custom software work for businesses of any size or sector: web and mobile apps, business ERPs, retail POS, bespoke SaaS and internal tools, together with cybersecurity and managed IT. If your requirement does not match a product off our shelf, we build it to fit.',
      },
      {
        q: 'Who does Vybe work with?',
        a: 'The ERP and cafeteria products are built for schools, colleges and corporate campuses: student profiles, fees, payroll, biometric attendance and academics on one side, and a cafeteria system engineered to hold up during peak rush hours on the other. Our custom development, cybersecurity and cloud teams work well beyond education, with businesses in retail, hospitality, healthcare, gaming and professional services.',
      },
      {
        q: 'Where is Vybe Technologies located?',
        a: `We are based in Bengaluru, Karnataka. Our registered office is at ${esc(ORG.street)}, ${ORG.postal}, and our corporate office is at ${esc(
          ORG.corporate.street
        )}, ${ORG.corporate.postal}. You can reach sales on ${telLink(ORG.phone)} or <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a>.`,
      },
      {
        q: 'Can Vybe build software that is specific to our campus?',
        a: 'Yes. The ERP is fully customisable, and Vybe IT Solutions builds bespoke web and mobile applications (educational portals, business ERPs, retail POS and custom SaaS) to an institution\u2019s exact operational requirements.',
      },
      {
        q: 'Do you set up smart classrooms?',
        a: 'Yes, <a href="/smart-classroom/">smart classroom setup</a> end to end: smart interactive flat panels sized to the room, online and hybrid class systems (classroom PC, camera, chat monitor, lighting and audio), UPS-backed power and cabling, and teacher training at handover. The panels are Logic, supplied through <strong>JS Global Industries</strong> in Bengaluru, the authorised distributor for the range, and a partner and dealer we work with for classroom boards as well.',
      },
      {
        q: 'Which vendor programmes is Vybe part of?',
        a: 'Four, and they are different kinds of thing. <strong>Ingram Micro</strong>: registered distribution partner, which is how we source and license the hardware and software we resell. <strong>AWS Partner Network</strong>: registered partner at the entry tier. <strong>Google Cloud Partner Advantage</strong>: programme member, covering Google Cloud Platform and Google Workspace deployments. <strong>Microsoft for Startups</strong>: a grant of Azure credits awarded to us as a startup, not a partnership. None of the four is an accreditation, a certification, or any vendor’s endorsement of our work.',
      },
      {
        q: 'How do we get a quote?',
        a: `Email <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> or call ${telLink(ORG.phone)} with your campus size and the modules you need, and we will put together a proposal.`,
      },
    ],
    schema: (url) => ({
      '@type': 'ItemList',
      '@id': `${url}#services`,
      name: 'Vybe Technologies products and services',
      // Numbered after the UNPUBLISHED filter, so the positions have no gaps.
      itemListElement: [
        { nav: 'erp', name: 'Vybe ERP', url: `${SITE}/erp/`, description: 'Cloud-based Educational Resource Planning suite for schools and colleges.' },
        { nav: 'cms', name: 'Vybe CMS', url: `${SITE}/cms/`, description: '100% cashless cafeteria management system with QR pickup and split payouts.' },
        { nav: 'classroom', name: 'Smart Classrooms', url: `${SITE}/smart-classroom/`, description: 'Smart classroom setup: Logic interactive flat panels supplied through an authorised distributor, online and hybrid class systems, writing boards and UPS-backed power.' },
        { nav: 'workspace', name: 'Workspace & Email', url: `${SITE}/workspace/`, description: 'Google Workspace, Microsoft 365 and Zoho Mail setup, staff and student email, single sign-on, secure online classes and phishing training.' },
        { nav: 'it', name: 'Vybe IT Solutions', url: `${SITE}/it-solutions/`, description: 'Custom app development, penetration testing and managed security operations.' },
        { nav: 'cloud', name: 'Vybe Cloud', url: `${SITE}/cloud/`, description: 'Scalable cloud architecture, game servers and DDoS protection.' },
        { nav: 'printing', name: 'Printing Services', url: `${SITE}/printing/`, description: 'Commercial printing: business and RFID cards, letterheads, bill books, brochures, flex banners, roll-up standees and signage, printed to your artwork.' },
        { nav: 'registrations', name: 'Business Registrations', url: `${SITE}/registrations/`, description: 'GST, Udyam (MSME) and FSSAI registrations and DPIIT / Startup India recognition, prepared and filed at a flat professional fee with government charges separate, plus non-accredited ISO certification issued by Vybe, consulting on NSDC / Skill India and affiliation applications, and Class 3 digital signature certificates as a registered partner of eMudhra and Capricorn.' },
        { nav: 'audits', name: 'Compliance Audits', url: `${SITE}/audits/`, description: 'Advisory, non-statutory hygiene, safety and compliance audits: kitchen hygiene to the FSSAI Schedule 4 standard, kitchen layout and pest control records, fire and electrical safety to the National Building Code, canteen and mess hygiene, child safety to the POCSO standard, school transport safety, campus security, a NAAC/NIRF-ready SDG and sustainability audit, POSH Act Internal Committee compliance, software licensing and IT assets, DPDP Act data protection readiness and labour law records. Reports, certificates and badges are issued by Vybe Technologies alone and are not a licence, rating, accreditation or No Objection Certificate.' },
        { nav: 'manufacturing', name: 'Manufacturing & Supply', url: `${SITE}/manufacturing/`, description: 'Manufacture of RFID and NFC cards, fobs, tags and wristbands at 125 kHz, 13.56 MHz and UHF (MIFARE Classic, MIFARE DESFire, NTAG and EM4100), personalised and encoded to your access control, attendance and cafeteria systems, and distribution of IT hardware from Dell, HP, Lenovo, Asus, Apple, Logitech and Alienware, including desktops, all-in-one PCs, mini PCs, laptops, monitors, keyboards, mice, headsets, conferencing equipment and power adapters. Industrial IoT installations covering UHF asset and inventory tracking, temperature and humidity monitoring of cold rooms and server rooms, energy metering per panel or department, and edge gateways integrated with dashboards and Vybe ERP. Supplied against purchase orders and tenders with manufacturer warranty and GST invoicing. Pricing, stock availability and warranty terms are quoted per enquiry rather than listed.' },
      ].filter((s) => published(s.nav)).map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: { '@type': 'Service', name: s.name, url: s.url, description: s.description, provider: { '@id': `${SITE}/#organization` }, areaServed: { '@type': 'Country', name: 'India' } },
      })),
    }),
  },

  {
    url: '/erp/',
    file: 'erp/index.html',
    nav: 'erp',
    title: 'Vybe ERP | School & College Management Software (Cloud)',
    ogTitle: 'Vybe ERP: campus administration in one dashboard',
    description:
      'A customisable cloud ERP for schools and colleges: parent and staff portals, online fee collection, payroll, biometric attendance, timetables and report cards.',
    trail: [CRUMB_HOME, { name: 'Vybe ERP', url: '/erp/' }],
    priority: '0.9',
    view: erp,
    faqs: [
      { q: 'What is Vybe ERP?', a: 'Vybe ERP is a completely customisable, cloud-based Educational Resource Planning suite. It replaces fragmented administrative tasks (admissions, fees, attendance, academics) with one centralised, secure dashboard for schools and colleges.' },
      { q: 'Does Vybe ERP support biometric attendance?', a: 'Yes. The ERP integrates directly with campus biometric scanners so attendance is captured automatically, with no manual registers or spreadsheet reconciliation.' },
      { q: 'Can parents and students log in separately?', a: 'Yes. Students, parents and staff each get a dedicated portal login, so parents can track academics, attendance and fee status without going through the office.' },
      { q: 'How are fees collected?', a: 'Vybe ERP handles online fee collection with instant receipt generation, and keeps payroll logs for staff in the same system.' },
      { q: 'Is our data backed up and encrypted?', a: 'All data is encrypted, and the system takes automated encrypted backups daily to secure Microsoft Azure cloud servers. We target 99.9% server uptime.' },
      { q: 'What can the AI and WhatsApp features do?', a: 'The WhatsApp bot sends instant fee reminders and attendance alerts to parents. AI assistance helps staff generate exam papers, score sheets and study summaries.' },
    ],
    schema: (url) => ({
      '@type': 'SoftwareApplication',
      '@id': `${url}#software`,
      name: 'Vybe ERP',
      url,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Educational Resource Planning',
      operatingSystem: 'Web browser',
      description:
        'A customisable cloud-based Educational Resource Planning suite unifying student, parent and staff portals, fee collection, payroll, biometric attendance and academics.',
      featureList: [
        'Student, parent and staff portals',
        'Online fee collection with instant receipts',
        'Payroll logs',
        'Biometric attendance integration',
        'Automated timetables, seating plans and report cards',
        'WhatsApp fee and attendance alerts',
        'AI-assisted exam papers and summaries',
        'Daily encrypted backups to Azure',
      ],
      provider: { '@id': `${SITE}/#organization` },
      publisher: { '@id': `${SITE}/#organization` },
      offers: { '@type': 'Offer', priceCurrency: 'INR', availability: 'https://schema.org/InStock', url: `mailto:${ORG.sales}` },
    }),
  },

  {
    url: '/cms/',
    file: 'cms/index.html',
    nav: 'cms',
    title: 'Vybe CMS | 100% Cashless Smart Cafeteria System for Campuses',
    ogTitle: 'Vybe CMS: the cafeteria line ends here',
    description:
      'A 100% cashless cafeteria platform for campuses: mobile ordering, QR-code pickup, a kitchen display system, automated vendor payouts and live admin analytics.',
    trail: [CRUMB_HOME, { name: 'Vybe CMS', url: '/cms/' }],
    priority: '0.9',
    bodyClass: 'text-on-surface font-body selection:bg-brand/10 selection:text-brand flex flex-col min-h-screen relative z-0',
    view: cms,
    faqs: [
      { q: 'What is Vybe CMS?', a: 'Vybe CMS is a comprehensive SaaS platform for institutional cafeterias. It eliminates campus food queues, automates vendor payouts and gives the institution real-time analytics across every stall.' },
      { q: 'How do students collect their food?', a: 'Students order from the app and are given an auto-generated QR code. The vendor scans it at the Service Terminal, which marks the order complete instantly, with no verbal confirmation and no queue.' },
      { q: 'How do vendors get paid?', a: 'Payouts are automated and powered by PhonePe. Funds are split at checkout, routing the food cost directly to the vendor\u2019s bank account. Students can also pay from the zero-fee closed-loop Vybe Wallet.' },
      { q: 'Can students order ahead of a break?', a: 'Yes. Students can place an order from class and schedule it for \u2018Break 1\u2019 or \u2018Break 2\u2019, which lets kitchens prep intelligently instead of absorbing one large rush.' },
      { q: 'Do students need to install an app from the app store?', a: 'No. Vybe CMS is built as a PWA, so it installs to any iOS or Android home screen straight from the browser, with no app store approval required.' },
      { q: 'What does the kitchen see?', a: 'The Kitchen Display System (KDS) is a dedicated interface that separates immediate orders from scheduled break orders, with live order-prep tracking. Vendors can also mark items out of stock instantly or upload entire menus as JSON.' },
      { q: 'Is Vybe CMS being used anywhere today?', a: 'Yes. It is implemented at Christ Academy Institute for Advanced Studies (CAIAS).' },
    ],
    schema: (url) => ({
      '@type': 'SoftwareApplication',
      '@id': `${url}#software`,
      name: 'Vybe CMS',
      alternateName: 'Vybe Cafeteria Management System',
      url,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Cafeteria Management System',
      operatingSystem: 'Web browser, iOS, Android (PWA)',
      description:
        'A 100% cashless cafeteria management platform with mobile ordering, QR-code handover, a kitchen display system, scheduled break ordering and automated split payouts.',
      featureList: [
        'Student mobile ordering with live menus',
        'QR-code order handover',
        'Kitchen Display System (KDS)',
        'Automated PhonePe split payouts',
        'Scheduled break ordering',
        'WhatsApp OTP login, alerts and PDF invoices',
        'Admin revenue analytics and itemised PDF ledgers',
        'Installable PWA, no app store required',
      ],
      provider: { '@id': `${SITE}/#organization` },
      publisher: { '@id': `${SITE}/#organization` },
      offers: { '@type': 'Offer', priceCurrency: 'INR', availability: 'https://schema.org/InStock', url: `mailto:${ORG.sales}` },
    }),
  },

  {
    url: '/smart-classroom/',
    file: 'smart-classroom/index.html',
    nav: 'classroom',
    title: 'Smart Classroom Setup | Interactive Flat Panels | Vybe',
    ogTitle: 'Smart Classrooms: panels, cameras, power and content',
    description:
      'Smart classroom setup for schools and colleges: interactive flat panels, online class systems with camera and lighting, UPS-backed power and cabling.',
    trail: [CRUMB_HOME, { name: 'Smart Classrooms', url: '/smart-classroom/' }],
    priority: '0.9',
    dark: true,
    bodyClass: 'text-white dark-section selection:bg-brand/10 selection:text-brand flex flex-col min-h-screen relative z-0',
    view: classroom,
    faqs: [
      {
        q: 'What is included in a smart classroom setup?',
        a: 'A complete room rather than a list of parts: the interactive flat panel supplied and mounted, a classroom PC, camera, audio and lighting where the room is used for online or hybrid teaching, UPS backup and surge protection, dedicated power points and concealed cabling, content and LMS licensing, and teacher training at handover. Specifications are set per room. A 40-seat lecture hall and a 20-seat tutorial room do not take the same panel.',
      },
      {
        q: 'Should we buy an interactive flat panel or a projector?',
        a: 'A panel, in almost every case. Projectors need a darkened room, a bulb that is a recurring cost and eventually fails mid-lesson, and periodic alignment; the image degrades steadily and nobody notices until it is bad. A flat panel has no consumables, is readable in full daylight, and is touch-interactive out of the box. Projectors still make sense for very large halls where a panel cannot be seen from the back row, and we will say so when that is the situation.',
      },
      {
        q: 'What size panel do we need?',
        a: 'It depends on the distance from the panel to the back row, not on the size of the room. As a working rule, the back row should be no further from the panel than about six times its height, which for a typical 30-to-40-seat classroom puts you at 75 inches, with 65 inches suitable for smaller tutorial rooms and 86 or 98 inches for wide or deep halls. We measure the rooms rather than quoting one size across a building.',
      },
      {
        q: 'What do we need to run online or hybrid classes?',
        a: 'Five things, and most rooms are missing at least two of them. A classroom PC to run the session, a camera framed on the teaching area, a second chat monitor so the teacher can see remote students’ questions without minimising what they are teaching, lighting so the camera has usable light on the teacher’s face, and audio that picks up the room rather than only the person at the desk. The panel itself is the shared surface both audiences see. We supply and install the whole rig.',
      },
      {
        q: 'Do you supply UPS and handle the electrical work?',
        a: 'Yes. UPS backup sized to keep the panel and PC running through a typical outage, surge protection, dedicated power points and concealed cabling are part of the installation. This is the part most commonly skipped, and it is why so many smart classrooms end up with a panel running off an extension board trailing across a doorway.',
      },
      {
        q: 'Which interactive flat panels do you supply?',
        a: 'Logic panels, supplied through <strong>JS Global Industries</strong> in Bengaluru, who are the authorised distributor for the range and who we work with as a partner and dealer. Buying through the authorised channel is what turns a warranty claim into a phone call rather than an argument, and having the distributor in the same city means a panel that dies mid-term is replaced in an afternoon. Sizes run from 65 to 98 inches. If you are standardising on a different brand across a group of campuses, say so and we will quote the installation around it.',
      },
      {
        q: 'Do you supply the teaching content that runs on the panels?',
        a: 'No, and we would rather be plain about it than imply otherwise. We do not publish curriculum content of our own. What we do is make sure whatever your institution has licensed actually runs on the room we built: the panel and classroom PC specified against that software, accounts provisioned through your <a class="text-brand font-bold" href="/workspace/">Google Workspace or Microsoft 365 tenant</a>, and the room inside <a class="text-brand font-bold" href="/erp/">Vybe ERP</a> where you run it. If you have not chosen a content provider yet, we are happy to tell you what is being used around you and what people say about it.',
      },
      {
        q: 'Do you supply writing boards as well as panels?',
        a: 'Yes. JS Global Industries, the same partner our panels come through, manufacture classroom display and writing boards in Bengaluru. Most rooms want both: a panel for delivery and a writing surface beside it for working through a problem, and specifying them together means the wall is laid out once rather than retrofitted.',
      },
      {
        q: 'Do you train our teachers, and what happens after installation?',
        a: 'Installation includes hands-on training for the staff who have to teach with it, which is what decides whether the room gets used or quietly goes back to chalk. After handover we offer annual maintenance and support, so a failed panel is a phone call rather than a procurement exercise.',
      },
      {
        q: 'Can smart classrooms integrate with Vybe ERP?',
        a: `Yes. Where the institution runs <a class="text-brand font-bold" href="/erp/">Vybe ERP</a>, the classroom sits inside the same system (timetables, attendance and academics) rather than being a parallel setup with its own logins. Student accounts set up through our <a class="text-brand font-bold" href="/workspace/">workspace and email</a> service are what let online classes admit your own students automatically and keep every participant identifiable.`,
      },
    ],
    schema: (url) => [
      {
        '@type': 'Service',
        '@id': `${url}#classroom`,
        name: 'Smart Classroom Setup & Installation',
        url,
        serviceType: 'Audio-visual installation and classroom technology',
        description:
          'Supply, mounting and commissioning of smart interactive flat panels and writing boards, with UPS backup, surge protection, dedicated power and concealed cabling, specified per room for schools and colleges.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
        audience: { '@type': 'EducationalAudience', educationalRole: 'teacher' },
      },
      {
        '@type': 'Service',
        '@id': `${url}#online-class`,
        name: 'Online & Hybrid Class System Setup',
        url,
        serviceType: 'Hybrid classroom audio-visual systems',
        description:
          'Complete online class rigs: classroom PC, camera, dedicated chat monitor so teachers can see remote questions, lighting and room audio, built around the interactive flat panel as the shared surface.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
      },
      {
        '@type': 'Service',
        '@id': `${url}#panels`,
        name: 'Logic Interactive Flat Panel & Writing Board Supply',
        url,
        serviceType: 'Interactive flat panel and classroom board supply',
        description:
          'Supply and installation of Logic interactive flat panels from 65 to 98 inches for schools and colleges, sourced through JS Global Industries of Bengaluru, the authorised distributor for the range, together with classroom display and writing boards manufactured by the same partner.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
      },
    ],
  },

  {
    url: '/workspace/',
    file: 'workspace/index.html',
    nav: 'workspace',
    title: 'Google Workspace & Student Email Setup | Microsoft 365',
    ogTitle: 'Workspace & Email: set up properly, secured properly',
    description:
      'Google Workspace, Microsoft 365 and Zoho Mail setup: staff and student email on your own domain, single sign-on, secure online classes and phishing training.',
    trail: [CRUMB_HOME, { name: 'Workspace & Email', url: '/workspace/' }],
    priority: '0.8',
    view: workspace,
    // Partner Advantage covers Workspace, and Ingram Micro sells the licences.
    credentials: true,
    faqs: [
      {
        q: 'Should we use Google Workspace, Microsoft 365 or Zoho Mail?',
        a: 'Microsoft 365 for Business usually wins if your team already relies on desktop Office and Teams, or if you have Windows laptops to manage centrally, since Entra ID and Intune come with it. Google Workspace is usually simpler if your people work mainly in a browser and collaborate live on documents. Zoho Mail is the value option and a genuinely good one: noticeably cheaper per user, Indian-owned with Indian data centres if data residency matters to you, and the right answer when what you actually need is professional email on your own domain rather than a full collaboration suite. We will recommend one for your specific setup and explain why.',
      },
      {
        q: 'Do you set up Zoho Mail?',
        a: 'Yes. Zoho Mail is one of the three suites we deploy, and we handle it the same way as the others: domain verification, DNS, mailbox creation, migration of your existing mail, and SPF, DKIM and DMARC configured properly. It is often what we recommend to smaller teams and cost-sensitive institutions, since the per-user cost is well below Google Workspace or Microsoft 365 for what is, for many organisations, the same practical outcome.',
      },
      {
        q: 'Can you migrate our existing email without losing anything?',
        a: 'Yes. We migrate existing mail, contacts and calendars with folder structure intact, run the new tenant in parallel while DNS propagates, and cut over only once delivery is confirmed working both ways. Shared addresses like accounts@ or info@ are set up as proper shared mailboxes rather than a personal account with a shared password. Migrations between Google Workspace, Microsoft 365 and Zoho in any direction are all routine.',
      },
      {
        q: 'Can you set up email accounts for students, not just staff?',
        a: 'Yes, and it is a large part of what we do. Every student gets an institution-owned address on your domain, provisioned in bulk from your existing roll, or created automatically at admission where the institution runs Vybe ERP, and organised by year and department so you can mail a single batch without maintaining lists by hand. Each academic year the structure rolls forward, with graduating students moved to whatever your policy says: an alumni address, read-only access, or suspension. Both Google Workspace for Education and Microsoft 365 Education have tiers that cost qualifying institutions nothing or very little for the core student accounts.',
      },
      {
        q: 'How do you stop strangers joining our online classes?',
        a: 'Once students have institutional accounts, class meetings can be configured to admit signed-in members of your own domain automatically from the lobby and hold everybody else outside it. A leaked link stops being a way in, because having the link is no longer what grants entry, and the teacher is not stuck admitting forty people by hand at the start of every period.',
      },
      {
        q: 'What if a student disrupts an online class?',
        a: 'Because every participant joins under a named, institution-owned account rather than as an anonymous guest, disruption is attributable. Nobody can misbehave under an invented name and rejoin under another one, the attendance record is a real record, and the follow-up is an ordinary disciplinary matter rather than an investigation. In practice most of the benefit is deterrence. The incidents largely stop once students know the room can identify everyone in it.',
      },
      {
        q: 'What is SPF, DKIM and DMARC, and do we need all three?',
        a: 'They are the three DNS records that decide whether your mail reaches the inbox and whether anyone else can send mail pretending to be you. SPF lists which servers may send as your domain, DKIM cryptographically signs each message, and DMARC tells receiving servers what to do when a message fails either check, and reports attempted impersonation back to you. Yes, you need all three, and DMARC needs to be moved to enforcement rather than left on monitoring.',
      },
      {
        q: 'What does single sign-on actually give us?',
        a: 'One account per employee, protected by one multi-factor step, that signs them into Workspace or Microsoft 365 and into your other SaaS tools over SAML or OIDC. It centralises access control: MFA is enforced in one place, conditional access can require a managed device or block sign-ins from countries you do not operate in, and disabling one account when somebody leaves closes every door at once.',
      },
      {
        q: 'What is a phishing simulation and is it safe to run on our staff?',
        a: 'It is an authorised, harmless test: we send your employees a realistic phishing lure and record who clicks, who submits credentials and who reports it. Nothing is installed and no real credentials are captured. It is run with the organisation’s consent and reported as departmental patterns rather than as a list of individuals to punish. The point is to find where training is needed, and staff who expect to be blamed stop reporting real incidents.',
      },
      {
        q: 'What does the staff security training cover?',
        a: 'Short, practical, live sessions for non-technical staff on the attacks that actually arrive: business email compromise, invoice fraud where a supplier’s bank details are quietly changed, credential-harvesting pages that copy your own login screen, and password and MFA hygiene. We also cover what to do in the first ten minutes after somebody clicks, since how fast an incident is reported usually decides whether it becomes a breach.',
      },
      {
        q: 'How do we get started?',
        a: `Email <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> with your headcount, your domain and what you are running today, and we will come back with a migration plan and a quote.`,
      },
    ],
    schema: (url) => [
      {
        '@type': 'Service',
        '@id': `${url}#workspace`,
        name: 'Google Workspace, Microsoft 365 & Zoho Mail Setup',
        url,
        serviceType: 'Email and productivity suite deployment',
        description:
          'Licensing, tenant configuration and migration for Google Workspace, Microsoft 365 for Business and Zoho Mail: company email on your own domain, shared mailboxes, calendars and drives, SPF, DKIM and DMARC, and single sign-on with multi-factor and conditional access.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
      },
      {
        '@type': 'Service',
        '@id': `${url}#student-email`,
        name: 'Student Email & Online Class Setup',
        url,
        serviceType: 'Education email and virtual classroom deployment',
        description:
          'Institution-owned student email accounts on Google Workspace for Education or Microsoft 365 Education, provisioned in bulk and rolled forward each academic year, with online classes configured to auto-admit signed-in domain members from the lobby so leaked links do not grant entry and every participant is identifiable.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
        audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
      },
      {
        '@type': 'Service',
        '@id': `${url}#awareness`,
        name: 'Staff Security Awareness Training & Phishing Simulation',
        url,
        serviceType: 'Security awareness training',
        description:
          'Authorised simulated phishing campaigns reported by department, with practical live training for non-technical staff on business email compromise, invoice fraud and credential harvesting.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
      },
    ],
  },

  {
    url: '/it-solutions/',
    file: 'it-solutions/index.html',
    nav: 'it',
    title: 'Custom App Development & Cybersecurity | Vybe IT Solutions',
    ogTitle: 'Vybe IT Solutions: custom software and cybersecurity',
    description:
      'Bespoke web and mobile apps (portals, business ERPs, retail POS and SaaS) secured with penetration testing, DPDP Act compliance and managed SecOps.',
    trail: [CRUMB_HOME, { name: 'IT & Cyber', url: '/it-solutions/' }],
    priority: '0.8',
    dark: true,
    bodyClass: 'text-white dark-section selection:bg-brand/10 selection:text-brand flex flex-col min-h-screen relative z-0',
    view: it,
    faqs: [
      { q: 'What kind of applications does Vybe build?', a: 'Fast, responsive and scalable web and mobile applications built to an organisation\u2019s exact operational requirements using modern tech stacks: educational portals, business ERPs, retail POS systems and custom SaaS products.' },
      { q: 'What security services do you offer?', a: 'Penetration testing and application security (ethical hacking, exploit identification and deep vulnerability testing), plus Managed SecOps: 24/7 proactive monitoring, incident response and server hardening.' },
      { q: 'Can you help us meet ISO 27001 or the DPDP Act?', a: 'Yes. We provide guidance and implementation for ISO 27001 and India\u2019s Digital Personal Data Protection (DPDP) Act standards.' },
      { q: 'How do we get a quote for a custom build?', a: `Send your software requirements to <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> and we will scope the project and come back with a quote.` },
    ],
    schema: (url) => [
      {
        '@type': 'Service',
        '@id': `${url}#dev`,
        name: 'Custom Application Development',
        url,
        serviceType: 'Software development',
        description: 'Bespoke, scalable web and mobile applications: educational portals, business ERPs, retail POS and custom SaaS.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
      },
      {
        '@type': 'Service',
        '@id': `${url}#security`,
        name: 'Cybersecurity & Managed SecOps',
        url,
        serviceType: 'Cybersecurity',
        description: 'Penetration testing and application security, ISO 27001 and DPDP Act compliance, and 24/7 monitoring, incident response and server hardening.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
      },
    ],
  },

  {
    url: '/cloud/',
    file: 'cloud/index.html',
    nav: 'cloud',
    title: 'Vybe Cloud | Cloud Servers, Game Hosting & DDoS Protection',
    ogTitle: 'Vybe Cloud: enterprise-grade infrastructure',
    description:
      'Enterprise infrastructure: auto-scaling private clouds on AWS and Azure with a 99.99% uptime SLA, bare-metal game servers and active DDoS traffic scrubbing.',
    trail: [CRUMB_HOME, { name: 'Vybe Cloud', url: '/cloud/' }],
    priority: '0.8',
    view: cloud,
    // The one page where the vendor relationships are the product, not a badge.
    credentials: true,
    faqs: [
      { q: 'Which cloud platforms do you deploy on?', a: 'We design and deploy Virtual Private Clouds (VPCs) on AWS and Microsoft Azure, architected to auto-scale during traffic spikes. The uptime SLA is 99.99%.' },
      { q: 'Do you host game servers?', a: 'Yes. We provision high clock-speed, bare-metal servers tuned for multiplayer online games, targeting under 20ms ping with zero packet loss.' },
      { q: 'How do you handle DDoS attacks?', a: 'Active traffic scrubbing and volumetric attack mitigation keep servers online under heavy network floods.' },
      { q: 'Can you migrate our existing infrastructure?', a: `Get in touch at <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> with your current setup and requirements and we will scope the migration.` },
    ],
    schema: (url) => ({
      '@type': 'Service',
      '@id': `${url}#service`,
      name: 'Vybe Cloud',
      url,
      serviceType: 'Cloud infrastructure provisioning',
      description: 'Secure, scalable cloud environments on AWS and Azure, bare-metal low-latency game servers and DDoS protection.',
      provider: { '@id': `${SITE}/#organization` },
      areaServed: { '@type': 'Country', name: 'India' },
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Cloud services',
        itemListElement: [
          { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Scalable VPC architecture on AWS and Azure' } },
          { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Bare-metal game server hosting' } },
          { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'DDoS protection and traffic scrubbing' } },
        ],
      },
    }),
  },
];

/* --------------------------------------------------------------- emit pages */

/**
 * `lastmod` moves only when a page's content hash moves. Stamping today's date
 * on every URL each build teaches Google the signal is noise.
 */
const LASTMOD_FILE = '.lastmod.json';
const lastmodDb = (() => {
  try {
    return JSON.parse(read(LASTMOD_FILE));
  } catch {
    return {};
  }
})();

function lastmodFor(url, content) {
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  const prev = lastmodDb[url];
  if (!prev || prev.hash !== hash) lastmodDb[url] = { hash, date: BUILD_DATE };
  return lastmodDb[url].date;
}

const emitted = [];

/** Every document, collected before anything is written. */
const DOCS = [];

for (const page of PAGES.filter((p) => published(p.nav))) {
  page.body = renderView(page.view, page);
  page.lastmod = lastmodFor(page.url, [page.title, page.description, page.body].join('\n'));
  DOCS.push({ page, file: page.file, priority: page.priority, changefreq: 'monthly' });
}

/* ---------------------------------------------------------------- legal pages */

/* The binding policy documents, lifted out of their own source files. */
const LEGAL = [
  {
    src: 'src/privacy_policy.html',
    url: '/privacy-policy/',
    file: 'privacy-policy/index.html',
    title: 'Privacy Policy | Vybe Technologies',
    description: 'How Vybe Technologies collects, uses, stores and protects personal data across Vybe ERP, Vybe CMS and our other services.',
    crumb: 'Privacy Policy',
  },
  {
    src: 'src/tc.html',
    url: '/terms/',
    file: 'terms/index.html',
    title: 'Terms & Conditions | Vybe Technologies',
    description: 'The terms and conditions governing the use of Vybe Technologies software, platforms and services.',
    crumb: 'Terms & Conditions',
  },
  {
    src: 'src/refund_policy.html',
    url: '/refund-policy/',
    file: 'refund-policy/index.html',
    title: 'Cancellation & Refund Policy | Vybe Technologies',
    description: 'Vybe Technologies cancellation and refund policy for wallet top-ups, cafeteria orders and software subscriptions.',
    crumb: 'Cancellation & Refund Policy',
  },
  {
    src: 'src/shipping_policy.html',
    url: '/shipping-policy/',
    file: 'shipping-policy/index.html',
    title: 'Shipping & Exchange Policy | Vybe Technologies',
    description: 'How Vybe Technologies dispatches physical goods, when responsibility for a consignment passes to you, and where the exchange terms for your order are set out.',
    crumb: 'Shipping & Exchange Policy',
  },
];

for (const doc of LEGAL) {
  const raw = read(doc.src);

  // Keep only the body; the shared shell supplies nav, footer and breadcrumbs.
  const inner = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(raw);
  if (!inner) throw new Error(`no <main> in ${doc.src}`);

  let body = inner[1]
    .replace(/https:\/\/vybe\.net\.in\/privacy_policy\.html/g, '/privacy-policy/')
    .replace(/https:\/\/vybe\.net\.in\/T&amp;C\.html/g, '/terms/')
    .replace(/https:\/\/vybe\.net\.in\/refund_policy\.html/g, '/refund-policy/')
    .replace(/(?<=href=")privacy_policy\.html/g, '/privacy-policy/')
    .replace(/(?<=href=")T&amp;C\.html/g, '/terms/')
    .replace(/(?<=href=")refund_policy\.html/g, '/refund-policy/')
    .replace(/https:\/\/caias\.vybe\.net\.in\/vybe_logo\.png/g, '/assets/vybe-logo.opt.png');

  const url = SITE + doc.url;
  const trail = [CRUMB_HOME, { name: doc.crumb, url: doc.url }];
  const lastmod = lastmodFor(doc.url, [doc.title, doc.description, body].join('\n'));

  DOCS.push({
    file: doc.file,
    priority: '0.3',
    changefreq: 'yearly',
    page: {
      url: doc.url,
      nav: null,
      title: doc.title,
      description: doc.description,
      lastmod,
      trail,
      ogType: 'article',
      body: `<div class="py-12 px-6">${body}</div>`,
      bodyClass: 'min-h-screen flex flex-col text-slate-800 selection:bg-brand/20 selection:text-brand relative z-0',
      schema: () => [],
    },
  });
}

/* --------------------------------------------------------------- contact us */

/**
 * No form: this is a static site with no backend and `form-action 'self'`, so a
 * form would have nowhere to POST. Every number and address comes from ORG, so
 * this page, the footer and the schema cannot disagree.
 */
const mapsUrl = (o) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${ORG.name}, ${o.street}, ${o.locality}, ${o.region} ${o.postal}`
  )}${o.placeId ? `&query_place_id=${o.placeId}` : ''}`;

/**
 * One address on the dark office band. `o` is ORG itself for the registered
 * office and ORG.corporate for the other, which is the whole reason both carry
 * the same field names: dropping one office is then deleting one call.
 */
function officeBlock(label, o) {
  return `<div class="mt-8">
                        <p class="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-slate-400">${label}</p>
                        <address class="mt-3 not-italic text-base leading-relaxed text-slate-300">
                            ${o.streetLines.join('<br>\n                            ')}<br>
                            ${o.locality}, ${o.region} &ndash; ${o.postal}<br>
                            India
                        </address>
                        <a href="${mapsUrl(o)}" target="_blank" rel="noopener"
                           class="mt-4 inline-flex items-center gap-2 text-sm font-bold text-white hover:text-brand transition-colors">
                            <span class="material-symbols-outlined text-[20px]" aria-hidden="true">location_on</span>
                            Open in Google Maps
                            <span class="material-symbols-outlined text-[18px]" aria-hidden="true">open_in_new</span>
                        </a>
                    </div>`;
}

// `phone` is optional: legal correspondence wants a written record.
function contactCard({ icon, label, blurb, email, phone, phoneLabel }) {
  const tel = phone
    ? `<a href="tel:${phone.replace(/[^+\d]/g, '')}" class="flex items-center gap-3 font-bold text-slate-900 hover:text-brand transition-colors">
                                <span class="material-symbols-outlined text-[20px] text-slate-400" aria-hidden="true">call</span>
                                ${esc(phoneLabel)}
                            </a>`
    : '';
  return `<li class="flex flex-col h-full rounded-2xl border border-slate-200 bg-white p-8 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${icon}</span>
                        <h3 class="mt-4 text-xl font-bold font-display tracking-tight text-slate-900">${esc(label)}</h3>
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(blurb)}</p>
                        <div class="mt-auto pt-6 border-t border-slate-100 flex flex-col gap-3 text-sm">
                            <a href="mailto:${email}" class="flex items-center gap-3 font-bold text-slate-900 hover:text-brand transition-colors">
                                <span class="material-symbols-outlined text-[20px] text-slate-400" aria-hidden="true">mail</span>
                                ${esc(email)}
                            </a>
                            ${tel}
                        </div>
                    </li>`;
}

const contactFaqs = [
  {
    q: 'Who should we contact: sales, support or legal?',
    a: `Sales, on <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a>, for anything you do not have yet: a quote, a demo, a new campus, extra modules or hardware. Support, on <a class="text-brand font-bold" href="mailto:${ORG.support}">${ORG.support}</a>, for something already running that is not behaving. Legal, on <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a>, for contracts, data protection and privacy requests, security disclosures and invoicing disputes. If you pick the wrong one we will pass it across rather than send you back.`,
  },
  {
    q: 'What if my enquiry is not resolved?',
    a: `Start with sales, support or legal, whichever fits. They own the work and settle almost everything directly. If the matter is still unresolved after that, if you are not satisfied with how it was handled, or in a serious matter, you may bring it to our Grievance Officer at <a class="text-brand font-bold" href="mailto:${ORG.grievance}">${ORG.grievance}</a>, who also receives privacy and data protection grievances. Please attach the original correspondence and the date it was sent.`,
  },
  {
    q: 'What should we include in a first enquiry?',
    a: 'The more of this you can tell us up front, the more useful the first reply is: roughly how many students or staff the system has to cover, which of the products you are interested in, anything you are running today that the new system has to work alongside or replace, and the timeline you are working to. None of it is required to start a conversation.',
  },
  {
    q: 'Where are you located, and can we visit?',
    a: `We have two addresses in Bengaluru. Our registered office is at ${esc(ORG.street)}, ${esc(ORG.locality)}, ${esc(ORG.region)} ${
      ORG.postal
    }, and our corporate office is at ${esc(ORG.corporate.street)}, ${esc(ORG.corporate.locality)}, ${esc(ORG.corporate.region)} ${
      ORG.corporate.postal
    }. You are welcome at either to come and see the products running. Call ahead on ${telLink(
      ORG.phone
    )} so somebody who can answer your questions is there, and we will tell you which one to come to.`,
  },
  {
    q: 'Do you work with institutions outside Bengaluru?',
    a: 'Yes. We are based in Bengaluru and serve customers across India. The software is cloud-hosted, so an ERP or cafeteria deployment does not depend on how far away you are; on-site work such as smart classroom installation and hardware is scheduled per project.',
  },
  {
    q: 'What are your working hours?',
    a: `Monday to Saturday, 9:00&nbsp;AM to 6:30&nbsp;PM IST. Email sent outside those hours is picked up the next working morning.`,
  },
];

const contactBody = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Contact Us', url: '/contact/' }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Contact Us</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">Talk to us.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">Tell us what you are trying to run, and we will tell you plainly whether we are the right fit for it. No call centre and no ticket queue. The numbers below reach the people who build and support the software.</p>

                <ul class="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    ${contactCard({
                      icon: 'handshake',
                      label: 'Sales & new projects',
                      blurb: 'Quotes, demos, new campuses, extra modules and hardware. The fastest way to get a proposal together.',
                      email: ORG.sales,
                      phone: ORG.phone,
                      phoneLabel: telText(ORG.phone),
                    })}
                    ${contactCard({
                      icon: 'support_agent',
                      label: 'Customer support',
                      blurb: 'Already running Vybe software and something is not right? This reaches the team that maintains it.',
                      email: ORG.support,
                      phone: ORG.phoneSupport,
                      phoneLabel: telText(ORG.phoneSupport),
                    })}
                    ${contactCard({
                      icon: 'gavel',
                      label: 'Legal & compliance',
                      blurb: 'Contracts, data protection and privacy requests, security disclosures, invoicing disputes and anything else that needs a written record.',
                      email: ORG.legal,
                    })}
                </ul>

                <div class="mt-8 rounded-2xl border border-slate-200 bg-white/70 p-6 md:p-8 flex flex-col sm:flex-row gap-5 sm:items-start">
                    <span class="material-symbols-outlined text-brand text-[28px] shrink-0" aria-hidden="true">flag</span>
                    <div>
                        <h3 class="text-base font-bold font-display tracking-tight text-slate-900">Grievance Officer</h3>
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed max-w-3xl">Please raise your enquiry with sales, support or legal first. They own the work and settle the large majority of matters directly. If it remains unresolved after that, if you are not satisfied with how it was handled, or in a serious matter, you may bring it to our Grievance Officer at <a href="mailto:${ORG.grievance}" class="font-bold text-brand hover:underline">${ORG.grievance}</a>. Please attach the original correspondence and the date it was sent, so the matter can be taken up from where it stands rather than started again.</p>
                    </div>
                </div>
            </div>
        </section>

        <section class="bg-corporate dark-section text-slate-300 py-20 md:py-28 px-6 relative z-10" aria-labelledby="office-heading">
            <div class="max-w-6xl mx-auto grid gap-12 md:grid-cols-2">
                <div>
                    <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">Our offices</p>
                    <h2 id="office-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-white">Come and see it running.</h2>
                    ${officeBlock('Registered office', ORG)}
                    ${officeBlock(ORG.corporate.label, ORG.corporate)}
                    <p class="mt-8 text-sm text-slate-400 leading-relaxed">Second office line: <a class="font-bold text-white hover:text-brand transition-colors" href="${telHref(
                      ORG.phoneOffice
                    )}">${telText(ORG.phoneOffice)}</a>. It reaches us either way, and is the number to try if the sales and support lines are both busy.</p>
                </div>

                <div class="rounded-2xl border border-white/10 bg-white/5 p-8">
                    <h3 class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Opening hours</h3>
                    <dl class="mt-5 space-y-3 text-sm">
                        <div class="flex justify-between gap-6 border-b border-white/10 pb-3">
                            <dt class="text-slate-400">Monday &ndash; Saturday</dt>
                            <dd class="font-bold text-white">9:00&nbsp;AM &ndash; 6:30&nbsp;PM</dd>
                        </div>
                        <div class="flex justify-between gap-6">
                            <dt class="text-slate-400">Sunday</dt>
                            <dd class="font-bold text-white">Closed</dd>
                        </div>
                    </dl>
                    <p class="mt-6 text-sm text-slate-400 leading-relaxed">All times IST (UTC+5:30). Email sent outside working hours is picked up the next working morning.</p>
                </div>
            </div>
        </section>

${faqSection(contactFaqs, { dark: false })}
</div>`;

{
  const url = '/contact/';
  const lastmod = lastmodFor(url, contactBody);
  DOCS.push({
    file: 'contact/index.html',
    priority: '0.8',
    changefreq: 'yearly',
    page: {
      url,
      nav: 'contact',
      pageType: 'ContactPage',
      title: 'Contact Vybe Technologies | Bengaluru Office, Phone & Email',
      ogTitle: 'Contact Vybe Technologies',
      description:
        'Talk to Vybe Technologies in Bengaluru. Sales, support and legal contacts, grievance escalation, phone numbers, office address and opening hours.',
      lastmod,
      trail: [CRUMB_HOME, { name: 'Contact Us', url }],
      faqs: contactFaqs,
      body: contactBody,
      // The office node in the shared graph already carries address and hours.
      schema: () => [],
    },
  });
}

/* ------------------------------------------------------------------ printing */

/**
 * Print jobs arrive as a file, not as a form: the artwork is the enquiry. So
 * every call to action on this page is a mailto or a wa.me deep link with the
 * first message already written, and nothing here quotes a price. Print costs
 * move with material, size, finish and run length, so a made-up "from" figure
 * would be wrong on most jobs.
 */
const WA_NUMBER = ORG.phone.replace(/[^\d]/g, '');
const waLink = (text) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;

const PRINT_ENQUIRY = 'Hi Vybe, I would like a printing quote. Here is what I need:';

/* ---- shared furniture for the printing and registration sub-pages ---- */

/** The pair of calls to action every one of these pages ends on. */
function ctaRow({ waText, waLabel, email, subject, emailLabel }) {
  return `<div class="mt-10 flex flex-col sm:flex-row gap-4">
                    <a href="${waLink(waText)}" target="_blank" rel="noopener"
                       class="inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white px-7 py-4 rounded-full text-sm font-bold transition-all active:scale-95">
                        <span class="material-symbols-outlined text-[20px]" aria-hidden="true">forum</span>
                        ${waLabel}
                    </a>
                    <a href="mailto:${email}?subject=${encodeURIComponent(subject)}"
                       class="inline-flex items-center justify-center gap-2 bg-corporate hover:bg-slate-800 text-white px-7 py-4 rounded-full text-sm font-bold transition-all active:scale-95">
                        <span class="material-symbols-outlined text-[20px]" aria-hidden="true">mail</span>
                        ${emailLabel}
                    </a>
                </div>`;
}

/** A checklist panel: the short "here is what that covers" list. */
function checklistPanel(heading, items) {
  return `<div class="mt-14 rounded-2xl border border-slate-200 bg-white p-8">
                    <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">${esc(heading)}</h2>
                    <ul class="mt-5 grid gap-3 sm:grid-cols-2 text-sm text-slate-600">
                        ${items
                          .map(
                            (i) => `<li class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                            <span>${esc(i)}</span>
                        </li>`
                          )
                          .join('\n                        ')}
                    </ul>
                </div>`;
}

/** The long-form middle of a sub-page: headed paragraphs on the dark band. */
function proseSections({ id, eyebrow, heading, lede, sections }) {
  return `
        <section class="bg-corporate dark-section text-slate-300 py-20 md:py-28 px-6 relative z-10" aria-labelledby="${id}">
            <div class="max-w-4xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">${esc(eyebrow)}</p>
                <h2 id="${id}" class="text-3xl md:text-4xl font-black font-display tracking-tight text-white">${esc(heading)}</h2>
                ${lede ? `<p class="mt-5 text-lg leading-relaxed text-slate-300 max-w-3xl">${lede}</p>` : ''}
                <div class="mt-12 space-y-10">
                    ${sections
                      .map(
                        (s) => `<div class="border-t border-white/10 pt-8">
                        <h3 class="text-xl md:text-2xl font-bold font-display tracking-tight text-white">${esc(s.h)}</h3>
                        <p class="mt-3 leading-relaxed text-slate-300">${s.p}</p>
                    </div>`
                      )
                      .join('\n                    ')}
                </div>
            </div>
        </section>`;
}

/**
 * Sideways links between the pages in one group, plus the way back up to the
 * hub. Without it every sub-page is a leaf you can only leave by the nav.
 */
function siblingSection({ eyebrow, heading, items }) {
  const cards = items
    .map(
      (i) => `<a href="${i.href}" class="group block rounded-2xl border border-slate-200 bg-white p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${i.icon}</span>
                        <h3 class="mt-3 text-lg font-bold font-display tracking-tight text-slate-900">${esc(i.name)}</h3>
                        <p class="mt-1 text-sm text-slate-600 leading-relaxed">${esc(i.blurb)}</p>
                    </a>`
    )
    .join('\n                    ');

  return `
        <section class="bg-surface-main border-t border-slate-200 py-20 px-6 relative z-10" aria-labelledby="siblings-heading">
            <div class="max-w-6xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">${esc(eyebrow)}</p>
                <h2 id="siblings-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight mb-10 text-slate-900">${esc(heading)}</h2>
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    ${cards}
                </div>
            </div>
        </section>`;
}

function printCategory(c) {
  const { id, icon, title, blurb, items } = c;
  const href = c.slug ? printHref(c) : null;
  // Where a category has a page, the whole card is the link to it; the
  // "anything else" card has nowhere to go, so it stays a plain card.
  const head = href
    ? `<a href="${href}" class="group/card">
                            <h3 class="mt-4 text-xl font-bold font-display tracking-tight text-slate-900 group-hover/card:text-brand transition-colors">${esc(title)}</h3>
                        </a>`
    : `<h3 class="mt-4 text-xl font-bold font-display tracking-tight text-slate-900">${esc(title)}</h3>`;
  const more = href
    ? `<a href="${href}" class="mt-auto pt-6 inline-flex items-center gap-2 text-sm font-bold text-brand hover:gap-3 transition-all">
                            ${esc(title)} in detail
                            <span class="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                        </a>`
    : '';
  return `<li id="${id}" class="flex flex-col h-full rounded-2xl border border-slate-200 bg-white p-8 scroll-mt-28 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${icon}</span>
                        ${head}
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(blurb)}</p>
                        <ul class="mt-6 pt-6 border-t border-slate-100 grid gap-2 text-sm text-slate-600">
                            ${items
                              .map(
                                (i) => `<li class="flex items-start gap-2">
                                <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                                <span>${esc(i)}</span>
                            </li>`
                              )
                              .join('\n                            ')}
                        </ul>
                        ${more}
                    </li>`;
}

const PRINT_CATEGORIES = [
  {
    id: 'stationery',
    slug: 'stationery',
    nav: 'print-stationery',
    icon: 'description',
    title: 'Paper & stationery',
    blurb: 'The everyday run. The things an office gets through and reorders.',
    items: [
      'Letterheads, envelopes and compliment slips',
      'Bill books, invoice books and receipt books',
      'Brochures, leaflets, flyers and pamphlets',
      'Posters, certificates, calendars and diaries',
      'Files, folders and register covers',
    ],
    h1: 'Paper and stationery, run properly.',
    lede:
      'Letterheads, bill books, brochures, flyers, posters, certificates and folders. This is the work an office gets through and reorders, so it has to look the same in January and in November.',
    metaTitle: 'Letterhead, Bill Book & Brochure Printing, Bengaluru',
    metaDescription:
      'Letterheads, envelopes, bill books, brochures, flyers, posters, certificates, files and folders, printed to your artwork in Bengaluru. Send the file.',
    sections: [
      {
        h: 'Paper, and why we ask about it',
        p: 'Most of what goes wrong with a stationery job is decided before anything is printed, by the paper. A letterhead on 100 gsm bond feels like a letter; the same design on 70 gsm feels like a photocopy of one. A brochure that has to survive a counter wants a heavier stock and a lamination, and one that goes straight into a folder does not. Tell us where the piece ends up and we will suggest a stock, or match the one you used last time if you send us a sample.',
      },
      {
        h: 'Digital or offset',
        p: 'Short runs go digital: no plates, so a hundred copies cost what a hundred copies should. Past a certain quantity offset takes over and the per-piece price drops sharply, which is why the same brochure can work out cheaper at two thousand than at eight hundred. We will tell you where that crossover sits for your job rather than quote one method and leave you wondering about the other.',
      },
      {
        h: 'Finishing',
        p: 'Matt and gloss lamination, spot UV, foiling, embossing, folding, creasing, perforation, numbering, stapling and binding. Bill books and receipt books come carbonless in two or three parts, numbered in sequence, perforated and bound the way you are used to. If you have a book from a previous printer, send a photo of it and we will match the format rather than ask you to describe it.',
      },
    ],
    faqs: [
      {
        q: 'Can you print carbonless bill books with running numbers?',
        a: 'Yes. Two-part or three-part carbonless sets, numbered in sequence, perforated and bound into books of 50 or 100. Tell us the number to start from and whether the copies need to be different colours. If you want the same format as your current book, a photo of it is enough to go on.',
      },
      {
        q: 'What paper weights do you normally use?',
        a: 'As a rough guide: 70 to 100 gsm for letterheads and inner pages, 130 to 170 gsm for brochures and flyers, 250 to 300 gsm for covers, posters, certificates and folders. That is a starting point rather than a rule. The right answer depends on the piece and how it gets handled, and we will suggest one when we see the artwork.',
      },
      {
        q: 'Is there a minimum quantity for stationery?',
        a: 'Digital printing runs economically from small quantities, so a hundred letterheads is a perfectly normal order. Offset needs a larger run before the per-piece price makes sense. Ask with your quantity and we will tell you which method yours falls into and where the next price break is.',
      },
      {
        q: 'Can we reorder the same job later?',
        a: 'Yes, and it takes one message. We keep the approved file, so a repeat run needs nothing from you beyond the quantity unless something on the artwork has changed.',
      },
    ],
  },
  {
    id: 'cards',
    slug: 'cards',
    nav: 'print-cards',
    icon: 'badge',
    title: 'Business, ID & RFID cards',
    blurb: 'Everything card-sized, from a visiting card to a card that opens a door.',
    items: [
      'Visiting cards in matt, gloss, velvet and spot UV',
      'PVC ID cards with lanyards and holders',
      'RFID and NFC cards, tags and key fobs',
      'Student, staff and membership cards',
      'Variable data: names, numbers, photos and QR codes',
    ],
    h1: 'Cards, from a visiting card to one that opens a door.',
    lede:
      'Visiting cards, PVC ID cards, and RFID and NFC cards, tags and key fobs. All printed to your artwork, and the ones that have to work with a reader confirmed against your system before a batch is run.',
    metaTitle: 'Business Card, PVC ID & RFID Printing in Bengaluru',
    metaDescription:
      'Visiting cards in matt, gloss, velvet and spot UV. PVC ID cards with lanyards. RFID and NFC cards, tags and key fobs, printed in Bengaluru to your artwork.',
    sections: [
      {
        h: 'Visiting cards',
        p: 'Standard 3.5 by 2 inches unless you want otherwise, on 300 or 350 gsm, single or double sided. Matt and gloss lamination, velvet or suede touch, spot UV, foiling, embossing and rounded corners are all available, and several of them read better in the hand than they ever do on a screen. If you are choosing between finishes, say what impression you are after and we will tell you which one actually gets you there.',
      },
      {
        h: 'ID cards for schools, colleges and offices',
        p: 'PVC cards in the standard CR80 size, printed edge to edge, with names, photographs, designations, numbers, barcodes and QR codes handled as variable data. Send the list as a spreadsheet and the photographs in a folder named to match, and the whole batch is merged and printed from it. Lanyards, holders, clips and retractable reels can come with the order, so you are not sourcing them separately the week term starts.',
      },
      {
        h: 'RFID and NFC cards',
        p: 'Cards, tags, key fobs and wristbands, printed with your branding. The part worth getting right first is the chip: 125 kHz and 13.56 MHz are different technologies, and a card of the wrong sort is a coaster no matter how well it is printed. Tell us the chip your readers expect, or, if you do not know, what access control, attendance or cafeteria system you run, and we will confirm the right card before anything is ordered in bulk. If the card has to open a door, mark attendance or pay for lunch rather than simply look right, the chip choice, encoding and keys are covered properly on <a class="text-brand font-bold" href="/manufacturing/rfid-cards/">RFID and NFC card manufacturing</a>.',
      },
      {
        h: 'Cards that have to talk to your system',
        p: 'Whether cards can be delivered ready to use or have to be enrolled in your own software depends on the system. Some allow a supplier to write the card; others will only accept one enrolled from inside the application, by design. We will tell you which applies to yours before you order, rather than deliver a box and leave you to find out.',
      },
    ],
    faqs: [
      {
        q: 'Will the cards work with our existing readers?',
        a: 'They will if we know what your readers expect. RFID comes in different frequencies and chip families, and a card of the wrong sort will not be read at all. Tell us the chip type, or the name of the access, attendance or cafeteria system you run, and we will confirm the right card first. Where it is practical we will get a sample card to you to test on your reader before the batch is printed.',
      },
      {
        q: 'Can you print names, photos and QR codes on each card?',
        a: 'Yes. Send the list as a spreadsheet and the photographs in a folder whose filenames match a column in it, and the batch is merged from that. Names, roll or employee numbers, designations, validity dates, barcodes and QR codes all work the same way.',
      },
      {
        q: 'Do you supply lanyards and holders too?',
        a: 'Yes. Lanyards in your colours, with printing if you want it, along with holders, clips and retractable reels. Ordering them with the cards means one delivery rather than two.',
      },
      {
        q: 'What is the minimum order for ID or RFID cards?',
        a: 'Small batches are fine for PVC ID cards, which is what makes mid-year joiners and replacement cards practical. RFID and NFC cards depend on the chip, because some are only sold in fixed pack sizes. Ask with your quantity and we will tell you where you stand before you commit to anything.',
      },
    ],
  },
  {
    id: 'large-format',
    slug: 'banners-standees',
    nav: 'print-large-format',
    icon: 'flag',
    title: 'Banners, standees & signage',
    blurb: 'Large format, printed and finished ready to put up.',
    items: [
      'Flex and vinyl banners, any size',
      'Roll-up standees and backdrops',
      'Canopy, table covers and event branding',
      'Foam board, sunboard and acrylic signage',
      'Wall, window and vehicle graphics',
    ],
    h1: 'Large format, finished and ready to put up.',
    lede:
      'Flex and vinyl banners, roll-up standees, backdrops, event branding and signage. Printed to size, finished with the eyelets, stands or mounting you actually need, and checked against where it is going before it runs.',
    metaTitle: 'Flex Banner, Standee & Signage Printing in Bengaluru',
    metaDescription:
      'Flex and vinyl banners in any size, roll-up standees, backdrops, canopy and table branding, foam board and acrylic signage, printed in Bengaluru.',
    sections: [
      {
        h: 'Banners',
        p: 'Flex and vinyl, printed to whatever size you need rather than to a fixed list. Star flex for general outdoor use, backlit for a lit frame, blockout where light must not come through from behind. Finished with hemmed edges and eyelets as standard, and with rods or rope if you tell us how it is going up. Give us the finished size and the place it hangs, and we will flag it if the proportions are going to fight the space.',
      },
      {
        h: 'Standees and backdrops',
        p: 'Roll-up standees in the usual 6 by 3 feet, and wider where the stand allows, supplied with the stand and a carry bag. Backdrops and step-and-repeat walls for events, printed on fabric or flex with a frame if you need one. The thing worth remembering with a roll-up is that the bottom few inches sit inside the cassette, so anything important placed there disappears. We check for that before printing.',
      },
      {
        h: 'Signage and graphics',
        p: 'Foam board, sunboard and acrylic for indoor signage, name boards and directional signs. Vinyl for walls, windows and vehicles, including frosted film for glass partitions and one-way vision for windows you still want to see out of. Tell us the surface it is sticking to, because that decides which material is still there in six months.',
      },
      {
        h: 'Artwork for large format',
        p: 'Large format is more forgiving on resolution than paper is, because it gets read from a distance. It is not forgiving of a file that was already small. A logo pulled off a website, or a design forwarded through a chat app, has usually been compressed twice over, and it shows at banner size. Send the original file at whatever size it is and we will scale it. If it will not hold up, you hear that before it prints rather than after.',
      },
    ],
    faqs: [
      {
        q: 'What resolution does my artwork need to be?',
        a: 'Send the original file rather than aim at a number. Large format is viewed from a distance, so it needs far less resolution than a brochure does, but that only helps if the file has not already been compressed. A screenshot or a forwarded copy has lost detail that cannot be put back. We open every file at print size before quoting and tell you plainly if it will not hold.',
      },
      {
        q: 'What size are roll-up standees?',
        a: 'The common one is 6 by 3 feet, supplied with the stand and a carry bag, and wider sizes are available where the stand allows. Keep anything important out of the bottom few inches of the design, because that strip rolls into the cassette and cannot be seen once it is set up.',
      },
      {
        q: 'Do you install banners and signage?',
        a: 'Delivery in and around Bengaluru is normal. For signage that needs mounting, tell us when you send the artwork and we will confirm whether installation can be arranged for your site and what it would involve, rather than assume it either way.',
      },
      {
        q: 'How long will an outdoor banner last?',
        a: 'It depends on the material and on the weather it takes. Star flex is the usual choice for a short outdoor campaign; vinyl on a rigid board lasts considerably longer. Tell us how long it has to stand and where, and we will recommend the material for that rather than the cheapest one on the list.',
      },
    ],
  },
  {
    id: 'anything-else',
    icon: 'print',
    title: 'Something not on this list?',
    blurb: 'The list above is what we are asked for most, not the limit of what we run.',
    items: [
      'Send the spec and we will tell you plainly whether we can do it',
      'Odd sizes, unusual materials and special finishes included',
      'Repeat and bulk runs to the same file, reordered on a message',
    ],
  },
];

/** The three categories deep enough to deserve a page of their own. */
const PRINT_PAGES = PRINT_CATEGORIES.filter((c) => c.slug);
const printHref = (c) => `/printing/${c.slug}/`;

const PRINT_STEPS = [
  {
    h: 'Send us the file',
    p: `Email it to <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> or WhatsApp it to <a class="text-brand font-bold" href="${waLink(
      PRINT_ENQUIRY
    )}" target="_blank" rel="noopener">${telText(ORG.phone)}</a>. PDF, AI, CDR, PSD, PNG or JPG all work. Tell us the size, the quantity and the finish you want if you already know them.`,
  },
  {
    h: 'We check it and quote',
    p: 'Before anything is priced we open the file at print resolution and check the bleed, the margins, the colour mode and the resolution of every image placed in it. If something in the artwork will not survive the press, you hear about it then rather than after the run. The quote covers the job as specified, and the turnaround comes with it.',
  },
  {
    h: 'You approve the proof',
    p: 'Nothing goes on a machine until you have seen a proof and said yes to it. For a large-format job we will also confirm the finished size against where it is going up, because a banner that is right on screen and wrong on the wall is still a wasted banner.',
  },
  {
    h: 'We print and deliver',
    p: `Printed, finished and delivered in Bengaluru, or dispatched onward if you are further out. Our <a class="text-brand font-bold" href="/shipping-policy/">shipping and exchange policy</a> sets out how consignments are sent and when responsibility for one passes to you. Reordering the same job later takes one message, because we keep the approved file.`,
  },
];

const printingFaqs = [
  {
    q: 'What kinds of printing do you do?',
    a: 'Paper and stationery: letterheads, bill books, brochures, flyers, posters, certificates, files and folders. Cards of every sort: visiting cards, PVC ID cards, and RFID and NFC cards, tags and key fobs. Large format: flex and vinyl banners, roll-up standees, backdrops, event branding, foam board and acrylic signage, and wall, window and vehicle graphics. If what you need is not on that list, send us the specification anyway. It is what we are asked for most, not the limit of what we run.',
  },
  {
    q: 'How do I send you my artwork?',
    a: `Two ways, both of which reach the same people. Email the file to <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a>, or WhatsApp it to <a class="text-brand font-bold" href="${waLink(
      PRINT_ENQUIRY
    )}" target="_blank" rel="noopener">${telText(ORG.phone)}</a>. PDF is ideal; AI, CDR, PSD, PNG and JPG are all fine. For anything large format, send the original rather than a screenshot or a forwarded copy of it. A file that looks sharp on a phone can be well short of what a banner needs.`,
  },
  {
    q: 'What if my file is not print-ready?',
    a: 'Send it anyway. We check bleed, margins, colour mode and image resolution before quoting, and we will tell you exactly what needs to change and why. It is a short conversation before the run and an expensive one after it.',
  },
  {
    q: 'What does printing cost?',
    a: `It depends on the material, the size, the finish and how many you are running. The same design can differ several-fold across those four, so a headline price on this page would be wrong for most jobs. Send the artwork with the quantity and you will get a real figure rather than an indicative one. Email <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> or call ${telLink(ORG.phone)}.`,
  },
  {
    q: 'Is there a minimum quantity?',
    a: 'It varies by product. Digital work runs economically in small quantities; offset and some finishes only make sense above a certain run, and for those we will tell you the quantity at which the per-piece price actually changes. Ask with your quantity in hand and we will tell you where you stand.',
  },
  {
    q: 'How long does a job take?',
    a: 'The turnaround is confirmed with the quote, because it depends on the item, the quantity and the finishing involved. Urgent work is often possible. Say so in your first message and we will tell you honestly whether the deadline can be met, rather than accept it and miss it.',
  },
  {
    q: 'Do you deliver outside Bengaluru?',
    a: 'Yes. We deliver in and around Bengaluru and dispatch onward elsewhere in India. How consignments are sent, and the point at which responsibility for one passes to you, is set out in our <a class="text-brand font-bold" href="/shipping-policy/">shipping and exchange policy</a>.',
  },
  {
    q: 'Can you print RFID and NFC cards that work with our access system?',
    a: 'Yes. RFID and NFC cards, tags and key fobs, printed with your branding and with variable data such as names, photos, numbers and QR codes. Tell us the chip or frequency your existing readers expect, or, if you do not know, what system you are running, and we will confirm the right card before printing a batch that will not open anything.',
  },
];

const printingBody = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Printing', url: '/printing/' }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Printing Services</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">If it prints, we print it.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">Paper, cards, banners, standees, signage and RFID, all of it printed to your artwork. Mail us the file or send it on WhatsApp, tell us the size and the quantity, and you get a quote back with a turnaround attached to it.</p>

                <div class="mt-10 flex flex-col sm:flex-row gap-4">
                    <a href="${waLink(PRINT_ENQUIRY)}" target="_blank" rel="noopener"
                       class="inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white px-7 py-4 rounded-full text-sm font-bold transition-all active:scale-95">
                        <span class="material-symbols-outlined text-[20px]" aria-hidden="true">forum</span>
                        WhatsApp us the artwork
                    </a>
                    <a href="mailto:${ORG.sales}?subject=Printing%20enquiry"
                       class="inline-flex items-center justify-center gap-2 bg-corporate hover:bg-slate-800 text-white px-7 py-4 rounded-full text-sm font-bold transition-all active:scale-95">
                        <span class="material-symbols-outlined text-[20px]" aria-hidden="true">mail</span>
                        Email ${ORG.sales}
                    </a>
                </div>
                <p class="mt-4 text-sm text-slate-500">Mon&ndash;Sat, 9:00&nbsp;AM &ndash; 6:30&nbsp;PM IST. Files sent after hours are picked up the next working morning.</p>

                <ul class="mt-16 grid gap-5 sm:grid-cols-2">
                    ${PRINT_CATEGORIES.map(printCategory).join('\n                    ')}
                </ul>
            </div>
        </section>

        <section id="quote" class="bg-corporate dark-section text-slate-300 py-20 md:py-28 px-6 relative z-10 scroll-mt-20" aria-labelledby="print-process-heading">
            <div class="max-w-4xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">How a job runs</p>
                <h2 id="print-process-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-white">Send the file. That is the whole enquiry.</h2>
                <p class="mt-5 text-lg leading-relaxed text-slate-300 max-w-3xl">There is no form to fill in, because for a print job the artwork says more than a form ever would. Four steps from your file to the finished stack.</p>
                <ol class="mt-12 space-y-10">
                    ${PRINT_STEPS.map(
                      (s, i) => `<li class="border-t border-white/10 pt-8 flex gap-6">
                        <span class="text-3xl font-black font-display text-brand shrink-0 leading-none" aria-hidden="true">${i + 1}</span>
                        <div>
                            <h3 class="text-xl md:text-2xl font-bold font-display tracking-tight text-white">${esc(s.h)}</h3>
                            <p class="mt-3 leading-relaxed text-slate-300">${s.p}</p>
                        </div>
                    </li>`
                    ).join('\n                    ')}
                </ol>
            </div>
        </section>

${faqSection(printingFaqs, { dark: false })}
${relatedSection('printing', { dark: false })}
</div>`;

{
  const url = '/printing/';
  const lastmod = lastmodFor(url, printingBody);
  DOCS.push({
    file: 'printing/index.html',
    priority: '0.8',
    changefreq: 'monthly',
    page: {
      url,
      nav: 'printing',
      title: 'Printing Services in Bengaluru | Cards, Banners & Signage',
      ogTitle: 'Vybe Printing: paper, cards, banners, standees and RFID',
      description:
        'Printing in Bengaluru: business cards, PVC ID and RFID cards, letterheads, bill books, brochures, flyers, flex banners, standees and signage. Send us artwork.',
      lastmod,
      trail: [CRUMB_HOME, { name: 'Printing', url }],
      faqs: printingFaqs,
      body: printingBody,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: 'Printing services',
        serviceType: 'Commercial printing',
        description:
          'Commercial printing: business and visiting cards, PVC ID cards, RFID and NFC cards, letterheads, bill books, brochures, flyers, posters, flex banners, roll-up standees, backdrops and signage, printed to customer artwork.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
        url: u,
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Printing',
          itemListElement: PRINT_CATEGORIES.filter((c) => c.id !== 'anything-else').map((c) => ({
            '@type': 'OfferCatalog',
            name: c.title,
            itemListElement: c.items.map((i) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: i } })),
          })),
        },
      }),
    },
  });
}

/* ------------------------------------------------- printing, category pages */

/**
 * One page per print category, so a search for "roll-up standee printing" has
 * somewhere to land that is about roll-up standees rather than a hub page
 * mentioning them in passing. Everything here comes from PRINT_CATEGORIES, so
 * the hub, the nav and these pages cannot describe the same category
 * differently.
 */
for (const c of PRINT_PAGES) {
  const url = printHref(c);
  const enquiry = `Hi Vybe, I would like a quote for ${c.title.replace(/&/g, 'and').toLowerCase()}. Here is what I need:`;

  const body = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Printing', url: '/printing/' }, { name: c.title, url }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Printing &middot; ${esc(c.title)}</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">${esc(c.h1)}</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">${esc(c.lede)}</p>

                ${ctaRow({
                  waText: enquiry,
                  waLabel: 'WhatsApp us the artwork',
                  email: ORG.sales,
                  subject: `${c.title} enquiry`,
                  emailLabel: `Email ${ORG.sales}`,
                })}
                <p class="mt-4 text-sm text-slate-500">No prices on this page on purpose. What a job costs moves with the material, the size, the finish and the quantity, so we quote the job in front of us rather than an average of other people's.</p>

                ${checklistPanel(`What ${c.title.toLowerCase()} covers`, c.items)}
            </div>
        </section>

${proseSections({
  id: `${c.slug}-detail`,
  eyebrow: 'In detail',
  heading: c.title,
  sections: c.sections,
})}

${faqSection(c.faqs, { dark: false })}

${siblingSection({
  eyebrow: 'More printing',
  heading: 'The rest of what we print.',
  items: [
    { href: '/printing/', icon: 'print', name: 'All printing services', blurb: 'Everything we print, and how to send us artwork for a quote.' },
    ...PRINT_PAGES.filter((o) => o.slug !== c.slug).map((o) => ({ href: printHref(o), icon: o.icon, name: o.title, blurb: o.blurb })),
  ],
})}
${relatedSection('printing', { dark: false })}
</div>`;

  const lastmod = lastmodFor(url, [c.metaTitle, c.metaDescription, body].join('\n'));

  DOCS.push({
    file: `printing/${c.slug}/index.html`,
    priority: '0.7',
    changefreq: 'monthly',
    page: {
      url,
      nav: c.nav,
      title: c.metaTitle,
      ogTitle: c.title,
      description: c.metaDescription,
      lastmod,
      trail: [CRUMB_HOME, { name: 'Printing', url: '/printing/' }, { name: c.title, url }],
      faqs: c.faqs,
      body,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: c.title,
        serviceType: 'Commercial printing',
        description: c.metaDescription,
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
        url: u,
        isRelatedTo: { '@id': `${SITE}/printing/#service` },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: c.title,
          itemListElement: c.items.map((i) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: i } })),
        },
      }),
    },
  });
}

/* ------------------------------------------------------------- registrations */

/**
 * Flat professional fees, with government charges kept visibly separate. The
 * separation is repeated on every card, on every page and in the schema on
 * purpose: the fee is what Vybe charges, and for some of these it is not the
 * whole cost of the registration.
 *
 * The ISO entry is the odd one out and is handled with care throughout. It is
 * a certificate we issue ourselves, not an accredited one, and every place it
 * appears says so in plain words. See the disclosure on its own page.
 */
const REGISTRATIONS = [
  {
    id: 'gst',
    slug: 'gst',
    nav: 'reg-gst',
    icon: 'account_balance',
    name: 'GST registration',
    fee: 199,
    feeNote: 'No government fee on this registration',
    tagline: 'GSTIN for a new business, a branch or a turnover threshold crossed.',
    who: 'Anyone crossing the turnover threshold, selling across state lines, selling on a marketplace, or being asked for a GSTIN by a customer who cannot claim input credit without one.',
    needs: [
      'PAN and Aadhaar of the proprietor, partners or directors',
      'Proof of business address: ownership papers, a rent agreement or an NOC',
      'Bank account details or a cancelled cheque',
      'Photograph, and the constitution documents for a firm or company',
    ],
    note: 'The GST portal charges nothing for the registration itself. Our fee is the professional fee for preparing and filing it, and for handling any clarification the officer raises before the GSTIN is issued.',
    h1: 'GST registration, filed and followed up.',
    lede:
      'A GSTIN for a new business, a new branch, or a threshold you have just crossed. We prepare the application, file it, answer whatever the officer comes back with, and hand you the certificate.',
    metaTitle: 'GST Registration at ₹199 | New GSTIN Filed for You | Vybe',
    metaDescription:
      'GST registration at a flat ₹199 professional fee. Documents prepared, application filed, clarifications answered and the GSTIN delivered. No government fee.',
    sections: [
      {
        h: 'Who actually needs a GSTIN',
        p: 'The turnover thresholds are the usual reason, and they differ for goods and for services, and again in the special category states. But turnover is not the only trigger. Supplying goods across a state line, selling through an e-commerce marketplace, running an e-commerce platform yourself, operating as a casual taxable person at an exhibition, or being liable to pay under reverse charge all require registration whatever your turnover is. Plenty of businesses also register voluntarily, because a customer who cannot claim input credit on your invoice will eventually buy from somebody whose invoice they can claim on.',
      },
      {
        h: 'What we do',
        p: 'We check first whether you need to register at all, and under which scheme, because a composition scheme registration and a regular one lead to very different lives afterwards. Then the application is prepared, verified and filed on the portal. If the officer raises a query, which happens on a large share of applications and usually concerns the address proof, we draft and file the reply. That is inside the fee, not an extra.',
      },
      {
        h: 'Address proof is where applications stall',
        p: 'More GST applications are held up by premises documents than by anything else. A rent agreement in the wrong name, an electricity bill that does not match the address on the agreement, a consent letter without the owner’s identity proof attached: any of these is enough to draw a notice. Send us what you have before you commit and we will tell you what is missing while it is still cheap to fix.',
      },
      {
        h: 'After the GSTIN arrives',
        p: 'Registration is the start of an obligation, not the end of one. Returns fall due monthly or quarterly depending on your scheme and turnover, whether or not you traded in the period, and the late fees accrue per day. We file the registration; returns are separate ongoing work. Ask and we will quote it, or tell you plainly that your accountant should keep it.',
      },
    ],
    faqs: [
      {
        q: 'How much does GST registration cost in total?',
        a: '₹199, and that is the whole of it. The GST portal levies no government fee for a registration, so unlike FSSAI there is nothing payable on top. The ₹199 covers preparing the application, filing it, replying to any clarification raised on it and delivering the GSTIN.',
      },
      {
        q: 'How long does it take to get a GSTIN?',
        a: 'Filing happens within a working day of us having a complete set of documents. What follows is with the department: where no clarification is raised, a GSTIN is usually issued within about a week. Where one is raised, the clock restarts from our reply. We do not control that timeline and will not quote you one as though we did.',
      },
      {
        q: 'Do we need GST registration if our turnover is below the threshold?',
        a: 'Not on turnover grounds alone, but several other triggers apply regardless of turnover, including inter-state supply of goods, selling through an e-commerce marketplace and liability under reverse charge. Many businesses below the threshold also register voluntarily so that their customers can claim input credit. Tell us what you sell and to whom, and we will tell you which of those applies to you.',
      },
      {
        q: 'Can you register an additional place of business or a new branch?',
        a: 'Yes. Adding a branch, a godown or an additional place of business is an amendment to your existing registration rather than a fresh one, and a new state means a separate registration in that state. Send us the details and we will tell you which of the two yours is before you pay anything.',
      },
      {
        q: 'What happens if the application is rejected?',
        a: 'Rejections almost always follow an unanswered or unsatisfactory reply to a clarification, and the usual subject is the premises proof. If it happens we will tell you exactly what the department would not accept and what has to change before it is refiled, rather than refile the same papers and hope.',
      },
    ],
  },
  {
    id: 'msme',
    slug: 'msme',
    nav: 'reg-msme',
    icon: 'storefront',
    name: 'MSME / Udyam registration',
    fee: 199,
    feeNote: 'No government fee on this registration',
    tagline: 'The Udyam certificate that unlocks MSME benefits, subsidies and tender eligibility.',
    who: 'Micro, small and medium enterprises, whether manufacturing or services, that want the Udyam certificate for bank credit, subsidy schemes, tender eligibility or the protection of the delayed-payment provisions.',
    needs: [
      'Aadhaar of the proprietor, managing partner or authorised director',
      'PAN of the business',
      'GSTIN, where the business is registered for GST',
      'Investment and turnover figures, and the NIC activity codes that fit what you actually do',
    ],
    note: 'Udyam registration carries no government fee. Our fee is for classifying the activity correctly and filing it. A wrong NIC code or a mis-stated investment figure is the usual reason a certificate is later disputed.',
    h1: 'Udyam registration, classified correctly.',
    lede:
      'The MSME certificate that banks, tender portals and government schemes ask for. It is free to file and easy to file wrongly, and a wrong classification is the reason most certificates are questioned later.',
    metaTitle: 'MSME / Udyam Registration at ₹199 | Vybe Technologies',
    metaDescription:
      'Udyam (MSME) registration at a flat ₹199 professional fee, no government fee. Correct NIC classification and turnover figures filed, certificate delivered.',
    sections: [
      {
        h: 'What the certificate is for',
        p: 'Udyam is the government’s register of micro, small and medium enterprises, and the certificate is what proves you are on it. Banks ask for it before lending under priority sector norms and under the collateral-free credit guarantee scheme. Tender portals ask for it where a tender is reserved for MSEs or carries a relaxation on turnover and prior experience. Several state and central subsidy schemes ask for it as the first document. And it is what lets you invoke the delayed payment provisions, under which a buyer who holds your money past the statutory period owes interest on it.',
      },
      {
        h: 'Which band you fall into',
        p: 'Micro, small and medium are defined by two numbers together: investment in plant, machinery or equipment, and annual turnover. The limits have been revised upwards over time, most recently with effect from the 2025–26 financial year, so a business that was small under the old limits may sit differently now. Give us your figures and we will tell you which band you are in before anything is filed, rather than file first and explain afterwards.',
      },
      {
        h: 'The NIC code is the part people get wrong',
        p: 'Udyam requires you to declare your activity against National Industrial Classification codes, and the classification follows you. A trading business filed under a manufacturing code, or a consultancy filed under whatever code looked closest, is exactly the kind of mismatch that surfaces later when a bank or a tender authority compares the certificate against your GST returns. We pick the codes against what the business actually does, list them all where you do more than one thing, and tell you which is the primary.',
      },
      {
        h: 'It is linked to your PAN and GST',
        p: 'Udyam draws investment and turnover data from your PAN and GST records rather than taking your word for it, and the classification updates automatically as those figures move. That is a good reason to have the figures right at the time of filing, and a good reason not to enter numbers that your returns will contradict.',
      },
    ],
    faqs: [
      {
        q: 'Is there a government fee for Udyam registration?',
        a: 'None. Udyam registration is free on the government portal, and any site charging you a government fee for it is charging you for something that does not exist. Our ₹199 is a professional fee for classifying the business correctly and filing it, and you are perfectly entitled to file it yourself instead.',
      },
      {
        q: 'How long does it take?',
        a: 'Udyam is generally issued immediately once the application is submitted with a valid Aadhaar and PAN, and the certificate can usually be downloaded the same day. The work that takes time is what comes before: getting the classification, the activity codes and the figures right.',
      },
      {
        q: 'We already have a Udyog Aadhaar or an old MSME certificate. Is that enough?',
        a: 'No. The older Udyog Aadhaar Memorandum registrations have been superseded by Udyam, and the old numbers are no longer treated as valid MSME proof. If you are still carrying one, you need a fresh Udyam registration. Send us the old certificate and we will file the new one.',
      },
      {
        q: 'Can a trader register under Udyam?',
        a: 'Retail and wholesale traders are included for the limited purpose of priority sector lending, which is not the same as the full set of MSME benefits. It is worth knowing which of the two you are getting before you register, and we will tell you plainly where your business sits.',
      },
      {
        q: 'What if our turnover grows past the limit?',
        a: 'The classification moves with your PAN and GST data, so the certificate reclassifies itself as the figures change rather than becoming invalid. There is a transition period before a change in band takes effect on benefits. Nothing needs re-filing on your side.',
      },
    ],
  },
  {
    id: 'fssai',
    slug: 'fssai',
    nav: 'reg-fssai',
    icon: 'soup_kitchen',
    name: 'FSSAI registration & licence',
    fee: 299,
    feeNote: '+ government charges at actuals',
    tagline: 'Basic registration, or a State licence, for anyone handling food.',
    who: 'Anyone who manufactures, stores, transports, distributes or sells food: restaurants, cafeterias, caterers, cloud kitchens, retailers, traders and home-based food businesses.',
    needs: [
      'Photo ID and address proof of the proprietor, partners or directors',
      'Proof of business premises',
      'List of food products or categories handled',
      'Layout plan and a water test report, where the category calls for one',
    ],
    note: 'Which of Basic registration, a State licence or a Central licence applies depends on your turnover and where you operate, and the government fee differs for each. Tell us your turnover and we will tell you which one you need before you pay anything.',
    h1: 'FSSAI, on the right licence.',
    lede:
      'Basic registration, a State licence or a Central licence: three different things that get called "the FSSAI licence" interchangeably, with different fees and different consequences for getting it wrong. We work out which one you need first.',
    metaTitle: 'FSSAI Registration & Food Licence at ₹299 | Vybe',
    metaDescription:
      'FSSAI Basic, State and Central licences filed at a flat ₹299 professional fee, government fee quoted separately. For restaurants, cloud kitchens and caterers.',
    sections: [
      {
        h: 'Basic, State or Central',
        p: 'Which one applies is decided mostly by turnover and partly by what you do. Very small operators take Basic registration. Most restaurants, caterers, cloud kitchens and mid-sized manufacturers fall into the State licence. A Central licence is required above the upper turnover limit, and also regardless of turnover for importers and exporters, for operations at ports, airports and on the railways, and for businesses operating across several states from a head office. Tell us your turnover and where you operate and we will tell you which of the three you are before you pay for any of them.',
      },
      {
        h: 'What the government charges',
        p: 'Unlike GST and Udyam, FSSAI carries a real government fee, and it differs by licence type and by the number of years you take it for. Taking a licence for multiple years at once is usually cheaper per year than renewing annually. We quote the exact government figure for your category up front, charge it at actuals with nothing added, and keep it on a separate line of the invoice from our own fee.',
      },
      {
        h: 'Displaying and using the number',
        p: 'The 14-digit FSSAI number is not just a certificate for a drawer. It has to be displayed at your premises, and it belongs on your packaging, your menu and your bills depending on the kind of business you run. Aggregators will ask for it before they list you. Customers increasingly check it. We tell you where yours has to appear once it is issued.',
      },
      {
        h: 'Inspections and renewals',
        p: 'Some categories draw a premises inspection before the licence is granted, and the officer looks at the things you would expect: layout, storage, water, hygiene practice and pest control. We tell you in advance whether your category is likely to be inspected and what is typically looked at, so the visit is not the first time you hear about it. Licences run for one to five years and lapse if they are not renewed in time, with a penalty for late renewal, so we flag the date well before it arrives.',
      },
    ],
    faqs: [
      {
        q: 'Which FSSAI licence do we need?',
        a: 'It follows your turnover and your operations. Small operators take Basic registration; most restaurants, caterers and cloud kitchens take a State licence; importers, exporters, multi-state operations and larger manufacturers take a Central licence. Tell us your annual turnover and where you operate and we will tell you which one applies before you spend anything.',
      },
      {
        q: 'What are the government charges?',
        a: 'They vary by licence type and by the number of years you take the licence for, and they are payable on top of our ₹299 professional fee. We give you the exact figure for your category before you commit, and charge it at actuals with nothing added on.',
      },
      {
        q: 'Do home-based food businesses need FSSAI?',
        a: 'Yes. Selling food from home is a food business, and it needs at least Basic registration. Delivery platforms will ask for the number before they list you, and so will most customers ordering in any quantity.',
      },
      {
        q: 'Will there be an inspection?',
        a: 'For some categories, yes, usually before the licence is granted. The officer looks at layout, storage, water, hygiene practice and pest control. We will tell you whether your category typically draws one and what is normally looked at, so you can be ready rather than surprised.',
      },
      {
        q: 'How long is the licence valid?',
        a: 'From one to five years, whichever you choose at the time of application. Longer terms usually work out cheaper per year. A licence that lapses cannot simply be continued and attracts a late renewal penalty, so we flag the renewal date to you ahead of time.',
      },
    ],
  },
  {
    id: 'startup-india',
    slug: 'startup-india',
    nav: 'reg-startup-india',
    icon: 'rocket_launch',
    name: 'DPIIT / Startup India recognition',
    fee: 999,
    feeNote: 'No government fee. DPIIT recognition is free.',
    tagline: 'Startup India recognition, prepared and filed. The government charges nothing for it.',
    who: 'Private limited companies, LLPs and registered partnership firms within ten years of incorporation, working on something new or on a scalable model, that want the recognition certificate for IPR rebates, tender relaxations and scheme eligibility.',
    needs: [
      'Certificate of incorporation or registration, and PAN of the entity',
      'Details of the directors or partners, and the authorised signatory',
      'A short write-up on what the business does and what is new about it',
      'Website, pitch deck or a product video, if you have one',
      'Details of funding raised, patents filed or awards won, where they apply',
    ],
    note: 'DPIIT charges no fee for recognition, so ₹999 is the whole cost. Recognition is granted by DPIIT and not by us, and the tax benefits that people associate with it are a separate application that recognition makes you eligible to file, not something recognition itself grants.',
    h1: 'Startup India recognition, written properly.',
    lede:
      'DPIIT recognition is free to apply for and routinely refused for a weak write-up. The fee here buys the application being put together in a way that stands up, not access to a form that anybody can open.',
    metaTitle: 'DPIIT / Startup India Recognition at ₹999 | Vybe',
    metaDescription:
      'Startup India (DPIIT) recognition filed for ₹999, no government fee. Eligibility checked, innovation write-up drafted, certificate followed up. Bengaluru.',
    sections: [
      {
        h: 'Whether you are eligible',
        p: 'Four conditions, and all of them have to hold. The entity has to be a private limited company, a limited liability partnership or a registered partnership firm, so a sole proprietorship does not qualify. It has to be within ten years of incorporation. Annual turnover must not have crossed ₹100 crore in any year since incorporation. And it has to be working towards innovation, development or improvement of a product, process or service, or be a scalable business model with real potential for employment or wealth creation. An entity formed by splitting up or reconstructing an existing business is excluded. We check all four before you pay anything, and will tell you if you do not qualify.',
      },
      {
        h: 'What recognition actually gets you',
        p: 'Self-certification of compliance under a set of labour and environment laws for the first years after incorporation. Substantial rebates on intellectual property filings, with fast-tracked examination and a facilitator whose fees the government bears. Relaxation of prior turnover and prior experience requirements in public procurement, along with exemption from earnest money deposits on many tenders. A faster winding-up route. And eligibility to apply for the government’s startup funding schemes, which are open only to recognised startups.',
      },
      {
        h: 'What it does not get you, whatever anyone tells you',
        p: 'Recognition is not a grant, and no money arrives with the certificate. It is not the income tax holiday either. That benefit is a separate application to an Inter-Ministerial Board, decided on its own merits, and most recognised startups do not have it. Recognition makes you eligible to apply; it does not approve you. Anyone who sells you recognition on the promise of a tax exemption is selling you something they cannot deliver.',
      },
      {
        h: 'Why applications get rejected',
        p: 'The write-up, nearly always. The application asks what problem you solve, how you solve it, and what about it is new or scalable, and an answer that reads like a company brochure gets refused. What works is specific: the problem, who has it, what you built, what is genuinely different about the approach, and what the evidence is so far, whether that is revenue, users, a patent filing or a pilot. Drafting that is the work you are paying for. If we think the business does not have a case, we will say so rather than file it and keep the fee.',
      },
    ],
    faqs: [
      {
        q: 'Does DPIIT charge anything for recognition?',
        a: 'No. Recognition is free on the Startup India portal, and ₹999 is our professional fee for checking eligibility, drafting the write-up, filing the application and following it up. You are entirely free to file it yourself, and we would rather you knew that than found out afterwards.',
      },
      {
        q: 'Does recognition mean we do not pay income tax?',
        a: 'No, and this is the most common misunderstanding about it. The three-year deduction under Section 80-IAC is a separate application, decided by an Inter-Ministerial Board on its own criteria, and the large majority of recognised startups have not been granted it. Recognition makes you eligible to apply for it. Nothing more than that.',
      },
      {
        q: 'Can a proprietorship get DPIIT recognition?',
        a: 'No. The entity has to be a private limited company, an LLP or a registered partnership firm. If you are running as a proprietorship and want recognition, incorporating comes first. Tell us what you want to do and we will tell you what that would involve before you commit to either.',
      },
      {
        q: 'How long does recognition take?',
        a: 'Filing happens within a working day or two of the write-up being settled with you, which is the part that takes the real time. After that it sits with DPIIT, and the outcome typically comes back within a few weeks. We do not control that and will not put a date on it.',
      },
      {
        q: 'What if the application is rejected?',
        a: 'A rejection usually points at the write-up or at eligibility. Where it is the write-up, we will revise and refile it once at no further fee. Where the entity does not actually meet the conditions, no amount of redrafting fixes that, and we will tell you so plainly rather than keep refiling.',
      },
    ],
  },
  {
    id: 'iso',
    slug: 'iso-certification',
    nav: 'reg-iso',
    icon: 'workspace_premium',
    name: 'ISO certification (non-accredited)',
    fee: 2299,
    feeAlt: { amount: 1599, label: 'for startups' },
    feeNote: 'Not a government registration. No government charges.',
    tagline: 'ISO 9001, ISO 22000 and ISO 27001 certificates issued by us, verifiable on our portal, and not accredited by any accreditation body.',
    warn:
      'Read this before you buy: the certificate is issued by Vybe Technologies and is <strong>not accredited</strong> by NABCB, by any member of the International Accreditation Forum, or by any other accreditation body. If a customer or a tender requires an accredited certificate, this is not it.',
    who: 'Businesses that want a documented management system and a certificate to show for it, where the people asking have not specified that the certificate must be accredited. Commonly a first step before an accredited audit.',
    needs: [
      'Company details, and the scope you want certified',
      'Which standard you are after: ISO 9001, ISO 22000 or ISO 27001',
      'Whatever policies, procedures and records you already have',
      'A contact who can answer questions about how the work actually runs',
    ],
    note: 'This is our own certificate, verifiable on our portal and nowhere else. It carries no IAF, ILAC or NABCB mark and must not be presented as though it does. Ask whoever is asking you for ISO whether accreditation is required, before you buy a certificate from us or from anybody.',
    h1: 'ISO certification, with the fine print said out loud.',
    lede:
      'ISO 9001, ISO 22000 and ISO 27001. We review your processes against the standard, help you write what is missing, audit the result and issue a certificate you can point anybody at. It is a non-accredited certificate, and the next panel explains exactly what that means.',
    metaTitle: 'Non-Accredited ISO 9001, 22000 & 27001 Certification | Vybe',
    metaDescription:
      'Non-accredited ISO 9001, 22000 and 27001 certification: gap review, documentation, audit and a verifiable certificate. Issued by us, not an accredited body.',
    sections: [
      {
        h: 'ISO 9001, quality management',
        p: 'The general-purpose one, and the one most often asked for. It is about whether your business does what it says it does repeatably: defined processes, responsibilities that are written down, records that show what happened, and a habit of looking at what went wrong and changing something. It applies to any kind of business, which is why it is the certificate most tenders and vendor forms name.',
      },
      {
        h: 'ISO 22000, food safety management',
        p: 'For anyone in the food chain: manufacturing, processing, catering, storage, transport and retail. It is built around hazard analysis, the controls you put in place at the points that matter, and the records that show those controls were actually applied. It sits alongside your FSSAI licence rather than replacing it. FSSAI is the legal requirement; this is the management system.',
      },
      {
        h: 'ISO 27001, information security management',
        p: 'The one customers ask software and services companies for. Access control, asset and data handling, supplier risk, incident response, backups and continuity, all driven by a risk assessment you have actually done rather than a policy folder you downloaded. If your customers are starting to send you security questionnaires, this is the shape of the answer they are looking for.',
      },
      {
        h: 'What the fee actually buys',
        p: 'A review of how you work against the clauses of the standard, and a plain list of where the gaps are. Help writing the policies, scope statement, procedures and records you are missing, rather than a template pack emailed to you. A documented audit of the result. And then the certificate, carrying a number, a scope, a standard and an expiry date, which anybody can verify with us. The certificate number and the verification route are issued with it, so a customer can check it without coming through you.',
      },
      {
        h: 'Where this is genuinely useful, and where it is not',
        p: 'It is useful when a client or a vendor onboarding form asks for evidence of a management system without specifying accreditation, when you want the discipline of a real system at a price that makes starting possible, and as a stepping stone: the documentation work carries straight over to an accredited audit later. It is not useful, and we will not sell it to you, when a tender, a regulator, an overseas buyer or a large enterprise vendor programme requires an accredited certificate. Ask them which they need. If the answer is accredited, you need a body accredited under the IAF, and that is a different service at a different price.',
      },
    ],
    faqs: [
      {
        q: 'Is this the same as an accredited ISO certificate?',
        a: 'No, and it is important that you understand the difference before you buy. An accredited certificate is issued by a certification body that has itself been assessed by an accreditation board, such as NABCB in India, under the International Accreditation Forum. That chain is what gives the certificate weight with a regulator, an overseas buyer or a large tender. Our certificate is issued by Vybe Technologies. We are not accredited by NABCB or by any other accreditation body, the certificate carries no IAF, ILAC or NABCB mark, and it must not be presented as though it does.',
      },
      {
        q: 'So what is it worth?',
        a: 'It is worth what the person asking you for it will accept. A great many vendor onboarding forms, client questionnaires and smaller tenders ask whether you are ISO certified without specifying accreditation, and a certificate with a real audit and a verifiable number behind it answers that. Beyond that, the work itself has value regardless of the certificate: most businesses that go through it end up with documented processes they did not have. What it is not worth is anything at all to somebody who requires accreditation, and we say so on every page where it appears.',
      },
      {
        q: 'How is the certificate verified?',
        a: `On our portal, and only there: <a class="text-brand font-bold" href="/verify/">vybe.net.in/verify</a>. Each certificate carries a number, and the number resolves to the holder, the standard, the scope and the validity dates, so a customer can confirm it themselves without asking you for a scan. Verification is free and needs no account, and the certificate carries a QR code that goes straight to its own result. If a number you have been shown does not resolve, write to <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a> and we will confirm in writing whether it came from us.`,
      },
      {
        q: 'Can we use the ISO logo on our website?',
        a: 'No. ISO writes the standards and does not certify anyone, and its logo is not available for use by certified organisations, whether their certificate is accredited or not. What you can do is say in words that your management system has been certified to the standard, and name who certified it. We will tell you the exact wording to use, and we would rather you used it than something that overstates the position.',
      },
      {
        q: 'How long does certification take?',
        a: 'It depends almost entirely on what you already have. A business with documented processes can be through the gap review, the corrections and the audit in a couple of weeks. A business starting from nothing takes longer, because the documentation has to be written and, more to the point, has to describe what you actually do. We will give you a realistic timeline after the gap review rather than before it.',
      },
      {
        q: 'What if we need an accredited certificate later?',
        a: 'None of the work is wasted. The management system, the documentation and the records are what an accredited body audits too, and a business that has been through this once is in a far better position going into that audit than one starting cold. Tell us that is where you are heading and we will keep the documentation in the shape an accredited auditor will expect.',
      },
    ],
  },
  {
    id: 'nsdc',
    slug: 'nsdc-skill-india',
    nav: 'reg-nsdc',
    icon: 'school',
    name: 'NSDC / Skill India consulting',
    fee: null,
    feeQuote: 'On quote',
    feeNote: 'Advisory engagement. Scoped and quoted before we start.',
    tagline:
      'Advisory work on NSDC and Skill India training partner registration, and on affiliation applications generally. We review the file and tell you what is missing. You file it.',
    warn:
      'What this is: <strong>consulting</strong>. We review your documents, tell you where the gaps are and help you prepare the application. <strong>We do not register, file or submit on your behalf</strong>, and the application, the portal login, the fees and the inspections stay with you.',
    who: 'Training providers and institutes looking at NSDC or Skill India training partner registration, and schools and institutions preparing an affiliation application to a board or authority, who want the file checked by someone who has read the checklist properly before it goes in.',
    needs: [
      'What you are applying for, and to whom',
      'Your entity documents: incorporation or registration, PAN, GST where applicable',
      'Whatever you have already put together, including any checklist the authority has given you',
      'Details of the premises, equipment and trainers or staff you intend to show',
      'A contact who can actually make decisions about the application',
    ],
    note: 'This is advisory work, priced per engagement because the scope genuinely varies. We are not agents for NSDC, for any Sector Skill Council, or for any board or affiliating authority, and we have no influence over any of them.',
    h1: 'NSDC, Skill India and affiliation, reviewed before you file.',
    lede:
      'Consulting on NSDC and Skill India training partner registration, and on affiliation applications more broadly. We go through the requirements with you, read what you have, tell you plainly what is missing, and help you get the file into shape. The filing itself stays in your hands.',
    metaTitle: 'NSDC / Skill India Registration & Affiliation | Vybe',
    metaDescription:
      'Advisory support on NSDC and Skill India training partner registration and affiliation: requirement review, document gap check and file preparation. Bengaluru.',
    sections: [
      {
        h: 'What training partner registration involves',
        p: 'Becoming a training partner under NSDC and the Skill India mission is less a form and more a file. There is an entity to establish and evidence, a portal account to create, the job roles you intend to deliver to be picked and aligned to the relevant Sector Skill Council and the national qualification framework, and then each centre to be put up for accreditation with its premises, equipment, safety arrangements and certified trainers documented. The portals and the exact steps change from time to time, so we work from what the authority is asking for now rather than from a process we memorised two years ago.',
      },
      {
        h: 'What we do, and what stays with you',
        p: 'We are consultants here, not agents. What we do is go through the current requirements with you, read everything you have already gathered, produce a plain list of what is missing or will not stand up, help you draft and structure the documents that need writing, and tell you what an inspection is likely to look at. What stays with you is the rest: creating and holding the portal login, entering the application, paying whatever fees the authority charges, signing the declarations, and hosting any inspection or audit. We will not hold your credentials or submit anything in your name.',
      },
      {
        h: 'Affiliation consulting',
        p: 'The same approach applies where an institution is preparing an affiliation application to a board or an authority. Every affiliating body publishes its own requirements, and they differ enough that the only sensible starting point is the current checklist of the body you are actually applying to. We work through that with you: what the infrastructure and staffing requirements really mean in practice, which documents have to exist before the application rather than after it, where files usually fall short, and how to present what you have. We do not claim a relationship with any board, and we will not tell you that we can get an application through.',
      },
      {
        h: 'Registration is not a project',
        p: 'Worth saying plainly, because it is where expectations usually go wrong: being registered or accredited as a training partner is not the same as being awarded government-funded training. Funded schemes run through their own empanelment rounds, allocations and tenders, each with its own criteria and its own timing. Registration is what makes you eligible to go after those. It does not bring a batch, a target or a rupee with it, and anyone telling you otherwise is selling you something they cannot deliver.',
      },
      {
        h: 'Why this one is quoted rather than priced',
        p: 'Our other filings carry a flat fee because the work is predictable. This one is not. One institute wants a second opinion on a file that is nearly complete; another is starting from an idea and a rented floor. Pricing both the same would mean overcharging the first or doing the second badly. So we look at what you are applying for and what you already have, then quote a figure and say what is included, before any work starts.',
      },
    ],
    faqs: [
      {
        q: 'Will you file the NSDC or Skill India application for us?',
        a: 'No. This is consulting, and we are deliberate about that line. We review your documents, tell you what is missing, help you prepare the file and explain what the authority is looking for. You create and hold the portal account, submit the application, pay the fees and host any inspection. If you were looking for someone to take the whole thing off your hands, this is not that service, and we would rather you knew now.',
      },
      {
        q: 'Why is there no price on this page?',
        a: 'Because the work genuinely varies, and a flat fee would either overcharge the institute that just wants its file checked or shortchange the one starting from scratch. Tell us what you are applying for and send what you already have. We will come back with a figure and a clear statement of what it covers, and there is no charge for that conversation.',
      },
      {
        q: 'Can you guarantee we get registered or affiliated?',
        a: 'No, and be careful with anyone who says they can. Accreditation and affiliation decisions sit with NSDC, the relevant Sector Skill Council, or the board or authority concerned, on their own criteria and their own timelines. We have no influence with any of them and claim none. What we can do is make sure the file that reaches them is complete, accurate and presented the way they ask for it, which is the part that most applications actually fail on.',
      },
      {
        q: 'Which boards and authorities do you advise on?',
        a: 'We work from the published requirements of whichever body you are applying to, rather than keeping a list of bodies we imply a relationship with. Tell us who you are applying to and we will tell you honestly whether it is something we can usefully help with, before you pay us anything. Where it is outside what we know, we will say so rather than learn on your application.',
      },
      {
        q: 'What do we actually get for the fee?',
        a: 'A review of the current requirements against your situation, a written gap list you can work from, help drafting and structuring the documents that need writing, a read of the file before it goes in, and guidance on what an inspection tends to look at. What you get is a file that is ready. What you do not get is a submission made in your name, because we do not make those.',
      },
      {
        q: 'Is this connected to your ISO certificate?',
        a: 'No, and the two should not be confused. Our ISO certificate is issued by us and is not accredited by any accreditation body. This service is advisory work on a registration or affiliation granted by somebody else, where the decision belongs entirely to that authority. Buying one has nothing to do with the other.',
      },
    ],
  },
  {
    id: 'dsc',
    slug: 'digital-signature-certificate',
    nav: 'reg-dsc',
    icon: 'key',
    name: 'Digital signature certificates',
    fee: 1500,
    feeFrom: true,
    feeLabel: 'for a two-year Class 3 certificate',
    feeAlt: { amount: 599, label: 'for a USB token, priced separately' },
    feeNote: 'Issued by a licensed CA. We are a registered partner of eMudhra and Capricorn.',
    offerNote: 'Starting price for a two-year Class 3 certificate. The USB token is priced separately at ₹599. Other types and validities are quoted on the same basis.',
    tagline:
      'Class 3 signature certificates for individuals and organisations, combo certificates for e-tendering, and DGFT certificates, with the token if you need one.',
    warn:
      'How we handle your token: we hand it over to you and <strong>you set the PIN</strong>. We do not keep your DSC, hold your PIN, or sign anything on your behalf. Anyone who offers to keep your token in their office and file for you is asking you to hand over your legal signature.',
    who: 'Anyone who has to sign something electronically where a scanned signature will not do: company filings with the MCA, income tax and GST returns, e-tendering and e-procurement portals, EPFO and trademark filings, and DGFT work for importers and exporters.',
    needs: [
      'PAN, and a mobile number linked to Aadhaar for the verification step',
      'A working email address, which becomes part of the certificate',
      'The applicant available for a short video verification, which is mandatory',
      'For an organisation certificate: GST or incorporation proof and an authorisation letter for the signatory',
      'For DGFT: the IEC of the firm',
    ],
    note: 'The certificate is issued by the Certifying Authority, not by Vybe. We are a registered partner of eMudhra and of Capricorn, which is how we get you issued quickly and support you afterwards, but the certificate itself carries the CA’s name.',
    h1: 'Digital signature certificates, issued properly.',
    lede:
      'Class 3 DSCs from eMudhra and Capricorn, both licensed Certifying Authorities, with Vybe as a registered partner of each. Individual, organisation, combo and DGFT certificates, with the USB token if you need one, and the token handed to you rather than kept in our drawer.',
    metaTitle: 'Class 3 Digital Signature Certificate & Token | From ₹1,500',
    metaDescription:
      'Class 3 digital signature certificates from eMudhra and Capricorn: individual, organisation, combo and DGFT, from ₹1,500 for two years, USB token ₹599.',
    sections: [
      {
        h: 'What a DSC is, and who actually issues it',
        p: 'A digital signature certificate is the electronic equivalent of signing and sealing a document, and it holds up under the Information Technology Act because of who issues it. Certificates come from licensed Certifying Authorities working under the Controller of Certifying Authorities. Vybe is a registered partner of two of them, eMudhra and Capricorn, which lets us get an application through quickly and support you afterwards. We want to be clear about the line, though: the certificate is issued by the CA and carries its name. We are the partner who gets you there, not the issuer.',
      },
      {
        h: 'Which one you need',
        p: 'Class 3 is what gets issued now, for everything. The older Class 2 certificate was discontinued at the start of 2021 and no longer exists as an option, so if a form still asks for one, Class 3 is the answer. Within Class 3 the choice is about whose name is on it and what it does. An individual certificate sits in a person’s own name and covers income tax, GST, MCA filings and most day-to-day signing. An organisation certificate carries the organisation’s name alongside an authorised signatory. A combo certificate adds encryption on top of signing, which most e-tendering and e-procurement portals insist on. A DGFT certificate is the specific one for importers and exporters filing on the DGFT portal, and it is tied to the firm’s IEC.',
      },
      {
        h: 'The token, and why it is a separate line',
        p: 'A Class 3 certificate has to live on a certified cryptographic USB token. That is not an upsell, it is how the thing is designed: the key pair is generated inside the token and the private key cannot be copied out of it, which is exactly what makes the signature worth something. We price the token at &#8377;599 separately from the certificate for a simple reason. If you already have a compatible token with room on it, you should not be paying for another one. If you do not, you need one, and you will keep using it at renewal.',
      },
      {
        h: 'How issuance actually goes',
        p: 'Paperless, in most cases, and quicker than people expect. The application is filled in, verification runs through Aadhaar-based eKYC with an OTP to your linked mobile, and a short video verification is recorded, which is mandatory and cannot be done by somebody else on your behalf. Once the CA approves, the certificate is downloaded onto the token and you set your own PIN. A straightforward individual certificate is often the same day. Organisation and DGFT certificates take longer, because the authorisation letter and the entity documents have to be verified by the CA as well.',
      },
      {
        h: 'Your signature stays yours',
        p: 'It is common practice in this trade for a consultant to keep a client’s token in a drawer and sign things as and when needed, and it is a genuinely bad idea. That token is your legal signature. Anything signed with it is signed by you, whoever was holding the plastic at the time. So we hand the token over, you set the PIN, and you keep both. If you want us to prepare a filing, we will prepare it and you will sign it. We will not ask you to leave your DSC with us, and we would think carefully about anyone who does.',
      },
      {
        h: 'Renewal, loss and what it costs',
        p: 'Certificates are issued for one, two or three years, and the starting price of &#8377;1,500 is for a two-year Class 3 certificate, with the other durations and the organisation, combo and DGFT variants quoted on the same basis. Renewal is a fresh certificate rather than an extension, and it can go on the token you already have. If the token is lost or the PIN is forgotten past its retry limit, the certificate is gone: the key cannot be recovered by us, by the CA, or by anyone else, and a new certificate has to be issued. Tell us straight away if a token goes missing, because the existing certificate should be revoked.',
      },
    ],
    faqs: [
      {
        q: 'Who is the certificate actually issued by?',
        a: 'By the Certifying Authority, either eMudhra or Capricorn, both licensed under the Controller of Certifying Authorities. Vybe is a registered partner of both, which is how we get applications processed quickly and how we support you afterwards, but the certificate carries the CA’s name and its trust chain, not ours. We mention this because we are careful elsewhere on this site about what we issue ourselves and what we do not.',
      },
      {
        q: 'What does ₹1,500 cover, and what is extra?',
        a: 'It is the starting price for a two-year Class 3 certificate. The USB token is <strong>&#8377;599 and priced separately</strong>, because if you already have a compatible token you should not be buying another one. Organisation certificates, combo certificates for e-tendering, DGFT certificates and one or three year validities are quoted on the same basis, and you will have the exact figure before anything is applied for.',
      },
      {
        q: 'Do I need a Class 2 or a Class 3 certificate?',
        a: 'Class 3, and it is not really a choice any more. Class 2 certificates were discontinued at the beginning of 2021 and are no longer issued at all, so where a portal or an old form still refers to Class 2, a Class 3 certificate is what it will accept. The question worth asking instead is whether you need signing only or a combo certificate with encryption, since most e-tendering portals require the latter.',
      },
      {
        q: 'Can you keep our token and file things for us?',
        a: 'No, and we will say no even if you ask. A DSC is your legal signature, and anything signed with it is signed by you regardless of who was holding the token. We hand the token over, you set the PIN, and it stays with you. Where we are preparing a filing, we will get it ready and you will sign it. That is the only arrangement we are willing to work under.',
      },
      {
        q: 'How long does it take?',
        a: 'An individual Class 3 certificate is often issued the same day, since the process is paperless: eKYC with an OTP to your Aadhaar-linked mobile, and a short video verification you have to do yourself. Organisation and DGFT certificates take longer because the entity documents and the authorisation letter go through the CA’s own verification. The one thing that reliably holds an application up is a mobile number that is not linked to Aadhaar, so it is worth checking that first.',
      },
      {
        q: 'We lost the token. Can the certificate be recovered?',
        a: 'No. The private key is generated inside the token and never leaves it, which is the whole point of the design, so it cannot be extracted, backed up or recovered by us or by the CA. A lost token, or a PIN entered wrongly past its retry limit, means a new certificate. Tell us as soon as a token goes missing so the existing certificate can be revoked, and do not wait to see if it turns up.',
      },
    ],
  },
];

/** Registrations that have a page of their own, which is all of them. */
const REG_PAGES = REGISTRATIONS.filter((r) => r.slug);
const regHref = (r) => `/registrations/${r.slug}/`;
const rupees = (n) => `&#8377;${n.toLocaleString('en-IN')}`;

/* Most registrations carry a flat published fee. Consulting work is scoped
   first, so those entries set `fee: null` and show a quote line instead. */
const regFee = (r) => (r.fee === null ? esc(r.feeQuote) : `${r.feeFrom ? 'From ' : ''}${rupees(r.fee)}`);
const regFeeLabel = (r) => r.feeLabel ?? (r.fee === null ? 'professional fee, scoped first' : 'professional fee');

const regFaqs = [
  {
    q: 'What do the prices on this page cover?',
    a: 'They are our professional fee, the flat amount Vybe charges to prepare your application, file it, respond to queries raised on it and hand you the certificate at the end. <strong>Government charges, where any apply, are separate and are payable at actuals.</strong> GST, Udyam and DPIIT recognition carry no government fee at all, so for those three the professional fee is the whole cost. FSSAI does carry one, and we tell you the figure before you commit rather than after.',
  },
  {
    q: 'How much are the government charges?',
    a: 'For GST registration, Udyam (MSME) registration and DPIIT recognition: nothing. Those three are free on the government portals and our fee is the whole cost. FSSAI does carry a statutory fee, and it varies by whether you need Basic registration, a State licence or a Central licence and for how many years you take it. ISO certification is not a government registration at all, so no government charge arises. Tell us what you need and you will have the exact figure up front.',
  },
  {
    q: 'Is your ISO certificate accredited?',
    a: `No, and we would rather you heard it here than found out later. The certificate is issued by Vybe Technologies. We are not accredited by NABCB, by any member of the International Accreditation Forum, or by any other accreditation body, and the certificate carries no accreditation mark. It is verifiable on our own portal and nowhere else. If whoever is asking you for ISO requires an accredited certificate, this is not it, and we will tell you so rather than sell it to you. The full position is set out on the <a class="text-brand font-bold" href="/registrations/iso-certification/">ISO certification page</a>.`,
  },
  {
    q: 'What do you need from us to get started?',
    a: 'It differs by registration, and each page lists it. Broadly: identity and address proof of the proprietor, partners or directors, proof of premises where the registration is tied to a place, the business PAN, and whatever is specific to the filing, such as food categories for FSSAI or the incorporation certificate for DPIIT. Send what you have on WhatsApp or by email and we will tell you what is still missing rather than send you a checklist and wait.',
  },
  {
    q: 'How long does a registration take?',
    a: 'Filing happens within a working day of us having a complete set of documents. What comes after that is with the department: Udyam is generally immediate, a GSTIN is usually issued within about a week if no clarification is raised, FSSAI depends on the category and on whether an inspection is required, and DPIIT recognition typically comes back within a few weeks. We do not control those timelines and will not quote you one as though we did. What we will do is chase the file and keep you posted.',
  },
  {
    q: 'Do you handle registrations other than these?',
    a: `These are what we file day to day. Other registrations and filings start at ₹499 plus government charges. Ask us what you need on <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a> and we will tell you plainly whether it is something we take on, rather than take the work and learn on your file.`,
  },
  {
    q: 'Do you issue the digital signature certificates yourselves?',
    a: 'No. A DSC is issued by a licensed Certifying Authority, and we are a <strong>registered partner of eMudhra and of Capricorn</strong>. That gets your application processed quickly and gives you somebody local to call afterwards, but the certificate carries the CA’s name and trust chain, not ours. One other thing worth knowing before you buy from anybody: we hand the token over to you and you set the PIN. We do not keep client tokens.',
  },
  {
    q: 'Is the NSDC and affiliation work the same as the rest of this list?',
    a: 'No, and the difference matters. Everything else on this page is filing: we prepare the application, submit it and follow it up. NSDC, Skill India and affiliation work is <strong>consulting</strong>. We go through the requirements, review what you have, tell you what is missing and help you prepare the file, and then you submit it yourself. That is also why it carries a quote rather than a flat fee, since the amount of work varies enormously between one applicant and the next.',
  },
  {
    q: 'What happens if the application is rejected or a clarification is raised?',
    a: 'A clarification is routine. Departments raise them on a large share of applications, and answering one is part of the fee, not an extra. We draft the reply and file it. If an application fails for something outside the filing itself, such as a premises proof the department will not accept, we will tell you exactly what has to change before it is refiled.',
  },
  {
    q: 'Who should we contact about a registration?',
    a: `Email <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a>, or WhatsApp us on <a class="text-brand font-bold" href="${waLink(
      'Hi Vybe, I would like help with a registration.'
    )}" target="_blank" rel="noopener">${telText(ORG.phone)}</a> with what you are registering and roughly what the business does.`,
  },
];

const REG_ENQUIRY = 'Hi Vybe, I would like help with a registration.';

/** The amber-free house style for a caveat: bordered, iconed, unmissable. */
function noticePanel(heading, html, { dark = false } = {}) {
  const box = dark ? 'border-white/20 bg-white/5' : 'border-brand/30 bg-brand/5';
  const h = dark ? 'text-white' : 'text-slate-900';
  const p = dark ? 'text-slate-300' : 'text-slate-700';
  return `<div class="rounded-2xl border ${box} p-6 md:p-8 flex flex-col sm:flex-row gap-5 sm:items-start">
                    <span class="material-symbols-outlined text-brand text-[28px] shrink-0" aria-hidden="true">info</span>
                    <div>
                        <h2 class="text-base font-bold font-display tracking-tight ${h}">${esc(heading)}</h2>
                        <div class="mt-2 text-sm ${p} leading-relaxed max-w-3xl space-y-3">${html}</div>
                    </div>
                </div>`;
}

function registrationCard(r) {
  const href = regHref(r);
  return `<li id="${r.id}" class="flex flex-col h-full rounded-2xl border border-slate-200 bg-white p-8 scroll-mt-28 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${r.icon}</span>
                        <a href="${href}" class="group/card">
                            <h3 class="mt-4 text-xl font-bold font-display tracking-tight text-slate-900 group-hover/card:text-brand transition-colors">${esc(r.name)}</h3>
                        </a>
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(r.tagline)}</p>

                        <p class="mt-6 flex items-baseline gap-2">
                            <span class="text-4xl font-black font-display tracking-tight text-slate-900">${regFee(r)}</span>
                            <span class="text-sm font-bold text-slate-500">${regFeeLabel(r)}</span>
                        </p>
                        ${
                          r.feeAlt
                            ? `<p class="mt-1 text-sm text-slate-600">${rupees(r.feeAlt.amount)} ${esc(r.feeAlt.label)}</p>`
                            : ''
                        }
                        <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-brand">${esc(r.feeNote)}</p>

                        ${
                          r.warn
                            ? `<p class="mt-5 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm text-slate-700 leading-relaxed">${r.warn}</p>`
                            : ''
                        }

                        <div class="mt-6 pt-6 border-t border-slate-100">
                            <h4 class="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">Who needs it</h4>
                            <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(r.who)}</p>
                        </div>

                        <div class="mt-6">
                            <h4 class="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">What we need from you</h4>
                            <ul class="mt-3 grid gap-2 text-sm text-slate-600">
                                ${r.needs
                                  .map(
                                    (n) => `<li class="flex items-start gap-2">
                                    <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                                    <span>${esc(n)}</span>
                                </li>`
                                  )
                                  .join('\n                                ')}
                            </ul>
                        </div>

                        <p class="mt-6 text-sm text-slate-500 leading-relaxed">${esc(r.note)}</p>
                        <a href="${href}" class="mt-auto pt-6 inline-flex items-center gap-2 text-sm font-bold text-brand hover:gap-3 transition-all">
                            ${esc(r.name)} in detail
                            <span class="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                        </a>
                    </li>`;
}

const registrationsBody = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Registrations', url: '/registrations/' }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Legal &amp; Compliance</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">Registrations, filed for you.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">GST, Udyam (MSME), FSSAI and Startup India recognition, prepared, filed and followed up until the certificate is in your hands, plus ISO certification issued by us, consulting on NSDC, Skill India and affiliation applications, and Class 3 digital signature certificates. Flat professional fees, published below, with government charges separate and quoted before you commit.</p>

                ${ctaRow({
                  waText: REG_ENQUIRY,
                  waLabel: 'WhatsApp us',
                  email: ORG.legal,
                  subject: 'Registration enquiry',
                  emailLabel: `Email ${ORG.legal}`,
                })}

                <ul class="mt-16 grid gap-5 lg:grid-cols-3">
                    ${REGISTRATIONS.map(registrationCard).join('\n                    ')}
                </ul>

                <div class="mt-8">
                    ${noticePanel(
                      'About our ISO certificate',
                      `<p>It is issued by Vybe Technologies and is <strong>not accredited</strong> by NABCB, by any member of the International Accreditation Forum, or by any other accreditation body. It carries no accreditation mark and is verifiable on our own portal and nowhere else.</p>
                        <p>If a customer, a tender, a regulator or an overseas buyer requires an accredited certificate, ours is not it, and we will tell you so rather than sell it to you. Ask them whether accreditation is required before you buy an ISO certificate from us or from anybody. The whole position is set out on the <a href="/registrations/iso-certification/" class="font-bold text-brand hover:underline">ISO certification page</a>.</p>`
                    )}
                </div>

                <div class="mt-8 rounded-2xl border border-slate-200 bg-white/70 p-6 md:p-8 flex flex-col sm:flex-row gap-5 sm:items-start">
                    <span class="material-symbols-outlined text-brand text-[28px] shrink-0" aria-hidden="true">gavel</span>
                    <div>
                        <h2 class="text-base font-bold font-display tracking-tight text-slate-900">Something else to register?</h2>
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed max-w-3xl">The list above is what we file day to day. Other registrations and filings start at <strong>&#8377;499 plus government charges</strong>. Tell us what you need at <a href="mailto:${ORG.legal}" class="font-bold text-brand hover:underline">${ORG.legal}</a> and we will say plainly whether it is something we take on. We would rather turn a filing down than learn on your paperwork.</p>
                    </div>
                </div>
            </div>
        </section>

        <section class="bg-corporate dark-section text-slate-300 py-20 md:py-28 px-6 relative z-10" aria-labelledby="reg-fees-heading">
            <div class="max-w-4xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">What you actually pay</p>
                <h2 id="reg-fees-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-white">Our fee, and the government's, kept apart.</h2>
                <p class="mt-5 text-lg leading-relaxed text-slate-300 max-w-3xl">Two different things end up on one invoice everywhere else, which is how a &#8377;199 filing turns into a bill nobody recognises. Here they stay separate.</p>
                <div class="mt-12 grid gap-8 sm:grid-cols-2">
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-8">
                        <h3 class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Our professional fee</h3>
                        <p class="mt-4 text-white leading-relaxed text-sm">&#8377;199 for GST, &#8377;199 for Udyam (MSME), &#8377;299 for FSSAI, &#8377;999 for DPIIT recognition, and &#8377;2,299 for an ISO certificate, or &#8377;1,599 if you are a startup. Flat, published, and the same whether an application goes through first time or needs a clarification answered. NSDC, Skill India and affiliation work is consulting rather than filing, so it is scoped and quoted before anything starts. Digital signature certificates start at &#8377;1,500 for two years, with the USB token at &#8377;599 if you need one.</p>
                    </div>
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-8">
                        <h3 class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Government charges</h3>
                        <p class="mt-4 text-white leading-relaxed text-sm">Whatever the department levies for your category, charged at actuals with nothing added. GST, Udyam and DPIIT recognition carry no government fee at all. FSSAI does, and it changes with the licence type and the number of years, so we quote the exact figure before you commit. ISO certification is not a government registration, so nothing arises there either. A digital signature certificate is priced by the Certifying Authority rather than by a department, and the figure we quote is the whole cost.</p>
                    </div>
                </div>
            </div>
        </section>

${faqSection(regFaqs, { dark: false })}
${relatedSection('registrations', { dark: false })}
</div>`;

{
  const url = '/registrations/';
  const lastmod = lastmodFor(url, registrationsBody);
  DOCS.push({
    file: 'registrations/index.html',
    priority: '0.8',
    changefreq: 'monthly',
    page: {
      url,
      nav: 'registrations',
      title: 'GST, MSME & FSSAI Registration from ₹199 | Vybe',
      ogTitle: 'Business registrations: GST, Udyam, FSSAI, DPIIT, ISO and DSC',
      description:
        'GST and Udyam (MSME) at ₹199, FSSAI at ₹299, Startup India at ₹999, ISO from ₹1,599 and Class 3 DSC from ₹1,500. Professional fees, government charges separate.',
      lastmod,
      trail: [CRUMB_HOME, { name: 'Registrations', url }],
      faqs: regFaqs,
      body: registrationsBody,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: 'Business registration services',
        serviceType: 'Business registration and licensing',
        description:
          'Preparation and filing of GST registration, Udyam (MSME) registration, FSSAI registration and licences and DPIIT / Startup India recognition at a flat professional fee with government charges payable separately at actuals, plus non-accredited ISO 9001, ISO 22000 and ISO 27001 certification issued by Vybe Technologies advisory support on NSDC / Skill India training partner registration and affiliation applications, and supply of Class 3 digital signature certificates as a registered partner of the Certifying Authorities eMudhra and Capricorn.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
        url: u,
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Registrations',
          itemListElement: REGISTRATIONS.map((r) => ({
            '@type': 'Offer',
            name: r.name,
            ...(r.fee === null ? {} : { price: String(r.fee) }),
            priceCurrency: 'INR',
            description: r.offerNote
              ? `${r.tagline} ${r.offerNote}`
              : r.fee === null
                ? `${r.tagline} Advisory engagement, quoted per engagement.`
                : `${r.tagline} Professional fee only; government charges, where any apply, are payable separately at actuals.`,
            url: SITE + regHref(r),
            itemOffered: { '@type': 'Service', name: r.name, provider: { '@id': `${SITE}/#organization` } },
          })),
        },
      }),
    },
  });
}

/* -------------------------------------------- registrations, one page each */

/**
 * A page per registration. Someone searching for "FSSAI licence for a cloud
 * kitchen" should land on a page about FSSAI, not on a hub that mentions it in
 * a card. Content comes from REGISTRATIONS, so the hub, the nav and these
 * cannot drift apart.
 */
for (const r of REG_PAGES) {
  const url = regHref(r);
  const enquiry = `Hi Vybe, I would like help with ${r.name.replace(/\s*\(non-accredited\)/, '')}.`;

  const body = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Registrations', url: '/registrations/' }, { name: r.name, url }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Legal &amp; Compliance</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">${esc(r.h1)}</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">${esc(r.lede)}</p>

                <p class="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span class="text-5xl font-black font-display tracking-tight text-slate-900">${regFee(r)}</span>
                    <span class="text-sm font-bold text-slate-500">${regFeeLabel(r)}</span>
                    ${r.feeAlt ? `<span class="text-sm text-slate-600">&middot; ${rupees(r.feeAlt.amount)} ${esc(r.feeAlt.label)}</span>` : ''}
                </p>
                <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-brand">${esc(r.feeNote)}</p>

                ${ctaRow({
                  waText: enquiry,
                  waLabel: 'WhatsApp us',
                  email: ORG.legal,
                  subject: `${r.name} enquiry`,
                  emailLabel: `Email ${ORG.legal}`,
                })}

                ${
                  r.id === 'iso'
                    ? `<div class="mt-12">${noticePanel(
                        'What "non-accredited" means, in plain words',
                        `<p>This certificate is issued by <strong>Vybe Technologies</strong>. We are <strong>not</strong> a certification body accredited by NABCB, by any other member of the International Accreditation Forum (IAF), or by any accreditation board anywhere. The certificate carries no IAF, ILAC or NABCB mark, and it must not be presented, described or displayed as though it does.</p>
                        <p>ISO itself does not certify anybody. ISO writes the standards; certification is always done by a third party, and it is the accreditation sitting behind that third party that gives a certificate weight with a regulator, an overseas buyer or a large tender.</p>
                        <p>Our certificate is verifiable in exactly one place: our own portal. Anyone can check the number and see who holds it, against which standard, for what scope and until when.</p>
                        <p><strong>So, plainly:</strong> if a customer, a tender, a regulator or an overseas buyer requires an <em>accredited</em> certificate, this is not it, and we will tell you that rather than take your money. Ask them whether accreditation is required before you buy an ISO certificate from us or from anyone else.</p>`
                      )}</div>`
                    : ''
                }

                <div class="mt-12 grid gap-5 md:grid-cols-2">
                    <div class="rounded-2xl border border-slate-200 bg-white p-8">
                        <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Who needs it</h2>
                        <p class="mt-4 text-slate-600 leading-relaxed">${esc(r.who)}</p>
                        <p class="mt-4 text-sm text-slate-500 leading-relaxed">${esc(r.note)}</p>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-white p-8">
                        <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">What we need from you</h2>
                        <ul class="mt-4 grid gap-3 text-sm text-slate-600">
                            ${r.needs
                              .map(
                                (n) => `<li class="flex items-start gap-2">
                                <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                                <span>${esc(n)}</span>
                            </li>`
                              )
                              .join('\n                            ')}
                        </ul>
                    </div>
                </div>
            </div>
        </section>

${proseSections({
  id: `${r.slug}-detail`,
  eyebrow: 'In detail',
  heading: r.name,
  sections: r.sections,
})}

${faqSection(r.faqs, { dark: false })}

${siblingSection({
  eyebrow: 'More from legal',
  heading: 'The rest of what we file.',
  items: [
    { href: '/registrations/', icon: 'receipt_long', name: 'All registrations', blurb: 'Every filing we take on, with the fees side by side.' },
    ...REG_PAGES.filter((o) => o.slug !== r.slug).map((o) => ({ href: regHref(o), icon: o.icon, name: o.name, blurb: o.tagline })),
  ],
})}
${relatedSection('registrations', { dark: false })}
</div>`;

  const lastmod = lastmodFor(url, [r.metaTitle, r.metaDescription, body].join('\n'));

  DOCS.push({
    file: `registrations/${r.slug}/index.html`,
    priority: '0.7',
    changefreq: 'monthly',
    page: {
      url,
      nav: r.nav,
      title: r.metaTitle,
      ogTitle: r.name,
      description: r.metaDescription,
      lastmod,
      trail: [CRUMB_HOME, { name: 'Registrations', url: '/registrations/' }, { name: r.name, url }],
      faqs: r.faqs,
      body,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: r.name,
        serviceType:
          r.id === 'iso'
            ? 'Management system certification (non-accredited)'
            : r.id === 'dsc'
              ? 'Digital signature certificate supply'
              : r.fee === null
                ? 'Registration and affiliation consulting'
                : 'Business registration and licensing',
        description: r.metaDescription,
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
        url: u,
        isRelatedTo: { '@id': `${SITE}/registrations/#service` },
        offers: {
          '@type': 'Offer',
          ...(r.fee === null ? {} : { price: String(r.fee) }),
          priceCurrency: 'INR',
          description: r.offerNote ?? (r.fee === null ? r.feeNote : `Professional fee. ${r.feeNote}.`),
          url: u,
        },
      }),
    },
  });
}

/* ----------------------------------------------------------------- audits */

/**
 * Vybe audits. We read a site against a published standard and write down what
 * would fail, then issue our own certificate and badge where it passes.
 *
 * Two naming rules run through this whole section and exist for legal reasons
 * rather than stylistic ones:
 *
 *   1. Every audit is a *Vybe* audit. `name` carries the prefix, always. The
 *      standard it is read against is a separate field, `standard`, rendered
 *      as a description of the yardstick and never as a badge of approval.
 *      "Vybe Hygiene & Food Safety Audit: FSSAI Schedule 4 standard" is a
 *      true sentence; "FSSAI audit" is not one, and nothing here says it.
 *
 *   2. The certificate and badge are ours and nobody else's. We are not
 *      accredited by, affiliated to, appointed by or recognised by FSSAI, the
 *      fire services, any Pollution Control Board, NAAC, NIRF, the Labour
 *      Department, the Data Protection Board or any other authority. That is
 *      said on the hub, on every group page and on the certificate itself, in
 *      the same words the non-accredited ISO certificate uses, because it is
 *      the same disclosure problem.
 *
 * `notStatutory` on each audit carries the specific version of it: what
 * "unofficial" means for a fire audit is not what it means for a POSH one.
 *
 * Grouped by who buys them rather than by which law they sit under. A school
 * buying a fire audit is usually also buying the canteen and the bus one.
 */
const AUDIT_GROUPS = [
  {
    id: 'kitchen',
    slug: 'kitchen-food-safety',
    nav: 'audit-kitchen',
    icon: 'soup_kitchen',
    name: 'Kitchen & food business audits',
    short: 'Kitchens & food businesses',
    tagline: 'Restaurants, cloud kitchens, bakeries, caterers and canteens, read against Schedule 4.',
    h1: 'Kitchen audits, before the inspection.',
    lede:
      'Restaurants, cloud kitchens, bakeries, caterers and contract canteens, walked through against Schedule 4 of the FSSAI regulations. You get a written report with photographs, findings graded by what actually matters, a fix list you can work down, and a Vybe certificate and badge where it passes. It is not an FSSAI inspection and the certificate is ours, not FSSAI’s.',
    metaTitle: 'Kitchen Hygiene Audit: FSSAI Schedule 4 Standard | Vybe',
    metaDescription:
      'Hygiene and food safety audit to the FSSAI Schedule 4 standard, in Bengaluru. Report, graded fix list, Vybe certificate and badge. Not an FSSAI inspection.',
    audits: [
      {
        id: 'fssai-hygiene',
        icon: 'clean_hands',
        name: 'Vybe Hygiene & Food Safety Audit',
        standard: 'FSSAI Schedule 4 standard',
        tagline:
          'Your kitchen read against Schedule 4, line by line, before somebody official reads it for you.',
        covers: [
          'Raw material receipt, storage and the cold chain, including whether the fridge thermometer is read or just present',
          'Food handling, segregation of raw and cooked, and temperature control through cooking, holding and service',
          'Cleanliness: surfaces, equipment, chimney and duct, and whether a cleaning schedule exists and is signed',
          'Pest control evidence, entry-point proofing and the condition of drains and traps',
          'Staff hygiene: hand-wash points where they are needed, protective clothing, medical fitness records, food handler training',
          'Potable water and its testing records, ice, and the water used for washing produce',
          'Waste segregation, bin condition and how often waste actually leaves the premises',
          'Records and traceability: supplier bills, batch and expiry, and the register nobody has filled in since March',
        ],
        basis:
          'Schedule 4 of the Food Safety and Standards (Licensing and Registration of Food Businesses) Regulations, 2011. The Part that applies to you depends on whether you are a petty operator, a restaurant or a manufacturer.',
        notStatutory:
          'This is a Vybe audit conducted to the Schedule 4 standard. It is not an FSSAI inspection, and it is not a third-party audit by an FSSAI-recognised auditing agency under the Food Safety and Standards (Food Safety Auditing) Regulations, 2018. <strong>We are not affiliated to or recognised by FSSAI</strong>, the certificate we issue is ours alone, and none of this changes your licence, your inspection history or your hygiene rating.',
      },
      {
        id: 'kitchen-layout',
        icon: 'architecture',
        name: 'Vybe Kitchen Layout & Workflow Audit',
        standard: 'FSSAI Schedule 4 layout & HACCP flow',
        tagline:
          'Where raw crosses cooked, where the bin sits, and why the same station keeps failing.',
        covers: [
          'Cross-contamination risk: where raw meat, cooked food, produce and allergens share a surface, a board, a sink or a hand',
          'The line from receiving to storage to prep to cooking to plating to service, and where it doubles back on itself',
          'Separation of vegetarian and non-vegetarian preparation where you run both, which is a commercial problem as much as a food safety one',
          'Hand-wash point placement, because a basin at the wrong end of the kitchen is a basin nobody uses',
          'Dishwash and pot-wash flow, and whether clean ware travels back through the dirty side',
          'Waste route and bin siting: how far waste travels across the kitchen, and past what',
          'Ventilation, extraction and make-up air, and the grease load in the duct',
          'Floor drainage, gradient and standing water, which is where the pest problem usually starts',
        ],
        basis:
          'Schedule 4 layout and hygiene requirements, read alongside ordinary HACCP flow logic. Where a finding needs a drawing changed, we say so and mark it as a project rather than a fix.',
        notStatutory:
          'A Vybe advisory review, not a statutory or structural certification, and not a substitute for a licensed architect or MEP consultant where the answer is a wall moved or a duct rerouted.',
      },
      {
        id: 'pest-control',
        icon: 'pest_control',
        name: 'Vybe Pest Control Compliance Check',
        standard: 'FSSAI Schedule 4 pest control records',
        tagline:
          'The contract, the records and the evidence of treatment, checked against what is actually on site.',
        covers: [
          'The contract itself, and what it commits your vendor to as against what you assumed it did',
          'Treatment frequency against the schedule, and the gaps nobody noticed',
          'Service records, technician sign-offs and whether the dates on paper match anything on site',
          'Bait stations, fly-catchers and glue boards: mapped, numbered, serviced, or three of them missing',
          'Chemicals used, their labels, and whether they are approved for use in a food area',
          'Evidence of follow-up: a finding raised in one visit and closed in the next, or raised every visit for a year',
          'Proofing of entry points: gaps under doors, unscreened windows, service penetrations, drain covers',
          'The exact documents an auditor or an inspector asks to see, and whether you could produce them today',
        ],
        basis:
          'Schedule 4 pest control requirements, and the record-keeping any food safety auditor will ask for.',
        notStatutory:
          'We audit the pest control programme. We are not a pest control operator, we do not carry out treatment, and we have no arrangement with any vendor whose records we review.',
      },
    ],
    sections: [
      {
        h: 'Why a Vybe audit is worth anything',
        p: 'Because the official one is not a conversation. An FSSAI inspection, a customer’s audit or an aggregator’s hygiene check arrives, looks, and writes down what it finds, and by then the finding exists. A Vybe audit is the same walk with none of the consequences attached: the same cupboards opened, the same records asked for, the same questions put to the same staff, and a written answer you can act on while acting on it is still cheap. The value is entirely in the gap between the two, and nothing about our certificate is meant to close that gap on paper instead of in the kitchen.',
      },
      {
        h: 'What we actually do on site',
        p: 'We walk the whole line, from where deliveries land to where waste leaves, in service hours rather than after a deep clean, because a kitchen that has been scrubbed for a visitor tells you nothing. Fridges get opened and temperatures read. Records get asked for: supplier bills, water test reports, medical fitness certificates, the pest control file, the cleaning schedule. The answer "it is with the accountant" is itself a finding. We talk to the people actually handling food, not only to the manager, because the gap between the written procedure and the practised one is most of what an audit is for.',
      },
      {
        h: 'What the report looks like',
        p: 'A written report with photographs, delivered within a few working days. Every finding names the Schedule 4 requirement it is read against, so it is arguable rather than a matter of opinion, and is graded: things that would fail an inspection or make somebody ill, things that would draw a comment, and things worth doing when you next have the kitchen closed. The fix list is ordered the same way. We would rather hand you six findings you will act on than sixty you will file.',
      },
      {
        h: 'Where our opinion stops',
        p: 'We read a kitchen against a published standard and we tell you what we see. We do not test food, we do not test water. We look at whether you have had it tested and by whom, and we do not certify anything to anybody else’s standard but our own. Where a finding needs a licensed professional, an electrical contractor, a food technologist, a structural engineer, we say so and we say to bring one in. The report and the certificate are documents from us, for you and for whoever you choose to show them to, and they carry no standing with any regulator.',
      },
    ],
    faqs: [
      {
        q: 'Is this an FSSAI audit?',
        a: 'No. It is a <strong>Vybe</strong> audit conducted to the FSSAI Schedule 4 standard, which is a different sentence and we are careful to say it that way. Under the Food Safety and Standards (Food Safety Auditing) Regulations, 2018 a third-party food safety audit is carried out by an auditing agency recognised by FSSAI, and the result feeds back to the authority. <strong>We are not a recognised auditing agency and we are not affiliated to FSSAI in any way.</strong> What we do is read your kitchen against the same Schedule 4 requirements and tell you what would be found. It does not go to FSSAI, it does not change your inspection history, and it does not affect your hygiene rating.',
      },
      {
        q: 'Is the certificate an FSSAI certificate?',
        a: 'No, and it does not look like one. It is a <strong>Vybe Hygiene &amp; Food Safety Certificate</strong>, issued by Vybe Technologies, carrying our name, our verification number and nobody else’s mark. It says your kitchen was audited by us to the Schedule 4 standard on a date and met our threshold. It is not an FSSAI licence, an FSSAI approval or an FSSAI hygiene rating, it must not be displayed or described as though it were, and your actual FSSAI licence is a separate thing we can also <a class="text-brand font-bold" href="/registrations/fssai/">file for you</a>.',
      },
      {
        q: 'Will the audit shut the kitchen for a day?',
        a: 'No. We walk a working kitchen during working hours, which is the whole point. A kitchen cleaned for a visitor is not the kitchen an inspector sees. A typical single-outlet audit is two to four hours on site, most of which is us staying out of the way. The records review usually takes longer than the walk.',
      },
      {
        q: 'What does it cost?',
        a: `It is quoted rather than published, because a twelve-seat café and a central production kitchen feeding four outlets are not the same job. The things that move the number are floor area, how many kitchens and stores there are, whether the pest control and records review is included, and whether you want the re-check afterwards. Tell us what you run on <a class="text-brand font-bold" href="${waLink(
          'Hi Vybe, I would like a quote for a kitchen hygiene audit.'
        )}" target="_blank" rel="noopener">WhatsApp</a> and you will have a figure before anything is booked.`,
      },
      {
        q: 'Do you fix what you find?',
        a: 'Some of it. Signage, records, schedules, the display material Schedule 4 asks for and the training register are things we can put right as part of the work. Anything that needs a contractor (a new exhaust, a floor regraded, a wall tiled) we describe precisely enough that you can get it quoted, and we do not take a cut from whoever quotes it. We also do not require you to use us for the fixes to get the re-check.',
      },
      {
        q: 'Can you audit a cloud kitchen or a home-based food business?',
        a: 'Yes, and the smaller ones are often where it matters most, because a cloud kitchen carries all the food safety risk of a restaurant with none of the staff to spread the work across. The standard is the same Schedule 4; what changes is how much of it applies. If you are also still unregistered, an <a class="text-brand font-bold" href="/registrations/fssai/">FSSAI registration or licence</a> is a separate piece of work and we will say which one you need.',
      },
    ],
  },

  {
    id: 'institutions',
    slug: 'schools-institutions',
    nav: 'audit-institutions',
    icon: 'school',
    name: 'School, college & institute audits',
    short: 'Schools & institutions',
    tagline: 'Fire, canteen, child safety, transport, campus security and a NAAC/NIRF-ready SDG audit, on one campus visit.',
    h1: 'Campus audits, read against the rules that apply.',
    lede:
      'Fire and electrical safety, the canteen or mess, child protection, the bus fleet, campus security, and an SDG and sustainability audit built the way NAAC and NIRF ask for it. Most campuses need several of these and most of them are found by the same walk, so they are usually done together. Every one is a Vybe audit: the certificate at the end is ours, not an NOC, an accreditation or a government approval.',
    metaTitle: 'School Safety & SDG Audits: Fire, POCSO, Bus, NAAC | Vybe',
    metaDescription:
      'Audits for schools and colleges in Bengaluru: fire, canteen hygiene, child safety, bus safety, security and a NAAC/NIRF-ready SDG audit. Not a fire NOC.',
    audits: [
      {
        id: 'fire-safety',
        icon: 'local_fire_department',
        name: 'Vybe Fire Safety Audit',
        standard: 'NBC 2016 Part 4 standard',
        tagline:
          'Preparation and assessment: exits, extinguishers, alarms, drills and the wiring behind all of it.',
        covers: [
          'Exit routes, travel distances, staircase widths and whether the second exit is a door or a store room',
          'Extinguisher type against the risk, placement, pressure, refill dates, and whether anyone on the floor can use one',
          'Hose reels, wet risers, pumps, tanks and detection, and whether the system has been tested rather than installed',
          'Alarm audibility in every block, including the ones added later, and manual call point placement',
          'Emergency lighting, exit signage and the assembly point nobody has actually walked to',
          'Evacuation drill records, dates, timings and who was counted. This is the single most common gap on a campus',
          'Electrical: load against sanctioned, DB and panel condition, earthing, visible wiring, extension boards, lab supplies',
          'Generator, transformer and panel rooms, and what is being stored in them',
          'Kitchen, lab, library and store rooms, which carry a different fire load from a classroom',
        ],
        basis:
          'The National Building Code of India 2016, Part 4 (Fire and Life Safety), which sets the requirements for educational occupancies and is the basis on which a fire NOC is granted. Buildings above the occupancy and height thresholds in Part 4, commonly cited as 500 or more occupants for an educational building, are the ones where a fire clearance is insisted upon.',
        notStatutory:
          'A Vybe audit to the NBC standard: preparation for, not a substitute for, the statutory process. <strong>We are not the fire department and we are not affiliated to it.</strong> We do not conduct the inspection that leads to a No Objection Certificate and we cannot issue one. In Karnataka that is the Fire and Emergency Services Department. Our certificate is not an NOC and must never be shown as one. What the audit does is find what they would find, while there is still time to fix it.',
      },
      {
        id: 'canteen-hygiene',
        icon: 'restaurant',
        name: 'Vybe Canteen & Mess Hygiene Audit',
        standard: 'FSSAI Schedule 4 standard',
        tagline:
          'The same Schedule 4 walk as a commercial kitchen, plus the contractor sitting between you and it.',
        covers: [
          'Everything in the kitchen hygiene audit: storage, handling, temperatures, cleaning, pest control, staff hygiene, water, waste and records',
          'The contractor’s own FSSAI licence, its validity, and whether it names your premises',
          'Medical fitness and food handler training for staff the contractor employs but who work on your campus',
          'The food actually served against the menu that was approved, and the portion and quality complaints behind it',
          'Serving temperature, holding times and what happens to leftovers',
          'Sampling and retention of a serving, which matters enormously the day somebody falls ill',
          'Drinking water, coolers, RO units and their service records',
          'Whether the contract gives you the right to inspect, and what it says happens when you find something',
        ],
        basis:
          'Schedule 4 of the FSS (Licensing and Registration) Regulations, 2011, read alongside your contract with the canteen operator and any mid-day meal or hostel mess requirement that applies.',
        notStatutory:
          'A Vybe audit to the Schedule 4 standard. Not an FSSAI inspection of the contractor, not affiliated to FSSAI, and it does not affect their licence. It does give you something in writing to put in front of them.',
      },
      {
        id: 'child-safety',
        icon: 'child_care',
        name: 'Vybe Child Safety Audit',
        standard: 'POCSO Act 2012 standard',
        tagline:
          'Police verification, a policy people have read, visitor control, camera coverage and safe dispersal.',
        covers: [
          'Police verification of teaching staff, non-teaching staff, drivers, attendants, housekeeping and every contract worker on campus',
          'A written child protection policy that exists, is current, and that staff can tell you the contents of',
          'POCSO mandatory reporting: who reports, to whom, within what time, and whether the staff who would first hear something know that failing to report is itself an offence',
          'Visitor entry, identity checks, badging and escort, including for parents and for vendors',
          'CCTV coverage of corridors, gates, stairwells and the blind spots nobody mapped; retention period; and who is able to view footage',
          'Safe dispersal: gate handover, who is allowed to collect a child, and what happens when somebody else arrives',
          'Complaint routes a child could actually use, and whether anything has ever come through them',
          'Awareness sessions for children and for staff, and the records of them',
        ],
        basis:
          'The Protection of Children from Sexual Offences Act, 2012, particularly the mandatory reporting obligation in section 19, the Juvenile Justice (Care and Protection of Children) Act, 2015, and the school safety guidelines issued by CBSE and by state authorities.',
        notStatutory:
          'A Vybe review of your arrangements against the POCSO standard. It is not a legal opinion, not an investigation of any incident or allegation, and it does not discharge any obligation the law places on you. <strong>No certificate from us makes a campus safe or compliant</strong>. It records what we found on a date. Where something we find looks like it needs a lawyer or a report to the authorities, we will say so in plain words on the day and we will not sit on it.',
      },
      {
        id: 'transport-safety',
        icon: 'directions_bus',
        name: 'Vybe Transport Safety Audit',
        standard: 'CMVR & school bus rules standard',
        tagline:
          'Papers, speed governors, GPS, attendants and drivers, checked against the fleet as it stands today.',
        covers: [
          'Fitness certificate, permit, insurance and PUC for every vehicle, with the expiry dates in one place',
          'Speed governor fitment, seal and whether it works, rather than whether it is fitted',
          'GPS tracking, the panic button, and who is watching the screen it reports to',
          'CCTV inside the vehicle, its recording and its retention',
          'Driver licence, badge, endorsement, years of experience, police verification and medical and eyesight checks',
          'A female attendant on routes carrying young children, and whether she is verified too',
          'First aid kit, fire extinguisher, emergency exit, and whether the exit opens',
          'Seating capacity against the number of children actually carried, which is where most fleets fail',
          'Route plans, stop locations, timings, and pick-up and drop registers that are signed rather than printed',
          'Driver conduct, phone use and the complaint route a parent would use',
        ],
        basis:
          'The Central Motor Vehicles Rules and the state school bus and school cab rules made under them, together with the school transport safety directions issued by the transport department and the courts.',
        notStatutory:
          'We check papers and condition against the requirements and report what is missing. This is not an RTO fitness inspection, we are not affiliated to the transport department, we do not issue or renew any vehicle certificate, and our certificate is not a fitness certificate.',
      },
      {
        id: 'campus-security',
        icon: 'shield',
        name: 'Vybe Campus Security Audit',
        standard: 'Campus safety guidance standard',
        tagline:
          'Camera coverage that is really coverage, access control, boundaries and what happens in an incident.',
        covers: [
          'A camera-by-camera coverage map, the blind spots it reveals, and whether the recorder is actually recording',
          'Retention period, storage health, and who holds the password',
          'Gate and access control, staff and student identification, and after-hours access',
          'Visitor management, vendor access and deliveries',
          'Boundary wall, fencing, gates and the informal entrance everybody uses',
          'Controlled areas: labs, terrace, water tanks, electrical rooms, sports equipment stores and the chemistry store in particular',
          'Security staffing, shift cover, night cover and what the guard is actually instructed to do',
          'Incident and lockdown procedure, the emergency contact tree, and whether anyone has tested it',
          'First aid provision, the infirmary and the nearest hospital, with the route and the time',
        ],
        basis:
          'Campus safety guidance from CBSE and state education departments, read alongside ordinary physical security practice. Where the finding touches fire or transport, it is cross-referenced to those audits rather than repeated.',
        notStatutory:
          'A Vybe advisory audit. Not a police or regulatory inspection, and not a penetration test of your IT systems. If that is what you want, it sits under <a class="text-brand font-bold" href="/it-solutions/">IT and cyber</a> rather than here.',
      },
      {
        id: 'sdg-sustainability',
        icon: 'eco',
        name: 'Vybe SDG & Sustainability Audit',
        standard: 'NAAC / NIRF-ready, mapped to the UN SDGs',
        tagline:
          'The green audit, evidenced the way NAAC and NIRF ask for it: energy, waste, water and curriculum, each tied to the Goal it answers to.',
        covers: [
          'Energy consumption and efficiency: block-by-block load, connected against sanctioned, lighting and HVAC retrofits, solar generation against what it was sized for, and the meters nobody reads (SDG 7 and SDG 13)',
          'Waste management and recycling: segregation at source, the wet, dry, e-waste and sanitary streams, who collects each and under what authorisation, composting, and what actually happens after the gate (SDG 11 and SDG 12)',
          'Water conservation: consumption per head, rainwater harvesting structures and whether they are connected to anything, the STP and its log, treated water reuse, leaks and borewell dependence (SDG 6)',
          'Campus sustainability practice: single-use plastic across the canteen, events and the stationery store, green cover and tree census, biodiversity register, procurement, and emissions from the fleet',
          'Curriculum and pedagogy: where sustainability actually appears in teaching, projects, eco-club activity and student research, which is the part NAAC asks about and the part a generic green audit skips (SDG 4)',
          'Governance: the environment policy, the committee behind it, the budget line, and whether last year’s actions were ever closed',
          'The SDG map itself: every finding tied to the specific Goal and target it answers to, so it can be quoted rather than paraphrased',
          'The evidence file assembled in one place, rather than reconstructed the week before a submission is due',
        ],
        basis:
          'The UN Sustainable Development Goals, structured against the environment, energy and sustainability expectations in NAAC’s Criterion 7 and the criteria NIRF scores, and read alongside the Solid Waste Management Rules 2016, E-Waste (Management) Rules 2022 and Plastic Waste Management Rules 2016 so far as they apply to a campus.',
        notStatutory:
          '"NAAC/NIRF-ready" means the audit is structured and evidenced the way those frameworks ask for. It does not mean either body has approved, endorsed or scored anything. <strong>We are not NAAC, not NIRF, not a Pollution Control Board and not an accredited environmental auditor, and we are not affiliated to any of them.</strong> This is also not the statutory Environmental Statement (Form V) filed under the Environment (Protection) Rules, 1986, not a Consent to Operate, and not an eco-label. The certificate is a Vybe certificate and contributes no marks to any accreditation of itself.',
      },
    ],
    sections: [
      {
        h: 'Most campuses buy these together, and should',
        p: 'The audits above are separated because they answer to different rules, not because they are different visits. The walk that finds a fire exit chained shut is the walk that finds the chemistry store unlocked, the camera pointing at a wall and the mess storing rice on the floor. Doing them in one go costs less than doing them in four, and it produces one report with one fix list rather than four that contradict each other on priority. Where a campus wants only one, it is usually fire, and that is a reasonable place to start.',
      },
      {
        h: 'Fire is where the gap is widest',
        p: 'Almost every campus we have walked has extinguishers. Rather fewer have extinguishers of the right type in the right places with current refill dates, and fewer still have anybody on the floor who has held one. The pattern repeats: the hardware exists because somebody bought it, and the practice does not because nobody owns it. Drill records are the clearest tell. A campus that drills twice a year, times it, and writes down what went wrong is a campus that will be fine in an inspection and, far more to the point, in a fire. A campus with a drill photograph from 2022 is neither.',
      },
      {
        h: 'The child safety audit is the uncomfortable one',
        p: 'It has to be. Police verification is where it usually starts and it is usually incomplete. Teaching staff are verified, the housekeeping contractor’s people are not, and the van driver is somebody’s cousin. Then there is the policy, which exists as a PDF nobody has read, and mandatory reporting under section 19 of POCSO, which a surprising number of staff do not know binds them personally. We ask these questions of the people who would actually receive a disclosure from a child, because asking the principal tells you what the school intends rather than what it does. Where we find something serious, you will hear it from us immediately and in plain words, not in a report three days later.',
      },
      {
        h: 'Why the SDG audit is not a generic green audit',
        p: 'Because a generic green audit produces a folder about waste bins, and an accreditation team asks a different question. NAAC wants sustainability evidenced across governance, practice and, critically, curriculum: what students are actually taught and what they actually do, with a policy, a committee, a budget line and closed actions behind it. NIRF wants numbers you can defend. So the audit is built to produce that: energy, waste and water measured rather than described, every finding mapped to the specific Sustainable Development Goal and target it answers to, and the evidence assembled in one file instead of reconstructed the week before a submission. Institutions that already have a green audit report usually find the gap is not the environment work, it is that none of it is written down in a form anybody can score.',
      },
      {
        h: 'What you get, and what it is worth',
        p: 'A written report per audit with photographs, delivered within a few working days of the visit. Every finding cites the rule, the code clause, the guideline or the Goal it is read against, so it can be argued with on its merits rather than taken on our say-so. Findings are graded, the fix list is ordered, and where the audit closes at or above our threshold you get a Vybe certificate and a digital badge. What that certificate is not is an NOC, an accreditation, an affiliation document or anything carrying an authority’s mark. If somebody is asking your institution for an official clearance, this is preparation for getting one, and we will tell you which department issues it.',
      },
    ],
    faqs: [
      {
        q: 'Does the fire safety audit get us a fire NOC?',
        a: 'No, and be careful of anybody who says theirs does. A No Objection Certificate is issued by the state fire services department after its own inspection. In Karnataka that is the Karnataka State Fire and Emergency Services. <strong>We are not the fire department, we are not affiliated to it, and we cannot issue or arrange a clearance.</strong> The Vybe Fire Safety Certificate records that we audited you to the NBC standard and what we found; it is not an NOC and must not be presented as one. What the audit does is find the things that would hold a clearance up, while there is still time and budget to fix them.',
      },
      {
        q: 'Is the SDG audit recognised by NAAC or NIRF?',
        a: 'No. <strong>We have no affiliation with NAAC, NIRF, the UGC or any accrediting body, and nothing we issue carries marks or standing with them.</strong> "NAAC/NIRF-ready" describes how the audit is built: measured, evidenced and mapped to specific Sustainable Development Goals, in the structure those frameworks ask questions in, so that your team is not assembling it from scratch at submission time. The assessment, the score and the accreditation remain entirely theirs to give.',
      },
      {
        q: 'Which buildings actually need a fire clearance?',
        a: 'Part 4 of the National Building Code 2016 sets the thresholds by occupancy type, height and occupant load, and educational buildings are treated as a high-priority occupancy because the occupants are children. The commonly cited figure for an educational building is an occupant load of 500 or more, but height, number of floors and basement use pull buildings in below that, and state rules add their own requirements on top. Tell us the building and we will tell you which way it falls before you commission anything.',
      },
      {
        q: 'How long does a campus audit take?',
        a: 'A single audit on a single-building school is usually most of a day. A full campus taking fire, canteen, child safety, transport, security and the SDG audit together is typically two to three days on site, depending on the number of blocks and the size of the fleet, plus the records review. The transport audit needs the buses on campus, so it is normally done early morning or after the afternoon run, and the SDG audit needs meter readings and bills, so it helps if somebody pulls the last twelve months out before we arrive.',
      },
      {
        q: 'Do you need to speak to our staff and see our records?',
        a: 'Yes, and an audit that does not is not worth buying. We ask for staff police verification records, drill logs, the AMC and service records for fire equipment, vehicle papers, the canteen contract and the contractor’s FSSAI licence, the child protection policy, and for the SDG audit twelve months of electricity and water bills and your waste vendor’s authorisation. We speak to the people who would actually be involved (the gate, the drivers, the mess staff, class teachers) rather than only to the management, because the difference between the two answers is most of what the audit finds.',
      },
      {
        q: 'Will you tell us what you find, or just write it down?',
        a: 'Both, and in that order. Anything urgent is said on the day, on site, to whoever can act on it. Anything that looks like it needs a lawyer, a licensed contractor or a report to an authority is flagged as such rather than left to be inferred from a paragraph in a report. The written report follows within a few working days.',
      },
      {
        q: 'What does a campus audit cost?',
        a: `It is scoped before it is quoted. Number of blocks, number of students, how many kitchens and buses, and how many of the six audits you want all change the number, so a published figure would be a fiction. Tell us the campus on <a class="text-brand font-bold" href="${waLink(
          'Hi Vybe, I would like a quote for a campus safety audit.'
        )}" target="_blank" rel="noopener">WhatsApp</a> or by email and you will have a scope and a figure before anything is booked.`,
      },
    ],
  },

  {
    id: 'workplace',
    slug: 'workplace-compliance',
    nav: 'audit-workplace',
    icon: 'corporate_fare',
    name: 'Office & workplace compliance audits',
    short: 'Offices & workplaces',
    tagline: 'POSH, software licensing, DPDP, labour law and the office fire basics.',
    h1: 'Workplace compliance, checked before it is checked.',
    lede:
      'The five things an office is quietly out of compliance with and does not find out about until a complaint, a vendor audit, a notice or an inspection. POSH is the one with a penalty attached and a hard trigger at ten employees, so it is where most of these start.',
    metaTitle: 'POSH, DPDP, Labour Law & Software Licence Audits | Vybe',
    metaDescription:
      'Workplace audits in Bengaluru: POSH Act and Internal Committee, DPDP data protection, software licensing, labour law and office fire safety.',
    audits: [
      {
        id: 'posh',
        icon: 'balance',
        name: 'Vybe POSH Compliance Audit',
        standard: 'POSH Act 2013 standard',
        tagline:
          'Internal Committee, policy, training and the annual report, mandatory at ten employees, with a penalty behind it.',
        covers: [
          'Whether an Internal Committee exists at all, and whether one exists at every office with ten or more employees rather than only at head office',
          'Its composition: a Presiding Officer who is a woman employed at a senior level, at least half the members women, and an external member from an NGO or with experience of issues relating to sexual harassment',
          'Whether the external member is genuinely external and is being paid the fees the Rules provide for',
          'The written policy: whether it exists, whether it says what the Act requires, and whether it has reached anybody',
          'Display at a conspicuous place of the penal consequences and the Internal Committee’s constitution, which the Act requires and almost nobody does',
          'The annual report to the District Officer, whether it has been filed, and for which years',
          'Awareness programmes for employees and orientation for IC members, and the records of both',
          'The complaint register, the procedure and the statutory timelines, and whether a complaint could be handled without improvising',
          'Coverage of interns, trainees, contract staff, probationers and people working from home, all of whom count',
        ],
        basis:
          'The Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 and the Rules made under it. The obligation to constitute an Internal Committee bites at ten or more employees.',
        penalty:
          'Failure to constitute an Internal Committee or to comply with the Act carries a fine of up to ₹50,000 for a first contravention. On a repeat, the penalty is doubled and the licence or registration under which the business operates can be cancelled or not renewed.',
        notStatutory:
          'We review your arrangements and report on them. We do not sit on your Internal Committee, we do not conduct inquiries into complaints, and neither the audit nor the certificate files your annual report or discharges any obligation under the Act. <strong>A Vybe certificate is not a finding of compliance by any authority</strong> and would not answer a District Officer. Where you need an external IC member or a lawyer, we will say so.',
      },
      {
        id: 'software-licence',
        icon: 'verified_user',
        name: 'Vybe Software Licence & IT Asset Audit',
        standard: 'Licence terms & Copyright Act 1957',
        tagline:
          'What is installed against what is paid for, counted by you before it is counted by somebody else.',
        covers: [
          'An inventory of what is actually installed across machines, against what has actually been bought',
          'Invoices, licence keys and proof of purchase matched to specific devices rather than kept in a folder called Software',
          'Per-user versus per-device licensing, and whether the count is genuinely met under the metric that applies',
          'OEM, retail and volume licensing, and the OEM licence that left with the laptop it was tied to',
          'Operating system licensing, server licences and client access licences, which is where the money usually is',
          'Unlicensed, cracked or key-generated installs, including the one on the machine in the corner',
          'Open-source components used commercially, and whether their licence terms are being met',
          'Fonts, stock photography and design files, which are licensed assets and are almost never tracked',
          'Subscriptions being paid for and not used, which is the part of this audit that pays for it',
          'What happens to a licence when a laptop is reassigned, and when an employee leaves',
        ],
        basis:
          'Your own licence agreements and the terms of the products you run. The exposure is contractual and under the Copyright Act, 1957, and it typically arrives as a letter from a vendor or from an industry body such as the BSA rather than as a government inspection.',
        notStatutory:
          'We are not the BSA, not a Microsoft SAM engagement, and not an OEM auditor, and we are not affiliated to any software vendor. Nothing we find is reported to anybody. Our certificate records our own count on a date; it is not a vendor’s clearance and would not settle a vendor’s claim. This is your count, done privately, so that somebody else’s does not surprise you.',
      },
      {
        id: 'dpdp',
        icon: 'encrypted',
        name: 'Vybe Data Protection Audit',
        standard: 'DPDP Act 2023 standard',
        tagline:
          'What personal data you hold, why, on whose consent, for how long, and who else has it.',
        covers: [
          'A map of the personal data you actually collect, where it lives, and why you have it',
          'Notice and consent at the point of collection, in the form the Act requires, rather than a line in a footer',
          'Where you are relying on a legitimate use rather than consent, and whether that reliance holds',
          'Retention and deletion: how long you keep things, and whether anything is ever actually deleted',
          'Processors and vendors, from payroll and CRM to cloud, analytics and that WhatsApp group, and what your contracts with them say',
          'A data principal’s rights: access, correction, erasure, nomination and grievance, and whether anybody at your end would answer',
          'Breach readiness: who is told, by whom, in what time, and whether the Board would be notified',
          'Children’s data and verifiable parental consent, which is a hard requirement and a live problem for anyone running a school or an ed-tech product',
          'Cross-border transfer, and where your data has quietly been all along',
          'Employee data, CCTV footage and recruitment records, which are the categories most often forgotten',
        ],
        basis: 'The Digital Personal Data Protection Act, 2023 and the Rules made under it.',
        notStatutory:
          'A Vybe gap assessment to the DPDP standard. It is not the independent Data Auditor engagement that a Significant Data Fiduciary must arrange under the Act, <strong>we are not appointed or recognised by the Data Protection Board</strong>, and it is not a legal opinion. Neither the audit nor the certificate makes you compliant. They tell you where you are not.',
      },
      {
        id: 'labour-law',
        icon: 'badge',
        name: 'Vybe Labour Law & HR Compliance Audit',
        standard: 'EPF, ESI & Shops Act standard',
        tagline:
          'PF, ESI, Shops and Establishments, contracts and the statutory registers nobody maintains.',
        covers: [
          'EPF and ESI: registration, coverage, whether everybody who should be on it is, and whether contributions match the wages actually paid',
          'Shops and Commercial Establishments registration, its renewal, and the establishment details on it still being true',
          'Professional Tax registration for the establishment and deduction for employees',
          'Appointment letters, and whether their terms match what is actually paid and worked',
          'Statutory registers: muster roll, wage register, leave, overtime, fines and deductions, and the advances register',
          'Minimum wages against the rates notified for your scheduled employment and zone',
          'Working hours, weekly off, overtime rates and the leave the Act entitles people to',
          'Gratuity and bonus eligibility and provisioning',
          'Contract labour, and the liability that sits with you as principal employer whatever the contract says',
          'Maternity benefit, and the crèche requirement above the employee threshold',
          'The abstracts and notices that have to be displayed, and the ones that have to be filed annually',
        ],
        basis:
          'The EPF & MP Act 1952, the ESI Act 1948, the Karnataka Shops and Commercial Establishments Act 1961, the Payment of Wages, Minimum Wages, Payment of Bonus, Payment of Gratuity, Maternity Benefit and Contract Labour Acts, and the registers and returns prescribed under them.',
        notStatutory:
          'A Vybe advisory review. Not a Labour Department inspection, not a statutory audit, and not legal advice; we are not affiliated to any labour authority and our certificate would not answer an inspector. Where a finding needs a lawyer or a labour law consultant to resolve rather than a form to be filed, we say which.',
      },
      {
        id: 'office-fire',
        icon: 'fire_extinguisher',
        name: 'Vybe Office Fire & Workplace Safety Audit',
        standard: 'NBC 2016 Part 4 standard',
        tagline: 'The same fire and electrical basics as a campus, scaled to a floor plate.',
        covers: [
          'Exit routes and whether they are clear, which is where an office fails almost every time: cartons in the corridor, a fire door wedged, a second exit that opens into a locked lobby',
          'Extinguisher type against the risk, placement, pressure and refill dates, and whether anybody on the floor has used one',
          'Detection and alarm, its audibility in meeting rooms and washrooms, and manual call points',
          'Emergency lighting, exit signage and the route to the assembly point',
          'Evacuation drill records, and the fact that most offices have none',
          'Electrical load against sanctioned load, the DB, and the extension board tree under somebody’s desk',
          'Server room, UPS and battery room: ventilation, suppression, and what is being stored in there',
          'Pantry equipment, which is the most likely ignition source in a normal office',
          'First aid box contents and expiry, and who is trained to use it',
          'Where you are a tenant: what the building’s fire systems cover, what they do not, and which of the findings are the landlord’s',
        ],
        basis:
          'The National Building Code of India 2016, Part 4, so far as it applies to a business occupancy, together with the fire requirements in the Shops and Commercial Establishments rules and your building’s own occupancy certificate and fire clearance.',
        notStatutory:
          'Preparation and assessment only. We are not the fire department and are not affiliated to it, and neither the audit nor the certificate produces or renews a fire NOC for you or for your building.',
      },
    ],
    sections: [
      {
        h: 'POSH is the one with a deadline already passed',
        p: 'Every other audit here is prudent. POSH is overdue. The obligation to constitute an Internal Committee applies to every employer with ten or more employees, it applied from 2013, and it applies at each office separately rather than once for the company. The penalty for not having one is up to ₹50,000, and for a repeat it doubles and brings the possibility of the licence or registration the business trades under being cancelled. The part that catches people is not the committee, though. It is the rest of it: the external member who has to come from outside, the display of the committee’s constitution at a conspicuous place, the annual report to the District Officer, and the awareness sessions. We have yet to walk into an office that had all five and could show the records.',
      },
      {
        h: 'The software audit usually pays for itself',
        p: 'Not because of the exposure, although a letter from a vendor or from an industry body is an unpleasant way to spend a quarter, but because of what the inventory turns up in the other direction. Almost every office of any size is paying for seats nobody uses, for a subscription renewed by standing instruction for a product replaced two years ago, and for licences tied to laptops that left the building. The count runs in both directions and the second direction is usually the larger number. What we will not do is tell you the exposure is bigger than it is in order to sell you something: where the answer is that you are fine, the report says you are fine.',
      },
      {
        h: 'DPDP is a gap assessment, not a certificate of compliance',
        p: 'Nobody can make you DPDP compliant in a week, and anybody offering to should be shown the door. What is achievable is knowing exactly where you stand: what personal data you hold, whose it is, what you told them when you took it, who you have since given it to, how long you keep it, and what would happen if somebody asked for it back or if it leaked. Most organisations cannot answer more than two of those. The audit produces the answers and a prioritised list, and the first items on that list are usually unglamorous: a retention rule, a vendor contract clause, a grievance address that reaches a person. The certificate at the end says we audited you against the Act on a date. It does not say you are compliant, because that is not ours to say.',
      },
      {
        h: 'What you get, and what our opinion is worth',
        p: 'A written report per audit with a graded finding list, the provision each finding is read against, and a fix list ordered by exposure rather than by ease. Where the fix is a form, a register, a notice or a policy, we can do it as part of the work. Where it needs a lawyer, a chartered accountant, a licensed electrical contractor or an external IC member, we say so and we say it early. None of this is legal advice, none of it is a statutory audit, and the certificate is ours rather than any authority’s. It is a competent outside reading of your position, in writing, before somebody with the power to fine you forms their own.',
      },
    ],
    faqs: [
      {
        q: 'We have fewer than ten employees. Does POSH apply to us?',
        a: 'The obligation to constitute an Internal Committee starts at ten. Below that you still owe your employees a workplace free of sexual harassment, complaints go to the Local Committee constituted by the District Officer rather than to an internal one, and it is worth having a policy and knowing where to send somebody. If you are near the threshold, the sensible time to set the committee up is before you cross it, not after somebody counts.',
      },
      {
        q: 'Does this audit make us POSH compliant?',
        a: 'No. It tells you precisely where you are not, and it can produce the missing pieces: a policy that says what the Act requires, the display notice, the committee constitution, the annual report format, the awareness session. <strong>What it cannot do is serve on your Internal Committee, conduct an inquiry, or file anything on your behalf as though we were you.</strong> The external member of your IC has to come from outside the organisation and must not be us reviewing our own arrangement. The certificate records that we audited you against the Act; it is not a finding of compliance by any authority.',
      },
      {
        q: 'Is the software licence audit reported to anyone?',
        a: 'No. Nothing leaves your organisation. We are not the BSA, not a vendor’s SAM programme and not an OEM auditor, we are not affiliated to any software vendor, and we have no obligation or incentive to tell anybody what we found. That is the entire point of counting it yourself first.',
      },
      {
        q: 'Is the DPDP audit legal advice?',
        a: 'No. It is a technical and procedural gap assessment against the Act and Rules, written by people who read them carefully, and it will tell you where your practice and the text do not line up. Where the answer turns on a question of law, whether that is a legitimate use applying to you, how a contract should be drafted or whether you are a Significant Data Fiduciary, we will tell you that it is a lawyer’s question rather than answer it ourselves.',
      },
      {
        q: 'Can you do these remotely?',
        a: 'Partly. The POSH, software licence, DPDP and labour law audits are mostly documents, systems and conversations, and a good deal of that can be done remotely with a shorter visit at the end. The fire and workplace safety audit cannot be done remotely at all and we will not pretend otherwise. Outside Bengaluru, the document-led audits travel fine; for the site-based ones, ask and we will tell you honestly whether the travel is worth it to you.',
      },
      {
        q: 'What does a workplace audit cost?',
        a: `Scoped first, then quoted. Headcount, number of offices, how many of the five audits you want and how much of it can be done remotely are what move the number. A single POSH review for one office is a small piece of work; a five-audit engagement across three locations is not. Tell us the shape of it at <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a> and a scope and figure come back before anything starts.`,
      },
    ],
  },
];

const AUDIT_ENQUIRY = 'Hi Vybe, I would like to talk about an audit.';
const auditHref = (g) => `/audits/${g.slug}/`;
const AUDIT_COUNT = AUDIT_GROUPS.reduce((n, g) => n + g.audits.length, 0);

/** Every audit name ends in Audit or Check; the certificate takes its place. */
const certificateName = (a) => a.name.replace(/(Audit|Check)$/, 'Certificate');

/**
 * The disclosure that sits above the fold on every audit page. It is the same
 * text everywhere on purpose: a reader who has seen it once should recognise
 * it, and one who has not should not be able to miss it. Naming a standard is
 * a description of the yardstick; the second paragraph exists so that nobody
 * can read it as anything else.
 */
function auditNotice({ dark = false } = {}) {
  return noticePanel(
    'Vybe audits, Vybe certificates. Read this first.',
    `<p>We read your premises, your records and your arrangements against the standard that applies to them, write down what we find, and where the audit passes we issue a certificate and a badge. <strong>Every audit here is a Vybe audit and every certificate is issued by Vybe Technologies.</strong></p>
                        <p>Where an audit names a standard, whether that is FSSAI Schedule 4, the National Building Code, POCSO, the POSH Act, the DPDP Act or the UN SDGs, that names the yardstick we read you against. It is not a claim of approval, affiliation or recognition by whoever wrote it. <strong>We are not accredited by, affiliated to, appointed by or recognised by FSSAI, the Fire and Emergency Services, any Pollution Control Board, NAAC, NIRF, the Labour Department, the Data Protection Board or any other authority or certification body.</strong></p>
                        <p>So our certificate is not a licence, an NOC, a hygiene rating, an accreditation or a finding of legal compliance, it carries no authority’s mark, and it must not be displayed or described as though it did. It is verifiable on our own portal and nowhere else. If somebody is asking your organisation for an official certificate, ours is not it, and we will tell you which body issues the one they want rather than sell you ours instead.</p>`,
    { dark }
  );
}

/** One audit, as a card. `notStatutory` is part of the card, not a footnote. */
function auditCard(a) {
  return `<li id="${a.id}" class="flex flex-col h-full rounded-2xl border border-slate-200 bg-white p-8 scroll-mt-28 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${a.icon}</span>
                        <p class="mt-4 text-xs font-bold uppercase tracking-[0.15em] text-brand">${esc(a.standard)}</p>
                        <h3 class="mt-1 text-xl font-bold font-display tracking-tight text-slate-900">${esc(a.name)}</h3>
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(a.tagline)}</p>

                        <div class="mt-6 pt-6 border-t border-slate-100">
                            <h4 class="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">What it covers</h4>
                            <ul class="mt-3 grid gap-2 text-sm text-slate-600">
                                ${a.covers
                                  .map(
                                    (c) => `<li class="flex items-start gap-2">
                                    <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                                    <span>${esc(c)}</span>
                                </li>`
                                  )
                                  .join('\n                                ')}
                            </ul>
                        </div>

                        <div class="mt-6">
                            <h4 class="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">Read against</h4>
                            <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(a.basis)}</p>
                        </div>

                        <div class="mt-6">
                            <h4 class="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">If it passes</h4>
                            <p class="mt-2 text-sm text-slate-600 leading-relaxed">${esc(certificateName(a))} and badge, issued by Vybe Technologies, valid one year.</p>
                        </div>
                        ${
                          a.penalty
                            ? `<p class="mt-5 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm text-slate-700 leading-relaxed">${esc(a.penalty)}</p>`
                            : ''
                        }

                        <p class="mt-auto pt-6 text-sm text-slate-500 leading-relaxed"><span class="font-bold uppercase tracking-[0.15em] text-xs text-slate-400 block mb-1">What it is not</span>${
                          a.notStatutory
                        }</p>
                    </li>`;
}

/**
 * The certificate and badge, set out at length. Same treatment as the
 * non-accredited ISO certificate on the registrations side, and for the same
 * reason: the value of saying it plainly is that nobody can say later that
 * they were not told.
 */
function certificateSection() {
  const point = (icon, h, p) =>
    `<div class="rounded-2xl border border-slate-200 bg-white p-8">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${icon}</span>
                        <h3 class="mt-4 text-lg font-bold font-display tracking-tight text-slate-900">${esc(h)}</h3>
                        <p class="mt-3 text-sm text-slate-600 leading-relaxed">${p}</p>
                    </div>`;

  return `
        <section class="bg-surface-main border-t border-slate-200 py-20 md:py-28 px-6 relative z-10" aria-labelledby="audit-certificate-heading">
            <div class="max-w-6xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">Report, certificate, badge</p>
                <h2 id="audit-certificate-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-slate-900">What you walk away with.</h2>
                <p class="mt-5 text-lg leading-relaxed text-slate-600 max-w-3xl">Every audit produces a report. Where it closes at or above our threshold it also produces a certificate and a badge, both issued by us, and both described below in the plainest words we can find, so that nobody displays one thinking it is something it is not.</p>

                <div class="mt-12 grid gap-5 md:grid-cols-3">
                    ${point(
                      'description',
                      'The assessment report',
                      'The substance of the engagement. Findings with photographs, each cited to the clause, rule or Goal it is read against, graded into what would fail an inspection or hurt somebody, what would draw a comment, and what is worth doing next time round. Then a fix list in that order. This is the part worth paying for.'
                    )}
                    ${point(
                      'workspace_premium',
                      'The Vybe certificate',
                      'Issued where the audit closes at or above our threshold. It names the audit, the standard we read you against, the scope, the site, the date and an expiry a year out, and it carries a verification number checkable on our own portal. Signed by us, on our paper, with our name on it and nobody else’s.'
                    )}
                    ${point(
                      'verified',
                      'The digital badge',
                      'A web and print asset for your site footer, your reception wall, an admission brochure or a tender file, carrying the same audit name, date and verification number. It expires when the certificate does, and we ask that it comes down when it does.'
                    )}
                </div>

                <div class="mt-8">
                    ${noticePanel(
                      'What the certificate and badge are not',
                      `<p>They are issued by <strong>Vybe Technologies</strong> and by nobody else. <strong>We are not accredited by, affiliated to, appointed by, empanelled with or recognised by</strong> FSSAI, the Karnataka State Fire and Emergency Services or any fire authority, any State Pollution Control Board, NAAC, NIRF, the UGC, the Labour Department, the Data Protection Board of India, the BSA, any software vendor, NABCB, any member of the International Accreditation Forum, or any other regulator, accreditation body or certification body.</p>
                        <p>So the certificate is <strong>not</strong> an FSSAI licence, approval or hygiene rating; <strong>not</strong> a fire No Objection Certificate; <strong>not</strong> a pollution control consent; <strong>not</strong> a NAAC or NIRF accreditation, score or endorsement; <strong>not</strong> a vehicle fitness certificate; <strong>not</strong> a vendor’s licensing clearance; and <strong>not</strong> a finding by any authority that your organisation is legally compliant. It carries no government, regulatory or accreditation mark, and it must not be presented, described or displayed as though it does.</p>
                        <p>What it does say is exactly this: that Vybe Technologies audited a named site against a named standard on a named date, and that it met the threshold we publish for that audit. That is a real and checkable statement, and it is the only one being made.</p>
                        <p>It is verifiable in one place: our own portal, at <a class="font-bold text-brand hover:underline" href="/verify/">vybe.net.in/verify</a>. Anyone can check the number and see who holds it, for which audit, against which standard, for what scope and until when. If a customer, a parent body, a tender, a regulator or an accreditation team requires an <em>official</em> or <em>accredited</em> certificate, ours is not it. Ask them what they need before you buy one from us or from anybody, and we will tell you which body issues it.</p>`
                    )}
                </div>
            </div>
        </section>`;
}

/** How the engagement runs, in four steps. Shared by the hub and every group. */
const AUDIT_STEPS = [
  {
    icon: 'forum',
    h: 'Scope and quote',
    p: 'Tell us what you run and which audits you want. We come back with a scope that says exactly what will be looked at and what will not, and a figure. Nothing is booked until you have both.',
  },
  {
    icon: 'search',
    h: 'The visit',
    p: 'On site, during working hours, with the place running as it normally does. We open cupboards, read thermometers, ask for records and talk to the people doing the work rather than only to whoever is showing us around.',
  },
  {
    icon: 'description',
    h: 'The report',
    p: 'Within a few working days: findings with photographs, each cited to the rule or clause it is read against, graded by severity, and a fix list ordered by what actually matters. Anything urgent you will have heard on the day.',
  },
  {
    icon: 'workspace_premium',
    h: 'Re-check, then certificate',
    p: 'Work down the list and we come back to confirm in writing what has closed. Pass our threshold and the Vybe certificate and badge are issued, valid a year. Fall short and we say so. A certificate nobody can fail is worth nothing.',
  },
];

function auditStepsSection({ heading, lede }) {
  return `
        <section class="bg-corporate dark-section text-slate-300 py-20 md:py-28 px-6 relative z-10" aria-labelledby="audit-steps-heading">
            <div class="max-w-6xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">How it runs</p>
                <h2 id="audit-steps-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-white">${esc(heading)}</h2>
                <p class="mt-5 text-lg leading-relaxed text-slate-300 max-w-3xl">${lede}</p>
                <ol class="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    ${AUDIT_STEPS.map(
                      (s, i) => `<li class="rounded-2xl border border-white/10 bg-white/5 p-8">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${s.icon}</span>
                        <p class="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Step ${i + 1}</p>
                        <h3 class="mt-2 text-lg font-bold font-display tracking-tight text-white">${esc(s.h)}</h3>
                        <p class="mt-3 text-sm leading-relaxed text-slate-300">${esc(s.p)}</p>
                    </li>`
                    ).join('\n                    ')}
                </ol>
            </div>
        </section>`;
}

const auditFaqs = [
  {
    q: 'Are these official audits?',
    a: 'No, and that is the first thing we say rather than the last. <strong>Every audit here is a Vybe audit and none of them is a statutory or regulatory audit.</strong> We are not the fire department, not an FSSAI-recognised auditing agency under the Food Safety Auditing Regulations, 2018, not a Labour Department inspector, not an appointed Data Auditor under the DPDP Act, and not connected to NAAC or NIRF. When an audit names a standard, that names what we read you against. It is not a claim that whoever wrote the standard has approved us or you.',
  },
  {
    q: 'Then what is the point of an unofficial audit?',
    a: 'That the official one is not a conversation. When a fire inspection, a food safety audit, a vendor’s licence review or a POSH complaint arrives, it looks, it finds, and the finding exists from that moment. A Vybe audit is the same walk with none of the consequences attached, early enough that fixing things is a line item rather than a crisis. The entire value sits in the gap between our visit and the one that counts.',
  },
  {
    q: 'You issue certificates. What are they worth?',
    a: 'They are worth exactly what they say, which is a real thing and a limited one. A Vybe certificate says that we audited a named site against a named standard on a named date and that it met the threshold we publish for that audit. It carries our name, a verification number checkable on our own portal, and an expiry a year out. <strong>It is not a licence, an NOC, a hygiene rating, an accreditation or a finding of legal compliance, it carries no authority’s mark, and it must not be displayed or described as though it does.</strong> Plenty of parents, customers, tender committees and franchise partners are satisfied by a credible third party having looked and written it down. Anybody who needs an official certificate needs a different document, and we will tell you which body issues it.',
  },
  {
    q: 'Are you affiliated to FSSAI, NAAC, the fire department or any certifying body?',
    a: 'No, to all of them and to any others you can name. We are not accredited by, affiliated to, appointed by, empanelled with or recognised by FSSAI, any fire authority, any Pollution Control Board, NAAC, NIRF, the UGC, the Labour Department, the Data Protection Board, the BSA, any software vendor, NABCB or any member of the International Accreditation Forum. We do not claim that our certificates are recognised by any of them, and if you ever see anybody suggesting otherwise on our behalf, tell us and we will correct it.',
  },
  {
    q: 'Does everybody pass?',
    a: 'No, and a certificate nobody can fail is worth nothing to the people you would show it to. Where an audit closes below the threshold we say so in writing, we tell you exactly what stands between you and it, and the re-check is there for when you have closed those items. We would rather issue you a certificate in three months that means something than one today that does not.',
  },
  {
    q: 'What do we actually get at the end?',
    a: 'A written report per audit, delivered within a few working days of the visit, with photographs of what we found. Each finding cited to the clause, rule or Goal it is read against, so you can argue with it on the merits instead of taking our word. Findings graded into what would fail an inspection or hurt somebody, what would draw a comment, and what is worth doing when you next have the chance. A fix list in that order. And where the audit passes, the Vybe certificate and digital badge described above.',
  },
  {
    q: 'What does an audit cost?',
    a: `It is scoped first and then quoted, and we do not publish a figure because there is no honest one to publish. A single POSH review for one office and a six-audit engagement across a campus with four blocks and fourteen buses are not the same work. Floor area, number of sites, fleet size, headcount, how many audits you want and whether you want the re-check are what move it. Tell us what you run on <a class="text-brand font-bold" href="${waLink(
      AUDIT_ENQUIRY
    )}" target="_blank" rel="noopener">WhatsApp</a> or at <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a> and you will have a scope and a figure before anything is booked.`,
  },
  {
    q: 'Do you fix what you find?',
    a: 'The paperwork, yes: policies, registers, schedules, display notices, the documentation an application or an inspection asks for, and the training records behind them. That can be included in the scope. Anything needing a contractor (an exhaust replaced, a floor regraded, a distribution board rewired, a camera moved) we describe precisely enough for you to get it quoted, and we take nothing from whoever quotes it. You are not required to use us for the fixes to get the re-check or the certificate.',
  },
  {
    q: 'Who carries out the audit?',
    a: 'Our own team, working to a written checklist per audit so that two visits to the same place produce comparable reports. Where a finding needs a licensed professional to resolve or to sign off, whether that is a chartered electrical safety inspector, a structural engineer, a food technologist, a lawyer or an external Internal Committee member, we say so in the report and we say to bring one in. We would rather mark the boundary of our competence than blur it.',
  },
  {
    q: 'Is what you find confidential?',
    a: 'Yes. The report is yours. Nothing goes to any regulator, vendor, industry body or third party from us, and nothing is used as a reference without your written agreement. The one exception is the certificate, which exists to be shown and is checkable by anybody you give the number to. The one thing we will not do is stay quiet about an immediate danger to a person, or about something that looks like it triggers a mandatory reporting obligation, a POCSO disclosure in particular. In that situation you will hear it from us on the day, in plain words, along with what the law expects of you.',
  },
  {
    q: 'Do you audit outside Bengaluru?',
    a: 'Bengaluru and the surrounding districts are the normal working area and there is no travel charge inside it. Further afield is possible, with travel quoted separately and openly in the scope. For the document-led audits (POSH, software licensing, DPDP and labour law) a good part of the work is records, systems and conversations, so distance matters less. The site-based ones cannot be done remotely and we will not pretend they can.',
  },
  {
    q: 'We already had an audit. Why another one?',
    a: 'If it was recent, thorough and you have worked through it, you may not need one. Send us the report and we will tell you plainly whether a second opinion is worth your money. Sometimes the answer is that a re-check against the existing list is all you need, and that is a much smaller piece of work. What is usually worth revisiting is anything older than a year, anything from before a building, a block, a kitchen or a fleet changed, and anything covering only one of the areas you are now being asked about.',
  },
];

/* ---------------------------------------------------------- audits, the hub */

const auditsBody = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Audits', url: '/audits/' }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Compliance &amp; Safety</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">Audits, before somebody official does one.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">${AUDIT_COUNT} Vybe audits for kitchens, campuses and offices: hygiene to the FSSAI Schedule 4 standard, fire to the National Building Code, child safety to POCSO, bus safety, a NAAC/NIRF-ready SDG audit, POSH, software licensing, data protection under the DPDP Act and labour law. We read your site against the standard, write down what would be found, and certify what passes.</p>

                ${ctaRow({
                  waText: AUDIT_ENQUIRY,
                  waLabel: 'WhatsApp us',
                  email: ORG.legal,
                  subject: 'Audit enquiry',
                  emailLabel: `Email ${ORG.legal}`,
                })}

                <div class="mt-12">
                    ${auditNotice()}
                </div>

                ${AUDIT_GROUPS.map(
                  (g) => `<section class="mt-20" aria-labelledby="audit-group-${g.id}">
                    <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">${esc(g.short)}</p>
                    <h2 id="audit-group-${g.id}" class="text-3xl md:text-4xl font-black font-display tracking-tight text-slate-900">${esc(g.name)}</h2>
                    <p class="mt-4 text-lg text-slate-600 leading-relaxed max-w-3xl">${esc(g.tagline)}</p>
                    <ul class="mt-10 grid gap-5 lg:grid-cols-3">
                        ${g.audits.map(auditCard).join('\n                        ')}
                    </ul>
                    <a href="${auditHref(g)}" class="mt-8 inline-flex items-center gap-2 text-sm font-bold text-brand hover:gap-3 transition-all">
                        ${esc(g.name)} in detail
                        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                    </a>
                </section>`
                ).join('\n                ')}

                <div class="mt-20 rounded-2xl border border-slate-200 bg-white/70 p-6 md:p-8 flex flex-col sm:flex-row gap-5 sm:items-start">
                    <span class="material-symbols-outlined text-brand text-[28px] shrink-0" aria-hidden="true">fact_check</span>
                    <div>
                        <h2 class="text-base font-bold font-display tracking-tight text-slate-900">Something else you are being asked to prove?</h2>
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed max-w-3xl">The list above is what we audit regularly and know well. If a customer, a tender, a parent body or a regulator is asking your organisation for something not on it, tell us at <a href="mailto:${ORG.legal}" class="font-bold text-brand hover:underline">${ORG.legal}</a> and we will say plainly whether it is work we can do properly. Where the honest answer is that you need an accredited body or a licensed professional, we will name the kind of body to look for instead of taking the work.</p>
                    </div>
                </div>
            </div>
        </section>

${certificateSection()}

${auditStepsSection({
  heading: 'Scoped, walked, written down, re-checked, certified.',
  lede: 'The same five beats whatever is being audited. No engagement starts before you have a written scope and a figure, nothing urgent waits for the report, and no certificate is issued before the findings are closed.',
})}

${faqSection(auditFaqs, { dark: false })}
${relatedSection('audits', { dark: false })}
</div>`;

{
  const url = '/audits/';
  const lastmod = lastmodFor(url, auditsBody);
  DOCS.push({
    file: 'audits/index.html',
    priority: '0.8',
    changefreq: 'monthly',
    page: {
      url,
      nav: 'audits',
      title: 'Compliance & Safety Audits in Bengaluru | Vybe Technologies',
      ogTitle: 'Vybe audits: kitchen hygiene, campus safety and workplace compliance',
      description:
        'Audits for kitchens, schools and offices in Bengaluru: FSSAI-standard hygiene, fire safety, POCSO, bus safety, NAAC/NIRF SDG, POSH, DPDP and labour law.',
      lastmod,
      trail: [CRUMB_HOME, { name: 'Audits', url }],
      faqs: auditFaqs,
      body: auditsBody,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: 'Vybe compliance and safety audits',
        serviceType: 'Advisory compliance, hygiene and safety auditing',
        description:
          'Advisory (non-statutory) compliance and safety audits for food businesses, educational institutions and offices in Bengaluru, covering kitchen hygiene to the FSSAI Schedule 4 standard, kitchen layout and cross-contamination, pest control records, fire and electrical safety to the National Building Code 2016 standard, canteen and mess hygiene, child safety to the POCSO standard, school transport safety, campus security, a NAAC/NIRF-ready SDG and sustainability audit covering energy, waste, water and curriculum, POSH Act Internal Committee compliance, software licensing and IT asset compliance, Digital Personal Data Protection Act readiness, and labour law and HR statutory records. Certificates and badges are issued by Vybe Technologies alone. Vybe Technologies is not accredited by, affiliated to, appointed by or recognised by FSSAI, any fire authority, any Pollution Control Board, NAAC, NIRF, the Labour Department, the Data Protection Board or any other regulator, accreditation body or certification body, and these audits and certificates are not a statutory audit, licence, rating, accreditation or No Objection Certificate.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'City', name: 'Bengaluru' },
        url: u,
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Audits',
          itemListElement: AUDIT_GROUPS.flatMap((g) =>
            g.audits.map((a) => ({
              '@type': 'Offer',
              name: a.name,
              priceCurrency: 'INR',
              description: `${a.tagline} Audited to the ${a.standard}. Advisory audit, scoped and quoted per engagement; not a statutory audit, and any certificate issued is a Vybe Technologies certificate carrying no regulatory or accreditation recognition.`,
              url: `${SITE}${auditHref(g)}#${a.id}`,
              itemOffered: { '@type': 'Service', name: a.name, provider: { '@id': `${SITE}/#organization` } },
            }))
          ),
        },
      }),
    },
  });
}

/* --------------------------------------------------- audits, one page each */

/**
 * A page per audience rather than per audit. Somebody searching for a school
 * fire safety audit and somebody searching for a POSH audit want different
 * pages; somebody searching for a fire audit and a canteen audit is usually
 * the same person on the same campus. Content comes from AUDIT_GROUPS, so the
 * hub, the nav and these cannot drift apart.
 */
for (const g of AUDIT_GROUPS) {
  const url = auditHref(g);
  const enquiry = `Hi Vybe, I would like to talk about ${g.short.toLowerCase()} audits.`;

  const body = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Audits', url: '/audits/' }, { name: g.name, url }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Compliance &amp; Safety</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">${esc(g.h1)}</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">${esc(g.lede)}</p>

                <p class="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span class="text-5xl font-black font-display tracking-tight text-slate-900">On quote</span>
                    <span class="text-sm font-bold text-slate-500">scoped before anything is booked</span>
                </p>
                <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-brand">${g.audits.length} audit${
                  g.audits.length === 1 ? '' : 's'
                } in this group &middot; take one or take the set</p>

                ${ctaRow({
                  waText: enquiry,
                  waLabel: 'WhatsApp us',
                  email: ORG.legal,
                  subject: `${g.name} enquiry`,
                  emailLabel: `Email ${ORG.legal}`,
                })}

                <div class="mt-12">
                    ${auditNotice()}
                </div>

                <ul class="mt-12 grid gap-5 lg:grid-cols-3">
                    ${g.audits.map(auditCard).join('\n                    ')}
                </ul>
            </div>
        </section>

${proseSections({
  id: `${g.slug}-detail`,
  eyebrow: 'In detail',
  heading: g.name,
  sections: g.sections,
})}

${certificateSection()}

${auditStepsSection({
  heading: 'Scoped, walked, written down, re-checked, certified.',
  lede: 'The same five beats whatever is being audited. No engagement starts before you have a written scope and a figure, nothing urgent waits for the report, and no certificate is issued before the findings are closed.',
})}

${faqSection(g.faqs, { dark: false })}

${siblingSection({
  eyebrow: 'More audits',
  heading: 'The rest of what we audit.',
  items: [
    { href: '/audits/', icon: 'fact_check', name: 'All audits', blurb: `Every audit we run, across kitchens, campuses and offices.` },
    ...AUDIT_GROUPS.filter((o) => o.slug !== g.slug).map((o) => ({
      href: auditHref(o),
      icon: o.icon,
      name: o.name,
      blurb: o.tagline,
    })),
    { href: '/registrations/', icon: 'receipt_long', name: 'Business registrations', blurb: 'GST, Udyam, FSSAI, DPIIT and more, filed for you at a flat professional fee.' },
  ],
})}
${relatedSection('audits', { dark: false })}
</div>`;

  const lastmod = lastmodFor(url, [g.metaTitle, g.metaDescription, body].join('\n'));

  DOCS.push({
    file: `audits/${g.slug}/index.html`,
    priority: '0.7',
    changefreq: 'monthly',
    page: {
      url,
      nav: g.nav,
      title: g.metaTitle,
      ogTitle: g.name,
      description: g.metaDescription,
      lastmod,
      trail: [CRUMB_HOME, { name: 'Audits', url: '/audits/' }, { name: g.name, url }],
      faqs: g.faqs,
      body,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: g.name,
        serviceType: 'Advisory compliance, hygiene and safety auditing',
        description: `${g.metaDescription} Audits and any certificate issued are by Vybe Technologies alone; Vybe Technologies is not accredited by, affiliated to or recognised by FSSAI, any fire authority, NAAC, NIRF, the Labour Department, the Data Protection Board or any other regulator, accreditation body or certification body.`,
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'City', name: 'Bengaluru' },
        url: u,
        isRelatedTo: { '@id': `${SITE}/audits/#service` },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: g.name,
          itemListElement: g.audits.map((a) => ({
            '@type': 'Offer',
            name: a.name,
            priceCurrency: 'INR',
            description: `${a.tagline} Audited to the ${a.standard}. Advisory audit, scoped and quoted per engagement; not a statutory audit, and any certificate issued is a Vybe Technologies certificate carrying no regulatory or accreditation recognition.`,
            url: `${u}#${a.id}`,
            itemOffered: { '@type': 'Service', name: a.name, provider: { '@id': `${SITE}/#organization` } },
          })),
        },
      }),
    },
  });
}

/* ---------------------------------------------------------- manufacturing */

/**
 * Two quite different things share this line of business, and the nav groups
 * them because a buyer's question is the same for both: can you supply it,
 * and who do I talk to.
 *
 *   - What we make. RFID and NFC cards, encoded and personalised, which is a
 *     manufacturing job rather than a printing one once a chip is involved.
 *     /printing/cards/ still owns the artwork-and-finish side of the same
 *     product; the two pages cross-link rather than duplicate.
 *   - What we distribute. Desktops, laptops, displays and peripherals from
 *     Dell, HP, Lenovo, Asus, Apple and Logitech.
 *
 * Deliberately no prices and no stock figures anywhere in this section. Both
 * move weekly, a stale number on a static site is worse than no number, and
 * the honest answer to "do you have twelve of these" is a conversation. Every
 * card therefore ends at contact rather than at a cart.
 */

const MFG_ENQUIRY = 'Hi Vybe, I would like to talk about hardware supply.';

/**
 * One representative render per category, produced by tools/gen-product-images.mjs.
 * A category with no `img` falls back to its icon on its own, which is what
 * happens if a vendor ever asks for artwork to come down.
 */
const DIST_CATEGORIES = [
  {
    id: 'desktops',
    icon: 'desktop_windows',
    img: 'desktops',
    name: 'Desktops & towers',
    brands: 'Dell · HP · Lenovo · Alienware',
    blurb:
      'Slim, SFF and full tower builds from Core i3 up to Core Ultra 9 and Ryzen 7, on Windows 11 Home or Pro, FreeDOS or Ubuntu.',
    lines: [
      'Dell Slim ECS1250: Core i3, i5 and i7 14th gen, 8–16 GB, 512 GB NVMe',
      'HP Pro 280 G9 and Pro Tower 280 G9: Core i3 13th gen to i5-13500, up to 1 TB NVMe',
      'HP ProDesk 2 G1a: Ryzen 5 8500G and Ryzen 7 8700G on the AMD PRO 665 chipset',
      'Lenovo ThinkCentre neo 50t and M70t Gen 5/6: up to Core Ultra 7 265 with vPro',
      'Alienware Aurora ACT1250: Core Ultra 9 285K, Z890, for workstation and gaming loads',
    ],
  },
  {
    id: 'all-in-ones',
    icon: 'desktop_mac',
    img: 'allinone',
    name: 'All-in-one PCs',
    brands: 'HP · Lenovo · Dell',
    blurb:
      'One cable, no tower and nothing on the floor. What front desks, labs and admin rooms usually want once they have seen one.',
    lines: [
      'HP 27-cr1000i: 27" Full HD, Core Ultra 5 125U, 16 GB, 1 TB SSD',
      'HP ProOne 440 G9: the 23.8" business all-in-one, wall and arm mountable',
      'Keyboard and mouse included on most SKUs; check the config before you assume it',
    ],
  },
  {
    id: 'mini-pcs',
    icon: 'memory',
    img: 'minipc',
    name: 'Mini PCs & small form factor',
    brands: 'HP · Lenovo · Dell',
    blurb:
      'A litre of machine that VESA-mounts behind the display. The right answer for digital signage, kiosks, labs and any desk short of room.',
    lines: [
      'HP Pro Mini 400 G9: Core i5, 16 GB, 512 GB, mounts behind the monitor',
      'Lenovo ThinkCentre neo 50q Gen 5 and Gen 6 Tiny: Core i3-1315U up to Core Ultra 7 Series 2',
      'Lenovo ThinkCentre neo 50s Gen 5: small form factor where a tiny will not take the cards',
    ],
  },
  {
    id: 'laptops',
    icon: 'laptop_windows',
    img: 'laptops',
    name: 'Laptops & notebooks',
    brands: 'Apple · Dell · HP · Lenovo · Asus',
    blurb:
      'Business notebooks, student machines and creative laptops, including Apple. Bulk configurations are quoted per order.',
    lines: [
      'Apple MacBook Pro 16": M5 Pro, 24 GB, 1 TB, 120 Hz, English (India) keyboard',
      'Asus Vivobook X1504MA and the rest of the education range',
      'Dell, HP and Lenovo commercial notebooks with on-site warranty options',
      'Imaging, asset tagging and enrolment can be done before delivery, just ask',
    ],
  },
  {
    id: 'monitors',
    icon: 'monitor',
    img: 'monitors',
    name: 'Monitors & displays',
    brands: 'HP · Dell · Lenovo',
    blurb:
      'Full HD through to 4K, in the sizes people actually order. Arms, stands and dual-display brackets alongside.',
    lines: [
      'HP S3 Pro 322PE and the S-series Full HD line',
      '24" and 27" IPS panels for offices, labs and reception',
      'Larger panels and interactive displays sit under Smart Classrooms instead',
    ],
  },
  {
    id: 'input',
    icon: 'keyboard',
    img: 'kbmouse',
    name: 'Keyboards, mice & input',
    brands: 'Dell · HP · Asus · Logitech · Lenovo',
    blurb:
      'Wired and wireless, combos and singles, in the volumes an office refresh actually needs rather than in ones and twos.',
    lines: [
      'Dell KM555 and Pro KM526 wireless combos; Pro MS3220 and Premier MS900 and MS7421W mice',
      'HP 455 programmable keyboard, 655 wireless combo, 125, 245 and 435 mice',
      'Asus Marshmallow KW100 keyboards and MD100 mice, ROG MW203, SmartO MD200, U2000 wired combo',
      'Logitech Combo Touch keyboard cases for iPad and iPad Pro',
      'Dell Pro Bluetooth Stylus and Lenovo Tab folio keyboards for tablet fleets',
    ],
  },
  {
    id: 'audio',
    icon: 'headset_mic',
    img: 'audio',
    name: 'Headsets & conferencing',
    brands: 'Dell · HP · Logitech',
    blurb:
      'Headsets for support desks and classrooms, and the soundbar and camera end of a meeting room that people can actually hear.',
    lines: [
      'Dell Pro Premier conferencing soundbar SB725',
      'Wired and wireless UC headsets, certified for Teams and Zoom',
      'Room cameras and speakerphones quoted against the room, not off a list',
    ],
  },
  {
    id: 'power',
    icon: 'power',
    img: 'power',
    name: 'Power, adapters & spares',
    brands: 'Asus · Dell · HP · Lenovo',
    blurb:
      'Genuine adapters, docks and the replacement parts that keep a fleet running once the original brick has gone missing.',
    lines: [
      'Asus 45 W, 65 W USB-C and 180 W notebook adapters',
      'USB-C docks and port replicators matched to the machine, not to the connector',
      'Batteries, keyboards, palm rests and other service spares, to order',
    ],
  },
];

/** Brand marks are named rather than drawn: no third-party logo files to host. */
const DIST_BRANDS = ['Dell', 'HP', 'Lenovo', 'Asus', 'Apple', 'Logitech', 'Alienware', 'Microsoft'];

/* ------------------------------------------------ manufacturing, the hub */

const MFG_LINES = [
  {
    href: '/manufacturing/rfid-cards/',
    icon: 'contactless',
    name: 'RFID & NFC cards',
    blurb:
      'Cards, fobs, tags and wristbands, with the chip chosen for the job, encoded to your system and personalised per person.',
  },
  {
    href: '/manufacturing/distribution/',
    icon: 'local_shipping',
    name: 'IT hardware distribution',
    blurb:
      'Desktops, all-in-ones, mini PCs, laptops, displays and peripherals from Dell, HP, Lenovo, Asus, Apple and Logitech.',
  },
  {
    href: '/manufacturing/iot/',
    icon: 'sensors',
    name: 'IoT solutions',
    blurb:
      'Asset and inventory tracking, temperature, humidity and energy monitoring, with gateways and dashboards that tie into your ERP.',
  },
];

const mfgFaqs = [
  {
    q: 'Why is there no price list on these pages?',
    a: 'Because any figure we published would be wrong within the week. Hardware pricing moves with the distributor’s rate, the configuration, the quantity, the warranty term and what the rupee did on Tuesday. A card quantity moves with the chip, the finish and the run length. Rather than print a number we would have to caveat into meaninglessness, we quote against what you actually need. Tell us the configuration and the quantity and a figure comes back the same day in most cases.',
  },
  {
    q: 'Do you hold stock?',
    a: 'Some, and the rest comes in against the order. What we will not do is publish a stock count on a website, because it would be stale by the time you read it and the disappointment lands on you rather than on us. Ask us about a specific model and quantity and you will get a straight answer about availability and lead time, including when the answer is that it is a four-week wait.',
  },
  {
    q: 'What warranty do these carry?',
    a: 'Manufacturer warranty, and it varies by product and SKU rather than by us, and is typically one to three years on desktops and notebooks, with on-site and extended options available on the commercial ranges from Dell, HP and Lenovo. Refurbished units carry a shorter warranty, stated per unit before you buy. Ask about a specific model and we will tell you the term, what it covers and what an upgrade to on-site costs.',
  },
  {
    q: 'Can you supply against a purchase order or a tender?',
    a: 'Yes. We are set up for institutional and corporate purchase orders, we can supply the quotations, specification sheets and compliance documents a tender file needs, and we can quote on a GeM-comparable basis where a school, college or office needs a like-for-like reference. Tell us the format your procurement wants and we will match it.',
  },
  {
    q: 'Do you install and set it up, or just deliver?',
    a: 'Either. Plenty of orders are simply delivered against an invoice. Where you want it, we image the machines, join them to your domain or tenant, asset-tag them, install the software you standardise on and take the packaging away. For a campus, that is usually cheaper than your own team doing it around their day job. It is quoted as part of the order rather than bolted on afterwards.',
  },
  {
    q: 'Do you take old equipment away?',
    a: 'We can, and for an office or a campus refresh we usually do. Buy-back on anything with life left in it, responsible disposal through an authorised e-waste handler for anything that does not, and a certificate of disposal for your records, which matters if you are ever audited on it. Say so at quote stage and it comes off the price of the new kit.',
  },
  {
    q: 'Is the hardware you supply genuine?',
    a: 'Yes, sourced through authorised distribution, with the manufacturer warranty intact and the invoice, serial numbers and HSN codes to show it. Refurbished units are labelled refurbished, plainly, on the quote and on the invoice. We would rather lose an order to somebody quoting grey stock than explain later why the warranty will not honour.',
  },
  {
    q: 'What is the smallest order you will take?',
    a: 'For hardware there is no formal minimum, though for a single mouse you are better off at a shop. Where we are worth talking to is anything from a handful of machines upward, or a standing arrangement where you come back each time you need something. RFID cards have a practical minimum that depends on the chip and the finish, so ask, and if the run is too small to make sense we will tell you rather than take it.',
  },
];

const mfgBody = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Manufacturing', url: '/manufacturing/' }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Manufacturing &amp; Supply</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">What we make, and what we supply.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">RFID and NFC cards manufactured, encoded and personalised to your system. Desktops, laptops, displays and peripherals distributed from Dell, HP, Lenovo, Asus, Apple and Logitech. IoT that tracks what you own and monitors what it costs to run. All of it quoted against what you need rather than listed off a shelf.</p>

                ${ctaRow({
                  waText: MFG_ENQUIRY,
                  waLabel: 'WhatsApp us',
                  email: ORG.sales,
                  subject: 'Manufacturing and supply enquiry',
                  emailLabel: `Email ${ORG.sales}`,
                })}

                <div class="mt-12">
                    ${noticePanel(
                      'No prices and no stock counts on this site, on purpose',
                      `<p>Hardware pricing and availability move weekly, and card pricing moves with the chip, the finish and the run length. A number published here would be wrong by the time you read it, and being wrong in your favour is as unhelpful as being wrong the other way.</p>
                        <p>So ask. Tell us the model or the specification and the quantity and you get a current figure, the real lead time, and the warranty term that actually applies, usually the same day. If something is a four-week wait, we will say four weeks rather than let you find out after the purchase order.</p>`
                    )}
                </div>

                <div class="mt-16 grid gap-5 md:grid-cols-2">
                    ${MFG_LINES.map(
                      (l) => `<a href="${l.href}" class="group flex flex-col rounded-2xl border border-slate-200 bg-white p-8 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${l.icon}</span>
                        <h2 class="mt-4 text-2xl font-bold font-display tracking-tight text-slate-900 group-hover:text-brand transition-colors">${esc(l.name)}</h2>
                        <p class="mt-3 text-sm text-slate-600 leading-relaxed">${esc(l.blurb)}</p>
                        <span class="mt-auto pt-6 inline-flex items-center gap-2 text-sm font-bold text-brand group-hover:gap-3 transition-all">
                            ${esc(l.name)} in detail
                            <span class="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                        </span>
                    </a>`
                    ).join('\n                    ')}
                </div>

                ${checklistPanel('What comes with an order, whichever side of the business it is', [
                  'A written quotation with the exact configuration or specification on it',
                  'The real lead time, including when the real answer is weeks rather than days',
                  'Manufacturer warranty, with the term and what it covers stated up front',
                  'GST invoice with serial numbers and HSN codes, for your asset register',
                  'Imaging, asset tagging, encoding and enrolment before delivery, where you want it',
                  'Buy-back or authorised e-waste disposal of what the new kit replaces',
                ])}
            </div>
        </section>

${proseSections({
  id: 'manufacturing-detail',
  eyebrow: 'How we work',
  heading: 'Quoted against the job, not listed off a shelf.',
  sections: [
    {
      h: 'Why we are not a storefront',
      p: 'Because the things that decide whether a purchase is a good one (the configuration, the warranty term, whether it will be imaged before it arrives, what happens to the machines it replaces) are exactly the things a cart cannot ask you about. Most of the orders we take change shape between the first message and the quotation, usually because we asked what the machines are actually for and the answer pointed somewhere cheaper. That conversation is worth more to both sides than a checkout button.',
    },
    {
      h: 'Where we are worth talking to, and where we are not',
      p: 'We are worth talking to for a fleet: an office refresh, a lab, a new campus block, a card programme for a school. There you get a configuration chosen against the workload, one invoice, one warranty conversation and one number to call when something fails. We are not worth talking to for a single mouse, and we will say so rather than take the order. If you are buying one laptop for yourself, a retail site will serve you faster and probably cheaper.',
    },
    {
      h: 'The same people run the software',
      p: 'Which matters more than it sounds. When the machines going into a school are the machines that will run Vybe ERP, and the cards going to the students are the cards the cafeteria terminals will read, nobody is standing between two vendors translating. The specification is set against the software it has to run, the cards are encoded to the format the readers expect, and if something does not work on day one it is our problem in both directions.',
    },
    {
      h: 'Genuine, invoiced, and labelled for what it is',
      p: 'Everything is sourced through authorised distribution with the manufacturer warranty intact, and it ships with a GST invoice carrying serial numbers and HSN codes, because that is what your asset register and your auditor will want. Refurbished stock is labelled refurbished on the quotation and on the invoice, with its own shorter warranty stated before you agree to it. Grey imports and pulled-warranty stock are cheaper and we do not sell them, which occasionally costs us an order and has never once cost us a customer.',
    },
  ],
})}

${siblingSection({
  eyebrow: 'Related',
  heading: 'What usually goes with it.',
  items: [
    ...MFG_LINES.map((l) => ({ href: l.href, icon: l.icon, name: l.name, blurb: l.blurb })),
    {
      href: '/printing/cards/',
      icon: 'badge',
      name: 'Card printing',
      blurb: 'The artwork, finish and print side of ID and visiting cards, including short runs.',
    },
    {
      href: '/smart-classroom/',
      icon: 'smart_display',
      name: 'Smart classrooms',
      blurb: 'Interactive flat panels and hybrid teaching rigs, specified and installed.',
    },
    {
      href: '/it-solutions/',
      icon: 'code_blocks',
      name: 'IT & cyber',
      blurb: 'Managed IT, networking and the people who will look after the fleet afterwards.',
    },
    {
      href: '/audits/workplace-compliance/',
      icon: 'verified_user',
      name: 'Software licence audit',
      blurb: 'Count what is installed against what is paid for, before a vendor does it for you.',
    },
  ],
})}

${faqSection(mfgFaqs, { dark: false })}
${relatedSection('manufacturing', { dark: false })}
</div>`;

{
  const url = '/manufacturing/';
  const lastmod = lastmodFor(url, mfgBody);
  DOCS.push({
    file: 'manufacturing/index.html',
    priority: '0.8',
    changefreq: 'monthly',
    page: {
      url,
      nav: 'manufacturing',
      title: 'Manufacturing & IT Hardware Supply in Bengaluru | Vybe',
      ogTitle: 'Vybe manufacturing and supply: RFID cards and IT hardware',
      description:
        'RFID and NFC cards made and encoded, IoT asset and energy monitoring, plus Dell, HP and Lenovo hardware in Bengaluru. Contact us for stock and pricing.',
      lastmod,
      trail: [CRUMB_HOME, { name: 'Manufacturing', url }],
      faqs: mfgFaqs,
      body: mfgBody,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: 'Vybe manufacturing and IT hardware supply',
        serviceType: 'RFID card manufacturing, IoT installations and IT hardware distribution',
        description:
          'Manufacture of RFID and NFC cards, fobs, tags and wristbands with chip selection, encoding and personalisation, and distribution of IT hardware: desktops, all-in-one PCs, mini PCs, laptops, monitors, keyboards, mice, headsets, conferencing equipment, power adapters and spares from Dell, HP, Lenovo, Asus, Apple and Logitech, to businesses, schools and colleges in Bengaluru. Industrial IoT installations covering UHF asset and inventory tracking, temperature and humidity monitoring, energy metering, and edge gateways integrated with dashboards and Vybe ERP. Supplied against purchase orders and tenders, with manufacturer warranty, GST invoicing, optional imaging and asset tagging, and buy-back or authorised e-waste disposal. Pricing, stock availability and warranty terms are quoted per enquiry rather than listed.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'City', name: 'Bengaluru' },
        url: u,
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Manufacturing and supply',
          itemListElement: MFG_LINES.map((l) => ({
            '@type': 'Offer',
            name: l.name,
            priceCurrency: 'INR',
            description: `${l.blurb} Quoted per enquiry; contact us for current pricing, stock availability and warranty terms.`,
            url: `${SITE}${l.href}`,
            itemOffered: { '@type': 'Service', name: l.name, provider: { '@id': `${SITE}/#organization` } },
          })),
        },
      }),
    },
  });
}

/* ------------------------------------------------ manufacturing, RFID cards */

const RFID_SPECS = [
  {
    icon: 'contactless',
    h: 'Frequency, chosen for the job',
    items: [
      '125 kHz low frequency: EM4100, EM4200, T5577. Cheap, read-only, fine for a simple door',
      '13.56 MHz high frequency: MIFARE Classic 1K and 4K, MIFARE DESFire EV1, EV2 and EV3, NTAG213, NTAG215, NTAG216',
      '860–960 MHz UHF: for vehicle tags, gate reads and anything that has to work at a distance',
      'Dual-frequency cards where a campus is halfway through replacing its readers, which is most of them',
    ],
  },
  {
    icon: 'credit_card',
    h: 'Format',
    items: [
      'CR80 ISO cards, 0.76 mm, the standard credit-card size every reader and wallet expects',
      'Key fobs and keyrings, for staff and for anyone who will not carry a card',
      'Silicone and fabric wristbands, for events, hostels and swimming pools',
      'Adhesive tags and on-metal tags, for asset tracking where the surface fights the antenna',
      'Clamshell cards, where the environment is rough and the card will be dropped',
    ],
  },
  {
    icon: 'tune',
    h: 'Personalisation',
    items: [
      'Photo identity printing, edge-to-edge, in full colour on both sides',
      'Sequential numbering, printed and encoded to match, so the card and the record agree',
      'Barcode and QR alongside the chip, for readers that have not been replaced yet',
      'Magnetic stripe and signature panel where a legacy system still needs one',
      'Matte, gloss and frosted finishes; rounded corners, slot punch and lanyard holes',
    ],
  },
  {
    icon: 'key',
    h: 'Encoding',
    items: [
      'Encoded to your system before delivery, so cards arrive working rather than blank',
      'Sector and application keys set to yours, not left on the factory default, which is how most card systems are actually broken into',
      'Access control formats: Wiegand 26 and 34, and the custom formats panels expect',
      'NDEF encoding for NFC cards that have to open a URL or a payment flow on a phone',
      'Card data supplied back as a file your system can import, matched to the printed numbers',
    ],
  },
];

const rfidFaqs = [
  {
    q: 'How is this different from the cards under Printing?',
    a: 'It is the same physical card, approached from opposite ends. <a class="text-brand font-bold" href="/printing/cards/">Card printing</a> is about the artwork, the finish and short runs: visiting cards, plain ID cards, a hundred passes for an event. This page is about what happens once a chip is involved: which chip, at which frequency, encoded to which system, with which keys, matched to the readers you already own. If your card has to open a door, mark attendance or pay for lunch, you are on the right page. If it just has to look good, the printing page is the cheaper one.',
  },
  {
    q: 'Will these work with the readers we already have?',
    a: 'That is the first thing to settle and it is why we ask for the reader model before quoting. A 125 kHz reader will never read a 13.56 MHz card, and a MIFARE Classic reader will not read DESFire unless it was set up for it. Tell us what is on your doors and turnstiles, and a photograph of the unit is usually enough, and we will tell you which chip you need. Where a campus is mid-migration between two systems, a dual-frequency card buys you the time to finish.',
  },
  {
    q: 'Do you encode them, or do we?',
    a: 'Whichever you prefer, and most people prefer us to. Cards encoded before delivery arrive working and matched to your data, with the printed number and the chip number agreeing, and we hand back a file your system can import. If your security policy says the keys never leave your building, that is a good policy and we will supply the cards blank with the numbering you specified.',
  },
  {
    q: 'Can they work with Vybe ERP and the cafeteria system?',
    a: 'Yes, and that is a large part of why we make them. Cards for a school running <a class="text-brand font-bold" href="/erp/">Vybe ERP</a> come encoded for attendance, and cards for a campus on <a class="text-brand font-bold" href="/cms/">Vybe CMS</a> come ready for the cashless cafeteria terminals. One card usually does the gate, the classroom and the canteen. Because both ends are ours, there is nobody in the middle explaining why the format does not match.',
  },
  {
    q: 'What is the minimum quantity?',
    a: 'It depends on the chip and the finish rather than being one fixed number, and blank stock cards run far smaller than fully personalised ones. Tell us what you are after and we will give you the practical minimum and the point at which the per-card price drops. If your run is too small to be worth doing properly, we will say so rather than take the order and disappoint you.',
  },
  {
    q: 'How long do they take?',
    a: 'Plain encoded cards from stock are quick. Fully personalised cards, with photo, name, number, encoded and verified, depend on how fast the data and the photographs reach us, and that is almost always the slow part rather than the printing. Send a clean spreadsheet and named photograph files and you will have a realistic date; send four hundred photographs called IMG_0423.jpg and it will take longer, for reasons nobody can fix at our end.',
  },
  {
    q: 'What does it cost?',
    a: `Quoted, because the chip choice moves the per-card price more than anything else does. An EM4100 fob and a DESFire EV3 card are not in the same bracket. Quantity, finish, whether it is personalised and whether we encode it do the rest. Tell us the chip or the reader, the quantity and what has to go on the face of the card at <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> and a figure comes back.`,
  },
];

const rfidBody = `<div class="w-full bg-surface-main">
${breadcrumbs(
  [CRUMB_HOME, { name: 'Manufacturing', url: '/manufacturing/' }, { name: 'RFID & NFC cards', url: '/manufacturing/rfid-cards/' }],
  false
)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Manufacturing</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">RFID and NFC cards, encoded to your system.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">Cards, fobs, tags and wristbands at 125 kHz, 13.56 MHz and UHF. Chip chosen against the readers you already own, personalised per person, encoded before delivery so they arrive working rather than blank.</p>

                <p class="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span class="text-5xl font-black font-display tracking-tight text-slate-900">On quote</span>
                    <span class="text-sm font-bold text-slate-500">the chip drives the price more than the quantity does</span>
                </p>
                <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-brand">Contact us for stock, minimum run, lead time and warranty</p>

                ${ctaRow({
                  waText: 'Hi Vybe, I would like a quote for RFID cards.',
                  waLabel: 'WhatsApp us',
                  email: ORG.sales,
                  subject: 'RFID and NFC card enquiry',
                  emailLabel: `Email ${ORG.sales}`,
                })}

                <div class="mt-12">
                    ${noticePanel(
                      'Tell us the reader before you tell us the card',
                      `<p>The single most expensive mistake in a card order is buying the wrong frequency. A 125 kHz reader will never read a 13.56 MHz card no matter how good the card is, and a panel configured for MIFARE Classic will not read DESFire unless somebody reconfigures it.</p>
                        <p>So send us a photograph of the reader on your door or turnstile, or its model number, before anything is ordered. It takes a minute and it is the difference between cards that work on the morning they arrive and a box of very well-printed coasters.</p>`
                    )}
                </div>

                <div class="mt-14 grid gap-5 md:grid-cols-2">
                    ${RFID_SPECS.map(
                      (s) => `<div class="flex flex-col rounded-2xl border border-slate-200 bg-white p-8">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${s.icon}</span>
                        <h2 class="mt-4 text-xl font-bold font-display tracking-tight text-slate-900">${esc(s.h)}</h2>
                        <ul class="mt-5 grid gap-2 text-sm text-slate-600">
                            ${s.items
                              .map(
                                (i) => `<li class="flex items-start gap-2">
                                <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                                <span>${esc(i)}</span>
                            </li>`
                              )
                              .join('\n                            ')}
                        </ul>
                    </div>`
                    ).join('\n                    ')}
                </div>
            </div>
        </section>

${proseSections({
  id: 'rfid-detail',
  eyebrow: 'In detail',
  heading: 'A card is only as good as what is on the chip.',
  sections: [
    {
      h: 'Which chip, and why it matters more than the price',
      p: 'An EM4100 card at 125 kHz is cheap, read-only and carries a number anybody with a fifteen-hundred-rupee cloner can copy in seconds. That is genuinely fine for a store room. It is not fine for a payroll gate, a hostel door or a cafeteria wallet. MIFARE DESFire EV2 and EV3 are a different class of thing: mutual authentication, encrypted communication, and no meaningful cloning risk in practice. The honest advice usually lands between the two: put the good chip where the money or the safety is, and do not pay for it on the visitor pass.',
    },
    {
      h: 'The default keys problem',
      p: 'Most card systems that get broken into are not broken by cryptography. They are broken because the MIFARE sector keys were left on the factory default, which is published in every datasheet and known to everybody. It costs nothing to set your own keys at encoding time and it is the single highest-value thing you can do to a card programme, so we do it by default and tell you what was set. If you have an existing estate still on factory keys, that is worth fixing before you buy a single new card.',
    },
    {
      h: 'Personalisation is a data job, not a printing job',
      p: 'The printing is the easy part. What determines whether a run of two thousand student cards goes smoothly is the quality of the spreadsheet and the photographs: consistent columns, names that match the enrolment system, photographs named by the same identifier as the rows. Where that is clean, cards are printed, encoded, verified and boxed in order. Where it is not, somebody spends three days matching faces to names, and that somebody is going to be one of us. We will tell you exactly what format to send before you start collecting it.',
    },
    {
      h: 'One card, several systems',
      p: 'The point of choosing the chip properly is that one card can do everything. The same card opens the gate, marks attendance in Vybe ERP, pays for lunch through Vybe CMS, borrows a book and gets the student into the exam hall. That only works if the format, the numbering and the keys are agreed once at the start, across every reader and every system that will touch the card. Retrofitting a second system onto a card programme that was not planned for it is where most campuses end up carrying two cards and resenting both.',
    },
  ],
})}

${siblingSection({
  eyebrow: 'Related',
  heading: 'What usually goes with a card programme.',
  items: [
    {
      href: '/manufacturing/',
      icon: 'precision_manufacturing',
      name: 'All manufacturing & supply',
      blurb: 'What we make and what we distribute, in one place.',
    },
    {
      href: '/manufacturing/distribution/',
      icon: 'local_shipping',
      name: 'IT hardware distribution',
      blurb: 'Desktops, laptops, displays and peripherals from Dell, HP, Lenovo, Asus and Apple.',
    },
    {
      href: '/manufacturing/iot/',
      icon: 'sensors',
      name: 'IoT solutions',
      blurb: 'Asset tracking that reads the same tags, plus temperature and energy monitoring.',
    },
    {
      href: '/printing/cards/',
      icon: 'badge',
      name: 'Card printing',
      blurb: 'Visiting cards, plain ID cards and short runs, where no chip is involved.',
    },
    {
      href: '/erp/',
      icon: 'dashboard_customize',
      name: 'Vybe ERP',
      blurb: 'Attendance, admissions and fees, with the card as the front end.',
    },
    {
      href: '/cms/',
      icon: 'fastfood',
      name: 'Vybe CMS',
      blurb: 'Cashless cafeteria that reads the same card as the gate.',
    },
    {
      href: '/it-solutions/',
      icon: 'code_blocks',
      name: 'IT & cyber',
      blurb: 'Access control, networking and the readers the cards have to talk to.',
    },
  ],
})}

${faqSection(rfidFaqs, { dark: false })}
${relatedSection('manufacturing', { dark: false })}
</div>`;

{
  const url = '/manufacturing/rfid-cards/';
  const lastmod = lastmodFor(url, rfidBody);
  DOCS.push({
    file: 'manufacturing/rfid-cards/index.html',
    priority: '0.7',
    changefreq: 'monthly',
    page: {
      url,
      nav: 'mfg-rfid',
      title: 'RFID & NFC Card Manufacturing in Bengaluru | Vybe',
      ogTitle: 'RFID and NFC cards, encoded to your system',
      description:
        'RFID and NFC cards, fobs, tags and wristbands made in Bengaluru. MIFARE, DESFire, NTAG and UHF, personalised and encoded. Contact us for pricing and lead time.',
      lastmod,
      trail: [
        CRUMB_HOME,
        { name: 'Manufacturing', url: '/manufacturing/' },
        { name: 'RFID & NFC cards', url },
      ],
      faqs: rfidFaqs,
      body: rfidBody,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: 'RFID and NFC card manufacturing',
        serviceType: 'RFID and NFC card manufacturing, personalisation and encoding',
        description:
          'Manufacture of RFID and NFC cards, key fobs, wristbands and asset tags in Bengaluru, at 125 kHz (EM4100, EM4200, T5577), 13.56 MHz (MIFARE Classic 1K and 4K, MIFARE DESFire EV1, EV2 and EV3, NTAG213, NTAG215, NTAG216) and UHF, including dual-frequency cards. Photo identity personalisation, sequential numbering, barcode and QR, magnetic stripe and signature panel, and encoding to Wiegand and custom access control formats with customer-set sector keys. Integrates with Vybe ERP attendance and Vybe CMS cashless cafeteria. Pricing, minimum run and lead time are quoted per enquiry.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'City', name: 'Bengaluru' },
        url: u,
        isRelatedTo: { '@id': `${SITE}/manufacturing/#service` },
      }),
    },
  });
}

/* -------------------------------------------------------- manufacturing, IoT */

const IOT_SPECS = [
  {
    icon: 'inventory_2',
    h: 'Asset and inventory tracking',
    items: [
      'UHF tags read at gates and doorways, so a movement is logged without anybody stopping to scan',
      'Handheld readers for stock counts that take an afternoon rather than a weekend',
      'On-metal and ruggedised tags, for tools, trolleys and anything where the surface fights the antenna',
      'Tags made on the same line as the cards, so the tag and the reader are specified together rather than separately',
      'Movement tied to a person and a time, not just to a location',
    ],
  },
  {
    icon: 'thermostat',
    h: 'Temperature and humidity',
    items: [
      'Cold rooms, stores and server rooms logged continuously rather than checked on a clipboard',
      'Alerts by WhatsApp, email or SMS the moment a reading leaves the band you set',
      'History retained, so an auditor can be shown the last twelve months instead of this morning',
      'Battery sensors where running a cable is not practical, mains-powered where it is',
      'Placement chosen against what you are actually protecting: the reading at the door is not the reading in the middle of the room',
    ],
  },
  {
    icon: 'bolt',
    h: 'Energy metering',
    items: [
      'Clamp-on CT meters per panel, line or department, fitted without rewiring',
      'Consumption over time, so the bill becomes a set of numbers you can act on',
      'Load patterns that show what is still running out of hours and should not be',
      'Solar and generator contribution tracked alongside grid draw where both are present',
      'Per-department figures where the cost has to be allocated internally',
    ],
  },
  {
    icon: 'hub',
    h: 'Gateways and integration',
    items: [
      'Edge gateways that keep logging when the internet drops and backfill when it returns',
      'Wi-Fi, Ethernet, LoRaWAN or 4G chosen against the building rather than the brochure',
      'Modbus and MQTT where the equipment already speaks them',
      'Dashboards that can be read at a glance, with CSV export for whoever wants the raw numbers',
      'Readings into Vybe ERP where you already run it, rather than a second system to log into',
    ],
  },
];

const iotFaqs = [
  {
    q: 'Where does a project like this actually start?',
    a: 'With a question rather than a sensor. "Which cold room went out of range last month", "what are we still running at two in the morning", "where did that trolley go". Each of those implies a different sensor in a different place, and answering one properly is worth more than instrumenting the whole building and reading none of it. Tell us the decision you want to make and we will work backwards to the smallest installation that answers it.',
  },
  {
    q: 'Can this use the RFID tags you already make?',
    a: `Yes, and it is the main reason this sits under manufacturing rather than under IT. The tags and cards are made and encoded here, so the tag, the reader and the numbering are specified together instead of being bought from three places and reconciled afterwards. If you already run cards from us for doors or attendance, asset tracking can reuse the same numbering rather than starting a second scheme. The chip side of that is covered on <a class="text-brand font-bold" href="/manufacturing/rfid-cards/">RFID and NFC card manufacturing</a>.`,
  },
  {
    q: 'What happens when the internet at the site goes down?',
    a: 'The gateway keeps logging locally and backfills when the link returns, so you get a gap in the dashboard rather than a hole in the record. This matters more than it sounds: the sites that most need monitoring are often the ones with the least reliable connectivity, and a system that silently stops recording during an outage is worse than no system, because you only discover it when somebody asks for the very period that is missing.',
  },
  {
    q: 'Does it feed into Vybe ERP?',
    a: `Where you run it, yes. Readings and asset movements can land in <a class="text-brand font-bold" href="/erp/">Vybe ERP</a> so there is one place to look rather than another login and another password. Where you run something else, we can export to it or simply hand you CSV and an API and let your team do the joining. What we try to avoid is leaving you with a dashboard nobody opens because it lives somewhere separate from the system people already have open all day.`,
  },
  {
    q: 'Who owns the data?',
    a: 'You do, and you can export all of it at any time in a format that is useful rather than deliberately awkward. We will tell you plainly where it is stored before anything is installed. If your policy requires it to stay on your own hardware, that is a reasonable policy and the gateway can be configured to keep it there, but it changes the quote and it is better raised at the start than discovered at handover.',
  },
  {
    q: 'What happens when a sensor fails?',
    a: 'It is treated as an event rather than as silence. A sensor that stops reporting raises the same kind of alert as one reporting a bad number, because the failure mode that actually hurts is a dead sensor sitting unnoticed for six weeks while everybody assumes the cold room is fine. Batteries are reported before they die rather than after. Spares are quoted with the installation so a replacement is a swap rather than a procurement exercise.',
  },
  {
    q: 'What does it cost?',
    a: `Quoted, and the site drives it more than the sensor count does. A single cold room is a small job; six buildings with poor connectivity and an energy meter on every panel is not. The survey is where the real number comes from, because cable runs, mounting and how far the gateway sits from the sensors move the price more than the hardware list does. Tell us the site and the question you want answered at <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> and a figure comes back.`,
  },
];

const iotBody = `<div class="w-full bg-surface-main">
${breadcrumbs(
  [CRUMB_HOME, { name: 'Manufacturing', url: '/manufacturing/' }, { name: 'IoT solutions', url: '/manufacturing/iot/' }],
  false
)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Manufacturing</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">IoT that answers a question you already have.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">Asset and inventory tracking on the tags we make ourselves. Temperature, humidity and energy logged continuously, with alerts when a reading leaves the band. Gateways that keep working when the internet does not, and readings that land where you already look.</p>

                <p class="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span class="text-5xl font-black font-display tracking-tight text-slate-900">On quote</span>
                    <span class="text-sm font-bold text-slate-500">the site drives the price more than the sensor count does</span>
                </p>
                <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-brand">Contact us for a site survey, sensor count, connectivity and lead time</p>

                ${ctaRow({
                  waText: 'Hi Vybe, I would like to talk about an IoT installation.',
                  waLabel: 'WhatsApp us',
                  email: ORG.sales,
                  subject: 'IoT solutions enquiry',
                  emailLabel: `Email ${ORG.sales}`,
                })}

                <div class="mt-12">
                    ${noticePanel(
                      'Tell us the question before you tell us the sensor',
                      `<p>The usual way an IoT project goes wrong is not technical. It is that everything gets instrumented, a dashboard appears with forty tiles on it, and within a month nobody opens it because no single tile was tied to a decision anybody actually makes.</p>
                        <p>So the first conversation is about what you want to stop guessing at: which room went out of range, what is drawing power overnight, where the trolley went. One question answered properly is worth more than a building full of sensors, and it is usually a much smaller quote than you expect.</p>`
                    )}
                </div>

                <div class="mt-14 grid gap-5 md:grid-cols-2">
                    ${IOT_SPECS.map(
                      (s) => `<div class="flex flex-col rounded-2xl border border-slate-200 bg-white p-8">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">${s.icon}</span>
                        <h2 class="mt-4 text-xl font-bold font-display tracking-tight text-slate-900">${esc(s.h)}</h2>
                        <ul class="mt-5 grid gap-2 text-sm text-slate-600">
                            ${s.items
                              .map(
                                (i) => `<li class="flex items-start gap-2">
                                <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                                <span>${esc(i)}</span>
                            </li>`
                              )
                              .join('\n                            ')}
                        </ul>
                    </div>`
                    ).join('\n                    ')}
                </div>
            </div>
        </section>

${proseSections({
  id: 'iot-detail',
  eyebrow: 'In detail',
  heading: 'A reading is only useful if somebody trusts it.',
  sections: [
    {
      h: 'Placement decides the number',
      p: 'A temperature sensor mounted next to the door of a cold room will read the corridor every time somebody opens it, and the record will show excursions that never happened to the stock. One buried at the back behind a pallet will read nothing but the pallet. Neither is a sensor fault and no amount of software fixes either. Where the sensor goes is a judgement about what you are protecting, made on site with the doors open and the shelves loaded, and it is the part of the job that earns its money.',
    },
    {
      h: 'Alerts that people still read in month six',
      p: 'An alert that fires twice a day gets muted within a fortnight, and the one that mattered goes with it. So the bands are set against what the stock or the equipment can actually tolerate rather than against a round number, with a delay so a door held open for thirty seconds does not page anybody, and an escalation so an unacknowledged alert at two in the morning reaches a second person. Tuning this after a few weeks of real data is part of the installation, not an extra.',
    },
    {
      h: 'Connectivity is where these projects actually fail',
      p: 'The sensors are rarely the problem. The problem is the cold store at the back of the building where Wi-Fi does not reach, the 4G that works on a phone at head height and not on a gateway in a plant room, and the site where somebody unplugs the router every night. That is what the survey is looking for. Sometimes the answer is LoRaWAN because it walks through walls the Wi-Fi will not; sometimes it is a cable, because a cable is boring and works.',
    },
    {
      h: 'One place to look',
      p: 'Every system added to a business brings a login, and a login nobody uses is a system that is not doing anything. Where you already run Vybe ERP, readings and asset movements can appear there alongside everything else, so checking them is part of a routine somebody already has rather than a separate habit they have to build. Where they have to live in their own dashboard, we would rather put five tiles on it that get read than forty that do not.',
    },
  ],
})}

${siblingSection({
  eyebrow: 'Related',
  heading: 'What usually goes with an IoT installation.',
  items: [
    {
      href: '/manufacturing/',
      icon: 'precision_manufacturing',
      name: 'All manufacturing & supply',
      blurb: 'What we make and what we distribute, in one place.',
    },
    {
      href: '/manufacturing/rfid-cards/',
      icon: 'contactless',
      name: 'RFID & NFC cards',
      blurb: 'The tags and cards the tracking side reads, made and encoded here.',
    },
    {
      href: '/manufacturing/distribution/',
      icon: 'local_shipping',
      name: 'IT hardware distribution',
      blurb: 'The displays, mini PCs and networking the dashboards run on.',
    },
    {
      href: '/erp/',
      icon: 'dashboard_customize',
      name: 'Vybe ERP',
      blurb: 'Where the readings can land, instead of a separate login.',
    },
    {
      href: '/it-solutions/',
      icon: 'code_blocks',
      name: 'IT & cyber',
      blurb: 'The networking, cabling and security the gateways depend on.',
    },
  ],
})}

${faqSection(iotFaqs, { dark: false })}
${relatedSection('manufacturing', { dark: false })}
</div>`;

{
  const url = '/manufacturing/iot/';
  const lastmod = lastmodFor(url, iotBody);
  DOCS.push({
    file: 'manufacturing/iot/index.html',
    priority: '0.7',
    changefreq: 'monthly',
    page: {
      url,
      nav: 'mfg-iot',
      title: 'IoT Solutions for Manufacturing in Bengaluru | Vybe',
      ogTitle: 'IoT: asset tracking, environment and energy monitoring',
      description:
        'IoT for manufacturing in Bengaluru: UHF asset tracking, temperature, humidity and energy monitoring, gateways and ERP integration. Contact us for a survey.',
      lastmod,
      trail: [
        CRUMB_HOME,
        { name: 'Manufacturing', url: '/manufacturing/' },
        { name: 'IoT solutions', url },
      ],
      faqs: iotFaqs,
      body: iotBody,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: 'IoT solutions for manufacturing',
        serviceType: 'Industrial IoT: asset tracking, environmental and energy monitoring',
        description:
          'Design, supply and installation of IoT systems for manufacturing and distribution sites in Bengaluru. UHF RFID asset and inventory tracking using fixed gateway readers, handheld readers and on-metal tags manufactured in house; continuous temperature and humidity monitoring of cold rooms, stores and server rooms with threshold alerting and retained history; energy metering per panel, line or department using clamp-on current transformers, including solar and generator contribution. Edge gateways with local buffering over Wi-Fi, Ethernet, LoRaWAN or 4G, Modbus and MQTT integration, dashboards with CSV export and integration into Vybe ERP. Scope, sensor count and lead time are quoted per site survey rather than listed.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'City', name: 'Bengaluru' },
        url: u,
        isRelatedTo: { '@id': `${SITE}/manufacturing/#service` },
      }),
    },
  });
}

/* ---------------------------------------------- manufacturing, distribution */

/**
 * One card per category. The image is a manufacturer render used as a
 * representative shot of the category, not a photograph of stock we hold,
 * which is why the card says "contact for stock" rather than showing a count.
 */
function distCard(c) {
  const art = c.img
    ? picture({
        base: `products/${c.img}`,
        alt: `${c.name} of the kind Vybe supplies`,
        cls: 'w-full h-48 object-contain',
        h: 320,
        aspect: 1,
      })
    : `<div class="w-full h-48 flex items-center justify-center"><span class="material-symbols-outlined text-brand text-[64px]" aria-hidden="true">${c.icon}</span></div>`;

  return `<li id="${c.id}" class="flex flex-col h-full rounded-2xl border border-slate-200 bg-white p-8 scroll-mt-28 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <div class="rounded-xl bg-white">${art}</div>
                        <span class="material-symbols-outlined text-brand text-[24px] mt-6" aria-hidden="true">${c.icon}</span>
                        <h3 class="mt-2 text-xl font-bold font-display tracking-tight text-slate-900">${esc(c.name)}</h3>
                        <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-brand">${esc(c.brands)}</p>
                        <p class="mt-3 text-sm text-slate-600 leading-relaxed">${esc(c.blurb)}</p>

                        <ul class="mt-5 grid gap-2 text-sm text-slate-600">
                            ${c.lines
                              .map(
                                (l) => `<li class="flex items-start gap-2">
                                <span class="material-symbols-outlined text-brand text-[18px] shrink-0 mt-0.5" aria-hidden="true">check_circle</span>
                                <span>${esc(l)}</span>
                            </li>`
                              )
                              .join('\n                            ')}
                        </ul>

                        <p class="mt-auto pt-6 text-sm text-slate-500 leading-relaxed"><span class="font-bold uppercase tracking-[0.15em] text-xs text-slate-400 block mb-1">Before you order</span>Contact us for current stock, configuration options, lead time and warranty. We do not publish those here because they change weekly.</p>
                    </li>`;
}

const distFaqs = [
  {
    q: 'Where are the prices?',
    a: 'Not on the page, and that is deliberate rather than coy. Hardware pricing moves with the distributor rate, the configuration, the quantity and the warranty term, and a figure printed here would be wrong within the week. Send us the model or the specification and the quantity and you will have a current, firm figure, usually the same day, and valid for long enough to get it approved.',
  },
  {
    q: 'Do you have it in stock?',
    a: 'Ask us, and you will get a straight answer per model rather than a badge on a page. Some lines we hold, most come in against the order, and lead times move constantly. What we will not do is publish a stock count that is stale by the time you read it. If something is four weeks out, we will tell you four weeks before you raise the purchase order rather than after.',
  },
  {
    q: 'What warranty comes with it?',
    a: 'The manufacturer’s, and the term varies by product and by SKU, usually one to three years on desktops and notebooks, with on-site and extended cover available across the Dell, HP and Lenovo commercial ranges. Refurbished units carry their own shorter warranty, stated per unit on the quotation. Ask about a specific model and we will tell you the term, what it actually covers, and what upgrading to on-site would cost.',
  },
  {
    q: 'Can I get a configuration that is not listed here?',
    a: 'Almost certainly. The lines on this page are what moves regularly, not the extent of what we can source. More memory, a bigger or second drive, a discrete graphics card, a different operating system, a specific keyboard layout, a particular warranty term: all of it is configurable, and on the commercial ranges a build-to-order usually beats buying a stock machine and upgrading it afterwards. Tell us the workload rather than the part numbers and we will come back with the specification.',
  },
  {
    q: 'Do you supply refurbished machines?',
    a: 'Yes, and we label them plainly as refurbished on the quotation and the invoice. Refurbished Dell OptiPlex small form factor units and HP ProDesk 400 G4 and G5 Minis are the ones that move most, and are genuinely sensible for a lab, a reception desk, a signage player or anywhere the workload is light and the budget is real. They carry a shorter warranty, stated per unit, and we will tell you honestly when spending a little more on new is the better decision.',
  },
  {
    q: 'Will you image and asset-tag them before delivery?',
    a: 'Yes, and for anything above a handful of machines it is usually the cheaper way round. We image to your standard build, join them to your domain or tenant, install what you standardise on, asset-tag them against a register we hand back as a spreadsheet, and take the packaging away. Your own team then spends the day doing their job rather than unboxing.',
  },
  {
    q: 'Do you deliver outside Bengaluru?',
    a: 'Yes, across Karnataka and beyond it for orders of a reasonable size, with freight quoted openly in the scope rather than buried in the unit price. Installation and imaging outside the city depend on the size of the order. For a full campus it is straightforward, for four machines it rarely justifies the travel and we will say so.',
  },
  {
    q: 'Can you quote for a tender or a GeM comparison?',
    a: 'Yes. We can supply quotations in the format your procurement needs, with specification sheets, make and model detail, HSN codes and the compliance documents a tender file asks for, and we can quote on a like-for-like basis against a GeM listing where a school, college or office needs the comparison on record. Tell us the format and the deadline.',
  },
];

const distBody = `<div class="w-full bg-surface-main">
${breadcrumbs(
  [CRUMB_HOME, { name: 'Manufacturing', url: '/manufacturing/' }, { name: 'Distribution', url: '/manufacturing/distribution/' }],
  false
)}

        <section class="px-6 pt-12 pb-20 md:pb-28 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Distribution</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">IT hardware, supplied and set up.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">Desktops, all-in-ones, mini PCs, laptops, monitors and peripherals from Dell, HP, Lenovo, Asus, Apple and Logitech. Sourced through authorised distribution, with the manufacturer warranty intact and a GST invoice that your asset register will accept.</p>

                <p class="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span class="text-5xl font-black font-display tracking-tight text-slate-900">On quote</span>
                    <span class="text-sm font-bold text-slate-500">configuration and quantity decide the number</span>
                </p>
                <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-brand">Contact us for stock, lead time, configuration and warranty</p>

                ${ctaRow({
                  waText: MFG_ENQUIRY,
                  waLabel: 'WhatsApp us',
                  email: ORG.sales,
                  subject: 'IT hardware supply enquiry',
                  emailLabel: `Email ${ORG.sales}`,
                })}

                <div class="mt-12">
                    ${noticePanel(
                      'No prices, no stock counts. Ask and you get both.',
                      `<p>Everything below is what we supply regularly. What is not below is a price or a stock figure, because both move weekly and a stale number helps nobody, least of all you, when you have already taken it to your finance team.</p>
                        <p>Tell us the model or the specification and the quantity, and you get a current figure, the real lead time, the configuration options and the warranty term that applies. <strong>Product images are manufacturers’ own renders shown to illustrate each category, not photographs of stock in hand, and all brand names and marks belong to their owners.</strong></p>`
                    )}
                </div>

                <div class="mt-14 rounded-2xl border border-slate-200 bg-white p-8">
                    <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Brands we supply</h2>
                    <ul class="mt-5 flex flex-wrap gap-x-8 gap-y-3">
                        ${DIST_BRANDS.map(
                          (b) => `<li class="text-lg font-bold font-display tracking-tight text-slate-700">${esc(b)}</li>`
                        ).join('\n                        ')}
                    </ul>
                    <p class="mt-5 text-sm text-slate-500 leading-relaxed">All trademarks are the property of their respective owners. Vybe Technologies is a reseller; listing a brand here describes what we supply and is not a claim of endorsement, authorisation tier or partnership beyond ordinary distribution.</p>
                </div>

                <ul class="mt-8 grid gap-5 lg:grid-cols-3">
                    ${DIST_CATEGORIES.map(distCard).join('\n                    ')}
                </ul>

                <div class="mt-8">
                    ${noticePanel('Refurbished, where it genuinely makes sense', `<p>We also supply refurbished business machines: Dell OptiPlex small form factor units, HP ProDesk 400 G4 and G5 Minis and similar. For a lab, a reception desk, a signage player or a back-office role where the workload is light, they are a sensible use of a real budget.</p>
                        <p>They are labelled refurbished on the quotation and on the invoice, never quietly mixed in with new, and they carry their own shorter warranty which is stated per unit before you agree to anything. Where spending a little more on new is the better decision, we will say so.</p>`)}
                </div>

                ${checklistPanel('What we can do before it reaches your desk', [
                  'Image every machine to your standard build, so they arrive identical',
                  'Join them to your domain, Microsoft 365 tenant or Google Workspace',
                  'Install the software you standardise on, licensed and activated',
                  'Asset-tag each unit and hand back the register as a spreadsheet',
                  'Deliver to the room rather than the loading bay, and take the packaging away',
                  'Buy back or responsibly dispose of what the new kit replaces, with a disposal certificate',
                ])}
            </div>
        </section>

${proseSections({
  id: 'distribution-detail',
  eyebrow: 'In detail',
  heading: 'Buying hardware well is mostly about asking better questions.',
  sections: [
    {
      h: 'Specify against the workload, not the spec sheet',
      p: 'The most common way to waste money on a fleet is to buy one configuration for everybody. A reception desk, a computer lab, an accounts team running heavy spreadsheets and a designer are four different machines, and buying the designer’s specification for all of them costs several times what buying the reception desk’s would. Tell us what the machines are actually for, floor by floor if need be, and the quotation will come back split accordingly, which more often than not is how the total comes down rather than up.',
    },
    {
      h: 'Memory and storage are where the real decisions are',
      p: 'Processor generation is what the spec sheet leads with and it is rarely what anybody feels. What people feel is 8 GB of memory on a machine running a browser with thirty tabs, a video call and an ERP client, and a mechanical drive on a machine that boots twenty times a day. Sixteen gigabytes and an NVMe SSD change the experience of a mid-range machine more than a processor tier does, and cost less. Where a budget is tight, that is the trade we will recommend every time.',
    },
    {
      h: 'The warranty question worth asking',
      p: 'Not how long, but what happens. A one-year carry-in warranty means somebody in your office packs the machine and takes it somewhere, and the machine is gone for a fortnight. Three-year on-site means an engineer comes to the desk. For a school or an office where nobody has a spare machine to hand out, the difference in downtime is worth far more than the difference in price, and on the commercial ranges from Dell, HP and Lenovo it is a modest uplift at the point of purchase and impossible to add later. Ask about it before you order, not after.',
    },
    {
      h: 'What happens to the old machines',
      p: 'They should not go in a cupboard, which is where most of them go. Anything with life left in it has a buy-back value that comes straight off the cost of the new kit, and anything that does not needs to go to an authorised e-waste handler, not to the scrap dealer at the gate, who will take the payment and the liability stays with you. We handle both, and for anything carrying data we can wipe drives to a documented standard and give you a certificate of destruction and disposal for your records. That is the piece that matters if you are ever audited on it, and it is the piece almost everybody forgets to ask for.',
    },
  ],
})}

${siblingSection({
  eyebrow: 'Related',
  heading: 'What usually goes with a hardware order.',
  items: [
    {
      href: '/manufacturing/',
      icon: 'precision_manufacturing',
      name: 'All manufacturing & supply',
      blurb: 'What we make and what we distribute, in one place.',
    },
    {
      href: '/manufacturing/rfid-cards/',
      icon: 'contactless',
      name: 'RFID & NFC cards',
      blurb: 'Cards, fobs and tags, encoded to your access control and attendance systems.',
    },
    {
      href: '/smart-classroom/',
      icon: 'smart_display',
      name: 'Smart classrooms',
      blurb: 'Interactive flat panels and hybrid teaching rigs, specified and installed.',
    },
    {
      href: '/it-solutions/',
      icon: 'code_blocks',
      name: 'IT & cyber',
      blurb: 'Networking, security and managed IT for the fleet once it is in.',
    },
    {
      href: '/workspace/',
      icon: 'alternate_email',
      name: 'Workspace & email',
      blurb: 'Google Workspace and Microsoft 365, so the new machines have something to join.',
    },
    {
      href: '/audits/workplace-compliance/',
      icon: 'verified_user',
      name: 'Software licence audit',
      blurb: 'Count what is installed against what is paid for, before a vendor does it for you.',
    },
  ],
})}

${faqSection(distFaqs, { dark: false })}
${relatedSection('manufacturing', { dark: false })}
</div>`;

{
  const url = '/manufacturing/distribution/';
  const lastmod = lastmodFor(url, distBody);
  DOCS.push({
    file: 'manufacturing/distribution/index.html',
    priority: '0.7',
    changefreq: 'monthly',
    page: {
      url,
      nav: 'mfg-distribution',
      title: 'IT Hardware Distribution in Bengaluru | Vybe',
      ogTitle: 'IT hardware distribution: desktops, laptops, displays, peripherals',
      description:
        'Dell, HP, Lenovo, Asus and Apple desktops, laptops, monitors and peripherals supplied in Bengaluru. Contact us for stock, pricing and warranty.',
      lastmod,
      trail: [CRUMB_HOME, { name: 'Manufacturing', url: '/manufacturing/' }, { name: 'Distribution', url }],
      faqs: distFaqs,
      body: distBody,
      schema: (u) => ({
        '@type': 'Service',
        '@id': `${u}#service`,
        name: 'IT hardware distribution',
        serviceType: 'IT hardware supply and distribution',
        description:
          'Supply of IT hardware to businesses, schools and colleges in Bengaluru: desktops and towers, all-in-one PCs, mini PCs and small form factor machines, laptops and notebooks, monitors and displays, keyboards, mice and input devices, headsets and conferencing equipment, and power adapters and spares, from Dell, HP, Lenovo, Asus, Apple, Logitech and Alienware, including refurbished business machines labelled as such. Sourced through authorised distribution with manufacturer warranty, supplied against purchase orders and tenders with GST invoicing, and optionally imaged, domain-joined and asset-tagged before delivery, with buy-back and authorised e-waste disposal of replaced equipment. Pricing, stock availability, configuration options and warranty terms are quoted per enquiry rather than published. All trademarks are the property of their respective owners.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'City', name: 'Bengaluru' },
        url: u,
        isRelatedTo: { '@id': `${SITE}/manufacturing/#service` },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'IT hardware',
          itemListElement: DIST_CATEGORIES.map((c) => ({
            '@type': 'Offer',
            name: c.name,
            priceCurrency: 'INR',
            description: `${c.blurb} Brands: ${c.brands.replace(/ · /g, ', ')}. Quoted per enquiry; contact us for current pricing, stock availability, configuration options and warranty terms.`,
            url: `${u}#${c.id}`,
            itemOffered: { '@type': 'Product', name: c.name, category: 'IT hardware' },
          })),
        },
      }),
    },
  });
}


/* --------------------------------------------------- certificate verification */

/**
 * The certificate register. This array is the whole source of truth: it is
 * serialised into /assets/verify.js at build time and looked up client-side,
 * because Azure Static Web Apps serves files and nothing else — there is no
 * database to query and no API to call.
 *
 * Adding a certificate is a line here followed by `npm run build`. Never edit
 * assets/verify.js by hand; it is generated output like every other page.
 *
 * `status` is 'active' or 'withdrawn'. Expiry is not a status: it is derived
 * from `expires` against the day the visitor loads the page, so a certificate
 * cannot sit here reading "valid" a year after it lapsed.
 *
 * `specimen: true` marks a record that is not a real issued certificate. The
 * PDF it points at is watermarked SAMPLE and the result card says so, so that
 * a demonstration record can never be mistaken for a live one.
 */
const CERTIFICATES = [
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

const SPECIMEN = CERTIFICATES.find((c) => c.specimen) || CERTIFICATES[0];

/* Ligature names the result card can render. They are written into the
   generated file as a declaration because the card builds its markup by
   concatenation, so the icon name never appears next to the class name for
   tools/gen-fonts.mjs to find. Left undeclared, `npm run fonts` would subset
   these glyphs out and the card would render the words "verified" and
   "open_in_new" in place of the icons. */
const VERIFY_ICONS = ['verified', 'info', 'gavel', 'search', 'description', 'open_in_new'];

/* The lookup runs in the browser, so it ships as a real file rather than an
   inline <script>: the CSP is script-src 'self' with no 'unsafe-inline', and
   an inline block would be dropped by the browser before it ran. Because it
   lives under /assets/, tools/stamp-assets.js hashes its URL and a revised
   register reaches visitors instead of sitting in a year-long edge cache. */
write(
  'assets/verify.js',
  `/*
 * GENERATED by build.js from the CERTIFICATES register. Do not edit.
 *
 * The certificate verifier behind /verify/. Progressive enhancement: the page,
 * the form and the guidance are all in the HTML before this deferred file
 * runs. Without it the form still submits, as a plain GET to /verify/?cert=…,
 * and the <noscript> panel tells the visitor how to check by email instead.
 *
 * material-symbols-outlined: ${VERIFY_ICONS.join(', ')}
 */
(function () {
  'use strict';

  var CERTS = ${JSON.stringify(CERTIFICATES, null, 2).replace(/</g, '\\u003c').split('\n').join('\n  ')};
  var LEGAL = ${JSON.stringify(ORG.legal)};

  var form = document.getElementById('verify-form');
  var input = document.getElementById('verify-number');
  var out = document.getElementById('verify-result');
  if (!form || !input || !out) return;

  /* Certificate numbers get retyped off paper and pasted out of PDFs, where a
     dash can arrive as an en dash and a space can arrive anywhere. Matching on
     letters and digits alone means "vyb qms 2026 0417" finds the same record
     as "VYB-QMS-2026-0417", without loosening what counts as a match. */
  var key = function (s) {
    return String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  };

  var index = {};
  for (var i = 0; i < CERTS.length; i++) index[key(CERTS[i].number)] = CERTS[i];

  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  /* Dates are stored ISO and shown the way the certificate itself shows them.
     Formatting here rather than through toLocaleDateString keeps the card and
     the paper identical whatever locale the visitor's browser is set to. */
  var dmy = function (iso) {
    var p = String(iso).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  };

  var today = function () {
    var d = new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  };

  /* ISO dates compare correctly as strings, which is the point of storing them
     that way: no Date parsing, no timezone sliding the expiry by a day. */
  var state = function (c) {
    if (c.status === 'withdrawn') {
      return { tone: 'amber', icon: 'gavel', label: 'Withdrawn', note: 'This certificate was withdrawn by Vybe Technologies before its expiry date. It must not be relied on or displayed.' };
    }
    if (c.expires < today()) {
      return { tone: 'rose', icon: 'info', label: 'Expired', note: 'This certificate has passed its expiry date and is no longer valid. It must not be displayed as current.' };
    }
    return { tone: 'emerald', icon: 'verified', label: 'Valid', note: 'This certificate is on our register and is valid on today\\u2019s date.' };
  };

  var TONES = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    slate: 'bg-slate-100 text-slate-700 border-slate-300',
  };

  var row = function (label, value) {
    return (
      '<div class="border-t border-slate-200 pt-4">' +
      '<dt class="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">' + esc(label) + '</dt>' +
      '<dd class="mt-1 text-sm text-slate-700 leading-relaxed">' + esc(value) + '</dd>' +
      '</div>'
    );
  };

  var chip = function (s) {
    return (
      '<span class="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-bold ' + TONES[s.tone] + '">' +
      '<span class="material-symbols-outlined text-[18px]" aria-hidden="true">' + s.icon + '</span>' + esc(s.label) +
      '</span>'
    );
  };

  var found = function (c) {
    var s = state(c);
    return (
      '<div class="rounded-2xl border border-slate-200 bg-white p-8 md:p-10 shadow-xl">' +
      '<div class="flex flex-wrap items-center gap-3">' + chip(s) +
      (c.specimen
        ? '<span class="inline-flex items-center gap-2 rounded-full border ' + TONES.slate + ' px-4 py-1.5 text-sm font-bold">' +
          '<span class="material-symbols-outlined text-[18px]" aria-hidden="true">description</span>Specimen record</span>'
        : '') +
      '<span class="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">Checked ' + dmy(today()) + '</span>' +
      '</div>' +
      '<p class="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-brand">' + esc(c.number) + '</p>' +
      '<h2 class="mt-2 text-3xl md:text-4xl font-black font-display tracking-tight text-slate-900">' + esc(c.holder) + '</h2>' +
      '<p class="mt-2 text-sm text-slate-600 leading-relaxed">' + esc(c.address) + '</p>' +
      '<p class="mt-5 text-sm text-slate-600 leading-relaxed">' + esc(s.note) + '</p>' +
      (c.specimen
        ? '<p class="mt-3 text-sm text-slate-600 leading-relaxed"><strong>This is a demonstration record.</strong> ' +
          'No organisation of this name holds a Vybe certificate. It is published so that anyone can see exactly what a real ' +
          'verification result shows before they are handed a number to check.</p>'
        : '') +
      '<dl class="mt-8 grid gap-5 sm:grid-cols-2">' +
      row('Standard', c.standard) +
      row('Scheme', c.scheme) +
      row('Scope of certification', c.scope) +
      row('Issued by', 'Vybe Technologies, Bengaluru') +
      row('Initial certification', dmy(c.initial)) +
      row('Issue date', dmy(c.issued)) +
      row('Expiry date', dmy(c.expires)) +
      '</dl>' +
      (c.pdf
        ? '<a href="' + esc(c.pdf) + '" class="mt-8 inline-flex items-center gap-2 text-sm font-bold text-brand hover:gap-3 transition-all" target="_blank" rel="noopener">' +
          '<span class="material-symbols-outlined text-[18px]" aria-hidden="true">description</span>View the certificate as issued (PDF)' +
          '<span class="material-symbols-outlined text-[18px]" aria-hidden="true">open_in_new</span></a>'
        : '') +
      '</div>'
    );
  };

  var missing = function (n) {
    return (
      '<div class="rounded-2xl border border-slate-200 bg-white p-8 md:p-10 shadow-xl">' +
      '<div class="flex flex-wrap items-center gap-3">' + chip({ tone: 'slate', icon: 'search', label: 'Not on the register' }) + '</div>' +
      '<h2 class="mt-6 text-2xl md:text-3xl font-black font-display tracking-tight text-slate-900">No certificate matches ' + esc(n) + '.</h2>' +
      '<p class="mt-4 text-sm text-slate-600 leading-relaxed">Nothing on our register carries that number. That means one of three things, ' +
      'and it is worth ruling out the first two before acting on the third: the number was mistyped or read wrong off a scan; the certificate ' +
      'was issued by some other body and not by us; or the document you are holding was never issued at all.</p>' +
      '<p class="mt-4 text-sm text-slate-600 leading-relaxed">Check the number against the document and try again. If it still does not resolve, ' +
      'send us a scan at <a class="font-bold text-brand hover:underline" href="mailto:' + LEGAL + '?subject=Certificate%20verification">' + LEGAL + '</a> ' +
      'and we will tell you in writing whether it came from us.</p>' +
      '</div>'
    );
  };

  var render = function (raw) {
    var n = String(raw).trim();
    if (!n) {
      out.innerHTML = '';
      return;
    }
    var c = index[key(n)];
    out.innerHTML = c ? found(c) : missing(n);
  };

  /* The number belongs in the URL: a verification result is the kind of thing
     people bookmark, forward to a colleague or attach to a tender file, and
     the QR code on the certificate itself points straight at ?cert=. */
  var param = function () {
    var m = /[?&]cert=([^&]*)/.exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\\+/g, ' ')) : '';
  };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var n = input.value.trim();
    var url = n ? window.location.pathname + '?cert=' + encodeURIComponent(n) : window.location.pathname;
    window.history.replaceState({}, '', url);
    render(n);
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Back and forward through results the visitor has already looked at.
  window.addEventListener('popstate', function () {
    input.value = param();
    render(input.value);
  });

  var initial = param();
  if (initial) {
    input.value = initial;
    render(initial);
  }
})();
`
);

const verifyFaqs = [
  {
    q: 'What does a valid result here actually prove?',
    a: 'Exactly one thing, and it is worth being precise about it: that Vybe Technologies issued that certificate to that organisation, for that scope, against that standard, and that it has not expired or been withdrawn. It is our register saying our own certificate is genuine. It is not a statement by any regulator, accreditation body or government department, and a valid result does not make the certificate an accredited one.',
  },
  {
    q: 'Are Vybe certificates accredited?',
    a: 'No. Our ISO certificates and audit certificates are issued by Vybe Technologies on a non-accredited basis. We are not accredited by, affiliated to, appointed by or recognised by NABCB, any member of the International Accreditation Forum, FSSAI, any fire authority, NAAC, NIRF, the Labour Department, the Data Protection Board or any other regulator or accreditation body, and our certificates carry no IAF, ILAC, UKAS or NABCB mark. If a tender, a regulator or an overseas buyer requires an <em>accredited</em> certificate, ours is not it, and we say so on <a href="/registrations/iso-certification/" class="text-brand font-bold">the page where we sell it</a>.',
  },
  {
    q: 'The number on the document does not resolve. What now?',
    a: `Check it character by character against the document first: these numbers are commonly retyped off a printed copy, and a misread digit is the usual explanation. Spaces, dashes and case do not matter here, so only the letters and digits need to be right. If it still does not resolve, email a scan to <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a> and we will confirm in writing whether the document came from us. Do not accept a certificate that does not verify.`,
  },
  {
    q: 'Can an organisation stay on the register after it stops meeting the standard?',
    a: 'No, and that is the point of a register rather than a printed certificate. Where we withdraw a certificate — because a surveillance check failed, because the scope changed, or because the holder asked us to — the number stops returning a valid result on the same day, whatever the expiry date printed on the paper says. Always check the number rather than reading the dates off a scan.',
  },
  {
    q: 'Do you charge to verify a certificate?',
    a: 'No. Verification is free, needs no account, and is open to anybody holding a number — a customer, a tender committee, a parent body or an auditor. Nothing you type here is stored or sent anywhere: the register ships with the page and the lookup happens in your own browser.',
  },
];

const verifyBody = `<div class="w-full bg-surface-main">
${breadcrumbs([CRUMB_HOME, { name: 'Verify a certificate', url: '/verify/' }], false)}

        <section class="px-6 pt-12 pb-20 md:pb-24 relative overflow-hidden">
            <div class="absolute inset-0 bg-grid-faint" aria-hidden="true"></div>
            <div class="max-w-6xl mx-auto relative z-10">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Certificate verification</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900">Check a certificate we issued.</h1>
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">Every ISO and audit certificate issued by Vybe Technologies carries a number. Type it in and the register will tell you who holds it, for what scope, against which standard and until when. Free, no account, and open to anybody holding a number.</p>

                <form id="verify-form" action="/verify/" method="get" class="mt-10 max-w-2xl">
                    <label for="verify-number" class="block text-xs font-bold uppercase tracking-[0.15em] text-slate-400">Certificate number</label>
                    <div class="mt-3 flex flex-col sm:flex-row gap-3">
                        <input id="verify-number" name="cert" type="text" inputmode="text" autocomplete="off" spellcheck="false"
                               placeholder="VYB-QMS-2026-0417"
                               class="flex-1 rounded-full border border-slate-300 bg-white px-6 py-4 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30">
                        <button type="submit" class="inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white px-7 py-4 rounded-full text-sm font-bold transition-all active:scale-95">
                            <span class="material-symbols-outlined text-[20px]" aria-hidden="true">search</span>
                            Verify
                        </button>
                    </div>
                    <p class="mt-3 text-xs text-slate-500 leading-relaxed">Spaces, dashes and capitals do not matter. Scanning the QR code on the certificate brings you straight here with the number filled in.</p>
                </form>

                <div id="verify-result" class="mt-10 max-w-3xl" role="status" aria-live="polite"></div>

                <noscript>
                    <div class="mt-10 max-w-3xl">
                        ${noticePanel(
                          'The lookup needs JavaScript',
                          `<p>The register is checked in your own browser, which is why nothing you type is stored or sent anywhere — and it is also why this one feature needs JavaScript switched on.</p>
                        <p>If you would rather not, email the certificate number, or a scan of the document, to <a class="font-bold text-brand hover:underline" href="mailto:${ORG.legal}">${ORG.legal}</a> and we will confirm in writing whether it came from us.</p>`
                        )}
                    </div>
                </noscript>

                <div class="mt-10 max-w-3xl rounded-2xl border border-slate-200 bg-white/70 p-6 md:p-8 flex flex-col sm:flex-row gap-5 sm:items-start">
                    <span class="material-symbols-outlined text-brand text-[28px] shrink-0" aria-hidden="true">description</span>
                    <div>
                        <h2 class="text-base font-bold font-display tracking-tight text-slate-900">Want to see what a result looks like first?</h2>
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed">We publish one specimen record so nobody has to take our word for what this page returns. <a href="/verify/?cert=${encodeURIComponent(SPECIMEN.number)}" class="font-bold text-brand hover:underline">Verify ${esc(SPECIMEN.number)}</a> to see the full card, marked as a specimen. No organisation of that name holds a certificate with us.</p>
                    </div>
                </div>
            </div>
        </section>

${proseSections({
  id: 'verify-meaning',
  eyebrow: 'What this page settles',
  heading: 'A number that resolves, or it is not our certificate.',
  lede:
    'A certificate is only worth what somebody can check independently of the person showing it to you. That is the entire job of this page, and it is worth being exact about what a result does and does not mean.',
  sections: [
    {
      h: 'Why the number and not the paper',
      p: 'A printed certificate proves very little on its own. It can be edited, it can be reprinted after it lapses, and it can be issued by a body that has since withdrawn it. The number is the durable part: it resolves against our register on the day you check it, so a certificate withdrawn this morning stops verifying this morning, whatever the expiry date printed on the copy in front of you says. If somebody sends you a scan, check the number rather than reading the dates off the image.',
    },
    {
      h: 'What a valid result asserts',
      p: 'That Vybe Technologies issued this certificate to this organisation, for this scope, against this standard, on these dates, and has not withdrawn it. That is a real, checkable statement and we stand behind it. It is the only statement being made.',
    },
    {
      h: 'What it does not assert',
      p: 'Our certificates are issued on a <strong>non-accredited</strong> basis. We are not accredited by, affiliated to, appointed by or recognised by NABCB, any member of the International Accreditation Forum, FSSAI, any fire authority, any Pollution Control Board, NAAC, NIRF, the Labour Department, the Data Protection Board of India or any other regulator, accreditation body or certification body. So a valid result is not a licence, not a government approval, not a hygiene rating, not a fire No Objection Certificate, not an accreditation, and not a finding by any authority that the holder is legally compliant. It carries no IAF, ILAC, UKAS or NABCB mark, and it must not be presented as though it does.',
    },
    {
      h: 'If accreditation is what you require',
      p: 'Then ours is not the certificate you are looking for, and we would rather say that here than have you discover it later. Tell the organisation you are assessing that you need a certificate from a body accredited under the International Accreditation Forum — in India, that means NABCB — and they will need to go to one. Everything they documented for us carries over to that audit, but the certificate itself does not.',
    },
    {
      h: 'Nothing you type is collected',
      p: `The register is compiled into the page assets and the lookup runs entirely in your browser. There is no form submission, no logging of who checked what, and no record kept of a number that was typed in. If you would prefer a written confirmation on our letterhead for a tender or an audit file, email <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a> with the number and we will send one.`,
    },
  ],
})}

        <section class="bg-surface-main border-t border-slate-200 py-20 md:py-24 px-6 relative z-10" aria-labelledby="verify-where-heading">
            <div class="max-w-6xl mx-auto">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">Where our certificates come from</p>
                <h2 id="verify-where-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-slate-900">The two things that put a number on this register.</h2>
                <p class="mt-5 text-lg leading-relaxed text-slate-600 max-w-3xl">If somebody has handed you a Vybe certificate, it came out of one of these. Both are described in full, fine print included, on their own pages.</p>

                <div class="mt-12 grid gap-5 md:grid-cols-2">
                    <a href="/registrations/iso-certification/" class="group block rounded-2xl border border-slate-200 bg-white p-8 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">workspace_premium</span>
                        <h3 class="mt-4 text-xl font-bold font-display tracking-tight text-slate-900 group-hover:text-brand transition-colors">ISO certification</h3>
                        <p class="mt-3 text-sm text-slate-600 leading-relaxed">ISO 9001, ISO 22000 and ISO 27001. A gap review against the standard, help writing what is missing, a documented audit, and then a numbered certificate with a scope and an expiry. Non-accredited, and the page says so before the price does.</p>
                    </a>
                    <a href="/audits/" class="group block rounded-2xl border border-slate-200 bg-white p-8 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand/40">
                        <span class="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">fact_check</span>
                        <h3 class="mt-4 text-xl font-bold font-display tracking-tight text-slate-900 group-hover:text-brand transition-colors">Compliance &amp; safety audits</h3>
                        <p class="mt-3 text-sm text-slate-600 leading-relaxed">Kitchen hygiene, fire and electrical safety, POCSO and transport, SDG and sustainability, POSH, software licensing, DPDP and labour law records. Where an audit closes at or above our threshold it produces a numbered certificate and a badge.</p>
                    </a>
                </div>

                <div class="mt-8">
                    ${noticePanel(
                      'Seen a Vybe logo or badge that will not verify?',
                      `<p>Every certificate and every digital badge we issue carries a number, and every number resolves on this page. A badge on a website or a certificate on a reception wall with no number on it, or with a number that does not resolve here, was not issued by us or is no longer current.</p>
                        <p>Tell us at <a class="font-bold text-brand hover:underline" href="mailto:${ORG.legal}">${ORG.legal}</a> and we will confirm in writing, one way or the other. We would much rather hear about it than not.</p>`
                    )}
                </div>
            </div>
        </section>

${faqSection(verifyFaqs, { dark: false })}
${relatedSection('verify', { dark: false })}
</div>`;

{
  const url = '/verify/';
  const lastmod = lastmodFor(url, verifyBody);
  DOCS.push({
    file: 'verify/index.html',
    priority: '0.6',
    changefreq: 'monthly',
    page: {
      url,
      nav: null,
      title: 'Verify a Certificate | Vybe Technologies',
      ogTitle: 'Verify a Vybe certificate by its number',
      description:
        'Check any ISO or audit certificate issued by Vybe Technologies. Enter the certificate number to see the holder, scope, standard and validity dates. Free.',
      lastmod,
      trail: [CRUMB_HOME, { name: 'Verify a certificate', url }],
      faqs: verifyFaqs,
      body: verifyBody,
      scripts: ['/assets/verify.js'],
      schema: (u) => ({
        '@type': 'WebApplication',
        '@id': `${u}#app`,
        name: 'Vybe certificate verification',
        applicationCategory: 'BusinessApplication',
        browserRequirements: 'Requires JavaScript',
        operatingSystem: 'Any',
        url: u,
        description:
          'Public register lookup for certificates issued by Vybe Technologies. A certificate number returns the holder, the certified scope, the standard assessed against, the issue and expiry dates and the current status. Certificates are issued by Vybe Technologies on a non-accredited basis and carry no IAF, ILAC, UKAS or NABCB endorsement.',
        provider: { '@id': `${SITE}/#organization` },
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      }),
    },
  });
}

/* ------------------------------------------------------------------ 404 page */

const notFoundLink = (href, label, desc) =>
  `<a href="${href}" class="block bg-white p-6 rounded-2xl border border-slate-200 hover:border-brand hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-left">
                        <span class="block font-black font-display tracking-tight text-slate-900 mb-1">${label}</span>
                        <span class="block text-sm text-slate-600 leading-relaxed">${desc}</span>
                    </a>`;

/* ------------------------------------------------------------- write it out */

for (const doc of DOCS) {
  // Every document, however its body was assembled, gets one outline pass.
  doc.page.body = liftLeadingHeadings(doc.page.body);
  write(doc.file, shell(doc.page));
  emitted.push({
    url: doc.page.url,
    priority: doc.priority,
    changefreq: doc.changefreq,
    lastmod: doc.page.lastmod,
  });
}

write(
  '404.html',
  shell({
    url: '/404.html',
    nav: null,
    title: 'Page not found | Vybe Technologies',
    description: 'That page does not exist. Browse Vybe ERP, Vybe CMS, Smart Classrooms and IT Solutions instead.',
    trail: [],
    noindex: true,
    schema: () => [],
    body: `<section class="py-24 md:py-32 px-6 bg-surface-main">
            <div class="max-w-3xl mx-auto text-center">
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-3">Error 404</p>
                <h1 class="text-5xl md:text-7xl font-black font-display tracking-tighter text-slate-900 mb-6">Page not found.</h1>
                <p class="text-lg text-slate-600 leading-relaxed mb-12 max-w-xl mx-auto">The page you were looking for has moved or never existed. Here is where everything lives now.</p>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                    ${notFoundLink('/', 'Home', 'Everything Vybe builds, in one place.')}
                    ${notFoundLink('/erp/', 'Vybe ERP', 'Cloud ERP for schools and colleges.')}
                    ${notFoundLink('/cms/', 'Vybe CMS', '100% cashless campus cafeteria system.')}
                    ${notFoundLink('/it-solutions/', 'IT &amp; Cyber', 'Custom app development and security.')}
                    ${published('cloud') ? notFoundLink('/cloud/', 'Vybe Cloud', 'Scalable servers and DDoS protection.') : ''}
                    ${notFoundLink('/printing/', 'Printing', 'Cards, banners, standees, RFID and stationery.')}
                    ${notFoundLink('/registrations/', 'Registrations', 'GST, MSME, FSSAI and Startup India, filed for you, plus ISO, NSDC and DSC.')}
                    ${notFoundLink('/audits/', 'Audits', 'Hygiene, fire, child safety, SDG, POSH and data protection audits.')}
                    ${notFoundLink('/manufacturing/', 'Manufacturing', 'RFID and NFC cards, plus Dell, HP, Lenovo and Apple hardware.')}
                    ${notFoundLink('/contact/', 'Contact Us', 'Phone, email and where to find us.')}
                </div>
            </div>
        </section>`,
  })
);

/* ------------------------------------------------------------ staff cards */

/*
 * The cards arrive from the importer as standalone pages: noindex, no graph,
 * nothing tying them to the company. That is the right default for an export
 * that does not know where it will be hosted, and the wrong one here, where
 * each card is the answer to a search for that person's name. This pass makes
 * them first-class pages of the site.
 *
 * It rewrites rather than appends, so running the build twice is a no-op and
 * re-importing a card cannot leave a stale graph behind.
 */
const CARD_MARK = '<!-- build.js: person graph -->';

for (const m of TEAM) {
  const file = `${m.slug}/index.html`;
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    console.warn(`  ${file}: no such card, skipped — import it before building.`);
    continue;
  }

  const url = `/${m.slug}/`;
  const title = `${m.name} | ${m.titleRole || m.role}, ${ORG.name}`;
  // Same content hash the sitemap uses, so the graph and the sitemap agree and
  // neither moves on a build that changed nothing.
  const lastmod = lastmodFor(url, [title, m.bio, m.role, m.linkedin].join('\n'));
  const image = `${SITE}${url}assets/og.png`;
  let s = read(file);

  // The importer's export is noindex. That is what kept these out of a search
  // for the person's name, so it is the single most important line here.
  s = s.replace(
    /<meta name="robots" content="[^"]*">/,
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">'
  );
  s = s.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  s = s.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(m.bio)}">`);

  // Strip a previous run's graph before writing this one.
  s = s.replace(new RegExp(`${CARD_MARK}[\\s\\S]*?</script>\\n?`), '');

  const person = defined({
    '@type': 'Person',
    '@id': personId(m.slug),
    name: m.name,
    jobTitle: m.role,
    description: m.bio,
    url: `${SITE}${url}`,
    image,
    email: m.email,
    telephone: m.tel,
    worksFor: { '@id': `${SITE}/#organization` },
    // The card is the person's page, so it is also their knowsAbout anchor.
    workLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: ORG.street,
        addressLocality: ORG.locality,
        addressRegion: ORG.region,
        postalCode: ORG.postal,
        addressCountry: ORG.country,
      },
    },
    sameAs: m.linkedin ? [m.linkedin] : '',
  });

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': `${SITE}${url}#webpage`,
        url: `${SITE}${url}`,
        name: title,
        description: m.bio,
        // mainEntity is what tells Google the page is *about* the person
        // rather than merely mentioning them.
        mainEntity: { '@id': personId(m.slug) },
        isPartOf: { '@id': `${SITE}/#website` },
        inLanguage: 'en-IN',
        datePublished: isoDateTime(ORG.foundingDate),
        dateModified: isoDateTime(lastmod),
      },
      person,
      {
        '@type': 'BreadcrumbList',
        '@id': `${SITE}${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: m.name, item: `${SITE}${url}` },
        ],
      },
    ],
  };

  s = s.replace('</head>', `${CARD_MARK}\n${ld(graph)}\n</head>`);
  write(file, s);

  emitted.push({
    url,
    priority: '0.5',
    changefreq: 'yearly',
    lastmod,
  });
}

/* --------------------------------------------------------- sitemap & friends */

/** First-party images worth surfacing in Google Images. Nothing decorative. */
function sitemapImages(url) {
  const img = (loc, caption) =>
    `\n    <image:image><image:loc>${loc}</image:loc><image:caption>${esc(caption)}</image:caption></image:image>`;

  // A card's image is the person, not the company banner.
  const card = TEAM.find((m) => url === `/${m.slug}/`);
  if (card) return img(`${SITE}/${card.slug}/assets/og.png`, `${card.name}, ${card.role}, ${ORG.name}`);

  let out = img(`${SITE}/assets/og-image.png`, `${ORG.name} | ${ORG.slogan}`);
  if (url === '/') {
    out += img(`${SITE}/assets/vybe-lockup.png`, `${ORG.name} logo`);
    for (const g of PARTNERS) {
      for (const i of g.items) out += img(`${SITE}/assets/partners/${i.logo}.png`, `${i.name}, ${g.label}`);
    }
  }
  return out;
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${emitted
  .map(
    (e) => `  <url>
    <loc>${SITE}${e.url}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>${sitemapImages(e.url)}
  </url>`
  )
  .join('\n')}
</urlset>
`;
write('sitemap.xml', sitemap);

write(
  'robots.txt',
  `# https://vybe.net.in/robots.txt
User-agent: *
Allow: /

# Build tooling and sources are not content.
Disallow: /src/
Disallow: /tools/
Disallow: /node_modules/

Sitemap: ${SITE}/sitemap.xml
`
);

/*
 * /llms.txt, the llmstxt.org convention: a curated map for answer engines.
 * Generated from the same arrays as the sitemap, so it cannot drift.
 */
write(
  'llms.txt',
  `# ${ORG.name}

> ${organization.description}

Based in ${ORG.locality}, ${ORG.region}, India. Sales: ${ORG.sales} / ${ORG.phone}.

## Products

${PRODUCTS.filter((p) => published(p.nav))
  .map((p) => `- [${p.name}](${SITE}${p.href}): ${p.blurb}`)
  .join('\n')}

## Contact

- [Contact Us](${SITE}/contact/): Phone, email, our registered and corporate offices, and opening hours.
- Sales: ${ORG.sales} / ${ORG.phone} for quotes, demos, new deployments, hardware, printing and registrations.
- Support: ${ORG.support} / ${ORG.phoneSupport} for existing Vybe deployments.
- Second office line: ${ORG.phoneOffice}, which reaches the same office.
- Legal and compliance: ${ORG.legal} for contracts, privacy and data protection requests, security disclosures.
- Grievance Officer: ${ORG.grievance}, last resort only, after sales, support or legal have not resolved the matter. Route enquiries to the three addresses above first.

## Policies

${LEGAL.map((d) => `- [${d.crumb}](${SITE}${d.url}): ${d.description}`).join('\n')}

## Notes

- Every page above is a real HTML document with its own canonical URL and schema.org graph.
- Sitemap: ${SITE}/sitemap.xml
`
);

/* RFC 9116. Expires is required by the RFC, and is refreshed every build. */
const securityExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
write(
  '.well-known/security.txt',
  // Most-preferred address first, as RFC 9116 specifies. legal@ leads because
  // the contact page names it as the route for security disclosures.
  `Contact: mailto:${ORG.legal}
Contact: mailto:${ORG.support}
Expires: ${securityExpiry}
Preferred-Languages: en
Canonical: ${SITE}/.well-known/security.txt
Policy: ${SITE}/terms/
`
);

write(
  'site.webmanifest',
  JSON.stringify(
    {
      name: 'Vybe Technologies',
      short_name: 'Vybe',
      description: ORG.slogan,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f8fafc',
      theme_color: '#e31837',
      lang: 'en-IN',
      dir: 'ltr',
      categories: ['business', 'education', 'productivity'],
      icons: [
        { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/assets/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2
  ) + '\n'
);

// Commit this file: the stored hashes are what keep lastmod honest.
write(LASTMOD_FILE, JSON.stringify(lastmodDb, null, 2) + '\n');

/* ------------------------------------------------------- link integrity */

/**
 * Every internal href has to resolve to a page we wrote or a file on disk.
 * This is what makes UNPUBLISHED safe: a stale link fails the build.
 */
{
  const pages = new Set(emitted.map((e) => e.url));
  const broken = [];

  for (const file of [...emitted.map((e) => (e.url === '/' ? 'index.html' : `${e.url.slice(1)}index.html`)), '404.html']) {
    const html = read(file);
    for (const m of html.matchAll(/\shref="(\/[^"#]*)"/g)) {
      // A query string is read by the page, not by the server: /verify/?cert=…
      // is still the /verify/ document, so the path is what has to resolve.
      const href = m[1].replace(/\?.*$/, '');
      if (pages.has(href)) continue;
      if (fs.existsSync(path.join(ROOT, href.replace(/^\//, '')))) continue;
      broken.push(`${file} -> ${href}`);
    }
  }

  if (broken.length) {
    console.error('build: internal links point at nothing:');
    for (const b of [...new Set(broken)]) console.error(`   ${b}`);
    process.exit(1);
  }
}

console.log(`built ${emitted.length} pages:`);
for (const e of emitted) console.log('  ', e.url.padEnd(22), e.lastmod);
