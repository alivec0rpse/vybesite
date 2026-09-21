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

const ORG = {
  name: 'Vybe Technologies',
  legalName: 'Vybe Technologies',
  slogan: 'Smart. Simple. Affordable.',
  // Sales is the number on the site's calls to action; support has its own
  // line; the old main number is still answered, as a second office line.
  phone: '+91-99641-77677',
  phoneSupport: '+91-90198-01319',
  phoneOffice: '+91-99641-77877',
  sales: 'sales@vybe.net.in',
  support: 'support@vybe.net.in',
  legal: 'legal@vybe.net.in',
  // Escalation of last resort. A person, not a role alias, on purpose.
  grievance: 'manjunath@vybe.net.in',
  street: '#103, First Floor, 10th Main, Gaurav Nagar, J.P Nagar 7th Phase',
  locality: 'Bengaluru',
  region: 'Karnataka',
  postal: '560078',
  country: 'IN',
  // 24-hour times, because that is the only format schema.org accepts.
  opens: '09:00',
  closes: '18:30',
  openDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  profiles: [
    'https://www.linkedin.com/company/vybe-technologies',
    'https://www.instagram.com/vybe_technologies/',
  ],
};

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
  // matching to the first </a> takes exactly one card.
  for (const nav of UNPUBLISHED) {
    const href = (PRODUCTS.find((p) => p.nav === nav) || {}).href;
    if (!href) continue;
    out = out.replace(new RegExp(`<a href="${href}"[^>]*>[\\s\\S]*?</a>\\s*`, 'g'), '');
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
      { nav: 'classroom', href: '/smart-classroom/', label: 'Smart Classrooms', blurb: 'Flat panels, hybrid class rigs, Extramarks.', icon: 'smart_display' },
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
            <a href="/" class="flex items-center gap-3 group" aria-label="Vybe Technologies — home">
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
                <p class="text-sm leading-relaxed mb-6">Unified software suites, custom development and secure infrastructure — for campuses and for businesses that need something built to fit.</p>

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
                </ul>
            </div>

            <div>
                <h2 class="text-white font-bold mb-4 uppercase tracking-widest text-xs">Legal &amp; Support</h2>
                <ul class="space-y-3 text-sm">
                    ${link('/privacy-policy/', 'Privacy Policy')}
                    ${link('/terms/', 'Terms of Service')}
                    ${link('/refund-policy/', 'Cancellation &amp; Refund')}
                    ${link('/shipping-policy/', 'Shipping &amp; Exchange')}
                    ${link('/contact/', 'Contact Us')}
                </ul>
            </div>

            <div>
                <h2 class="text-white font-bold mb-4 uppercase tracking-widest text-xs">Registered Office</h2>
                <address class="text-sm not-italic leading-relaxed">
                    #103, First Floor, 10th Main<br>
                    Gaurav Nagar, J.P Nagar 7th Phase<br>
                    Bengaluru, Karnataka - ${ORG.postal}<br><br>
                    <a href="${telHref(ORG.phone)}" class="hover:text-brand transition-colors block mt-2">${telText(ORG.phone)}</a>
                    <a href="${telHref(ORG.phoneSupport)}" class="hover:text-brand transition-colors block mt-1">${telText(ORG.phoneSupport)}</a>
                    <a href="${telHref(ORG.phoneOffice)}" class="hover:text-brand transition-colors block mt-1">${telText(ORG.phoneOffice)}</a>
                    <a href="mailto:${ORG.sales}" class="hover:text-brand transition-colors block mt-1">${ORG.sales}</a>
                </address>
                <p class="text-sm mt-4 text-slate-400">Mon&ndash;Sat, 9:00&nbsp;AM &ndash; 6:30&nbsp;PM IST</p>
            </div>
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
  legalName: ORG.legalName,
  url: `${SITE}/`,
  slogan: ORG.slogan,
  description:
    'Vybe Technologies is a Bengaluru software company. Its products include a cloud ERP for schools and colleges and a 100% cashless cafeteria management system, alongside custom software development, cybersecurity and cloud infrastructure for businesses in any sector.',
  // The full lockup, not the bare glyph: it spells the company name.
  logo: { '@type': 'ImageObject', '@id': `${SITE}/#logo`, url: `${SITE}/assets/vybe-lockup.png`, width: 892, height: 118, caption: ORG.name },
  image: { '@type': 'ImageObject', '@id': `${SITE}/#image`, url: `${SITE}/assets/og-image.png`, width: 1200, height: 630, caption: `${ORG.name} — ${ORG.slogan}` },
  address: {
    '@type': 'PostalAddress',
    streetAddress: ORG.street,
    addressLocality: ORG.locality,
    addressRegion: ORG.region,
    postalCode: ORG.postal,
    addressCountry: ORG.country,
  },
  contactPoint: [
    { '@type': 'ContactPoint', telephone: ORG.phone, contactType: 'sales', email: ORG.sales, areaServed: 'IN', availableLanguage: ['en', 'hi', 'kn'] },
    { '@type': 'ContactPoint', telephone: ORG.phoneSupport, contactType: 'customer support', email: ORG.support, areaServed: 'IN', availableLanguage: ['en', 'hi', 'kn'] },
  ],
  areaServed: { '@type': 'Country', name: 'India' },
  // Profiles we control. Each must link back here or the claim is weak.
  sameAs: ORG.profiles,
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
 * phone and address off this type, not off a bare Organization.
 */
const localBusiness = {
  '@type': 'ProfessionalService',
  '@id': `${SITE}/#office`,
  name: ORG.name,
  parentOrganization: { '@id': `${SITE}/#organization` },
  url: `${SITE}/`,
  telephone: [ORG.phone, ORG.phoneSupport, ORG.phoneOffice],
  email: ORG.sales,
  image: { '@id': `${SITE}/#image` },
  logo: { '@id': `${SITE}/#logo` },
  address: { ...organization.address },
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
  description: ORG.slogan,
  publisher: { '@id': `${SITE}/#organization` },
  inLanguage: 'en-IN',
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
  { nav: 'classroom', href: '/smart-classroom/', name: 'Smart Classrooms', blurb: 'Interactive flat panels, online class rigs and Extramarks content.', icon: 'smart_display' },
  { nav: 'workspace', href: '/workspace/', name: 'Workspace & Email', blurb: 'Google Workspace, Microsoft 365, Zoho Mail and student email.', icon: 'alternate_email' },
  { nav: 'it', href: '/it-solutions/', name: 'IT & Cyber', blurb: 'Custom software, security and managed IT.', icon: 'code_blocks' },
  { nav: 'cloud', href: '/cloud/', name: 'Vybe Cloud', blurb: 'Scalable servers, hosting and DDoS protection.', icon: 'cloud' },
  { nav: 'printing', href: '/printing/', name: 'Printing', blurb: 'Everything from business cards to banners, standees and RFID cards.', icon: 'print' },
  { nav: 'registrations', href: '/registrations/', name: 'Business Registrations', blurb: 'GST, Udyam (MSME), FSSAI and Startup India recognition, from ₹199, plus ISO, NSDC consulting and digital signatures.', icon: 'receipt_long' },
];

/**
 * The two lines of business that are not software. The home page hero comes
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
                <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">Beyond the software</p>
                <h2 id="beyond-software-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-slate-900">Printing and registrations, under the same roof.</h2>
                <p class="mt-5 text-lg leading-relaxed text-slate-600 max-w-3xl">Two things our customers kept asking us to sort out for them, so we do. Both run on a message rather than a meeting.</p>
                <div class="mt-12 grid gap-5 md:grid-cols-2">
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
    note: 'Brands we are an authorised channel partner or dealer for, and deploy on campus.',
    items: [
      /* Held back until the channel partner contract is executed. Also
       * commented out of tools/gen-partner-logos.mjs, so uncommenting here
       * alone will not render them; rerun `npm run logos`.
       *
      {
        name: 'Extramarks Education',
        meta: 'Channel partner — digital learning for K-12 schools',
        url: 'https://www.extramarks.com/',
        logo: 'extramarks',
      },
      {
        name: 'Extramarks Forte',
        meta: 'Channel partner — smart LMS for universities',
        url: 'https://www.extramarksforte.com/',
        logo: 'extramarksforte',
      },
      */
      {
        name: 'JS Global Industries',
        meta: 'Partner and dealer — classroom boards, Bengaluru',
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
 */
const CREDENTIALS = [
  {
    name: 'Ingram Micro',
    tier: 'Registered partner',
    note: 'Distribution and licensing for the hardware and software we resell.',
  },
  {
    name: 'AWS Partner Network',
    tier: 'Registered partner',
    note: 'Amazon Web Services, for the infrastructure we design and run.',
  },
  {
    name: 'Google Cloud Partner Advantage',
    tier: 'Programme member',
    note: 'Covers Google Cloud Platform and Google Workspace deployments.',
  },
  {
    name: 'Microsoft for Startups',
    tier: 'Azure credits grant',
    note: 'Awarded Azure credits under the Microsoft for Startups programme.',
  },
];

/** Accreditation strip. Dark under the partner wall, light on /cloud/. */
function credentialsSection({ dark = false, standalone = false } = {}) {
  const head = dark ? 'text-white' : 'text-slate-900';
  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  const label = dark ? 'text-slate-400' : 'text-slate-400';
  const card = dark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white';
  const icon = dark ? 'text-brand' : 'text-brand';

  const items = CREDENTIALS.map(
    (c) => `<li class="rounded-2xl border ${card} p-6">
                            <span class="material-symbols-outlined ${icon} text-[22px]" aria-hidden="true">verified</span>
                            <h3 class="mt-3 text-base font-bold ${head} tracking-tight">${esc(c.name)}</h3>
                            <p class="mt-1 text-xs font-bold uppercase tracking-[0.15em] ${label}">${esc(c.tier)}</p>
                            <p class="mt-3 text-sm ${muted} leading-relaxed">${esc(c.note)}</p>
                        </li>`
  ).join('\n                        ');

  const body = `<h2 id="accreditations-heading" class="text-xs font-bold uppercase tracking-[0.2em] ${label}">Accreditations</h2>
                    <p class="mt-2 text-sm ${muted}">Vendor programmes we are enrolled in, and the grant we have received.</p>
                    <ul class="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        ${items}
                    </ul>`;

  if (!standalone) return body;

  return `
        <section id="accreditations" class="${
          dark ? 'bg-slate-950 dark-section' : 'bg-surface-main'
        } border-t ${dark ? 'border-white/10' : 'border-slate-200'} py-16 px-6 relative z-10" aria-labelledby="accreditations-heading">
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
        p: 'An interactive flat panel is the anchor of the room, and for nearly every classroom it is the right call over a projector. A projector needs the lights down, which fights the thing you actually want — students able to read and write while looking at the board. It needs a bulb, which is a recurring cost that arrives as a surprise and usually fails mid-lesson. It drifts out of alignment and dims so gradually that nobody notices until it is genuinely bad. A panel has no consumables, is readable in full daylight, and is touch-interactive from the moment it is switched on. The exception is the very large hall where no panel can be read from the back row, and there we will tell you to use a projector rather than sell you a 98-inch panel that still will not work.',
      },
      {
        h: 'Sizing, which is about the back row and nothing else',
        p: 'Panel size is set by the distance to the furthest student, not by the dimensions of the room and definitely not by the budget line. The working rule is that the back row should sit no further from the panel than roughly six times the panel’s height. For a typical 30-to-40-seat classroom that lands on 75 inches; smaller tutorial rooms take 65; wide or deep halls need 86 or 98. This is why we measure rooms before quoting instead of applying one size across a building — a block of classrooms is rarely uniform, and the room that gets the wrong panel is the room that stops being used.',
      },
      {
        h: 'The online class rig, item by item',
        p: 'Teaching the room and a remote cohort at the same time needs five things, and most rooms that claim to do hybrid are missing at least two. A classroom PC to run the session, so it does not depend on whichever laptop the teacher brought. A camera framed on the teaching area rather than bolted wherever there was a spare bracket. A second chat monitor, which is the component everyone skips and the one teachers notice immediately — without it, reading a remote student’s question means minimising what you are teaching, so in practice remote students stop being answered at all. Lighting, because a camera does not need a bright room, it needs light on the teacher’s face, and a classroom lit from directly above gives you a silhouette. And room audio that picks up students asking questions, not just the person standing at the desk. The panel is the shared surface both audiences are looking at.',
      },
      {
        h: 'Power, the part that is always cut first',
        p: 'This is the least interesting section on this page and the one that decides whether the room is still working in two years. A panel and a PC on an unprotected supply in most of India will eventually meet a surge or an outage mid-period. So the install includes UPS backup sized to carry the panel and PC through a typical cut, surge protection, dedicated power points, and concealed cabling. The alternative is the arrangement you find in a depressing number of smart classrooms: a forty-thousand-rupee panel running off an extension board trailing across a doorway.',
      },
      {
        h: 'Extramarks Smart Class Plus, for schools',
        p: 'Hardware with nothing on it is a very expensive television. As an Extramarks channel partner we license and deploy Smart Class Plus, which is curriculum-mapped animated content for K-12 — the lessons where an animation genuinely explains something a diagram cannot, which is most of physics, chemistry and biology — together with LMS modules for assignments and assessment. Because we are the channel partner rather than a middleman, the content licensing and the panel it runs on are the same purchase order and the same support line, and there is nobody to point at when the two do not talk to each other.',
      },
      {
        h: 'Extramarks Forte, for colleges and universities',
        p: 'Higher education has a different shape of problem. The content need is smaller and the delivery need is larger: course structures, assessments, submissions and results across departments that each do things slightly differently. Extramarks Forte is the product built for that, and we deploy it for universities and colleges department by department rather than as one institution-wide switch, because a rollout that starts everywhere at once tends to finish nowhere. We are a channel partner for Forte on the same terms as Smart Class Plus.',
      },
      {
        h: 'Boards, because the panel is not the whole wall',
        p: 'Almost every teacher wants a writing surface beside the panel. Working through a derivation or a correction is faster on a board than on a touchscreen, and the panel should be showing the material while that happens rather than being cleared for it. We are a partner and dealer for JS Global Industries, who manufacture classroom display and writing boards in Bengaluru, so the board and the panel are specified together and the wall gets laid out once instead of being retrofitted after somebody notices.',
      },
      {
        h: 'Handover, and the reason rooms go unused',
        p: 'The single best predictor of whether a smart classroom is still in daily use a year later is whether the teachers were trained on it properly, by someone patient, on the actual hardware, before they had to use it in front of thirty students. Nobody wants to be visibly incompetent in front of a class, so a teacher who is unsure will quietly avoid the panel and it will sit dark. Installation therefore includes hands-on sessions for the staff who have to teach with it, and after handover there is annual maintenance and support — so a failed panel is a phone call rather than a procurement exercise that takes a term.',
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
        h: 'Google Workspace, Microsoft 365 or Zoho Mail — how to choose',
        p: 'If your team already lives in Excel, uses Teams, or you have Windows laptops you want centrally managed, Microsoft 365 for Business is usually the shorter path — Entra ID and Intune come with it and you will want both eventually. If your people work mostly in a browser, collaborate heavily on documents at the same time, and nobody is attached to desktop Office, Google Workspace is simpler to run and simpler to explain to staff. Zoho Mail is the one worth taking seriously on cost: it is materially cheaper per user than either, it does the mail part properly, and for an organisation whose real requirement is professional addresses on its own domain rather than a full collaboration suite, it is often the honest recommendation. It is also an Indian company with Indian data centres, which some organisations prefer on data-residency grounds under the DPDP Act. We will tell you which way we would go for your situation and why, including when the answer is that any of the three would do and you should simply take the cheapest.',
      },
      {
        h: 'Student email, and why a campus should not run on personal Gmail',
        p: 'Most institutions arrive at this having quietly standardised on whatever students already had: a personal Gmail address, often created in a hurry, frequently shared with a sibling, occasionally something a prospective employer would rather not see on a CV. The costs are real even when they are invisible. Nobody can tell whether a submission genuinely came from the student who owns it, staff cannot circulate anything sensitive with confidence, there is no way to reach the cohort reliably, and when a student leaves there is no account to close because the institution never owned one. Institution-owned student addresses fix all of that at once, and both Google Workspace for Education and Microsoft 365 Education have tiers that cost qualifying institutions nothing or very little for the core accounts — which usually surprises people, and is the single most common reason this gets postponed for years longer than it needed to be.',
      },
      {
        h: 'Provisioning a whole cohort without typing it in twice',
        p: 'Creating four hundred accounts by hand is how this becomes a fortnight of somebody’s life. We provision in bulk from the roll you already have — and where the institution runs Vybe ERP, from the student records that are already in it, so the address is created at admission rather than as a separate administrative errand months later. Accounts are organised by year and by department, which is what makes it possible to mail one batch or restrict a resource to one course without maintaining a distribution list by hand. Each academic year the structure rolls forward: incoming students provisioned, existing students moved up, and graduating students moved to whatever the institution’s policy actually is, whether that is an alumni address, a period of read-only access, or a clean suspension. The point of writing that policy down is that it stops being a decision somebody has to make individually, four hundred times.',
      },
      {
        h: 'Online classes that do not get crashed',
        p: 'Remote and hybrid teaching has a specific failure mode that has nothing to do with bandwidth: someone who is not in the class gets hold of the link and joins to disrupt it. The link travels, because it only takes one student to forward it, and once an uninvited participant is in a session with forty teenagers the lesson is effectively over. Admitting people manually is not a fix either, because it makes the teacher a doorman for the first ten minutes of every period. Institutional student accounts solve it properly. Meetings are configured so that signed-in members of your own domain are admitted automatically from the lobby, while anyone outside it is held there and never reaches the room. The leaked link stops being a way in, because possession of the link is no longer what grants entry.',
      },
      {
        h: 'Accountability, which is the part that actually changes behaviour',
        p: 'The other half of the problem is anonymity. A participant who joined as "Guest" or under an invented name can disrupt a session and simply rejoin under a different one, and there is nothing for the institution to act on afterwards. When every participant is in the room under a named, institution-owned account, that stops. Each join is attributable, the attendance record is a genuine record rather than a list of nicknames, and if somebody does cause a problem the follow-up is a straightforward disciplinary matter instead of an investigation. In practice the deterrent does most of the work — the incidents largely stop once students understand the room knows exactly who they are. We also set up recording and retention in line with whatever the institution has decided about consent and storage, rather than leaving each teacher to improvise it.',
      },
      {
        h: 'Email on your own domain, set up so it gets delivered',
        p: 'Mail from a new domain is treated with suspicion by default, and the fix is three DNS records that are widely skipped. SPF states which servers may send as you. DKIM signs each message so it cannot be altered in transit. DMARC ties the two together and tells receiving servers what to do when a message fails — and, crucially, sends you reports on who is attempting to send as your domain. We configure all three and move DMARC to enforcement once the reports are clean, rather than leaving it permanently on the monitoring setting that protects nobody.',
      },
      {
        h: 'Migrating without losing the last six years of mail',
        p: 'The mail history is usually the thing people are most nervous about, and reasonably so: for a lot of businesses the mailbox is the filing system. We migrate existing mail, contacts and calendars across with folder structure intact, run the new tenant in parallel while DNS propagates, and cut over once delivery is confirmed working in both directions. Shared mailboxes such as accounts@ or info@ get set up as shared mailboxes rather than as a personal account four people share a password to, which is where most of the access problems start.',
      },
      {
        h: 'Single sign-on: one identity, everywhere',
        p: 'Single sign-on means your staff have one account, protected by one strong authentication step, that gets them into Workspace or Microsoft 365 and into the other SaaS tools you pay for — your ERP, your accounting package, your CRM — over SAML or OIDC. The benefit people notice is fewer passwords. The benefit that matters is that access is now centralised: multi-factor authentication is enforced in one place, conditional access rules can require a managed device or block sign-ins from countries you do not operate in, and when somebody leaves, disabling one account closes every door at once instead of leaving a forgotten login live for two years.',
      },
      {
        h: 'Joiners, leavers and the accounts nobody closed',
        p: 'Most organisations have a decent process for creating accounts and no process at all for removing them, because creating one is somebody’s urgent problem and removing one is nobody’s. We set up the offboarding side properly: access revoked on the last day, the mailbox converted or delegated to a manager so the work does not vanish with the person, and company data removed from personal devices. Device enrolment through Intune or Google endpoint management makes remote wipe possible for the laptop that gets lost or the phone that does not come back.',
      },
      {
        h: 'Phishing simulation, run against your own staff',
        p: 'A simulated phishing campaign sends your people a realistic but harmless lure and records who clicks, who submits credentials and who reports it. It is done with the organisation’s authorisation and it is not a trap laid for individuals — the useful output is the pattern, broken down by department and by role, showing where the real exposure sits. Finance and reception are usually the answer, because they are the two functions whose job is to open attachments from strangers. Campaigns are run on a schedule rather than once, because the number that matters is whether the click rate falls over the year, not what it was in January.',
      },
      {
        h: 'Training that is worth an hour of your staff’s time',
        p: 'Security awareness training fails when it is a compliance video nobody watches. Ours is short, in-person or live remote, and built around the attacks that actually reach Indian businesses: business email compromise, where an attacker impersonates a director and asks for an urgent transfer; invoice fraud, where a genuine supplier’s bank details are silently changed; credential harvesting pages that look exactly like your own login screen. We also cover the part most training skips, which is what to do in the ten minutes after somebody has clicked — because the difference between an incident and a breach is usually how fast it was reported, and staff who expect to be blamed do not report.',
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
        p: 'We design and deploy Virtual Private Clouds on AWS and Microsoft Azure: an isolated network you control, with your own subnets, routing and security groups rather than a shared box with neighbours. The architecture auto-scales, so capacity follows demand up during a traffic spike and back down again afterwards. That is the difference between paying for a peak and paying for a year of peaks. The uptime SLA is 99.99%. We are a registered partner in the AWS Partner Network and a member of the Google Cloud Partner Advantage programme, and we hold an Azure credits grant from Microsoft for Startups — which matters less as a badge than as the reason we can go to the vendor directly when something needs escalating.',
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
    datePublished: '2025-01-15',
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
<meta property="og:image:alt" content="Vybe Technologies — Smart. Simple. Affordable.">

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.ogTitle || page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${SITE}/assets/og-image.png">
<meta name="twitter:image:alt" content="Vybe Technologies — Smart. Simple. Affordable.">

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
${page.body}
</main>

${footer()}

<script src="/assets/site.js" defer></script>
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
    ogTitle: 'Vybe Technologies — Smart. Simple. Affordable.',
    description:
      'Campus software for schools, colleges and corporate campuses in India: cloud ERP, a 100% cashless cafeteria system, custom apps, cybersecurity and cloud servers.',
    trail: [CRUMB_HOME],
    priority: '1.0',
    view: home,
    mentions: PARTNER_ORGS,
    faqs: [
      {
        q: 'What does Vybe Technologies do?',
        a: 'Vybe Technologies is a software company based in Bengaluru. Our flagship products are <strong>Vybe ERP</strong> for school and college administration, <strong>Vybe CMS</strong> for 100% cashless cafeterias, and <strong>Vybe Cloud</strong> for scalable servers and hosting. We set up <strong>smart classrooms</strong> — interactive flat panels, online and hybrid class systems and Extramarks content — and handle <strong>workspace and email setup</strong>: Google Workspace, Microsoft 365 and Zoho Mail, staff and student accounts, single sign-on and secure online classes. Alongside those, <strong>Vybe IT Solutions</strong> takes on custom software work for businesses of any size or sector — web and mobile apps, business ERPs, retail POS, bespoke SaaS, internal tools — together with cybersecurity and managed IT. If your requirement does not match a product off our shelf, we build it to fit.',
      },
      {
        q: 'Who does Vybe work with?',
        a: 'The ERP and cafeteria products are built for schools, colleges and corporate campuses — student profiles, fees, payroll, biometric attendance and academics on one side, and a cafeteria system engineered to hold up during peak rush hours on the other. Our custom development, cybersecurity and cloud teams work well beyond education, with businesses in retail, hospitality, healthcare, gaming and professional services.',
      },
      {
        q: 'Where is Vybe Technologies located?',
        a: `We are based in Bengaluru, Karnataka — ${esc(ORG.street)}, ${ORG.postal}. You can reach sales on ${telLink(ORG.phone)} or <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a>.`,
      },
      {
        q: 'Can Vybe build software that is specific to our campus?',
        a: 'Yes. The ERP is fully customisable, and Vybe IT Solutions builds bespoke web and mobile applications — educational portals, business ERPs, retail POS and custom SaaS — to an institution\u2019s exact operational requirements.',
      },
      {
        q: 'Do you set up smart classrooms?',
        a: 'Yes — <a href="/smart-classroom/">smart classroom setup</a> end to end: smart interactive flat panels sized to the room, online and hybrid class systems (classroom PC, camera, chat monitor, lighting and audio), UPS-backed power and cabling, and teacher training at handover. We are an <strong>Extramarks channel partner</strong> for Smart Class Plus in schools and Extramarks Forte in colleges and universities, and a partner and dealer for <strong>JS Global Industries</strong> classroom boards.',
      },
      {
        q: 'Is Vybe an accredited partner of any cloud or hardware vendor?',
        a: 'Yes. We are a registered <strong>Ingram Micro</strong> partner for distribution and licensing, a registered partner in the <strong>AWS Partner Network</strong>, and a member of the <strong>Google Cloud Partner Advantage</strong> programme, which covers both Google Cloud Platform and Google Workspace. We have also been awarded Azure credits under <strong>Microsoft for Startups</strong>.',
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
        { nav: 'classroom', name: 'Smart Classrooms', url: `${SITE}/smart-classroom/`, description: 'Smart classroom setup — interactive flat panels, online and hybrid class systems, UPS-backed power and Extramarks content.' },
        { nav: 'workspace', name: 'Workspace & Email', url: `${SITE}/workspace/`, description: 'Google Workspace, Microsoft 365 and Zoho Mail setup, staff and student email, single sign-on, secure online classes and phishing training.' },
        { nav: 'it', name: 'Vybe IT Solutions', url: `${SITE}/it-solutions/`, description: 'Custom app development, penetration testing and managed security operations.' },
        { nav: 'cloud', name: 'Vybe Cloud', url: `${SITE}/cloud/`, description: 'Scalable cloud architecture, game servers and DDoS protection.' },
        { nav: 'printing', name: 'Printing Services', url: `${SITE}/printing/`, description: 'Commercial printing — business and RFID cards, letterheads, bill books, brochures, flex banners, roll-up standees and signage, printed to your artwork.' },
        { nav: 'registrations', name: 'Business Registrations', url: `${SITE}/registrations/`, description: 'GST, Udyam (MSME) and FSSAI registrations and DPIIT / Startup India recognition, prepared and filed at a flat professional fee with government charges separate, plus non-accredited ISO certification issued by Vybe, consulting on NSDC / Skill India and affiliation applications, and Class 3 digital signature certificates as a registered partner of eMudhra and Capricorn.' },
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
    ogTitle: 'Vybe ERP — Campus administration in one dashboard',
    description:
      'A customisable cloud ERP for schools and colleges: parent and staff portals, online fee collection, payroll, biometric attendance, timetables and report cards.',
    trail: [CRUMB_HOME, { name: 'Vybe ERP', url: '/erp/' }],
    priority: '0.9',
    view: erp,
    faqs: [
      { q: 'What is Vybe ERP?', a: 'Vybe ERP is a completely customisable, cloud-based Educational Resource Planning suite. It replaces fragmented administrative tasks — admissions, fees, attendance, academics — with one centralised, secure dashboard for schools and colleges.' },
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
    ogTitle: 'Vybe CMS — The cafeteria line ends here',
    description:
      'A 100% cashless cafeteria platform for campuses: mobile ordering, QR-code pickup, a kitchen display system, automated vendor payouts and live admin analytics.',
    trail: [CRUMB_HOME, { name: 'Vybe CMS', url: '/cms/' }],
    priority: '0.9',
    bodyClass: 'text-on-surface font-body selection:bg-brand/10 selection:text-brand flex flex-col min-h-screen relative z-0',
    view: cms,
    faqs: [
      { q: 'What is Vybe CMS?', a: 'Vybe CMS is a comprehensive SaaS platform for institutional cafeterias. It eliminates campus food queues, automates vendor payouts and gives the institution real-time analytics across every stall.' },
      { q: 'How do students collect their food?', a: 'Students order from the app and are given an auto-generated QR code. The vendor scans it at the Service Terminal, which marks the order complete instantly — no verbal confirmation and no queue.' },
      { q: 'How do vendors get paid?', a: 'Payouts are automated and powered by PhonePe. Funds are split at checkout, routing the food cost directly to the vendor\u2019s bank account. Students can also pay from the zero-fee closed-loop Vybe Wallet.' },
      { q: 'Can students order ahead of a break?', a: 'Yes. Students can place an order from class and schedule it for \u2018Break 1\u2019 or \u2018Break 2\u2019, which lets kitchens prep intelligently instead of absorbing one large rush.' },
      { q: 'Do students need to install an app from the app store?', a: 'No. Vybe CMS is built as a PWA, so it installs to any iOS or Android home screen straight from the browser — no app store approval required.' },
      { q: 'What does the kitchen see?', a: 'The Kitchen Display System (KDS) is a dedicated interface that separates immediate orders from scheduled break orders, with live order-prep tracking. Vendors can also mark items out of stock instantly or upload entire menus as JSON.' },
      { q: 'Is Vybe CMS being used anywhere today?', a: 'Yes — it is implemented at Christ Academy Institute for Advanced Studies (CAIAS).' },
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
    title: 'Smart Classroom Setup | Interactive Flat Panels & Online Classes',
    ogTitle: 'Smart Classrooms — panels, cameras, power and content',
    description:
      'Smart classroom setup for schools and colleges: interactive flat panel installation, online class systems with camera and lighting, UPS-backed power and cabling.',
    trail: [CRUMB_HOME, { name: 'Smart Classrooms', url: '/smart-classroom/' }],
    priority: '0.9',
    dark: true,
    bodyClass: 'text-white dark-section selection:bg-brand/10 selection:text-brand flex flex-col min-h-screen relative z-0',
    view: classroom,
    faqs: [
      {
        q: 'What is included in a smart classroom setup?',
        a: 'A complete room rather than a list of parts: the interactive flat panel supplied and mounted, a classroom PC, camera, audio and lighting where the room is used for online or hybrid teaching, UPS backup and surge protection, dedicated power points and concealed cabling, content and LMS licensing, and teacher training at handover. Specifications are set per room — a 40-seat lecture hall and a 20-seat tutorial room do not take the same panel.',
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
        q: 'Are you an Extramarks partner?',
        a: 'Yes, we are an Extramarks channel partner. That covers <strong>Extramarks Smart Class Plus</strong> — curriculum-mapped animated lessons and LMS modules for K-12 schools — and <strong>Extramarks Forte</strong>, the higher-education stack for universities and colleges. We license, deploy and support both, so the content and the hardware it runs on come from one place and there is nobody to point at when something does not work.',
      },
      {
        q: 'What is the difference between Extramarks Smart Class Plus and Extramarks Forte?',
        a: 'Smart Class Plus is built for K-12: animated lessons mapped to the syllabus, delivered on the classroom panel, with LMS modules for assignments and assessment. Forte is the higher-education product, aimed at universities and colleges, covering LMS, course delivery and assessments at degree level. Schools generally want the first; colleges and universities want the second. Both can sit alongside Vybe ERP.',
      },
      {
        q: 'Do you supply writing boards as well as panels?',
        a: 'Yes. We are a partner and dealer for JS Global Industries, who manufacture classroom display and writing boards in Bengaluru. Most rooms want both — a panel for delivery and a writing surface beside it for working through a problem — and specifying them together means the wall is laid out once rather than retrofitted.',
      },
      {
        q: 'Do you train our teachers, and what happens after installation?',
        a: 'Installation includes hands-on training for the staff who have to teach with it, which is what decides whether the room gets used or quietly goes back to chalk. After handover we offer annual maintenance and support, so a failed panel is a phone call rather than a procurement exercise.',
      },
      {
        q: 'Can smart classrooms integrate with Vybe ERP?',
        a: `Yes. Where the institution runs <a class="text-brand font-bold" href="/erp/">Vybe ERP</a>, the classroom sits inside the same system — timetables, attendance and academics — rather than being a parallel setup with its own logins. Student accounts set up through our <a class="text-brand font-bold" href="/workspace/">workspace and email</a> service are what let online classes admit your own students automatically and keep every participant identifiable.`,
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
        '@id': `${url}#content`,
        name: 'Extramarks Smart Class Plus & Forte Deployment',
        url,
        serviceType: 'Digital learning content and LMS deployment',
        description:
          'Licensing, deployment and support of Extramarks Smart Class Plus curriculum-mapped animated lessons and LMS modules for K-12 schools, and Extramarks Forte LMS and course delivery for universities and colleges, as an Extramarks channel partner.',
        provider: { '@id': `${SITE}/#organization` },
        areaServed: { '@type': 'Country', name: 'India' },
      },
    ],
  },

  {
    url: '/workspace/',
    file: 'workspace/index.html',
    nav: 'workspace',
    title: 'Google Workspace & Student Email Setup | Microsoft 365, Zoho Mail',
    ogTitle: 'Workspace & Email — set up properly, secured properly',
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
        a: 'Microsoft 365 for Business usually wins if your team already relies on desktop Office and Teams, or if you have Windows laptops to manage centrally — Entra ID and Intune come with it. Google Workspace is usually simpler if your people work mainly in a browser and collaborate live on documents. Zoho Mail is the value option and a genuinely good one: noticeably cheaper per user, Indian-owned with Indian data centres if data residency matters to you, and the right answer when what you actually need is professional email on your own domain rather than a full collaboration suite. We will recommend one for your specific setup and explain why.',
      },
      {
        q: 'Do you set up Zoho Mail?',
        a: 'Yes. Zoho Mail is one of the three suites we deploy, and we handle it the same way as the others — domain verification, DNS, mailbox creation, migration of your existing mail, and SPF, DKIM and DMARC configured properly. It is often what we recommend to smaller teams and cost-sensitive institutions, since the per-user cost is well below Google Workspace or Microsoft 365 for what is, for many organisations, the same practical outcome.',
      },
      {
        q: 'Can you migrate our existing email without losing anything?',
        a: 'Yes. We migrate existing mail, contacts and calendars with folder structure intact, run the new tenant in parallel while DNS propagates, and cut over only once delivery is confirmed working both ways. Shared addresses like accounts@ or info@ are set up as proper shared mailboxes rather than a personal account with a shared password. Migrations between Google Workspace, Microsoft 365 and Zoho in any direction are all routine.',
      },
      {
        q: 'Can you set up email accounts for students, not just staff?',
        a: 'Yes, and it is a large part of what we do. Every student gets an institution-owned address on your domain, provisioned in bulk from your existing roll — or created automatically at admission where the institution runs Vybe ERP — and organised by year and department so you can mail a single batch without maintaining lists by hand. Each academic year the structure rolls forward, with graduating students moved to whatever your policy says: an alumni address, read-only access, or suspension. Both Google Workspace for Education and Microsoft 365 Education have tiers that cost qualifying institutions nothing or very little for the core student accounts.',
      },
      {
        q: 'How do you stop strangers joining our online classes?',
        a: 'Once students have institutional accounts, class meetings can be configured to admit signed-in members of your own domain automatically from the lobby and hold everybody else outside it. A leaked link stops being a way in, because having the link is no longer what grants entry, and the teacher is not stuck admitting forty people by hand at the start of every period.',
      },
      {
        q: 'What if a student disrupts an online class?',
        a: 'Because every participant joins under a named, institution-owned account rather than as an anonymous guest, disruption is attributable. Nobody can misbehave under an invented name and rejoin under another one, the attendance record is a real record, and the follow-up is an ordinary disciplinary matter rather than an investigation. In practice most of the benefit is deterrence — the incidents largely stop once students know the room can identify everyone in it.',
      },
      {
        q: 'What is SPF, DKIM and DMARC, and do we need all three?',
        a: 'They are the three DNS records that decide whether your mail reaches the inbox and whether anyone else can send mail pretending to be you. SPF lists which servers may send as your domain, DKIM cryptographically signs each message, and DMARC tells receiving servers what to do when a message fails either check — and reports attempted impersonation back to you. Yes, you need all three, and DMARC needs to be moved to enforcement rather than left on monitoring.',
      },
      {
        q: 'What does single sign-on actually give us?',
        a: 'One account per employee, protected by one multi-factor step, that signs them into Workspace or Microsoft 365 and into your other SaaS tools over SAML or OIDC. It centralises access control: MFA is enforced in one place, conditional access can require a managed device or block sign-ins from countries you do not operate in, and disabling one account when somebody leaves closes every door at once.',
      },
      {
        q: 'What is a phishing simulation and is it safe to run on our staff?',
        a: 'It is an authorised, harmless test: we send your employees a realistic phishing lure and record who clicks, who submits credentials and who reports it. Nothing is installed and no real credentials are captured. It is run with the organisation’s consent and reported as departmental patterns rather than as a list of individuals to punish — the point is to find where training is needed, and staff who expect to be blamed stop reporting real incidents.',
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
    ogTitle: 'Vybe IT Solutions — Custom software and cybersecurity',
    description:
      'Bespoke web and mobile apps — portals, business ERPs, retail POS and custom SaaS — secured with penetration testing, DPDP Act compliance and 24/7 managed SecOps.',
    trail: [CRUMB_HOME, { name: 'IT & Cyber', url: '/it-solutions/' }],
    priority: '0.8',
    dark: true,
    bodyClass: 'text-white dark-section selection:bg-brand/10 selection:text-brand flex flex-col min-h-screen relative z-0',
    view: it,
    faqs: [
      { q: 'What kind of applications does Vybe build?', a: 'Fast, responsive and scalable web and mobile applications built to an organisation\u2019s exact operational requirements using modern tech stacks — educational portals, business ERPs, retail POS systems and custom SaaS products.' },
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
        description: 'Bespoke, scalable web and mobile applications — educational portals, business ERPs, retail POS and custom SaaS.',
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
    ogTitle: 'Vybe Cloud — Enterprise-grade infrastructure',
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
const MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  `${ORG.name}, ${ORG.street}, ${ORG.locality}, ${ORG.region} ${ORG.postal}`
)}`;

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
    q: 'Who should we contact — sales, support or legal?',
    a: `Sales, on <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a>, for anything you do not have yet: a quote, a demo, a new campus, extra modules or hardware. Support, on <a class="text-brand font-bold" href="mailto:${ORG.support}">${ORG.support}</a>, for something already running that is not behaving. Legal, on <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a>, for contracts, data protection and privacy requests, security disclosures and invoicing disputes. If you pick the wrong one we will pass it across rather than send you back.`,
  },
  {
    q: 'What if my enquiry is not resolved?',
    a: `Start with sales, support or legal, whichever fits — they own the work and settle almost everything directly. If the matter is still unresolved after that, if you are not satisfied with how it was handled, or in a serious matter, you may bring it to our Grievance Officer at <a class="text-brand font-bold" href="mailto:${ORG.grievance}">${ORG.grievance}</a>, who also receives privacy and data protection grievances. Please attach the original correspondence and the date it was sent.`,
  },
  {
    q: 'What should we include in a first enquiry?',
    a: 'The more of this you can tell us up front, the more useful the first reply is: roughly how many students or staff the system has to cover, which of the products you are interested in, anything you are running today that the new system has to work alongside or replace, and the timeline you are working to. None of it is required to start a conversation.',
  },
  {
    q: 'Where are you located, and can we visit?',
    a: `Our registered office is at ${esc(ORG.street)}, ${esc(ORG.locality)}, ${esc(ORG.region)} ${ORG.postal}. You are welcome to come and see the products running — call ahead on ${telLink(ORG.phone)} so somebody who can answer your questions is in the office.`,
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
                <p class="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl">Tell us what you are trying to run, and we will tell you plainly whether we are the right fit for it. No call centre and no ticket queue — the numbers below reach the people who build and support the software.</p>

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
                        <p class="mt-2 text-sm text-slate-600 leading-relaxed max-w-3xl">Please raise your enquiry with sales, support or legal first — they own the work and settle the large majority of matters directly. If it remains unresolved after that, if you are not satisfied with how it was handled, or in a serious matter, you may bring it to our Grievance Officer at <a href="mailto:${ORG.grievance}" class="font-bold text-brand hover:underline">${ORG.grievance}</a>. Please attach the original correspondence and the date it was sent, so the matter can be taken up from where it stands rather than started again.</p>
                    </div>
                </div>
            </div>
        </section>

        <section class="bg-corporate dark-section text-slate-300 py-20 md:py-28 px-6 relative z-10" aria-labelledby="office-heading">
            <div class="max-w-6xl mx-auto grid gap-12 md:grid-cols-2">
                <div>
                    <p class="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-2">Registered office</p>
                    <h2 id="office-heading" class="text-3xl md:text-4xl font-black font-display tracking-tight text-white">Come and see it running.</h2>
                    <address class="mt-6 not-italic text-base leading-relaxed text-slate-300">
                        #103, First Floor, 10th Main<br>
                        Gaurav Nagar, J.P Nagar 7th Phase<br>
                        ${ORG.locality}, ${ORG.region} &ndash; ${ORG.postal}<br>
                        India
                    </address>
                    <p class="mt-5 text-sm text-slate-400 leading-relaxed">Second office line: <a class="font-bold text-white hover:text-brand transition-colors" href="${telHref(
                      ORG.phoneOffice
                    )}">${telText(ORG.phoneOffice)}</a>. It reaches the same office, and is the number to try if the sales and support lines are both busy.</p>
                    <a href="${MAPS_URL}" target="_blank" rel="noopener"
                       class="mt-6 inline-flex items-center gap-2 text-sm font-bold text-white hover:text-brand transition-colors">
                        <span class="material-symbols-outlined text-[20px]" aria-hidden="true">location_on</span>
                        Open in Google Maps
                        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">open_in_new</span>
                    </a>
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
        'Talk to Vybe Technologies in Bengaluru. Sales, support and legal contacts, our grievance escalation route, phone numbers, registered office address and opening hours.',
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
    metaTitle: 'Letterhead, Bill Book & Brochure Printing in Bengaluru | Vybe',
    metaDescription:
      'Letterheads, envelopes, bill books and invoice books, brochures, flyers, posters, certificates, files and folders, printed to your artwork in Bengaluru. Send the file for a quote.',
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
    metaTitle: 'Business Card, PVC ID & RFID Card Printing in Bengaluru | Vybe',
    metaDescription:
      'Visiting cards in matt, gloss, velvet and spot UV. PVC ID cards with lanyards and holders. RFID and NFC cards, tags and key fobs carrying names, photos, numbers and QR codes. Printed in Bengaluru to your artwork.',
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
        p: 'Cards, tags, key fobs and wristbands, printed with your branding. The part worth getting right first is the chip: 125 kHz and 13.56 MHz are different technologies, and a card of the wrong sort is a coaster no matter how well it is printed. Tell us the chip your readers expect, or, if you do not know, what access control, attendance or cafeteria system you run, and we will confirm the right card before anything is ordered in bulk.',
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
    metaTitle: 'Flex Banner, Roll-Up Standee & Signage Printing in Bengaluru | Vybe',
    metaDescription:
      'Flex and vinyl banners in any size, roll-up standees, backdrops, canopy and table branding, foam board, sunboard and acrylic signage, and wall, window and vehicle graphics. Printed in Bengaluru to your artwork.',
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
      title: 'Printing Services in Bengaluru | Banners, Standees, Cards & RFID',
      ogTitle: 'Vybe Printing: paper, cards, banners, standees and RFID',
      description:
        'All types of printing from Vybe Technologies, Bengaluru: business cards, PVC ID and RFID cards, letterheads, bill books, brochures, flyers, flex banners, roll-up standees and signage. Mail or WhatsApp us your artwork for a quote.',
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
      'GST registration at a flat ₹199 professional fee. Documents prepared, application filed on the GST portal, clarifications answered and the GSTIN delivered. The portal charges no government fee for the registration itself.',
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
      'Udyam (MSME) registration at a flat ₹199 professional fee, with no government fee payable. Correct NIC classification, investment and turnover figures filed properly, and the Udyam certificate delivered.',
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
    metaTitle: 'FSSAI Registration & Food Licence at ₹299 | Vybe Technologies',
    metaDescription:
      'FSSAI Basic registration, State licence and Central licence filed for you at a flat ₹299 professional fee, with the government fee quoted separately before you commit. For restaurants, cafeterias, cloud kitchens, caterers, traders and home food businesses.',
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
    metaTitle: 'DPIIT / Startup India Recognition at ₹999 | Vybe Technologies',
    metaDescription:
      'Startup India (DPIIT) recognition prepared and filed for ₹999, with no government fee payable. Eligibility checked, the innovation write-up drafted, and the certificate followed up. Bengaluru.',
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
    feeAlt: { amount: 1599, label: 'for DPIIT-recognised startups' },
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
      'Non-accredited ISO 9001, ISO 22000 and ISO 27001 certification from Vybe Technologies: gap review, documentation, audit and a certificate verifiable on our portal. Issued by us, not by an accredited certification body, and we say so plainly.',
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
        a: `On our portal, and only there. Each certificate carries a number, and the number resolves to the holder, the standard, the scope and the validity dates, so a customer can confirm it themselves without asking you for a scan. The verification link is issued along with the certificate. If you want to confirm a certificate somebody has shown you, write to <a class="text-brand font-bold" href="mailto:${ORG.legal}">${ORG.legal}</a> with the number.`,
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
    metaTitle: 'NSDC / Skill India Registration & Affiliation Consulting | Vybe',
    metaDescription:
      'Advisory support on NSDC and Skill India training partner registration and on affiliation applications: requirement review, document gap check and file preparation. Quoted per engagement. Vybe Technologies, Bengaluru.',
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
    metaTitle: 'Class 3 Digital Signature Certificate (DSC) & Token | From ₹1,500 | Vybe',
    metaDescription:
      'Class 3 digital signature certificates from eMudhra and Capricorn, with Vybe as a registered partner: individual, organisation, combo and DGFT, from ₹1,500 for two years, USB token ₹599. Bengaluru.',
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
                        <p class="mt-4 text-white leading-relaxed text-sm">&#8377;199 for GST, &#8377;199 for Udyam (MSME), &#8377;299 for FSSAI, &#8377;999 for DPIIT recognition, and &#8377;2,299 for an ISO certificate, or &#8377;1,599 if you are a DPIIT-recognised startup. Flat, published, and the same whether an application goes through first time or needs a clarification answered. NSDC, Skill India and affiliation work is consulting rather than filing, so it is scoped and quoted before anything starts. Digital signature certificates start at &#8377;1,500 for two years, with the USB token at &#8377;599 if you need one.</p>
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
      title: 'GST, MSME, FSSAI & Startup India Registration | From ₹199 | Vybe',
      ogTitle: 'Business registrations: GST, Udyam, FSSAI, DPIIT, ISO and DSC',
      description:
        'GST and Udyam (MSME) registration at ₹199, FSSAI at ₹299, DPIIT / Startup India recognition at ₹999, non-accredited ISO certification from ₹1,599, NSDC / Skill India and affiliation consulting on quote, and Class 3 digital signature certificates from ₹1,500. Professional fees, with government charges separate. Vybe Technologies, Bengaluru.',
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

/* ------------------------------------------------------------------ 404 page */

const notFoundLink = (href, label, desc) =>
  `<a href="${href}" class="block bg-white p-6 rounded-2xl border border-slate-200 hover:border-brand hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-left">
                        <span class="block font-black font-display tracking-tight text-slate-900 mb-1">${label}</span>
                        <span class="block text-sm text-slate-600 leading-relaxed">${desc}</span>
                    </a>`;

/* ------------------------------------------------------------- write it out */

for (const doc of DOCS) {
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
    description: 'That page does not exist. Browse Vybe ERP, Vybe CMS, IT Solutions and Vybe Cloud instead.',
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
                    ${notFoundLink('/contact/', 'Contact Us', 'Phone, email and where to find us.')}
                </div>
            </div>
        </section>`,
  })
);

/* --------------------------------------------------------- sitemap & friends */

/** First-party images worth surfacing in Google Images. Nothing decorative. */
function sitemapImages(url) {
  const img = (loc, caption) =>
    `\n    <image:image><image:loc>${loc}</image:loc><image:caption>${esc(caption)}</image:caption></image:image>`;

  let out = img(`${SITE}/assets/og-image.png`, `${ORG.name} — ${ORG.slogan}`);
  if (url === '/') {
    out += img(`${SITE}/assets/vybe-lockup.png`, `${ORG.name} logo`);
    for (const g of PARTNERS) {
      for (const i of g.items) out += img(`${SITE}/assets/partners/${i.logo}.png`, `${i.name} — ${g.label}`);
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

- [Contact Us](${SITE}/contact/): Phone, email, registered office and opening hours.
- Sales: ${ORG.sales} / ${ORG.phone} — quotes, demos, new deployments, hardware, printing and registrations.
- Support: ${ORG.support} / ${ORG.phoneSupport} — existing Vybe deployments.
- Second office line: ${ORG.phoneOffice} — reaches the same office.
- Legal and compliance: ${ORG.legal} — contracts, privacy and data protection requests, security disclosures.
- Grievance Officer: ${ORG.grievance} — last resort only, after sales, support or legal have not resolved the matter. Route enquiries to the three addresses above first.

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
      const href = m[1];
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

