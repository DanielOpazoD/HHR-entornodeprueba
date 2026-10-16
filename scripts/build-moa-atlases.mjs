import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Packaging only: preserve the generated artwork and alpha, align a shared stage
// for each six-frame action, and produce retina-size PNG strips.
const sourceDirectory = process.argv[2];
if (!sourceDirectory)
  throw new Error('Usage: node scripts/build-moa-atlases.mjs <source-directory>');
const scenes = [
  'drink',
  'juggle',
  'care',
  'sleep',
  'yawn',
  'pushups',
  'roll',
  'jump',
  'run',
  'wink',
  'love',
  'angry',
  'mother',
  'surf',
  'wave',
  'curious',
  'stroll',
  'happy',
];
const outputDirectory = path.resolve('public/images/moa');
await fs.mkdir(outputDirectory, { recursive: true });
for (const scene of scenes) {
  const input = path.join(sourceDirectory, `${scene}.png`);
  const metadata = await sharp(input).metadata();
  if (metadata.width !== 1536 || metadata.height !== 1024 || !metadata.hasAlpha) {
    throw new Error(`${scene}: expected a transparent 1536x1024 six-cell source`);
  }
  const frames = [];
  const bounds = { left: 512, top: 512, right: 0, bottom: 0 };
  for (let frame = 0; frame < 6; frame++) {
    const png = await sharp(input)
      .extract({
        left: (frame % 3) * 512,
        top: Math.floor(frame / 3) * 512,
        width: 512,
        height: 512,
      })
      .png()
      .toBuffer();
    frames.push(png);
    const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
    let found = false;
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        if (pixels[(y * 512 + x) * 4 + 3] < 64) continue;
        found = true;
        bounds.left = Math.min(bounds.left, x);
        bounds.top = Math.min(bounds.top, y);
        bounds.right = Math.max(bounds.right, x);
        bounds.bottom = Math.max(bounds.bottom, y);
      }
    if (!found) throw new Error(`${scene}: empty frame ${frame}`);
  }
  const crop = {
    left: Math.max(0, bounds.left - 6),
    top: Math.max(0, bounds.top - 6),
    width: 0,
    height: 0,
  };
  crop.width = Math.min(512, bounds.right + 7) - crop.left;
  crop.height = Math.min(512, bounds.bottom + 7) - crop.top;
  const composite = [];
  for (let frame = 0; frame < 6; frame++) {
    const image = await sharp(frames[frame])
      .extract(crop)
      .resize({ width: 276, height: 156, fit: 'inside', kernel: 'nearest' })
      .png()
      .toBuffer();
    const size = await sharp(image).metadata();
    composite.push({
      input: image,
      left: frame * 288 + Math.floor((288 - size.width) / 2),
      top: 162 - size.height,
    });
  }
  const file = path.join(outputDirectory, `moa-${scene}-v2.png`);
  await sharp({ create: { width: 1728, height: 168, channels: 4, background: '#00000000' } })
    .composite(composite)
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`${scene}: ${(await fs.stat(file)).size} bytes, six aligned frames`);
}
