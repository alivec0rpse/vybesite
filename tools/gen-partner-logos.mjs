/*
 * Normalise the client and partner marks for the logo row. Each is the brand's
 * own reversed artwork, which is why the section is dark. No recolouring
 * beyond the JS Global knockout below.
 *
 * A 6:1 wordmark and a 1:1 crest look nothing alike at the same pixel height,
 * so each is composed onto one shared 3:1 canvas and scaled by its own shape.
 * The row then renders at a single size with no per-logo classes, which the
 * CSP would forbid anyway.
 *
 *   node tools/gen-partner-logos.mjs   (npm run logos)
 */
import sharp from 'sharp';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/') + '/../';
const SRC = ROOT + 'src/logos/partners/'; // originals, never shipped
const OUT = ROOT + 'assets/partners/'; // deployed output

// The shared canvas: 3:1, at 2.5x the 128px display height. Going higher only
// grows jsglobal.png, whose soft gold gradient is the worst case PNG has.
const W = 960;
const H = 320;

fs.mkdirSync(OUT, { recursive: true });

/**
 * JS Global publish their mark only as gold-on-black JPEG with contact details
 * underneath. `crop` removes those, then each pixel's brightness becomes its
 * alpha so the black falls away, with colour renormalised against that
 * brightness so the gold keeps its hue where the alpha is partial.
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
  // Held back until the MoU is signed. Unbuilt rather than merely unreferenced:
  // a file under assets/ is a public URL whether anything links to it or not.
  // { name: 'milkymist', file: 'milkymist.png' },
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

  // Wide wordmarks are limited by width, tall crests by height. The band
  // between gets a height that lands on roughly the same ink area.
  const fit =
    ratio > 2.6 ? { width: W } :
    ratio > 1.5 ? { height: Math.round(H * 0.86) } :
                  { height: H };

  let pipe = sharp(trimmed).resize({ ...fit, fit: 'inside' });

  // Past about 1.5x, Lanczos leaves the edges soft. A light unsharp pass puts
  // the letterforms back without visible ringing.
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
