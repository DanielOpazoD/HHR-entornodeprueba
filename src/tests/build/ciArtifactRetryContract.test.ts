// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectCiArtifactContractIssues } from '../../../scripts/ciArtifactContractSupport.mjs';

const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8');

describe('CI artifact retry contract', () => {
  it('replaces stale build artifacts and fails when the new output is missing', () => {
    const stalePreview = workflow.replace(
      'retention-days: 14\n          if-no-files-found: error\n          overwrite: true',
      'retention-days: 14\n          if-no-files-found: error\n          overwrite: false'
    );
    const staleDist = workflow.replace(
      'retention-days: 7\n          if-no-files-found: error\n          overwrite: true',
      'retention-days: 7\n          if-no-files-found: error\n          overwrite: false'
    );
    const missingPreview = workflow.replace(
      'retention-days: 14\n          if-no-files-found: error',
      'retention-days: 14\n          if-no-files-found: warn'
    );
    const missingDist = workflow.replace(
      'retention-days: 7\n          if-no-files-found: error',
      'retention-days: 7\n          if-no-files-found: warn'
    );

    expect(collectCiArtifactContractIssues(workflow)).toEqual([]);
    expect(collectCiArtifactContractIssues(stalePreview)).toContain(
      'build: preview bootstrap upload must replace an artifact from an earlier run attempt.'
    );
    expect(collectCiArtifactContractIssues(staleDist)).toContain(
      'build: dist upload must replace an artifact from an earlier run attempt.'
    );
    expect(collectCiArtifactContractIssues(missingPreview)).toContain(
      'build: preview bootstrap upload must fail when new evidence is missing.'
    );
    expect(collectCiArtifactContractIssues(missingDist)).toContain(
      'build: dist upload must fail when the new build is missing.'
    );
  });
});
