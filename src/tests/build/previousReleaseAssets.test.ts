import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_RETIRED, planReleaseAssets } from '../../../scripts/link-previous-release-assets.mjs';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';
const now = Date.parse('2026-11-05T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const plan = (live: unknown, ownFiles: string[], currentDeployId = C) =>
  planReleaseAssets({ live, ownFiles, currentDeployId, siteName: 'testinghhr', now });
const rule = (file: string, deployId: string) =>
  `/assets/${file}  https://${deployId}--testinghhr.netlify.app/assets/${file}  200`;

describe('each release keeps recent release files reachable in one hop', () => {
  it('sends files the live release had and this one lacks straight to the live deploy', () => {
    const { manifest, rules } = plan({ deployId: B, assets: ['App-old.js', 'shared.js'] }, [
      'App-new.js',
      'shared.js',
      'App-new.js.br',
    ]);
    expect(rules).toEqual([rule('App-old.js', B)]);
    expect(manifest.assets).toEqual(['App-new.js', 'shared.js']);
    expect(manifest.retired).toEqual([
      { file: 'App-old.js', deployId: B, retiredAt: new Date(now).toISOString() },
    ]);
  });

  it('keeps older files pointing to the deploy that holds them, not to a chain', () => {
    const live = {
      deployId: B,
      assets: ['App-b.js'],
      retired: [{ file: 'App-a.js', deployId: A, retiredAt: hoursAgo(5) }],
    };
    expect(plan(live, ['App-c.js']).rules).toEqual([rule('App-b.js', B), rule('App-a.js', A)]);
  });

  it('drops files retired more than seven days ago and files this release has again', () => {
    const live = {
      deployId: B,
      assets: [],
      retired: [
        { file: 'expired.js', deployId: A, retiredAt: hoursAgo(24 * 7 + 1) },
        { file: 'back-again.js', deployId: A, retiredAt: hoursAgo(1) },
      ],
    };
    expect(plan(live, ['back-again.js']).rules).toEqual([]);
  });

  it(`keeps at most ${MAX_RETIRED} retired files, newest first`, () => {
    const retired = Array.from({ length: MAX_RETIRED + 5 }, (_, i) => ({
      file: `chunk-${i}.js`,
      deployId: A,
      retiredAt: hoursAgo(i / 100),
    }));
    const { manifest } = plan({ deployId: B, assets: [], retired }, []);
    expect(manifest.retired).toHaveLength(MAX_RETIRED);
    expect(manifest.retired[0].file).toBe('chunk-0.js');
  });

  it.each([
    ['an unreadable live list', null],
    ['a live list from this same deploy', { deployId: C, assets: ['App-old.js'] }],
    ['a live list without a valid deploy id', { deployId: 'evil.example.com', assets: ['x.js'] }],
    [
      'names that would inject rules',
      { deployId: B, assets: ['x.js  https://evil.example.com/ 200', '../index.html'] },
    ],
  ])('links nothing from %s', (_case, live) => {
    expect(plan(live, ['App-new.js']).rules).toEqual([]);
  });

  it('runs after the build in every Netlify deploy', () => {
    expect(readFileSync('netlify.toml', 'utf8')).toMatch(
      /command = "npm ci && npm run build && node scripts\/link-previous-release-assets\.mjs"/
    );
  });
});
