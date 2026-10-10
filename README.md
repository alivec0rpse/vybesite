# vybe.net.in

Static site for Vybe Technologies. Hosted on **Azure Static Web Apps**.

## Layout

```
src/app.html          original SPA — the source of truth for page copy
src/input.css         the one stylesheet source (Tailwind + custom layers)
src/logos/            original logo artwork; never deployed
build.js              emits every page, sitemap.xml, robots.txt, manifest, 404
tailwind.config.js    theme (brand colours, font stacks)
tools/                image, font-subset, preview-server and screenshot scripts
staticwebapp.config.json   routes, 301s, cache and security headers
api/                  order-tracking API (Azure Functions, deployed as SWA managed functions)
```

Everything else in the repo root is **generated output** — `index.html`,
`erp/`, `cms/`, `it-solutions/`, `cloud/`, the three legal pages, `404.html`,
`sitemap.xml`, `robots.txt`, `site.webmanifest`, `favicon.ico`, `assets/site.css`.
Edit the sources, not the output.

## Commands

```sh
npm run build        # build.js + Tailwind + asset stamping  <- the one you want
npm run css          # stylesheet only
npm run images       # regenerate logos, icons, favicon set and the OG image
npm run fonts        # re-subset the Material Symbols font to the icons in use
npm run validate     # html-validate across every page
npm run serve        # preview on http://localhost:8099
npm run audit:seo    # titles, descriptions, canonicals, headings, sitemap, links
npm run audit:mobile # renders every page at 390x844 (needs `npm run serve`)
npm run audit:icons  # every icon ligature still in the subset font
```

`npm run build` ends with `tools/stamp-assets.js`, which appends a content
hash to the stylesheet, script and font URLs. `/assets/*` is served
`immutable` for a year, so without that stamp a returning visitor keeps an old
stylesheet and an old icon font indefinitely — which is how icons added since
their last visit end up rendering as their literal ligature names. Never
reference `/assets/site.css` or a font by its bare path in a template; let the
stamp add the query string.

Run `npm run build` before every deploy and commit the output — Azure Static
Web Apps serves these files directly (`app_location: "/"`, no build step).

Adding a new Material Symbols icon to a page? Run `npm run fonts` afterwards,
or the glyph will render as its literal ligature text.

## Motion

Two systems, split by when they have to run.

**Load time is CSS.** The hero entrance is `@keyframes hero-rise` on
`[data-hero] > *`, staggered by `nth-child`. It cannot be JavaScript: every
script on this site is deferred, so the hero is already painted by the time one
runs, and a script that hid the headline in order to animate it in would flash
it and snatch it back — or leave it invisible for good if `site.js` 404'd. The
CSP is `script-src 'self'` with no `'unsafe-inline'`, so there is no inline
script to set the initial state earlier either. Keyframes with `both` hold the
from-state from the first painted frame, which is the only way to get an
entrance here with no flash and no JS dependency.

`build.js` decides what the hero is, in `tagHero()`: `data-hero` goes on the
element wrapping the page's first `<h1>` — across every page shape here that is
the content column, and its children are exactly what should rise in sequence.
A block that already carries `reveal` is skipped, because a load-time rise
stacked on a scroll reveal reads as a stutter. That is why `/erp/` and the
other `app.html`-derived pages have no hero stagger.

**Scroll time is GSAP.** `ScrollTrigger.batch` drives the `.reveal` sections,
which is the reason it replaced the IntersectionObserver: the observer fired
once per element, so four cards crossing the fold together ran as four
independent fades that happened to share a start frame. `batch` groups them and
can stagger. `ScrollTrigger` also runs the hero backdrop parallax, on desktop
with a real pointer only — the same bargain this site already strikes for the
orbs and the dot matrix, because re-rasterising a big soft layer every frame is
what costs a phone its scroll budget.

GSAP is vendored, not linked: `tools/vendor-gsap.mjs` copies `gsap.min.js` and
`ScrollTrigger.min.js` out of `node_modules` into `assets/vendor/`, where
`stamp-assets.js` hashes them like anything else. A CDN is not an option under
`script-src 'self'`, and it would put a third-party origin's latency on every
page — which the rest of this site is built to avoid. It runs first in
`npm run build`; `npm run vendor` does it alone after a GSAP upgrade.

Everything GSAP does is behind a `useGsap` flag in `site.js`, and every branch
has a path for when it is false — reduced motion, or the files failing to
arrive. The reveals fall back to the original IntersectionObserver; the hero
does not care, because it was never JavaScript.

Two rules hold across all of it:

- **Only `opacity` and `transform`.** Nothing in the motion layer can move
  layout, so none of it can register as CLS. The one exception was the
  "… in detail →" affordance, which grew a flex `gap` on hover and shifted its
  own label doing it; `slideArrowOnHover()` in `build.js` rewrites that to a
  transform on the arrow.
- **`will-change` is temporary.** It is set for the duration of a movement and
  dropped after — on `animationend` for the hero, via `clearProps` for the
  reveals, and in the `matchMedia` teardown for the parallax. A hint left on is
  a compositor layer held for the rest of the visit.

## Certificate verification

`/verify/` is the public register behind the certificate number printed on
every ISO and audit certificate we issue. The register lives in the API
(`api/src/lib/certs.js`, table `certs`) and is kept from the **Certificates**
tab at `/vyb-admin/`; the page looks each number up live at
`/api/verify/{number}`. Issuing, editing or withdrawing a certificate is a save
in the admin page and takes effect on the next lookup, with no build.

To issue one: fill in the form and upload the signed PDF (or link one). To
withdraw one, set its status to **Withdrawn** rather than deleting it, so the
number keeps answering "withdrawn" instead of "unknown". Expiry is derived from
`expires` against the visitor's date, so it needs no maintenance.

`specimen: true` marks a demonstration record: the result card labels it as
one. The published specimen (`VYB-QMS-2026-0417`) is seeded into the table the
first time the register is read; `build.js` reads the same seed for the page's
"see a specimen" link. Lookups are not logged, and the page says so.

`assets/verify.js` is still generated by `build.js`, for its markup; the
register is no longer in it. Its Tailwind classes and icons are declared the
same way as before.

## Blog

`/blogs/` is written from the **Blog** tab at `/vyb-admin/` and published as
static pages. Posts and authors live in the API (tables `posts`, `authors`;
images in the `media` blob container). At build time `tools/fetch-blog.mjs`
pulls every published post from `/api/blog/export`, re-encodes its images to
WebP + JPEG under `assets/blog/`, and `build.js` writes each post as an
ordinary page. That is the SEO decision: a post is as fast and as crawlable as
any other page, with no function between Google and the HTML.

Every post gets: its own canonical and title, the meta description staff wrote,
`BlogPosting` + `BreadcrumbList` JSON-LD with a real `Person` author (linked to
their visiting card's `#person` when they have one), `og:type=article` with the
cover as the share image, `article:*` tags, a table of contents, related posts,
a sitemap entry dated by its own last edit, and an item in `/blogs/feed.xml`.
Each author gets a page at `/blogs/authors/<slug>/`. IndexNow is told about new
and updated posts.

The editor shows a live preview rendered by the same code the build uses
(`api/src/lib/markdown.js`, a small markdown subset with no raw HTML), a Google
snippet preview, and an SEO checklist. Publishing refuses a post with no
author, a meta description under 50 characters, a cover without alt text, or
under 150 words. A future publish date schedules the post. Slugs are fixed at
creation.

**Getting a post live.** Saving never touches the site; the next build does.
The workflow runs every 15 minutes, compares `/api/blog/stamp` with the live
`/blogs/stamp.json`, and deploys only when they differ. **Rebuild site now** in
the admin page starts a deploy immediately if `VYB_GITEA_TOKEN` is set.

With no published posts there is no `/blogs/` page and no nav link. Blog output
(`blogs/`, `assets/blog/`, `src/blog-data/`) is gitignored: CI builds it from
the API. A laptop build without `VYB_BUILD_TOKEN` builds an empty blog.

## Staff visiting cards

`/ankit/`, `/harsha/`, `/manjunath/`, `/tejas/`, `/jaisharan/` and `/josh/` are
digital visiting cards.
The markup is imported, not written here: `tools/import-card.mjs` unpacks an
export built for a standalone origin. The import cannot know how the page
should behave on this site, so `build.js` owns that half, driven by the `TEAM`
array:

- rewrites the export's `noindex` to `index, follow` — the cards are meant to
  rank for the person's name,
- rewrites the title and description, and injects a `ProfilePage` + `Person`
  + `BreadcrumbList` graph,
- adds the card to `sitemap.xml`.

So an import is only half a card. Run `npm run build` after one, or you ship a
page that is indexable but anonymous to a crawler.

**The cards are deliberately orphaned.** `/contact/` used to carry a team grid
and it was the only internal link to any of them; it was removed as a content
decision, knowing what that costs. They are reachable now by sitemap, by direct
URL and by the printed QR code, and by nothing else on this site. Crawlers will
still find them, but with no internal links they earn no link equity and get
crawled less often, so ranking for a person's name is weaker than the
`index, follow` above implies. If that ever needs undoing, the fix is a link
from somewhere real — the footer is the obvious candidate — not another
sitemap entry.

To add a person: import the card, add the routes the importer prints to
`staticwebapp.config.json`, add them to `TEAM`, and build.

`<slug>/qr.html` stays `noindex` in both its meta tag and its route: it is the
same card with none of the content, so indexing it would compete with the page
that should rank. The card's `assets/` are deliberately *not* `noindex` —
`og:image` and Google Images both need them crawlable.

A person's `@id` is `/<slug>/#person`, and `ORG.founder.card` points the
founder node at that same id. One human must not be two entities in one graph,
or a search for the name has two things to choose between.

## Careers talent pool

`/careers/` is built in `build.js` (search `CAREERS`). The site has no open
roles, so the page carries no JobPosting data and must not grow any until a
real role exists. "Life at Vybe" photos come from `LIFE_PHOTOS`; a `null`
renders a marked placeholder.

The talent-pool form has no backend. `assets/careers.js` validates it, then
opens the visitor's own email app with a message to hr@vybe.net.in already
written, subject and body included, so they only press Send. Nothing is stored
or sent by the site. The send button ships disabled and the script enables it:
the CSP's `form-action 'self'` blocks posting a form to a mailto: URL, and a
plain GET would put the applicant's details in the URL. A "Copy my details"
button covers people whose browser has no email app set up.

## Order tracking

`/track/` is the customer's side, `/vyb-admin/` is staff's. Both pages are
built by `build.js` like everything else; what they talk to is `api/`, a small
Azure Functions app (Node 22, programming model v4) that the deploy ships as
this Static Web App's **managed functions**, so it is served at `/api/*` on
the same origin and the CSP's `connect-src 'self'` already covers it. The data
lives in **Azure Table Storage**: an `orders` table and a `users` table, both
created on first use.

- **Customers** open `/track/VYB-XXXXX-XXXXX` (the link staff send, usually by
  WhatsApp) or type the code at `/track/`. They see items and quantities, the
  delivery mode, courier/partner and AWB, a stepper from *payment confirmed* to
  *delivered* (or *collected*), and every update with its note. Never the
  phone, email, address, internal note or staff names. The customer's full
  name is shown, so they can tell the order is theirs.
  Codes are random (~49 bits), not sequential, so they cannot be walked.
- **Payment.** Each order is Prepaid, Cash on delivery or Credit. Prepaid
  orders open at *payment confirmed*; COD and credit open at *order confirmed*
  instead, so the page never claims money that has not arrived. COD and credit
  carry an amount (and credit a due date); the customer sees what is owed until
  staff tick *Payment received*. A delivered order that is still unpaid stays
  in the **Open** list.
- **Staff** sign in at `/vyb-admin/`, create an order once payment is in, and
  move it along. Any status can be set at any time; each delivery mode only
  decides which steps the customer's stepper draws ahead. Modes and statuses
  are defined once, in `api/src/lib/catalog.js`.
- **Roles.** `user` creates and updates orders. `admin` also deletes orders and
  manages staff accounts. Nobody signs up; only an admin creates accounts,
  of either role, with a temporary password the person must replace at first
  sign-in.
- **The owner** is the first admin, created on first sign-in from the
  `VYB_ADMIN_EMAIL` / `VYB_ADMIN_PASSWORD` settings, and only while no owner
  exists. The owner cannot be demoted, disabled or deleted, and no admin can
  demote, disable or delete themselves, so there is always an admin.
- **Sessions** are an HttpOnly, `SameSite=Strict` cookie scoped to `/api`,
  HMAC-signed with `VYB_SESSION_SECRET`, 12 hours. Signing out, a password
  change or reset, a role change or disabling an account ends every session
  for that person. Five wrong passwords lock an account for 15 minutes; an
  admin's password reset lifts the lock.

`cd api && npm test` runs the handlers end to end against an in-memory table,
no Azure needed. CI runs it before every deploy.

### Azure setup (once)

1. **A storage account** for the tables (keep it separate from `vybecdn`,
   whose `$web` container is public):

   ```sh
   az storage account create -g <resource-group> -n vybeorders -l centralindia \
     --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
   az storage account show-connection-string -g <resource-group> -n vybeorders -o tsv
   ```

2. **Four environment variables on the Static Web App** (Portal: the Static Web
   App -> Settings -> Environment variables -> Production):

   | Name | Value |
   | --- | --- |
   | `VYB_TABLES_CONNECTION` | the connection string from step 1 |
   | `VYB_SESSION_SECRET` | `openssl rand -hex 32` |
   | `VYB_ADMIN_EMAIL` | the owner's email |
   | `VYB_ADMIN_PASSWORD` | a one-time first password |
   | `VYB_BUILD_TOKEN` | `openssl rand -hex 32`; also add it as a Gitea secret of the same name |
   | `VYB_GITEA_TOKEN` | optional: a Gitea token with repo write access, for **Rebuild site now** |

   ```sh
   az staticwebapp appsettings set -n <static-web-app> -g <resource-group> --setting-names \
     VYB_TABLES_CONNECTION="<connection string>" VYB_SESSION_SECRET="$(openssl rand -hex 32)" \
     VYB_ADMIN_EMAIL="you@vybe.net.in" VYB_ADMIN_PASSWORD="<first password>"
   ```

3. **Push.** The Gitea workflow deploys `api/` with the site. Nothing else to
   create: managed functions come with the Static Web App, Free plan included.

4. **Sign in** at `/vyb-admin/` with the email and password from step 2,
   choose a new password, then add staff from the Staff tab. Once the owner
   exists, `VYB_ADMIN_PASSWORD` does nothing and can be deleted.

Changing `VYB_SESSION_SECRET` signs everybody out; that is the emergency
switch. `VYB_TABLES_CONNECTION` also gives the API its blob container for
uploads (`media`), created on first use.

`staticwebapp.config.json` has a 20 KB limit on Azure. `npm run stage`
minifies the deployed copy and fails if it is still over.

## SEO notes

- One canonical URL, title, description and JSON-LD graph per page.
- `npm run audit:seo` grades snippet-shaped things — description, title length,
  the h1, `og:url`, `twitter:card`, `dateModified` — only on indexable pages.
  The vcard and QR pages under `/tejas/`, `/ankit/` and friends are `noindex`
  by design and have no snippet to grade, so holding them to those rules only
  produced errors nobody could act on. Structural checks (title present, valid
  JSON-LD, image alt, links that resolve) still run everywhere.
- `sitemap.xml` is regenerated on every build; submit it once in Search Console.
- Every legacy URL (`/T&C.html`, `/privacy_policy.html`, extensionless paths)
  301s to its new home. See `staticwebapp.config.json`.
- No third-party requests at runtime: fonts, CSS, JS and images are all
  first-party, so nothing render-blocking sits on another origin's latency.
- Unknown URLs must return a real 404. `staticwebapp.config.json` carries
  `responseOverrides` and deliberately no `navigationFallback`: that key is for
  SPAs, and it served `404.html` with a 200, which Google reads as a soft 404
  and can spread to real pages.
- `ORG.alsoKnownAs` in `build.js` feeds `alternateName` on the Organization,
  ProfessionalService and WebSite nodes. It is how a bare "vybe" query gets
  matched to this entity.
- `ORG.profiles` is `sameAs`. Every URL in it must link back to vybe.net.in.
  The Google Business Profile carries the most weight for a local brand query;
  it is listed by place ID (`ORG.corporate.placeId`), which also feeds the
  corporate office's `hasMap` and its Maps link on the contact page.
- `ORG.foundingDate` is also the `datePublished` on every page. A page that
  claims to predate the company is a contradiction inside one graph, so the two
  are deliberately the same value rather than two dates that can drift apart.
- Anything left empty in `ORG` is dropped from the graph rather than emitted as
  an empty string, so a field can be blanked without breaking the JSON-LD.
