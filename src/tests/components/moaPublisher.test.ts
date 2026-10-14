// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { exportCatalog } from '../../../scripts/moa/publish-catalog.mjs';
import { parseMoaCatalog } from '@/components/layout/moa/moaCatalog';
let root: string;
let scene: Record<string, unknown>;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'moa-contract-'));
  const pixels = Buffer.alloc(1728 * 168 * 4, 255);
  pixels[3] = 0;
  await sharp(pixels, { raw: { width: 1728, height: 168, channels: 4 } })
    .png()
    .toFile(path.join(root, 'atlas.png'));
  scene = {
    id: 'test',
    title: 'Moa',
    category: 'Tests',
    status: 'approved',
    src: 'atlas.png',
    frames: 6,
    durations: [500, 500, 500, 500, 500, 500],
    cycles: 1,
    still: 0,
  };
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function run() {
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify([scene]));
  return exportCatalog(root, path.join(root, 'export'));
}
describe('Moa publication validation', () => {
  it('exports content-addressed inert data accepted by the actual application contract', async () => {
    const catalog = parseMoaCatalog(await run());
    expect(catalog.scenes).toHaveLength(1);
    const first = catalog.scenes[0];
    expect((await fs.stat(path.join(root, 'export', 'assets', first.sha256 + '.png'))).size).toBe(
      first.bytes
    );
    expect(catalog.scenes[0]).not.toHaveProperty('src');
    expect(catalog.scenes[0]).not.toHaveProperty('status');
    expect((await run()).version).toBe(catalog.version);
  });
  it.each([
    ['status', 'draft'],
    ['frames', 7],
    ['cycles', 20],
    ['durations', [1]],
    ['frameSize', [1024, 1024]],
    ['sha256', 'wrong'],
    ['still', 9],
  ])('rejects invalid %s before publication', async (key, value) => {
    scene[key as string] = value;
    await expect(run()).rejects.toThrow();
  });
  it('rejects a symlink that escapes the source checkout', async () => {
    await fs.symlink('/etc/hosts', path.join(root, 'outside.png'));
    scene.src = 'outside.png';
    await expect(run()).rejects.toThrow('escapes');
  });
  it('rejects an empty transparent atlas', async () => {
    await sharp({
      create: { width: 1728, height: 168, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toFile(path.join(root, 'atlas.png'));
    await expect(run()).rejects.toThrow('empty/opaque');
  });
});
