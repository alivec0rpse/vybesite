import sharp from 'sharp';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/') + '/../';
const A = ROOT + 'assets/'; // deployed output
const S = ROOT + 'src/logos/'; // originals, never shipped
const BRAND = { r: 227, g: 24, b: 55, alpha: 1 };

// 1. Optimised logo (displayed at most 112px tall -> 2x = 224px; 600w covers all uses)
await sharp(S + 'vybe-logo.png').resize({ width: 600 }).png({ compressionLevel: 9, palette: true }).toFile(A + 'vybe-logo.opt.png');
await sharp(S + 'vybe-logo.png').resize({ width: 600 }).webp({ quality: 92 }).toFile(A + 'vybe-logo.webp');

/**
 * 1b. The full lockup, which is what Organization.logo points at: it spells
 * the company name out where the bare glyph does not. Trimmed because the
 * source carries a band of empty alpha along the bottom.
 */
const lockup = await sharp(S + 'vybe-lockup.png').trim().png({ compressionLevel: 9 }).toBuffer();
const lm = await sharp(lockup).metadata();
fs.writeFileSync(A + 'vybe-lockup.png', lockup);
await sharp(lockup).webp({ quality: 92 }).toFile(A + 'vybe-lockup.webp');
console.log(`lockup ${lm.width}x${lm.height}`);

// 2. Client logo
await sharp(S + 'caias-logo.png').resize({ width: 560 }).png({ compressionLevel: 9, palette: true }).toFile(A + 'caias-logo.opt.png');
await sharp(S + 'caias-logo.png').resize({ width: 560 }).webp({ quality: 90 }).toFile(A + 'caias-logo.webp');

// 3. Icon mark: the full VYBE wordmark, knocked out white on brand red.
const MARK = await sharp(S + 'vybe-logo.png')
  .trim()                                           // drop transparent margin so the mark centres true
  .toBuffer();
const mm = await sharp(MARK).metadata();
const markWhite = await sharp(MARK)                 // use alpha as a mask, fill white
  .ensureAlpha()
  .composite([{ input: { create: { width: mm.width, height: mm.height, channels: 3, background: '#ffffff' } }, blend: 'in' }])
  .png().toBuffer();

/**
 * `pad` is the horizontal margin as a fraction of the icon size. The wordmark
 * is ~2.4:1, so width fills the square and the height follows from that.
 */
async function icon(size, pad) {
  const inner = Math.round(size * (1 - pad * 2));
  let pipe = sharp(markWhite).resize({ width: inner, fit: 'inside' });
  // Below ~64px the strokes smear into the red without a touch of sharpening.
  if (size < 64) pipe = pipe.sharpen({ sigma: 0.6 });
  const mark = await pipe.toBuffer();
  const m = await sharp(mark).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: BRAND } })
    .composite([{ input: mark, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }])
    .png({ compressionLevel: 9 }).toBuffer();
}

fs.writeFileSync(A + 'icon-512.png', await icon(512, 0.11));
fs.writeFileSync(A + 'icon-192.png', await icon(192, 0.11));
fs.writeFileSync(A + 'apple-touch-icon.png', await icon(180, 0.10));
// Android masks to a circle, so the mark needs wider padding to stay inside
// the 80% safe zone.
fs.writeFileSync(A + 'icon-maskable-512.png', await icon(512, 0.155));
fs.writeFileSync(A + 'favicon-48.png', await icon(48, 0.08));
fs.writeFileSync(A + 'favicon-32.png', await icon(32, 0.06));
fs.writeFileSync(A + 'favicon-16.png', await icon(16, 0.04));

// 4. favicon.ico, 16/32/48 only. ICO frames are uncompressed bitmaps, so a
// 192px frame would push the file to ~150KB.
const pngToIco = await import('png-to-ico').then((m) => m.default || m);
fs.writeFileSync(
  ROOT + 'favicon.ico',
  await pngToIco([A + 'favicon-16.png', A + 'favicon-32.png', A + 'favicon-48.png'])
);

// 5. Open Graph / Twitter card image (1200x630) — mirrors the hero: brand gradient + white logo card.
const OG_W = 1200, OG_H = 630;
const ogBg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e31837"/><stop offset="55%" stop-color="#ef4444"/><stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#g)"/>
  <circle cx="1080" cy="690" r="400" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="2"/>
  <circle cx="1140" cy="640" r="300" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="2"/>
  <rect x="80" y="175" width="440" height="280" rx="48" fill="#fff"/>
  <text x="600" y="268" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="66" font-weight="800" fill="#fff" letter-spacing="-2">Smart. Simple.</text>
  <text x="600" y="344" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="66" font-weight="800" fill="#fff" letter-spacing="-2">Affordable.</text>
  <text x="600" y="416" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="27" font-weight="500" fill="#fff" fill-opacity="0.9">Campus ERP &#183; Cashless Cafeteria &#183; Cloud</text>
</svg>`);
const ogMark = await sharp(S + 'vybe-logo.png').resize({ width: 300 }).toBuffer();
const om = await sharp(ogMark).metadata();
await sharp(ogBg)
  .composite([{ input: ogMark, left: 80 + Math.round((440 - om.width) / 2), top: 175 + Math.round((280 - om.height) / 2) }])
  .png({ compressionLevel: 9 })
  .toFile(A + 'og-image.png');

console.log('icons + og done');
