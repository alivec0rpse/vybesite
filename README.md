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
npm run build      # build.js + minified Tailwind  <- the one you want
npm run css        # stylesheet only
npm run images     # regenerate logos, icons, favicon set and the OG image
npm run fonts      # re-subset the Material Symbols font to the icons in use
npm run validate   # html-validate across every page
npm run serve      # preview on http://localhost:8099
```

Run `npm run build` before every deploy and commit the output — Azure Static
Web Apps serves these files directly (`app_location: "/"`, no build step).

Adding a new Material Symbols icon to a page? Run `npm run fonts` afterwards,
or the glyph will render as its literal ligature text.

## SEO notes

- One canonical URL, title, description and JSON-LD graph per page.
- `sitemap.xml` is regenerated on every build; submit it once in Search Console.
- Every legacy URL (`/T&C.html`, `/privacy_policy.html`, extensionless paths)
  301s to its new home — see `staticwebapp.config.json`.
- No third-party requests at runtime: fonts, CSS, JS and images are all
  first-party, so nothing render-blocking sits on another origin's latency.
