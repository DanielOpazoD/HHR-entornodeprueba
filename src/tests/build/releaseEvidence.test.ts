// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectReleaseEvidenceIssues } from '../../../scripts/check-release-evidence.mjs';

vi.mock('../../../scripts/gitReportState.mjs', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../scripts/gitReportState.mjs')>()),
  formatWorktreeState: (gitDirty: boolean) => (gitDirty ? 'dirty' : 'clean'),
  getGitReportState: () => ({ gitSha: 'abc123', gitDirty: false }),
}));

const tmpRoots: string[] = [];
const trackedReports = [
  'reports/quality-metrics.json',
  'reports/system-confidence.json',
  'reports/operational-health.json',
  'reports/release-confidence-matrix.json',
  'reports/release-readiness-scorecard.json',
];

const clinicalVisualReleaseReport = {
  stats: {
    expected: 1,
    unexpected: 0,
    flaky: 0,
  },
  errors: [],
  suites: [
    {
      title: 'clinical-release-visual-smoke.spec.ts',
      file: 'clinical-release-visual-smoke.spec.ts',
      specs: [],
      suites: [
        {
          title: 'Clinical release visual smoke',
          file: 'clinical-release-visual-smoke.spec.ts',
          specs: [
            {
              title: 'creates release-critical clinical surfaces without layout overflow',
              file: 'clinical-release-visual-smoke.spec.ts',
              tests: [
                {
                  expectedStatus: 'passed',
                  results: [
                    {
                      status: 'passed',
                      attachments: [
                        { name: 'clinical-release-census.png' },
                        { name: 'clinical-release-census-after-refresh.png' },
                        { name: 'clinical-release-census-excel-download.json' },
                        { name: 'clinical-release-documents.png' },
                        { name: 'clinical-release-documents-mobile.png' },
                        { name: 'clinical-release-cudyr.png' },
                        { name: 'clinical-release-cudyr-mobile.png' },
                        { name: 'clinical-release-cudyr-excel-download.json' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const makeRoot = (reportPayload: Record<string, unknown>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-evidence-'));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports/e2e'), { recursive: true });

  for (const reportFile of trackedReports) {
    const payload =
      reportFile === 'reports/system-confidence.json'
        ? { flakeRisk: { measured: true, fileCount: 0, files: [] }, ...reportPayload }
        : reportPayload;
    fs.writeFileSync(path.join(root, reportFile), JSON.stringify(payload), 'utf8');
  }
  fs.writeFileSync(
    path.join(root, 'reports/e2e/clinical-visual-release-report.json'),
    JSON.stringify(clinicalVisualReleaseReport),
    'utf8'
  );

  return root;
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('release evidence guardrail', () => {
  it('accepts reports without dirty release evidence markers', () => {
    const root = makeRoot({ gitSha: 'abc123', gitDirty: false });

    expect(collectReleaseEvidenceIssues(root)).toEqual([]);
  });

  it('rejects reports generated from a dirty checkout', () => {
    const root = makeRoot({ gitSha: 'abc123', gitDirty: true });

    expect(collectReleaseEvidenceIssues(root)).toContain(
      'reports/quality-metrics.json was generated with worktree=dirty.'
    );
  });

  it('blocks release evidence on test files that really failed or needed a retry', () => {
    const root = makeRoot({
      gitSha: 'abc123',
      gitDirty: false,
      flakeRisk: {
        measured: true,
        fileCount: 2,
        files: [
          { file: 'e2e/login.spec.ts', failed: 0, retried: 1 },
          { file: 'src/tests/timer.test.ts', failed: 1, retried: 0 },
        ],
      },
    });

    expect(collectReleaseEvidenceIssues(root)).toContain(
      'reports/system-confidence.json reports 2 test file(s) that failed or needed a retry: e2e/login.spec.ts, src/tests/timer.test.ts.'
    );
  });

  it('blocks release evidence while flake risk is unmeasured', () => {
    const root = makeRoot({
      gitSha: 'abc123',
      gitDirty: false,
      flakeRisk: { measured: false, reason: 'missing reports/test-execution-manifest.json' },
    });

    expect(collectReleaseEvidenceIssues(root)).toContain(
      "reports/system-confidence.json has unmeasured flake risk (missing reports/test-execution-manifest.json); regenerate it with reports/test-execution-manifest.json from this commit's CI run."
    );
  });

  it('does not block release evidence on informative clock or timer calls in tests', () => {
    const root = makeRoot({
      gitSha: 'abc123',
      gitDirty: false,
      tests: { clockSignalFiles: 1, clockSignalFilePaths: ['src/tests/timer.test.ts'] },
    });

    expect(collectReleaseEvidenceIssues(root)).toEqual([]);
  });

  it('requires the release confidence matrix to be present in the evidence pack', () => {
    const root = makeRoot({ gitSha: 'abc123', gitDirty: false });
    fs.rmSync(path.join(root, 'reports/release-confidence-matrix.json'));

    expect(collectReleaseEvidenceIssues(root)).toContain(
      'reports/release-confidence-matrix.json is missing.'
    );
  });

  it('requires dedicated clinical visual release evidence', () => {
    const root = makeRoot({ gitSha: 'abc123', gitDirty: false });
    fs.rmSync(path.join(root, 'reports/e2e/clinical-visual-release-report.json'));

    expect(collectReleaseEvidenceIssues(root)).toContain(
      'reports/e2e/clinical-visual-release-report.json is missing.'
    );
  });

  it('rejects failed clinical visual release evidence', () => {
    const root = makeRoot({ gitSha: 'abc123', gitDirty: false });
    fs.writeFileSync(
      path.join(root, 'reports/e2e/clinical-visual-release-report.json'),
      JSON.stringify({
        ...clinicalVisualReleaseReport,
        stats: { expected: 0, unexpected: 1, flaky: 0 },
      }),
      'utf8'
    );

    expect(collectReleaseEvidenceIssues(root)).toContain(
      'reports/e2e/clinical-visual-release-report.json has unexpected or flaky failures.'
    );
  });
});
