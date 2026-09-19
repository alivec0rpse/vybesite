/* =========================================================================
 * Normalise the client and partner marks for the logo row on the home page.
 *
 * Every mark here is the brand's own reversed (light-on-dark) artwork, taken
 * from the company's own site, which is why the partners section is dark:
 * it is the background those marks were drawn for. No recolouring is done
 * beyond what is noted for JS Global below.
 *
 * The hard part of a logo row is optical balance. A wordmark that is 6:1 and
 * a crest that is 1:1 look nothing alike at the same pixel height: constrain
 * both to h-24 and the wordmark reads as a banner while the crest disappears.
 * So instead of scaling each file and then styling it, every mark is composed
 * onto one shared 3:1 canvas, scaled by its own shape. The page then renders
 * them all at a single size with no per-logo classes, which matters because
 * the CSP forbids inline styles.
 *
 * Usage: node tools/gen-partner-logos.mjs   (npm run logos)
 * ========================================================================= */
import sharp from 'sharp';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/') + '/../';
const SRC = ROOT + 'src/logos/partners/'; // originals, never shipped
const OUT = ROOT + 'assets/partners/'; // deployed output

// Canvas every mark lands on. 3:1, and 2.5x the 128px desktop display height,
// which is already past what any current display resolves. Going higher only
// grows jsglobal.png, where a gold gradient with soft alpha edges is the worst
// case PNG has.
const W = 960;
const H = 320;

fs.mkdirSync(OUT, { recursive: true });

/**
 * JS Global publish their mark only as gold-on-black JPEG, with their phone
 * numbers and URL set underneath it. `crop` removes that contact block, then
 * the pixel's own brightness becomes its alpha: pure black falls away, the
 * gold survives. The colour is renormalised against that brightness so the
 * gold keeps its hue instead of washing out where the alpha is partial.
 */
async function knockOutBlack(file, crop) {
  const cropped = await sharp(file).extract(crop).toBuffer();
  const { data, info } = await sharp(cropped).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.max(data[i], data[i + 1], data[i + 2]);
    data[i + 3] = lum;
    if (lum > 0) {
      data[i] = Math.min(255, (data[i] * 255) / lum);
      data[i + 1] = Math.min(255, (data[i + 1] * 255) / lum);
      data[i + 2] = Math.min(255, (data[i + 2] * 255) / lum);
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const MARKS = [
  { name: 'caias', file: 'caias.webp' },
  { name: 'vendx', file: 'vendx.png' },
  // Held back with the Trusted Partner group in build.js until the MoU is
  // signed. Left unbuilt rather than merely unreferenced: an orphaned file
  // under assets/ is still a public URL anyone can fetch.
  // { name: 'milkymist', file: 'milkymist.png' },
  // Same reason as Milky Mist above: Extramarks do not permit use of their
  // mark before the channel partner contract is executed, which is scheduled
  // for the week of 21 September 2026. Both entries stay commented until then.
  // { name: 'extramarks', file: 'extramarks.svg' },
  // The largest Forte mark published anywhere on their site is 179x101, so
  // this one gets upscaled. See the sharpen below.
  // { name: 'extramarksforte', file: 'extramarksforte.webp' },
  { name: 'jsglobal', file: 'jsglobal.jpg', crop: { left: 60, top: 40, width: 730, height: 610 } },
];

for (const mark of MARKS) {
  const input = mark.crop
    ? await knockOutBlack(SRC + mark.file, mark.crop)
    : SRC + mark.file;

  // `density` only matters for the SVG; sharp ignores it on raster input.
  const trimmed = await sharp(input, { density: 600 }).trim().toBuffer();
  const t = await sharp(trimmed).metadata();
  const ratio = t.width / t.height;

  // Wide wordmarks are limited by width, tall crests by height, and the band
  // between them gets a height that lands roughly on the same ink area.
  const fit =
    ratio > 2.6 ? { width: W } :
    ratio > 1.5 ? { height: Math.round(H * 0.86) } :
                  { height: H };

  let pipe = sharp(trimmed).resize({ ...fit, fit: 'inside' });

  // Not every brand publishes a mark big enough for this canvas. Where one has
  // to be enlarged past about 1.5x, Lanczos leaves the edges soft; a light
  // unsharp pass puts the letterforms back without visible ringing.
  const upscale = (fit.width ? fit.width / t.width : fit.height / t.height);
  if (upscale > 1.5) pipe = pipe.sharpen({ sigma: 1 });

  const scaled = await pipe.toBuffer();
  const s = await sharp(scaled).metadata();

  const canvas = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, left: Math.round((W - s.width) / 2), top: Math.round((H - s.height) / 2) }]);

  const png = await canvas.png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(OUT + mark.name + '.png', png);
  await sharp(png).webp({ quality: 92 }).toFile(OUT + mark.name + '.webp');

  console.log(
    `${mark.name.padEnd(16)} ${t.width}x${t.height} (${ratio.toFixed(2)}:1) -> ${s.width}x${s.height} on ${W}x${H}` +
      (upscale > 1.5 ? `  [upscaled ${upscale.toFixed(1)}x, sharpened]` : '')
  );
}

console.log(`${MARKS.length} partner marks written to assets/partners/`);
