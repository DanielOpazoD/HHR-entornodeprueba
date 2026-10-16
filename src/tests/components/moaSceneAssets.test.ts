// @vitest-environment node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { moaScenes } from '@/components/layout/MoaSequence';

describe('Moa illustrated scene assets', () => {
  it('provides six distinct transparent retina frames per scene within a bounded payload', async () => {
    let totalBytes = 0;
    for (const scene of moaScenes) {
      const file = `public/images/moa/moa-${scene}-v2.png`;
      const bytes = (await fs.stat(file)).size;
      totalBytes += bytes;
      expect(bytes, scene).toBeLessThan(300_000);
      const metadata = await sharp(file).metadata();
      expect([metadata.width, metadata.height, metadata.hasAlpha], scene).toEqual([
        1728,
        168,
        true,
      ]);
      const frames = new Set<string>();
      for (let index = 0; index < 6; index++) {
        const frame = sharp(file).extract({ left: index * 288, top: 0, width: 288, height: 168 });
        const stats = await frame.clone().stats();
        const alpha = stats.channels[3];
        expect(alpha.min, `${scene}:${index} transparent margin`).toBe(0);
        expect(alpha.max, `${scene}:${index} visible artwork`).toBeGreaterThan(200);
        frames.add(
          crypto
            .createHash('sha256')
            .update(await frame.raw().toBuffer())
            .digest('hex')
        );
      }
      expect(frames.size, scene).toBe(6);
    }
    expect(totalBytes).toBeLessThan(4 * 1024 * 1024);
  });
});
