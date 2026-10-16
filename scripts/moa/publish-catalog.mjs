/** Publish decorative PNG data only. No app build, workflow, credentials or scripts in the target tree. */
import fs from 'node:fs/promises';
import { mkdtempSync, cpSync, readdirSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPOSITORY = 'https://github.com/DanielOpazoD/Moa-HHR.git';
const BRANCH = 'moa-catalog';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (valid, message) => {
  if (!valid) throw new Error(message);
};

export function serializeCatalog(catalog) {
  const json = JSON.stringify(catalog) + '\n';
  assert(Buffer.byteLength(json) <= 512 * 1024, 'Catalog exceeds 512 KiB');
  return json;
}

export async function exportCatalog(source, output) {
  const root = await fs.realpath(source);
  const original = JSON.parse(await fs.readFile(path.join(root, 'scenes.json'), 'utf8'));
  assert(
    Array.isArray(original) && original.length > 0 && original.length <= 1000,
    'Invalid scene count'
  );
  const ids = new Set();
  const scenes = [];
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  for (const s of original) {
    assert(
      typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.id) && !ids.has(s.id),
      'Invalid or duplicate ID'
    );
    ids.add(s.id);
    assert(['approved', 'preserved'].includes(s.status), `${s.id}: unpublished artwork`);
    assert(
      typeof s.title === 'string' && s.title.length > 0 && s.title.length <= 160,
      'Invalid title'
    );
    assert(typeof s.category === 'string' && s.category.length <= 80, 'Invalid category');
    assert(Number.isInteger(s.frames) && s.frames >= 1 && s.frames <= 64, 'Invalid frames');
    assert(
      Array.isArray(s.durations) &&
        s.durations.length === s.frames &&
        s.durations.every(d => Number.isFinite(d) && d >= 20 && d <= 6000),
      'Invalid timing'
    );
    assert(Number.isInteger(s.cycles) && s.cycles >= 1 && s.cycles <= 8, 'Invalid cycles');
    const duration = s.durations.reduce((a, b) => a + b, 0) * s.cycles;
    assert(duration >= 2999.9 && duration <= 6000.1, 'Animation must last 3–6 seconds');
    assert(Number.isInteger(s.still) && s.still >= 0 && s.still < s.frames, 'Invalid still');
    const size = s.frameSize || [288, 168];
    assert(
      JSON.stringify(size) === '[288,168]' || JSON.stringify(size) === '[576,336]',
      'Unsupported canvas'
    );
    const file = await fs.realpath(path.resolve(root, s.src));
    assert(
      file.startsWith(root + path.sep) && file.endsWith('.png'),
      'Asset escapes source checkout'
    );
    const bytes = await fs.readFile(file);
    assert(bytes.length > 0 && bytes.length <= 4 * 1024 * 1024, 'PNG exceeds 4 MiB');
    const metadata = await sharp(bytes).metadata();
    assert(
      metadata.format === 'png' &&
        metadata.width === size[0] * s.frames &&
        metadata.height === size[1] &&
        metadata.hasAlpha,
      `${s.id}: invalid atlas geometry`
    );
    const stats = await sharp(bytes).stats(); // Decode the complete image before publishing.
    assert(
      stats.channels.at(-1).max > 200 && stats.channels.at(-1).min === 0,
      `${s.id}: empty/opaque artwork`
    );
    const sha256 = hash(bytes);
    assert(!s.sha256 || s.sha256 === sha256, `${s.id}: source hash mismatch`);
    await fs.writeFile(path.join(output, 'assets', `${sha256}.png`), bytes);
    scenes.push({
      id: s.id,
      title: s.title,
      category: s.category,
      frames: s.frames,
      durations: s.durations,
      cycles: s.cycles,
      still: s.still,
      frameSize: size,
      renderMode: s.renderMode === 'smooth' ? 'smooth' : 'pixelated',
      sha256,
      bytes: bytes.length,
    });
  }
  const catalog = { schemaVersion: 1, version: hash(JSON.stringify(scenes)), scenes };
  await fs.writeFile(path.join(output, 'catalog.json'), serializeCatalog(catalog));
  return catalog;
}

export function publishCatalog(output) {
  // A dedicated data branch, with no .github/workflows directory. A normal fast-forward push
  // rejects concurrent publication; never force-push or remove older content-addressed PNGs.
  const temp = mkdtempSync(path.join(os.tmpdir(), 'moa-publish-'));
  const git = (...args) => execFileSync('git', ['-C', temp, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('remote', 'add', 'origin', REPOSITORY);
  git('fetch', '--depth=1', 'origin', BRANCH); // Initial branch is provisioned once, never guessed/reset.
  git('checkout', '-q', '-b', BRANCH, 'FETCH_HEAD');
  for (const name of execFileSync('git', ['-C', temp, 'ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)) {
    assert(
      name === 'catalog.json' || name === 'README.md' || /^assets\/[a-f0-9]{64}\.png$/.test(name),
      'Publication branch contains unexpected files'
    );
  }
  for (const name of readdirSync(path.join(output, 'assets'))) {
    const file = path.join(output, 'assets', name);
    const stat = lstatSync(file);
    assert(
      /^[a-f0-9]{64}\.png$/.test(name) && stat.isFile() && stat.size <= 4 * 1024 * 1024,
      'Export contains unexpected assets'
    );
    assert(hash(readFileSync(file)) === name.slice(0, -4), 'Export asset hash mismatch');
    cpSync(file, path.join(temp, 'assets', name));
  }
  cpSync(path.join(output, 'catalog.json'), path.join(temp, 'catalog.json'));
  git('add', '--', 'assets', 'catalog.json');
  if (!git('diff', '--cached', '--name-only')) return { changed: false, directory: temp };
  git('commit', '-m', 'Publish validated Moa animation catalog');
  git('push', 'origin', `HEAD:refs/heads/${BRANCH}`);
  return { changed: true, directory: temp, commit: git('rev-parse', 'HEAD') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, action] = process.argv.slice(2);
  assert(
    source && output && (!action || action === '--publish'),
    'Usage: node scripts/moa/publish-catalog.mjs ../Moa-HHR /tmp/moa-export [--publish]'
  );
  const catalog = await exportCatalog(source, output);
  console.log(`Validated ${catalog.scenes.length} animations; version ${catalog.version}`);
  if (action === '--publish') console.log(publishCatalog(output));
}
