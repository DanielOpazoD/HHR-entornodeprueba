import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { Fabricator } = require('firebase-tools/lib/deploy/functions/release/fabricator');

interface SourceScraper {
  getToken(): Promise<string | undefined>;
  poller(operation: { metadata: { target: string; sourceToken: string } }): void;
}

describe('Firebase deployment source isolation', () => {
  it('does not share source tokens between regional or codebase deployment groups', async () => {
    const fabricator = new Fabricator({});
    const groups = [
      { codebase: 'default', region: 'us-central1' },
      { codebase: 'default', region: 'southamerica-east1' },
      { codebase: 'other', region: 'us-central1' },
    ];
    const seen: Array<{
      initialV1: string | undefined;
      initialV2: string | undefined;
      finalV1: string | undefined;
      finalV2: string | undefined;
      expectedV1: string;
      expectedV2: string;
    }> = [];
    vi.spyOn(fabricator, 'applyUpserts').mockImplementation(async (...args: unknown[]) => {
      const [group, v1, v2] = args as [(typeof groups)[number], SourceScraper, SourceScraper];
      const initialV1 = await v1.getToken();
      const initialV2 = await v2.getToken();
      const target = `projects/synthetic/locations/${group.region}/functions/synthetic`;
      const expectedV1 = `v1-${group.codebase}-${group.region}`;
      const expectedV2 = `v2-${group.codebase}-${group.region}`;
      v1.poller({ metadata: { target, sourceToken: expectedV1 } });
      v2.poller({ metadata: { target, sourceToken: expectedV2 } });
      seen.push({
        initialV1,
        initialV2,
        finalV1: await v1.getToken(),
        finalV2: await v2.getToken(),
        expectedV1,
        expectedV2,
      });
      return [];
    });
    vi.spyOn(fabricator, 'applyDeletes').mockResolvedValue([]);
    await fabricator.applyPlan({
      default: {
        regionalChangesets: {
          'default-us-central1-default': groups[0],
          'default-southamerica-east1-default': groups[1],
        },
      },
      other: {
        regionalChangesets: { 'other-us-central1-default': groups[2] },
      },
    });
    expect(seen).toHaveLength(groups.length);
    for (const result of seen) {
      expect(result.initialV1).toBeUndefined();
      expect(result.initialV2).toBeUndefined();
      expect(result.finalV1).toBe(result.expectedV1);
      expect(result.finalV2).toBe(result.expectedV2);
    }
  });
});
