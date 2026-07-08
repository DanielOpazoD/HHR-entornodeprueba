import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectReleaseEvidenceIssues } from '../../../scripts/check-release-evidence.mjs';

vi.mock('../../../scripts/gitReportState.mjs', () => ({
  formatWorktreeState: (gitDirty: boolean) => (gitDirty ? 'dirty' : 'clean'),
  getGitReportState: () => ({ gitSha: 'abc123', gitDirty: false }),
}));

const tmpRoots: string[] = [];
const trackedReports = [
  'reports/quality-metrics.json',
  'reports/system-confidence.json',
  'reports/operational-health.json',
  'reports/clinical-release-validation.json',
  'reports/clinical-release-signoff.json',
  'reports/release-confidence-matrix.json',
  'reports/release-readiness-scorecard.json',
  'reports/maintenance-debt-scorecard.json',
];
const scenarioIds = ['census_reload_remote_reconcile', 'clinical_documents_pdf_print'];

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
                        { name: 'clinical-release-medical-handoff.png' },
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
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'scripts/config/clinical-release-validation.json'),
    JSON.stringify({
      version: 1,
      closureGates: ['codigo_corregido', 'regresion_automatizada', 'flujo_clinico_validado'],
      scenarios: scenarioIds.map(scenarioId => ({ id: scenarioId })),
    }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'scripts/config/clinical-release-signoff.json'),
    JSON.stringify({
      version: 1,
      releaseCandidate: 'test',
      signoffs: scenarioIds.map(scenarioId => ({
        scenarioId,
        status: 'passed',
        validatedBy: 'QA Clinico',
        validatedAt: '2026-05-16T12:00:00.000Z',
        evidence: [{ type: 'manual', reference: `evidence/${scenarioId}.md` }],
      })),
    }),
    'utf8'
  );

  for (const reportFile of trackedReports) {
    fs.writeFileSync(path.join(root, reportFile), JSON.stringify(reportPayload), 'utf8');
  }
  fs.writeFileSync(
    path.join(root, 'reports/e2e/clinical-visual-release-report.json'),
    JSON.stringify(clinicalVisualReleaseReport),
    'utf8'
  );

  return root;
};

afterEach(() => {
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

  it('blocks release evidence while quality metrics still report flake-risk tests', () => {
    const root = makeRoot({ gitSha: 'abc123', gitDirty: false });
    fs.writeFileSync(
      path.join(root, 'reports/quality-metrics.json'),
      JSON.stringify({
        gitSha: 'abc123',
        gitDirty: false,
        tests: {
          flakeRiskFiles: 2,
          flakeRiskFilePaths: [
            'src/tests/components/layout/date-strip/MedicalIndicationsQuickAction.test.tsx',
            'src/tests/services/storage/dailyRecordConflictSnapshotService.test.ts',
          ],
        },
      }),
      'utf8'
    );

    expect(collectReleaseEvidenceIssues(root)).toContain(
      'reports/quality-metrics.json reports 2 flake-risk test file(s): src/tests/components/layout/date-strip/MedicalIndicationsQuickAction.test.tsx, src/tests/services/storage/dailyRecordConflictSnapshotService.test.ts.'
    );
  });

  it('requires the release confidence matrix to be present in the evidence pack', () => {
    const root = makeRoot({ gitSha: 'abc123', gitDirty: false });
    fs.rmSync(path.join(root, 'reports/release-confidence-matrix.json'));

    expect(collectReleaseEvidenceIssues(root)).toContain(
      'reports/release-confidence-matrix.json is missing.'
    );
  });

  it('blocks release evidence while clinical signoff is pending', () => {
    const root = makeRoot({ gitSha: 'abc123', gitDirty: false });
    fs.writeFileSync(
      path.join(root, 'scripts/config/clinical-release-signoff.json'),
      JSON.stringify({
        version: 1,
        releaseCandidate: 'test',
        signoffs: scenarioIds.map(scenarioId => ({
          scenarioId,
          status: 'pending_human_review',
          validatedBy: '',
          validatedAt: '',
          evidence: [],
        })),
      }),
      'utf8'
    );

    expect(collectReleaseEvidenceIssues(root)).toContain(
      'clinical release signoff: census_reload_remote_reconcile is pending_human_review; release signoff requires passed.'
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
