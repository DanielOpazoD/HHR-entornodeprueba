import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPreviewBootstrapProvenance,
  collectPreviewBootstrapEvidenceIssues,
  PREVIEW_BOOTSTRAP_PROVENANCE,
  PREVIEW_BOOTSTRAP_REPORT,
  readPreviewBootstrapEvidence,
} from '../../../scripts/previewBootstrapEvidenceSupport.mjs';

const roots: string[] = [];
const expected = {
  workflow: 'CI/CD Pipeline',
  runId: '123456',
  runAttempt: '2',
  commit: 'abc1234',
};
const healthyReport = {
  stats: {
    expected: 3,
    unexpected: 0,
    flaky: 0,
    skipped: 0,
    duration: 1200,
  },
};

const createRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-bootstrap-evidence-'));
  roots.push(root);
  return root;
};

const writeFile = (root: string, relativePath: string, contents: string) => {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('previewBootstrapEvidenceSupport', () => {
  it('accepts a clean report bound to the expected workflow, attempt and commit', () => {
    expect(
      collectPreviewBootstrapEvidenceIssues({
        report: healthyReport,
        provenance: buildPreviewBootstrapProvenance(expected),
        expected,
      })
    ).toEqual([]);
  });

  it('rejects missing and corrupt evidence files', () => {
    const missing = readPreviewBootstrapEvidence(createRoot());
    expect(missing.issues).toEqual([
      `Preview bootstrap report is missing at ${PREVIEW_BOOTSTRAP_REPORT}.`,
      `Preview bootstrap provenance is missing at ${PREVIEW_BOOTSTRAP_PROVENANCE}.`,
    ]);

    const corruptRoot = createRoot();
    writeFile(corruptRoot, PREVIEW_BOOTSTRAP_REPORT, '{not-json');
    writeFile(corruptRoot, PREVIEW_BOOTSTRAP_PROVENANCE, '{also-not-json');
    const corrupt = readPreviewBootstrapEvidence(corruptRoot);
    expect(corrupt.issues).toHaveLength(2);
    expect(corrupt.issues[0]).toContain('Preview bootstrap report');
    expect(corrupt.issues[0]).toContain('is not valid JSON');
    expect(corrupt.issues[1]).toContain('Preview bootstrap provenance');
    expect(corrupt.issues[1]).toContain('is not valid JSON');
  });

  it.each([
    ['no successful tests', { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }],
    ['unexpected failure', { expected: 2, unexpected: 1, flaky: 0, skipped: 0 }],
    ['interrupted run', { expected: 2, unexpected: 0, flaky: 0, skipped: 0, interrupted: 1 }],
    ['flaky result', { expected: 2, unexpected: 0, flaky: 1, skipped: 0 }],
    ['skipped result', { expected: 2, unexpected: 0, flaky: 0, skipped: 1 }],
  ])('rejects a report with %s', (_label, stats) => {
    const issues = collectPreviewBootstrapEvidenceIssues({
      report: { stats },
      provenance: buildPreviewBootstrapProvenance(expected),
      expected,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Preview bootstrap gate must be ok');
  });

  it.each(['expected', 'unexpected', 'flaky', 'skipped'])(
    'rejects a corrupt %s counter',
    counter => {
      const issues = collectPreviewBootstrapEvidenceIssues({
        report: {
          stats: {
            ...healthyReport.stats,
            [counter]: 'invalid',
          },
        },
        provenance: buildPreviewBootstrapProvenance(expected),
        expected,
      });

      expect(issues).toContain(`Preview bootstrap report has an invalid stats.${counter} counter.`);
    }
  );

  it.each([
    ['workflow.name', { workflow: 'Other workflow' }],
    ['workflow.runId', { runId: '999999' }],
    ['workflow.commit', { commit: 'def5678' }],
  ])('rejects mismatched %s provenance', (field, override) => {
    const provenance = buildPreviewBootstrapProvenance({ ...expected, ...override });
    const issues = collectPreviewBootstrapEvidenceIssues({
      report: healthyReport,
      provenance,
      expected,
    });

    expect(issues.some(issue => issue.includes(`${field} mismatch`))).toBe(true);
  });

  it('accepts an earlier producer attempt when GitHub reruns only failed consumer jobs', () => {
    const provenance = buildPreviewBootstrapProvenance({ ...expected, runAttempt: '1' });

    expect(
      collectPreviewBootstrapEvidenceIssues({ report: healthyReport, provenance, expected })
    ).toEqual([]);
  });

  it('rejects invalid or future producer attempts', () => {
    const invalid = buildPreviewBootstrapProvenance(expected);
    invalid.workflow.producerRunAttempt = 'invalid';
    const future = buildPreviewBootstrapProvenance({ ...expected, runAttempt: '3' });

    expect(
      collectPreviewBootstrapEvidenceIssues({
        report: healthyReport,
        provenance: invalid,
        expected,
      })
    ).toContain('Preview bootstrap provenance workflow.producerRunAttempt must be positive.');
    expect(
      collectPreviewBootstrapEvidenceIssues({ report: healthyReport, provenance: future, expected })
    ).toContain(
      'Preview bootstrap provenance producer attempt 3 cannot be newer than consumer attempt 2.'
    );
  });

  it('rejects an unexpected artifact producer', () => {
    const provenance = buildPreviewBootstrapProvenance(expected);
    provenance.artifact.producerJob = 'other-job';

    expect(
      collectPreviewBootstrapEvidenceIssues({ report: healthyReport, provenance, expected })
    ).toContain(
      'Preview bootstrap provenance artifact.producerJob mismatch: expected build, received other-job.'
    );
  });
});
