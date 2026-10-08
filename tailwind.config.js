/** @type {import('tailwindcss').Config} */
module.exports = {
  // assets/verify.js builds the certificate result card in the browser, so the
  // only place those class names appear is inside that generated file. Without
  // it in the content list Tailwind purges the card's styles.
  // ./assets/site.js for the same reason as verify.js: `gsap-on` is set on
  // <html> from script and appears in no template, so without it here Tailwind
  // purges the rule that stops .reveal's CSS transition fighting the tween.
  // ./assets/track.js and ./assets/admin.js build the tracking card and the
  // order desk's lists in the browser, the same way verify.js does.
  content: [
    './index.html',
    './404.html',
    './*/index.html',
    './*/*/index.html',
    // Blog author pages sit one level deeper: /blogs/authors/<slug>/.
    './*/*/*/index.html',
    './assets/verify.js',
    './assets/site.js',
    './assets/track.js',
    './assets/admin.js',
    // The blog renderer emits .blog-table; .blog-prose rules that mention it
    // are purged unless Tailwind can see the name somewhere.
    './api/src/lib/markdown.js',
  ],
  theme: {
    extend: {
      colors: {
        brand: '#e31837',
        'brand-dark': '#b90027',
        corporate: '#0f172a',
        'surface-main': '#f8fafc',
        // Colors specific to the CMS design
        primary: '#b90027',
        'primary-container': '#e31837',
        surface: '#fbf9f8',
        'on-surface': '#1b1c1b',
        'on-surface-variant': '#5d3f3e',
        'surface-variant': '#e4e2e1',
        'outline-variant': '#e6bdbb',
        'tertiary-container': '#00808c',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        headline: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        body: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
};
