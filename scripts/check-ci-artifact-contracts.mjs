#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectCiArtifactContractIssues } from './ciArtifactContractSupport.mjs';

const ROOT = process.cwd();
const DEFAULT_WORKFLOW_PATH = '.github/workflows/ci-cd.yml';

const readArgValue = (flag, fallback = '') => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
};

const workflowPath = readArgValue('--workflow', DEFAULT_WORKFLOW_PATH);
const absoluteWorkflowPath = path.join(ROOT, workflowPath);

if (!fs.existsSync(absoluteWorkflowPath)) {
  console.error(`[ci-artifacts] Missing workflow file: ${workflowPath}`);
  process.exit(1);
}

const workflow = fs.readFileSync(absoluteWorkflowPath, 'utf8');
const issues = collectCiArtifactContractIssues(workflow);

if (issues.length > 0) {
  console.error('[ci-artifacts] Invalid GitHub Actions artifact contract:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  console.error(
    '[ci-artifacts] Artifact consumers must depend on producer jobs, and dist must be uploaded by the job that runs npm run build.'
  );
  process.exit(1);
}

console.log(`[ci-artifacts] OK (${workflowPath})`);
