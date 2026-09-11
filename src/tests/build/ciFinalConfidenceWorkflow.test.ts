import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(finalJob).toContain('needs: [quality-static-governance-snapshots, build]');
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
    expect(summaryJob).toContain('final-confidence-and-readiness');
    expect(summaryJob).toContain('final-confidence-and-readiness:$FINAL_CONFIDENCE_RESULT');
  });
});
