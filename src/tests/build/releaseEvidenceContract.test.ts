import { describe, expect, it } from 'vitest';

import {
  collectReleaseEvidenceContractIssues,
  getReleaseEvidenceRefreshSteps,
  RELEASE_DECISION_REPORT_IDS,
  RELEASE_EVIDENCE_INVENTORY,
} from '../../../scripts/releaseEvidenceContract.mjs';
import {
  collectBuiltReleaseEvidenceIssues,
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

  it('omits an externally produced report without disturbing the remaining order', () => {
    const steps = getReleaseEvidenceRefreshSteps({ skipReportIds: ['critical-coverage'] });
    const positions = new Map(steps.map((step, index) => [step.id, index]));

    expect(positions.has('critical-coverage')).toBe(false);
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
      gitSha: '11111111',
      gitDirty: true,
      status: 'stale',
      summary: { decisionReports: 10, currentReports: 8, staleReports: 2 },
    };

    expect(
      collectReleaseEvidenceManifestIssues({
        manifest,
        currentGitState: { gitSha: '22222222', gitDirty: false },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('current HEAD'),
        expect.stringContaining('worktree state'),
        expect.stringContaining('every decision report exactly once'),
        expect.stringContaining('10 stale reports'),
      ])
    );
  });

  it('rejects a manifest that claims freshness without the required evidence entries', () => {
    const issues = collectReleaseEvidenceManifestIssues({
      manifest: {
        schemaVersion: 1,
        contractVersion: 1,
        generatedAt: '2026-08-11T12:30:00.000Z',
        gitSha: '22222222',
        gitDirty: false,
        status: 'current',
        summary: { decisionReports: 10, currentReports: 10, staleReports: 0 },
      },
      currentGitState: { gitSha: '22222222', gitDirty: false },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('reports must be an array'),
        expect.stringContaining('every decision report exactly once'),
        expect.stringContaining('inventory must be an array'),
      ])
    );
  });

  it('does not allow a dirty evidence package to authorize a release', () => {
    const refreshSteps = new Map(getReleaseEvidenceRefreshSteps().map(step => [step.id, step]));
    const manifest = {
      schemaVersion: 1,
      contractVersion: 1,
      generatedAt: '2026-08-11T12:30:00.000Z',
      gitSha: '22222222',
      gitDirty: true,
      status: 'stale',
      summary: { decisionReports: 10, currentReports: 10, staleReports: 0 },
      reports: RELEASE_DECISION_REPORT_IDS.map(id => {
        const inventory = RELEASE_EVIDENCE_INVENTORY.find(entry => entry.id === id);
        return {
          id,
          label: inventory?.label,
          artifact: refreshSteps.get(id)?.artifacts.find((file: string) => file.endsWith('.json')),
          generatedAt: '2026-08-11T12:30:00.000Z',
          gitSha: '22222222',
          status: 'current',
        };
      }),
      inventory: RELEASE_EVIDENCE_INVENTORY.map(entry => ({
        ...entry,
        producer: refreshSteps.get(entry.id)?.command,
        artifacts: refreshSteps.get(entry.id)?.artifacts,
      })),
    };

    expect(
      collectReleaseEvidenceManifestIssues({
        manifest,
        currentGitState: { gitSha: '22222222', gitDirty: true },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('dirty worktree'),
        expect.stringContaining('cannot authorize a release'),
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

  it('compares every field in the built runtime contract', () => {
    const manifest = {
      schemaVersion: 1,
      contractVersion: 1,
      generatedAt: '2026-08-11T12:30:00.000Z',
      gitSha: '1234567890abcdef',
      status: 'current',
      summary: { decisionReports: 10, currentReports: 10, staleReports: 0 },
    };
    const runtimeManifest = buildRuntimeReleaseEvidenceManifest(manifest);

    expect(
      collectBuiltReleaseEvidenceIssues({
        runtimeManifest,
        manifest,
        expectedRuntimeManifest: runtimeManifest,
      })
    ).toEqual([]);
    expect(
      collectBuiltReleaseEvidenceIssues({
        runtimeManifest: { ...runtimeManifest, generatedAt: '2026-08-11T12:31:00.000Z' },
        manifest,
        expectedRuntimeManifest: runtimeManifest,
      })
    ).toEqual([expect.stringContaining('complete verified runtime contract')]);
    expect(
      collectBuiltReleaseEvidenceIssues({
        runtimeManifest,
        manifest,
        expectedRuntimeManifest: { ...runtimeManifest, status: 'stale' },
      })
    ).toEqual([expect.stringContaining('runtime source')]);
  });

  it.each(['a', 'not-a-commit'])(
    'rejects an ambiguous or non-hex commit identifier: %s',
    gitSha => {
      const issues = collectReleaseEvidenceManifestIssues({
        manifest: {
          schemaVersion: 1,
          contractVersion: 1,
          gitSha,
          gitDirty: false,
          status: 'current',
          summary: { decisionReports: 0, currentReports: 0, staleReports: 0 },
          reports: [],
          inventory: [],
        },
        currentGitState: { gitSha: 'abcdef12', gitDirty: false },
      });

      expect(issues).toEqual(expect.arrayContaining([expect.stringContaining('current HEAD')]));
    }
  );
});
