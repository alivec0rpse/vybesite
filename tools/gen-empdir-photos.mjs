/*
 * Crops each employee photo in src/empdir/photos/<ID>.{jpg,jpeg,png,webp} to a
 * 4:5 portrait and writes it beside that employee's page as photo.webp. Runs
 * after build.js, which has already issued the codes the directory names need
 * and cleared out any page that should no longer exist.
 *
 *   node tools/gen-empdir-photos.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(ROOT, 'src/empdir.json');
if (!existsSync(data)) process.exit(0);

for (const e of JSON.parse(readFileSync(data, 'utf8'))) {
  const src = ['jpg', 'jpeg', 'png', 'webp']
    .map((x) => join(ROOT, 'src/empdir/photos', `${e.id}.${x}`))
    .find(existsSync);
  const page = join(ROOT, 'empdir', `${e.id.toLowerCase()}-${e.code}`);
  if (!src || !e.code || !existsSync(page)) continue;

  const out = join(page, 'photo.webp');
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;

  // 2x the 120x150 it is shown at. `attention` keeps the face in frame when
  // the original is a landscape snapshot rather than a passport photo.
  await sharp(src).rotate().resize(240, 300, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality: 80 }).toFile(out);
  console.log(`  empdir photo: ${e.id}`);
}
