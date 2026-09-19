/* =========================================================================
 * Vybe Technologies — static site builder.
 *
 * Takes the original single-page app (src/app.html) and emits one real,
 * crawlable HTML document per section, each with its own canonical URL,
 * title, description, structured data and breadcrumbs.
 *
 *   node build.js && npx tailwindcss -i src/input.css -o assets/site.css --minify
 *
 * The shared chrome (head / nav / footer / scripts) lives in this file, so a
 * change to the nav propagates to every page on the next build.
 * ========================================================================= */

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
  phone: '+91-99641-77877',
  phoneAlt: '+91-99641-77677',
  sales: 'sales@vybe.net.in',
  support: 'support@vybe.net.in',
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

/**
 * Pull one `<div id="…-view">` block out of the source SPA by walking div
 * depth, so we get the whole subtree regardless of how it is indented.
 *
 * The wrapper's own classes carry the page's background and text colour
 * (e.g. `bg-slate-900 text-white` on the IT view), so it is kept — only the
 * SPA machinery (`view-section`, the inline `display:none`) is stripped.
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
const HREF = { 'home-view': '/', 'erp-view': '/erp/', 'cms-view': '/cms/', 'it-view': '/it-solutions/', 'cloud-view': '/cloud/' };

/** <picture> with a WebP source and a PNG fallback, always with intrinsic size. */
function picture({ base, alt, cls, h, aspect, eager = false, hidden = false }) {
  const w = Math.round(h * aspect);
  const a = hidden ? 'alt="" aria-hidden="true"' : `alt="${esc(alt)}"`;
  const prio = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  return `<picture><source srcset="/assets/${base}.webp" type="image/webp"><img src="/assets/${base}.opt.png" ${a} class="${cls}" width="${w}" height="${h}" ${prio} decoding="async"></picture>`;
}

const dedupe = (cls) => [...new Set(cls.split(/\s+/).filter(Boolean))].join(' ');

/**
 * Rewrite `<div onclick="showPage('x-view')" …> … </div>` into a real anchor,
 * walking div depth so the correct closing tag is converted too.
 */
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
 * Inline `style="…"` -> an equivalent class, folded into the element's existing
 * class attribute. Anything not in this map is a build error rather than a
 * silent pass-through: an unhandled inline style would work locally and vanish
 * under the production CSP, which is the worst possible failure mode.
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
    // The dot-pattern data URI is matched loosely — it carries escaped quotes.
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

  // Clickable cards become real anchors — Google can follow them, keyboards
  // can reach them, and the matching </div> is rewritten to </a> as well.
  out = divClickToAnchor(out);

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

  // A 175KB remote PNG drawn at 3% opacity. A CSS pattern is visually
  // identical and costs nothing.
  out = out.replace(
    /style="background-image: url\('https:\/\/lh3\.googleusercontent\.com\/[^']*'\);[^"]*"/g,
    'aria-hidden="true"'
  );
  out = out.replace(/<div class="absolute inset-0 opacity-\[0\.03\]" aria-hidden="true">/, '<div class="absolute inset-0 opacity-[0.03] bg-noise-faint" aria-hidden="true">');

  // Decorative-only inline handlers and error fallbacks are no longer needed.
  out = out.replace(/\s*onerror="this\.style\.display='none';"/g, '');

  // Heading levels were chosen visually, not semantically: the small eyebrow
  // label above a section was an <h2> and the section's actual title an <h3>.
  // Promote each real title and demote the label to a paragraph.
  out = out.replace(
    /<h2 (class="text-xs[^"]*")>([\s\S]*?)<\/h2>\s*<h3 (class="[^"]*")>([\s\S]*?)<\/h3>/g,
    (_, labelCls, label, titleCls, title) => `<p ${labelCls}>${label}</p>\n<h2 ${titleCls}>${title}</h2>`
  );
  // Card titles then sit one level below their section heading.
  out = out.replace(/<h4 (class="text-2xl[^"]*")>([\s\S]*?)<\/h4>/g, '<h3 $1>$2</h3>');

  // The production CSP is `style-src 'self'` with no 'unsafe-inline', which
  // means browsers drop inline style attributes outright. Every one of these
  // becomes a real class so the staggered reveals, the floating badges and the
  // IT-page dot pattern survive on Azure — they would silently flatten
  // otherwise, and only in production.
  out = styleAttrToClass(out);

  // Reveal-on-scroll starts hidden; mark it so JS can animate, but never
  // leave text invisible if JS fails.
  out = out.replace(/class="([^"]*)\breveal active\b([^"]*)"/g, 'class="$1reveal$2"');

  return { wrapperClass: view.wrapperClass, inner: out.trim(), dark };
}

/** Wrap a transformed view in its original container, breadcrumbs first. */
function renderView(view, page) {
  const cls = [view.wrapperClass, 'w-full'].filter(Boolean).join(' ');
  return `<div class="${dedupe(cls)}">
${breadcrumbs(page.trail, view.dark)}
${view.inner}
${deepDive(page.nav, { dark: view.dark })}
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

function navbar(active) {
  const item = (href, label, id) =>
    `<a href="${href}" class="hover:text-brand transition-colors${active === id ? ' text-brand font-bold' : ''}"${active === id ? ' aria-current="page"' : ''}>${label}</a>`;

  return `<header class="fixed top-0 w-full z-50 transition-all duration-300 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm" id="navbar">
        <div class="max-w-7xl mx-auto px-6 h-[72px] flex justify-between items-center">
            <a href="/" class="flex items-center gap-3 group" aria-label="Vybe Technologies — home">
                ${picture({ base: 'vybe-logo', alt: 'Vybe Technologies', cls: 'h-6 object-contain', h: 24, aspect: LOGO_ASPECT, eager: true })}
                <span class="flex flex-col justify-center border-l border-slate-200 pl-3">
                    <span class="text-[15px] font-bold font-display tracking-tight text-slate-900 leading-none">Technologies</span>
                    <span class="text-[7px] font-bold text-slate-400 uppercase tracking-[0.2em] leading-none mt-1">Smart. Simple. Affordable.</span>
                </span>
            </a>

            <nav class="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600" aria-label="Primary">
                ${item('/', 'Home', 'home')}
                ${item('/erp/', 'ERP', 'erp')}
                ${item('/cms/', 'Cafeteria', 'cms')}
                ${item('/it-solutions/', 'IT &amp; Cyber', 'it')}
                ${item('/cloud/', 'Cloud', 'cloud')}
            </nav>

            <div class="flex items-center gap-2 md:gap-4">
                <a href="mailto:${ORG.sales}" class="bg-corporate hover:bg-slate-800 text-white px-4 md:px-5 py-2.5 rounded-full text-sm font-bold transition-all active:scale-95 whitespace-nowrap">
                    Talk to Sales
                </a>

                <!-- Mobile menu. Pure CSS <details>: works with JS disabled, and
                     the links are the same markup the crawler already sees. -->
                <details class="group md:hidden relative" id="mobile-nav">
                    <summary class="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center justify-center w-12 h-12 rounded-full text-slate-700 hover:bg-slate-100 transition-colors" aria-label="Menu">
                        <span class="material-symbols-outlined text-[24px] group-open:hidden" aria-hidden="true">menu</span>
                        <span class="material-symbols-outlined text-[24px] hidden group-open:inline-block" aria-hidden="true">close</span>
                    </summary>
                    <nav class="absolute right-0 top-full mt-3 w-60 rounded-2xl border border-slate-200 bg-white shadow-xl p-2 flex flex-col text-base font-medium text-slate-700" aria-label="Mobile">
                        ${mobileItem('/', 'Home', 'home', active)}
                        ${mobileItem('/erp/', 'Vybe ERP', 'erp', active)}
                        ${mobileItem('/cms/', 'Vybe CMS (Cafeteria)', 'cms', active)}
                        ${mobileItem('/it-solutions/', 'IT &amp; Cyber', 'it', active)}
                        ${mobileItem('/cloud/', 'Vybe Cloud', 'cloud', active)}
                    </nav>
                </details>
            </div>
        </div>
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

                <!-- Visible counterparts to the sameAs list in the JSON-LD.
                     rel="me" states the same ownership claim in markup, and the
                     profiles link back here, which is what makes it credible. -->
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
                <h2 class="text-white font-bold mb-4 uppercase tracking-widest text-xs">Products</h2>
                <ul class="space-y-3 text-sm">
                    ${link('/erp/', 'Educational ERP')}
                    ${link('/cms/', 'Smart Cafeteria (CMS)')}
                    ${link('/it-solutions/', 'Custom App Development')}
                    ${link('/cloud/', 'Cloud &amp; Infrastructure')}
                </ul>
            </div>

            <div>
                <h2 class="text-white font-bold mb-4 uppercase tracking-widest text-xs">Legal &amp; Support</h2>
                <ul class="space-y-3 text-sm">
                    ${link('/privacy-policy/', 'Privacy Policy')}
                    ${link('/terms/', 'Terms of Service')}
                    ${link('/refund-policy/', 'Cancellation &amp; Refund')}
                    ${link('/shipping-policy/', 'Shipping &amp; Exchange')}
                    ${link(`mailto:${ORG.support}`, 'Contact Support')}
                </ul>
            </div>

            <div>
                <h2 class="text-white font-bold mb-4 uppercase tracking-widest text-xs">Registered Office</h2>
                <address class="text-sm not-italic leading-relaxed">
                    #103, First Floor, 10th Main<br>
                    Gaurav Nagar, J.P Nagar 7th Phase<br>
                    Bengaluru, Karnataka - ${ORG.postal}<br><br>
                    <a href="tel:+919964177877" class="hover:text-brand transition-colors block mt-2">+91 99641 77877</a>
                    <a href="tel:+919964177677" class="hover:text-brand transition-colors block mt-1">+91 99641 77677</a>
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
  // The full lockup, not the bare VYBE glyph: this is the image Google may put
  // in a Knowledge Panel, and the lockup actually spells the company name.
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
    { '@type': 'ContactPoint', telephone: ORG.phoneAlt, contactType: 'customer support', email: ORG.support, areaServed: 'IN', availableLanguage: ['en', 'hi', 'kn'] },
  ],
  areaServed: { '@type': 'Country', name: 'India' },
  // Profiles we control, asserting that all of these are the same entity.
  // Each one must link back to vybe.net.in or the claim carries little weight.
  sameAs: ORG.profiles,
  knowsAbout: [
    'Educational ERP', 'Campus management software', 'Cashless cafeteria systems',
    'Kitchen display systems', 'Custom software development', 'Cybersecurity', 'Cloud infrastructure',
  ],
};

/**
 * The office as a place you can walk into, kept separate from #organization.
 * The Organization is the abstract publisher every page points `about` at;
 * this is the physical branch, and it is the node that carries hours, phone
 * and (once you have them) coordinates. Google reads them off this type, not
 * off a bare Organization.
 */
const localBusiness = {
  '@type': 'ProfessionalService',
  '@id': `${SITE}/#office`,
  name: ORG.name,
  parentOrganization: { '@id': `${SITE}/#organization` },
  url: `${SITE}/`,
  telephone: [ORG.phone, ORG.phoneAlt],
  email: ORG.sales,
  image: { '@id': `${SITE}/#image` },
  logo: { '@id': `${SITE}/#logo` },
  address: { ...organization.address },
  areaServed: { '@type': 'Country', name: 'India' },
  sameAs: ORG.profiles,
  // A required-ish field for LocalBusiness rich results. '$$' is the schema.org
  // convention for mid-range; it is a band, not a quoted price.
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
  { nav: 'it', href: '/it-solutions/', name: 'IT & Cyber', blurb: 'Custom software, security and managed IT.', icon: 'code_blocks' },
  { nav: 'cloud', href: '/cloud/', name: 'Vybe Cloud', blurb: 'Scalable servers, hosting and DDoS protection.', icon: 'cloud' },
];

/**
 * Every product page used to link only back to the homepage, which left the
 * four of them as leaves hanging off one hub. Linking them to each other
 * spreads authority sideways and gives a reader on the ERP page somewhere to
 * go that is not the back button.
 */
function relatedSection(currentNav, { dark = false } = {}) {
  const others = PRODUCTS.filter((p) => p.nav !== currentNav);
  if (!others.length) return '';

  const bg = dark ? 'bg-slate-900 dark-section text-white' : 'bg-surface-main';
  const border = dark ? 'border-white/10' : 'border-slate-200';
  const card = dark ? 'bg-white/5 border-white/10 hover:border-white/30' : 'bg-white border-slate-200 hover:border-brand/40';
  const title = dark ? 'text-white' : 'text-slate-900';
  const body = dark ? 'text-slate-400' : 'text-slate-600';

  const cards = others
    .map(
      (p) => `<a href="${p.href}" class="group block rounded-2xl border ${card} p-6 transition-all hover:shadow-lg">
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

/* ----------------------------------------------------------- long-form copy */

/**
 * The product pages were built as sales decks: strong headlines, very little
 * prose. That reads fine but gives a search engine almost nothing to match a
 * query against — /cloud/ was 344 words. This section is the substance: real
 * explanation, in the reader's language, under headings that are themselves
 * plausible queries.
 *
 * Everything here restates what the page and its FAQs already claim. Nothing
 * asserts a client count, a price or a certification we have not said we hold.
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

  cloud: {
    kicker: 'The infrastructure',
    heading: 'Servers sized for the day it matters.',
    lede: 'Infrastructure is easy to get wrong in both directions. Over-provision and you pay every month for capacity you touch twice a year. Under-provision and the one day that actually counts, a results announcement or a launch or a sale, is the day it falls over. Vybe Cloud is about landing in between.',
    blocks: [
      {
        h: 'Private cloud on AWS and Azure',
        p: 'We design and deploy Virtual Private Clouds on AWS and Microsoft Azure: an isolated network you control, with your own subnets, routing and security groups rather than a shared box with neighbours. The architecture auto-scales, so capacity follows demand up during a traffic spike and back down again afterwards. That is the difference between paying for a peak and paying for a year of peaks. The uptime SLA is 99.99%.',
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
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: page.title,
    description: page.description,
    isPartOf: { '@id': `${SITE}/#website` },
    about: { '@id': `${SITE}/#organization` },
    primaryImageOfPage: { '@id': `${SITE}/#image` },
    inLanguage: 'en-IN',
    datePublished: '2025-01-15',
    dateModified: page.lastmod || BUILD_DATE,
    ...(page.trail.length > 1 ? { breadcrumb: { '@id': `${url}#breadcrumb` } } : {}),
  });

  const bc = breadcrumbSchema(url, page.trail);
  if (bc) graph.push(bc);
  const fq = faqSchema(url, page.faqs);
  if (fq) graph.push(fq);
  if (page.schema) graph.push(...[].concat(page.schema(url)));

  const bodyClass = page.bodyClass || 'text-slate-900 selection:bg-brand/10 selection:text-brand flex flex-col min-h-screen relative z-0';

  return `<!DOCTYPE html>
<html lang="en-IN" class="scroll-smooth">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
${page.noindex ? '' : `<link rel="canonical" href="${url}">\n`}<meta name="robots" content="${page.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">

<!-- Typography is self-hosted; preloading the two variable faces removes the
     flash of fallback text without any third-party connection. -->
<link rel="preload" href="/assets/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/plus-jakarta-sans-var.woff2" as="font" type="font/woff2" crossorigin>
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
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(page.ogTitle || page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:image" content="${SITE}/assets/og-image.png">
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
    faqs: [
      {
        q: 'What does Vybe Technologies do?',
        a: 'Vybe Technologies is a software company based in Bengaluru. Our flagship products are <strong>Vybe ERP</strong> for school and college administration, <strong>Vybe CMS</strong> for 100% cashless cafeterias, and <strong>Vybe Cloud</strong> for scalable servers and hosting. Alongside those, <strong>Vybe IT Solutions</strong> takes on custom software work for businesses of any size or sector — web and mobile apps, business ERPs, retail POS, bespoke SaaS, internal tools — together with cybersecurity and managed IT. If your requirement does not match a product off our shelf, we build it to fit.',
      },
      {
        q: 'Who does Vybe work with?',
        a: 'The ERP and cafeteria products are built for schools, colleges and corporate campuses — student profiles, fees, payroll, biometric attendance and academics on one side, and a cafeteria system engineered to hold up during peak rush hours on the other. Our custom development, cybersecurity and cloud teams work well beyond education, with businesses in retail, hospitality, healthcare, gaming and professional services.',
      },
      {
        q: 'Where is Vybe Technologies located?',
        a: `We are based in Bengaluru, Karnataka — ${esc(ORG.street)}, ${ORG.postal}. You can reach sales on <a class="text-brand font-bold" href="tel:+919964177877">+91 99641 77877</a> or <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a>.`,
      },
      {
        q: 'Can Vybe build software that is specific to our campus?',
        a: 'Yes. The ERP is fully customisable, and Vybe IT Solutions builds bespoke web and mobile applications — educational portals, business ERPs, retail POS and custom SaaS — to an institution\u2019s exact operational requirements.',
      },
      {
        q: 'How do we get a quote?',
        a: `Email <a class="text-brand font-bold" href="mailto:${ORG.sales}">${ORG.sales}</a> or call <a class="text-brand font-bold" href="tel:+919964177877">+91 99641 77877</a> with your campus size and the modules you need, and we will put together a proposal.`,
      },
    ],
    schema: (url) => ({
      '@type': 'ItemList',
      '@id': `${url}#services`,
      name: 'Vybe Technologies products and services',
      itemListElement: [
        { name: 'Vybe ERP', url: `${SITE}/erp/`, description: 'Cloud-based Educational Resource Planning suite for schools and colleges.' },
        { name: 'Vybe CMS', url: `${SITE}/cms/`, description: '100% cashless cafeteria management system with QR pickup and split payouts.' },
        { name: 'Vybe IT Solutions', url: `${SITE}/it-solutions/`, description: 'Custom app development, penetration testing and managed security operations.' },
        { name: 'Vybe Cloud', url: `${SITE}/cloud/`, description: 'Scalable cloud architecture, game servers and DDoS protection.' },
      ].map((s, i) => ({
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
    title: 'Vybe Cloud | Scalable Cloud Servers, Game Hosting & DDoS Protection',
    ogTitle: 'Vybe Cloud — Enterprise-grade infrastructure',
    description:
      'Enterprise infrastructure: auto-scaling private clouds on AWS and Azure with a 99.99% uptime SLA, bare-metal game servers and active DDoS traffic scrubbing.',
    trail: [CRUMB_HOME, { name: 'Vybe Cloud', url: '/cloud/' }],
    priority: '0.8',
    view: cloud,
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
 * `lastmod` has to mean something. Stamping today's date on all eight URLs at
 * every build teaches Google the signal is noise, and it stops trusting it for
 * crawl scheduling. So: hash each page's real content, keep the date it last
 * actually changed in .lastmod.json, and only move it when the hash moves.
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

for (const page of PAGES) {
  page.body = renderView(page.view, page);
  page.lastmod = lastmodFor(page.url, [page.title, page.description, page.body].join('\n'));
  write(page.file, shell(page));
  emitted.push({ url: page.url, priority: page.priority, changefreq: 'monthly', lastmod: page.lastmod });
}

/* ---------------------------------------------------------------- legal pages */

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

  // Keep only the document body; the shared shell supplies nav, footer and
  // breadcrumbs so the legal pages match the rest of the site and link back
  // into it instead of dead-ending on a history.back() button.
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

  write(
    doc.file,
    shell({
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
    })
  );
  emitted.push({ url: doc.url, priority: '0.3', changefreq: 'yearly', lastmod });
}

/* ------------------------------------------------------------------ 404 page */

const notFoundLink = (href, label, desc) =>
  `<a href="${href}" class="block bg-white p-6 rounded-2xl border border-slate-200 hover:border-brand hover:shadow-lg transition-all text-left">
                        <span class="block font-black font-display tracking-tight text-slate-900 mb-1">${label}</span>
                        <span class="block text-sm text-slate-600 leading-relaxed">${desc}</span>
                    </a>`;

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
                    ${notFoundLink('/cloud/', 'Vybe Cloud', 'Scalable servers and DDoS protection.')}
                    ${notFoundLink(`mailto:${ORG.sales}`, 'Talk to Sales', `Email ${ORG.sales}.`)}
                </div>
            </div>
        </section>`,
  })
);

/* --------------------------------------------------------- sitemap & friends */

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${emitted
  .map(
    (e) => `  <url>
    <loc>${SITE}${e.url}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
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

// Persist the content hashes so the next build can tell "actually changed"
// from "rebuilt". Commit this file — it is what keeps lastmod honest.
write(LASTMOD_FILE, JSON.stringify(lastmodDb, null, 2) + '\n');

console.log(`built ${emitted.length} pages:`);
for (const e of emitted) console.log('  ', e.url.padEnd(18), e.lastmod);
