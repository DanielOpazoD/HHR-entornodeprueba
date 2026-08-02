import { describe, expect, it } from 'vitest';
import {
  buildReleaseConfidenceMatrixReport,
  formatReleaseConfidenceMatrixMarkdown,
} from '../../../scripts/releaseConfidenceMatrixSupport.mjs';

describe('releaseConfidenceMatrixSupport', () => {
  it('declares git state in JSON and markdown release evidence', () => {
    const report = buildReleaseConfidenceMatrixReport(process.cwd());
    const markdown = formatReleaseConfidenceMatrixMarkdown(report);

    expect(report.gitSha).toEqual(expect.any(String));
    expect(report.gitSha).not.toBe('');
    expect(report.gitDirty).toEqual(expect.any(Boolean));
    expect(markdown).toContain(`Commit: ${report.gitSha}`);
    expect(markdown).toContain(`Worktree: ${report.gitDirty ? 'dirty' : 'clean'}`);
  });

  it('maps every governed release signal to an accountable area', () => {
    const report = buildReleaseConfidenceMatrixReport(process.cwd());

    expect(report.overall).toBe('ok');
    expect(report.issues).toEqual([]);
    expect(report.flowBudgets.unmapped).toEqual([]);
    expect(report.flowBudgets.mapped).toBe(report.counts.flowBudgets);
  });
});
