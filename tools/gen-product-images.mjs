/*
 * Category images for the distribution catalogue.
 *
 * These are manufacturer product renders, used the way a channel partner
 * normally uses them: one representative shot per category, not a photograph
 * of specific stock we hold. They are the vendors' artwork and their
 * trademarks remain theirs. If a brand asks for one to come down, delete the
 * original from src/products/, drop the entry from CATEGORY_IMAGES in
 * build.js, and the card falls back to its Material Symbols icon on its own.
 *
 * Originals live in src/products/ and are never deployed; this writes the
 * optimised pair the `picture()` helper expects — <base>.webp plus
 * <base>.opt.png — into assets/products/.
 *
 * Every source is a white-background render at wildly different pixel sizes,
 * so each is trimmed to its own ink and then composed onto one shared square
 * canvas. That way a 4000px tower and a 500px charger sit at the same optical
 * weight in the grid, and the page needs no per-image classes — which it
 * could not have anyway, because the CSP forbids inline styles.
 *
 * Usage: node tools/gen-product-images.mjs   (npm run products)
 */
import sharp from 'sharp';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/') + '/../';
const SRC = ROOT + 'src/products/'; // originals, never shipped
const OUT = ROOT + 'assets/products/'; // deployed output

// Square, at 2x the 320px the card renders at. Padding keeps the trimmed
// subject off the card's rounded corners.
const SIZE = 640;
const PAD = 0.06;

const NAMES = ['desktops', 'allinone', 'minipc', 'laptops', 'monitors', 'kbmouse', 'audio', 'power'];

fs.mkdirSync(OUT, { recursive: true });

for (const name of NAMES) {
  const file = SRC + name + '.png';
  if (!fs.existsSync(file)) {
    console.warn(`  skip ${name}: no original`);
    continue;
  }

  /*
   * `trim` on the white background rather than on alpha: several of these
   * renders carry a flattened white field with no transparency at all, so
   * trimming alpha would be a no-op and the subject would float.
   */
  const trimmed = await sharp(file)
    .flatten({ background: '#ffffff' })
    .trim({ background: '#ffffff', threshold: 12 })
    .toBuffer();

  const inner = Math.round(SIZE * (1 - PAD * 2));
  const fitted = await sharp(trimmed)
    .resize({ width: inner, height: inner, fit: 'inside', withoutEnlargement: false })
    .toBuffer();
  const m = await sharp(fitted).metadata();

  const canvas = sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' },
  }).composite([
    {
      input: fitted,
      top: Math.round((SIZE - m.height) / 2),
      left: Math.round((SIZE - m.width) / 2),
    },
  ]);

  const flat = await canvas.png().toBuffer();
  await sharp(flat).png({ compressionLevel: 9, quality: 90 }).toFile(OUT + name + '.opt.png');
  await sharp(flat).webp({ quality: 86 }).toFile(OUT + name + '.webp');

  const png = fs.statSync(OUT + name + '.opt.png').size;
  const webp = fs.statSync(OUT + name + '.webp').size;
  console.log(`  ${name.padEnd(10)} ${String(m.width).padStart(4)}x${m.height}  png ${(png / 1024).toFixed(0)}k  webp ${(webp / 1024).toFixed(0)}k`);
}

console.log(`${NAMES.length} category images -> assets/products/`);
