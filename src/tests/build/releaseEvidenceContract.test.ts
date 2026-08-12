import { describe, expect, it } from 'vitest';

import {
  collectReleaseEvidenceContractIssues,
  getReleaseEvidenceRefreshSteps,
  RELEASE_DECISION_REPORT_IDS,
  RELEASE_EVIDENCE_INVENTORY,
} from '../../../scripts/releaseEvidenceContract.mjs';
import {
  buildRuntimeReleaseEvidenceManifest,
  collectReleaseEvidenceManifestIssues,
} from '../../../scripts/releaseEvidenceManifestSupport.mjs';

describe('release evidence contract', () => {
  it('keeps a complete and unique inventory backed by real producers', () => {
    expect(collectReleaseEvidenceContractIssues()).toEqual([]);
    expect(new Set(RELEASE_EVIDENCE_INVENTORY.map(report => report.id)).size).toBe(
      RELEASE_EVIDENCE_INVENTORY.length
    );
    expect(RELEASE_DECISION_REPORT_IDS).toHaveLength(10);
  });

  it('orders every report producer after its report dependencies', () => {
    const steps = getReleaseEvidenceRefreshSteps();
    const positions = new Map(steps.map((step, index) => [step.id, index]));

    expect(positions.get('critical-coverage')).toBeLessThan(
      positions.get('operational-health') as number
    );
    expect(positions.get('operational-health')).toBeLessThan(
      positions.get('system-confidence') as number
    );
    expect(positions.get('system-confidence')).toBeLessThan(
      positions.get('release-readiness-scorecard') as number
    );
  });

  it('fails closed when the manifest does not represent the current clean commit', () => {
    const manifest = {
      schemaVersion: 1,
      contractVersion: 1,
      generatedAt: '2026-08-11T12:30:00.000Z',
      gitSha: 'old-sha',
      gitDirty: true,
      status: 'stale',
      summary: { decisionReports: 10, currentReports: 8, staleReports: 2 },
    };

    expect(
      collectReleaseEvidenceManifestIssues({
        manifest,
        currentGitState: { gitSha: 'current-sha', gitDirty: false },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('current HEAD'),
        expect.stringContaining('worktree state'),
        expect.stringContaining('status is stale'),
        expect.stringContaining('2 stale reports'),
      ])
    );
  });

  it('publishes only the non-sensitive runtime summary', () => {
    const runtimeManifest = buildRuntimeReleaseEvidenceManifest({
      schemaVersion: 1,
      contractVersion: 1,
      generatedAt: '2026-08-11T12:30:00.000Z',
      gitSha: '1234567890abcdef',
      gitDirty: false,
      status: 'current',
      summary: { decisionReports: 10, currentReports: 10, staleReports: 0 },
      reports: [{ id: 'critical-coverage' }],
      inventory: [{ id: 'critical-coverage', owner: 'Quality Engineering' }],
    });

    expect(runtimeManifest).toEqual({
      schemaVersion: 1,
      contractVersion: 1,
      generatedAt: '2026-08-11T12:30:00.000Z',
      gitSha: '1234567890abcdef',
      status: 'current',
      summary: { decisionReports: 10, currentReports: 10, staleReports: 0 },
    });
    expect(runtimeManifest).not.toHaveProperty('reports');
    expect(runtimeManifest).not.toHaveProperty('inventory');
  });
});
