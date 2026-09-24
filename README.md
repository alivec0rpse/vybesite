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

## Certificate verification

`/verify/` is the public register behind the certificate number printed on
every ISO and audit certificate we issue. The register is the `CERTIFICATES`
array in `build.js` and nothing else: the build serialises it into
`assets/verify.js`, and the lookup runs in the visitor's browser, because
Azure Static Web Apps serves files and there is no database to query.

To issue a certificate: add an entry to `CERTIFICATES`, drop the signed PDF in
`assets/certificates/`, and `npm run build`. To withdraw one, set its `status`
to `'withdrawn'` and rebuild — the number stops returning a valid result that
day, whatever the expiry printed on the paper says. Expiry itself is derived
from `expires` against the visitor's date, so it needs no maintenance.

`specimen: true` marks a demonstration record: the result card labels it as
one, which is what keeps the published sample from being mistaken for a real
certificate. Never edit `assets/verify.js` by hand; it is generated output.

The card builds its markup in JavaScript, so two things it needs are declared
rather than discovered: its Tailwind classes, via `./assets/verify.js` in the
`content` list in `tailwind.config.js`, and its Material Symbols names, via the
`material-symbols-outlined:` line `build.js` writes into the generated file's
header, which `tools/gen-fonts.mjs` and `tools/audit-icons.js` both read.

## SEO notes

- One canonical URL, title, description and JSON-LD graph per page.
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
  the `share.google` entry is a redirect and should be replaced with the
  canonical `maps/place/?q=place_id:<id>` URL when the place ID is available.
- `ORG.foundingDate` is also the `datePublished` on every page. A page that
  claims to predate the company is a contradiction inside one graph, so the two
  are deliberately the same value rather than two dates that can drift apart.
- Anything left empty in `ORG` is dropped from the graph rather than emitted as
  an empty string, so a field can be blanked without breaking the JSON-LD.
