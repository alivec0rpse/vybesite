/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './404.html', './*/index.html'],
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
