// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectCiArtifactContractIssues } from '../../../scripts/ciArtifactContractSupport.mjs';

const readWorkflow = () =>
  fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8');

describe('final CI confidence evidence', () => {
  it('publishes canonical confidence only after same-run preview and build evidence exist', () => {
    const workflow = readWorkflow();
    const governanceJob = workflow.slice(
      workflow.indexOf('quality-static-governance-snapshots:'),
      workflow.indexOf('quality-static-groups:')
    );
    const finalJob = workflow.slice(
      workflow.indexOf('final-confidence-and-readiness:'),
      workflow.indexOf('lighthouse-ci:')
    );
    const summaryJob = workflow.slice(
      workflow.indexOf('ci-strict-summary:'),
      workflow.indexOf('postmerge-evidence:')
    );
    const previewDownload = finalJob.indexOf('name: preview-bootstrap-artifacts');
    const distDownload = finalJob.indexOf('name: dist');
    const previewValidation = finalJob.indexOf('npm run check:preview-bootstrap-evidence');
    const operationalHealth = finalJob.indexOf('npm run report:operational-health');
    const systemConfidence = finalJob.indexOf('npm run report:system-confidence');
    const releaseReadiness = finalJob.indexOf(
      'npm run report:release-readiness-scorecard:from-current-inputs'
    );
    const freshness = finalJob.indexOf(
      'npm run check:report-freshness:strict -- --only operational-health,system-confidence,release-readiness-scorecard'
    );
    const canonicalUpload = finalJob.indexOf('name: confidence-and-readiness');

    expect(governanceJob).not.toContain('name: confidence-and-readiness');
    expect(finalJob).toContain(
      'needs: [quality-static-governance-snapshots, build, e2e-critical-emulator]'
    );
    expect(previewDownload).toBeGreaterThanOrEqual(0);
    expect(distDownload).toBeGreaterThanOrEqual(0);
    expect(previewValidation).toBeGreaterThan(previewDownload);
    expect(operationalHealth).toBeGreaterThan(previewValidation);
    expect(operationalHealth).toBeGreaterThan(distDownload);
    expect(systemConfidence).toBeGreaterThan(operationalHealth);
    expect(releaseReadiness).toBeGreaterThan(systemConfidence);
    expect(freshness).toBeGreaterThan(releaseReadiness);
    expect(canonicalUpload).toBeGreaterThan(freshness);
    expect(finalJob).toContain('reports/e2e/preview-bootstrap/ci-provenance.json');
    const flowDownload = finalJob.indexOf('name: flow-performance-evidence');
    const flowValidation = finalJob.indexOf('npm run check:flow-performance-budget');
    expect(flowDownload).toBeGreaterThanOrEqual(0);
    expect(flowValidation).toBeGreaterThan(flowDownload);
    expect(operationalHealth).toBeGreaterThan(flowValidation);
    expect(finalJob).toContain(
      'check-playwright-report-clean.mjs reports/e2e/flow-performance-playwright-report.json'
    );
    expect(finalJob).toContain('reports/e2e/flow-performance-budget-summary.json');
    expect(summaryJob).toContain('final-confidence-and-readiness');
    expect(summaryJob).toContain('final-confidence-and-readiness:$FINAL_CONFIDENCE_RESULT');
  });
  it('preserves flow evidence when main regenerates the post-merge reports', () => {
    const workflow = readWorkflow();
    const postmerge = workflow.slice(workflow.indexOf('  postmerge-evidence:'));
    const download = postmerge.indexOf('name: flow-performance-evidence');
    const validate = postmerge.indexOf('npm run check:flow-performance-budget');
    expect(download).toBeGreaterThanOrEqual(0);
    expect(validate).toBeGreaterThan(download);
    expect(postmerge.indexOf('npm run postmerge:evidence')).toBeGreaterThan(validate);
  });

  it('rejects consuming flow evidence without waiting for its producer', () => {
    const workflow = readWorkflow();
    expect(collectCiArtifactContractIssues(workflow)).toEqual([]);
    const unordered = workflow.replace(
      'needs: [quality-static-governance-snapshots, build, e2e-critical-emulator]',
      'needs: [quality-static-governance-snapshots, build]'
    );
    expect(collectCiArtifactContractIssues(unordered)).toContainEqual(
      expect.stringContaining(
        'downloads artifact "flow-performance-evidence" before declaring a needs chain'
      )
    );
  });
});
