/*
 * Local preview on http://localhost:8099, serving globalHeaders straight out
 * of staticwebapp.config.json so the CSP here matches the one Azure sends.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.vcf': 'text/vcard; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'staticwebapp.config.json'), 'utf8'));
const globalHeaders = { ...config.globalHeaders };
// HSTS on plain-HTTP localhost would poison every other localhost project.
delete globalHeaders['Strict-Transport-Security'];

http
  .createServer((req, res) => {
    const [pathname, query] = req.url.split('?');
    const url = decodeURIComponent(pathname);
    let file = path.join(ROOT, url);

    /* Azure 301s /dir onto /dir/, and that slash decides what a relative URL on
     * the page resolves against. Serving /dir directly makes the browser read
     * `styles.css` as /styles.css rather than /dir/styles.css, so a page whose
     * CSS and JS are relative — the cards under /ankit/ and friends — arrives
     * as bare unstyled HTML. The site's own pages hide this by linking assets
     * from the root. */
    if (!url.endsWith('/') && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      res.writeHead(301, { Location: `${pathname}/${query ? `?${query}` : ''}` });
      res.end();
      return;
    }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

    const notFound = !fs.existsSync(file) || !fs.statSync(file).isFile();
    if (notFound) file = path.join(ROOT, '404.html');

    res.writeHead(notFound ? 404 : 200, {
      ...globalHeaders,
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(8099, () => console.log('preview on http://localhost:8099 (production headers applied)'));
