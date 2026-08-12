import { describe, expect, it } from 'vitest';

import { bindReleaseEvidenceToBuild } from '../../../scripts/config/releaseEvidenceRuntimeAsset';

const manifest = (gitSha: string, status: 'current' | 'stale' = 'current') =>
  JSON.stringify({
    schemaVersion: 1,
    contractVersion: 1,
    generatedAt: '2026-08-12T12:00:00.000Z',
    gitSha,
    status,
    summary: { decisionReports: 10, currentReports: 10, staleReports: 0 },
  });

describe('Vite release evidence runtime asset', () => {
  it('compares full SHAs directly when Git metadata is unavailable', () => {
    const fullGitSha = `12345678${'90abcdef'.repeat(4)}`;
    const source = manifest(fullGitSha);

    expect(
      bindReleaseEvidenceToBuild(source, fullGitSha, () => {
        throw new Error('Git metadata is unavailable');
      })
    ).toBe(source);
  });

  it('keeps current evidence when its SHA resolves exactly to this build', () => {
    const source = manifest('12345678');
    const fullGitSha = `12345678${'90abcdef'.repeat(4)}`;

    expect(bindReleaseEvidenceToBuild(source, fullGitSha, () => fullGitSha)).toBe(source);
  });

  it('marks persisted current evidence as stale when it belongs to another build', () => {
    const result = JSON.parse(bindReleaseEvidenceToBuild(manifest('11111111'), '22222222'));

    expect(result).toMatchObject({
      gitSha: '11111111',
      status: 'stale',
      summary: { decisionReports: 10, currentReports: 0, staleReports: 10 },
    });
  });

  it('fails closed when the build SHA is unavailable', () => {
    const result = JSON.parse(bindReleaseEvidenceToBuild(manifest('11111111'), ''));

    expect(result.status).toBe('stale');
  });

  it('rejects different commits that share the same abbreviated prefix', () => {
    const buildGitSha = `12345678${'0'.repeat(32)}`;
    const evidenceGitSha = `12345678${'f'.repeat(32)}`;
    const result = JSON.parse(
      bindReleaseEvidenceToBuild(manifest('12345678'), buildGitSha, () => evidenceGitSha)
    );

    expect(result.status).toBe('stale');
  });
});
