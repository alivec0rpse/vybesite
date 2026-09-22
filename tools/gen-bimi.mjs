/*
 * logo.svg — the BIMI mark, served from the site root.
 *
 * BIMI does not accept ordinary SVG. The profile is SVG Tiny Portable/Secure
 * (SVG 1.2 Tiny with `baseProfile="tiny-ps"`): square viewBox, a <title>, no
 * width/height on the root, no script, no raster <image>, no external
 * references, nothing animated, and under 32KB. So the mark has to be real
 * vector geometry, and src/logos/vybe-logo.png is a bitmap — potrace turns it
 * into one path, which is then baked into the icon's coordinate space so the
 * output carries no transform for a validator to argue with.
 *
 * Geometry matches assets/icon-maskable-512.png: mailbox providers (Gmail
 * especially) crop the BIMI avatar to a circle, so the wordmark sits inside
 * the same 80% safe zone the Android maskable icon uses.
 *
 * Usage: node tools/gen-bimi.mjs
 */
import sharp from 'sharp';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Potrace } from 'potrace';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/') + '/../';
const S = ROOT + 'src/logos/';

const SIZE = 512;
const PAD = 0.155; // as in gen-images.mjs, the circle-safe padding
const BRAND = '#e31837';
const TITLE = 'Vybe Technologies';

/* 1. Trim the transparent margin so the mark centres true, then flatten to the
 *    black-on-white bitmap potrace wants. The mark is white-on-transparent, so
 *    its shape lives in the alpha channel and nowhere else. */
const trimmed = await sharp(S + 'vybe-logo.png').trim().toBuffer();
const { width, height } = await sharp(trimmed).metadata();
const bitmap = await sharp(trimmed)
  .ensureAlpha()
  .extractChannel('alpha') // opaque = 255
  .negate() //          -> mark 0 (black), background 255 (white)
  .threshold(128)
  .png()
  .toBuffer();

/* 2. Trace. turdSize drops stray specks from the PNG's antialiased edge;
 *    optTolerance is loose enough to keep the path short but not so loose that
 *    the deliberately rough letterforms get smoothed into something else. */
const tracer = new Potrace({
  threshold: 128,
  turdSize: 4,
  alphaMax: 1,
  optCurve: true,
  optTolerance: 0.2,
});
const pathTag = await new Promise((resolve, reject) => {
  tracer.loadImage(bitmap, (err) => (err ? reject(err) : resolve(tracer.getPathTag())));
});
const traced = /\sd="([^"]+)"/.exec(pathTag);
if (!traced) throw new Error('potrace returned no path data');

/* 3. potrace emits coordinates in source-pixel space. Scale that box into the
 *    padded square and rewrite every coordinate, rather than wrapping the path
 *    in a <g transform>. */
const inner = SIZE * (1 - PAD * 2);
const scale = Math.min(inner / width, inner / height);
const tx = (SIZE - width * scale) / 2;
const ty = (SIZE - height * scale) / 2;

/** Which coordinate each argument of a path command is: 0 = x, 1 = y. */
const ARGS = {
  M: [0, 1], L: [0, 1], T: [0, 1], H: [0], V: [1],
  C: [0, 1, 0, 1, 0, 1], S: [0, 1, 0, 1], Q: [0, 1, 0, 1],
};
const num = (v) => String(Math.round(v * 100) / 100);

function bake(d) {
  let out = '';
  for (const [, cmd, rest] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const key = cmd.toUpperCase();
    if (key === 'Z') {
      out += 'Z';
      continue;
    }
    const axes = ARGS[key];
    if (!axes) throw new Error(`unexpected path command ${cmd}`);
    const values = rest.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    const moved = values.map((raw, i) => {
      const axis = axes[i % axes.length];
      const v = Number(raw) * scale;
      // A relative command is a delta: it scales, but must not be translated.
      return num(cmd === key ? v + (axis ? ty : tx) : v);
    });
    out += cmd + moved.join(' ').replace(/ -/g, '-');
  }
  return out;
}

const d = bake(traced[1]);

/* 4. Emit. Attribute order and the leading <title> are both part of the
 *    profile: the title must be the first child of the root element. */
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 ${SIZE} ${SIZE}">
<title>${TITLE}</title>
<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BRAND}"/>
<path fill="#ffffff" fill-rule="evenodd" d="${d}"/>
</svg>
`;

fs.writeFileSync(ROOT + 'logo.svg', svg);

const bytes = Buffer.byteLength(svg);
if (bytes > 32 * 1024) throw new Error(`logo.svg is ${bytes} bytes; BIMI caps the file at 32KB`);
console.log(`logo.svg ${bytes} bytes (source mark ${width}x${height})`);
