/** Read-only, opt-in live verification. Not part of routine clinical CI. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
const base = 'https://raw.githubusercontent.com/DanielOpazoD/Moa-HHR/moa-catalog/';
const response = await fetch(`${base}catalog.json`, { signal: AbortSignal.timeout(15000) });
if (!response.ok || response.headers.get('access-control-allow-origin') !== '*')
  throw new Error('Catalog HTTP/CORS failed');
const catalog = await response.json();
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.scenes) || catalog.scenes.length > 1000)
  throw new Error('Invalid catalog');
let next = 0;
const results = [];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < catalog.scenes.length) {
      const s = catalog.scenes[next++];
      if (!/^[a-f0-9]{64}$/.test(s.sha256)) throw new Error('Invalid digest');
      const r = await fetch(`${base}assets/${s.sha256}.png`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok || r.headers.get('access-control-allow-origin') !== '*')
        throw new Error(`${s.id}: HTTP/CORS`);
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length !== s.bytes || crypto.createHash('sha256').update(b).digest('hex') !== s.sha256)
        throw new Error(`${s.id}: hash/size`);
      const metadata = await sharp(b).metadata();
      await sharp(b).stats();
      if (
        metadata.width !== s.frames * s.frameSize[0] ||
        metadata.height !== s.frameSize[1] ||
        !metadata.hasAlpha
      )
        throw new Error(`${s.id}: geometry`);
      results.push({ id: s.id, bytes: b.length, frames: s.frames, decoded: true });
    }
  })
);
const report = {
  version: catalog.version,
  verifiedAt: new Date().toISOString(),
  animations: results.length,
  frames: results.reduce((sum, s) => sum + s.frames, 0),
  bytes: results.reduce((sum, s) => sum + s.bytes, 0),
  results,
};
if (process.argv[2]) await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, results: undefined }));
