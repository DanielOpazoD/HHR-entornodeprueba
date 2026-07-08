import { describe, expect, it } from 'vitest';

import {
  buildPostMergeEvidenceSummary,
  buildPostMergeEvidencePayload,
  findPostMergeEvidenceIssues,
  POST_MERGE_EVIDENCE_COMMANDS,
  REQUIRED_POST_MERGE_EVIDENCE_RESULTS,
} from '../../../scripts/postMergeEvidenceSupport.mjs';

describe('postMergeEvidenceSupport', () => {
  it('defines the release evidence commands that must be refreshed after merge', () => {
    expect(POST_MERGE_EVIDENCE_COMMANDS.map(command => command.name)).toEqual([
      'quality-metrics',
      'system-confidence',
      'operational-health',
      'clinical-release-validation',
      'clinical-release-signoff',
      'release-confidence-matrix',
      'release-readiness-scorecard',
      'maintenance-debt-scorecard',
      'report-freshness-strict',
    ]);
  });

  it('builds an executive summary with commit and freshness status', () => {
    const summary = buildPostMergeEvidenceSummary({
      generatedAt: '2026-05-29T12:00:00.000Z',
      branch: 'main',
      commit: 'abc1234',
      results: [
        { name: 'quality-metrics', command: 'npm run report:quality-metrics', status: 'passed' },
        {
          name: 'report-freshness-strict',
          command: 'npm run check:report-freshness:strict',
          status: 'passed',
        },
      ],
    });

    expect(summary).toContain('# Evidencia post-merge');
    expect(summary).toContain('Commit: `abc1234`');
    expect(summary).toContain('Freshness estricta: verde');
    expect(summary).toContain('| quality-metrics | passed |');
  });

  it('builds a post-merge payload with main evidence provenance', () => {
    const payload = buildPostMergeEvidencePayload({
      generatedAt: '2026-07-01T12:00:00.000Z',
      branch: 'main',
      commit: 'abc1234',
      workflow: {
        eventName: 'push',
        runId: '123456',
        runAttempt: '2',
      },
      results: REQUIRED_POST_MERGE_EVIDENCE_RESULTS.map(name => ({
        name,
        command: `npm run ${name}`,
        status: 'passed',
        exitCode: 0,
      })),
    });

    expect(payload.provenance).toMatchObject({
      evidenceKind: 'post-merge-main',
      generatedFor: {
        branch: 'main',
        gitSha: 'abc1234',
      },
      workflow: {
        eventName: 'push',
        runId: '123456',
        runAttempt: '2',
      },
    });
    expect(payload.summary).toMatchObject({
      totalBlocks: REQUIRED_POST_MERGE_EVIDENCE_RESULTS.length,
      passedBlocks: REQUIRED_POST_MERGE_EVIDENCE_RESULTS.length,
      failedBlocks: 0,
      freshnessStrictStatus: 'passed',
    });
  });

  it('detects stale or incomplete post-merge evidence payloads', () => {
    const issues = findPostMergeEvidenceIssues({
      currentCommit: 'def5678',
      evidence: {
        commit: 'abc1234',
        results: REQUIRED_POST_MERGE_EVIDENCE_RESULTS.filter(
          name => name !== 'operational-health'
        ).map(name => ({
          name,
          command: `npm run ${name}`,
          status: name === 'report-freshness-strict' ? 'failed' : 'passed',
        })),
      },
    });

    expect(issues).toContain(
      'reports/postmerge-evidence.json was generated for abc1234, current HEAD is def5678.'
    );
    expect(issues).toContain(
      'reports/postmerge-evidence.json is missing result operational-health.'
    );
    expect(issues).toContain(
      'reports/postmerge-evidence.json records report-freshness-strict as failed.'
    );
  });

  it('accepts complete post-merge evidence for the current commit', () => {
    expect(
      findPostMergeEvidenceIssues({
        currentCommit: 'abc1234',
        evidence: {
          commit: 'abc1234',
          results: REQUIRED_POST_MERGE_EVIDENCE_RESULTS.map(name => ({
            name,
            command: `npm run ${name}`,
            status: 'passed',
          })),
        },
      })
    ).toEqual([]);
  });
});
