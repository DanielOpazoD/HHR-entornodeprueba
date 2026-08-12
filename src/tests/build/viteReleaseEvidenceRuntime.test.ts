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
  it('keeps current evidence when its abbreviated SHA belongs to this build', () => {
    const source = manifest('12345678');

    expect(bindReleaseEvidenceToBuild(source, '1234567890abcdef')).toBe(source);
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
});
