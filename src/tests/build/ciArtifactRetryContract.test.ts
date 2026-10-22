// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectArtifactUploads,
  collectCiArtifactContractIssues,
  parseWorkflowJobs,
} from '../../../scripts/ciArtifactContractSupport.mjs';

const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8');
const mutateArtifact = (name: string, before: string, after: string) => {
  const artifact = collectArtifactUploads(parseWorkflowJobs(workflow)).find(
    upload => upload.name === name
  );
  if (!artifact) throw new Error(`Missing artifact: ${name}`);
  expect(artifact.block).toContain(before);
  return workflow.replace(artifact.block, artifact.block.replace(before, after));
};

describe('CI artifact retry contract', () => {
  it('replaces stale build artifacts and fails when the new output is missing', () => {
    const stalePreview = mutateArtifact(
      'preview-bootstrap-artifacts',
      'overwrite: true',
      'overwrite: false'
    );
    const staleDist = mutateArtifact('dist', 'overwrite: true', 'overwrite: false');
    const missingPreview = mutateArtifact(
      'preview-bootstrap-artifacts',
      'if-no-files-found: error',
      'if-no-files-found: warn'
    );
    const missingDist = mutateArtifact(
      'dist',
      'if-no-files-found: error',
      'if-no-files-found: warn'
    );

    expect(collectCiArtifactContractIssues(workflow)).toEqual([]);
    expect(collectCiArtifactContractIssues(stalePreview)).toContain(
      'preview-smoke: preview bootstrap upload must replace an artifact from an earlier run attempt.'
    );
    expect(collectCiArtifactContractIssues(staleDist)).toContain(
      'build: dist upload must replace an artifact from an earlier run attempt.'
    );
    expect(collectCiArtifactContractIssues(missingPreview)).toContain(
      'preview-smoke: preview bootstrap upload must fail when new evidence is missing.'
    );
    expect(collectCiArtifactContractIssues(missingDist)).toContain(
      'build: dist upload must fail when the new build is missing.'
    );
  });
});
