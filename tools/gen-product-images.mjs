/*
 * Category images for the distribution catalogue. Manufacturer renders, used
 * as a channel partner normally uses them: one representative shot per
 * category, not a photograph of stock we hold. To pull a brand's artwork,
 * delete the original from src/products/ and drop the entry from
 * CATEGORY_IMAGES in build.js; the card falls back to its icon on its own.
 *
 * Reads src/products/ (never deployed) and writes the <base>.webp plus
 * <base>.opt.png pair that picture() expects into assets/products/.
 *
 * Sources are white-background renders at wildly different pixel sizes, so
 * each is trimmed to its own ink and composed onto one shared square canvas.
 * A 4000px tower and a 500px charger then sit at the same optical weight with
 * no per-image classes, which the CSP would forbid anyway.
 *
 *   node tools/gen-product-images.mjs   (npm run products)
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

  // Trim on white rather than alpha: several renders are flattened with no
  // transparency, so an alpha trim is a no-op and the subject floats.
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
