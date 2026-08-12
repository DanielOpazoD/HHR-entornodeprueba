#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { getReleaseEvidenceRefreshSteps } from './releaseEvidenceContract.mjs';

const reportsOnly = process.argv.includes('--reports-only');
const steps = [
  ...(!reportsOnly
    ? [
        // Preview and visual evidence need a production bundle. A final build
        // below embeds the manifest generated from every resulting report.
        { id: 'evidence-input-build', command: 'build' },
        { id: 'preview-bootstrap', command: 'test:e2e:preview:census-bootstrap:built' },
        { id: 'preview-provenance', command: 'write:preview-bootstrap-provenance' },
        { id: 'preview-evidence', command: 'check:preview-bootstrap-evidence' },
        { id: 'clinical-visual-release', command: 'test:e2e:clinical-visual-release' },
      ]
    : []),
  ...getReleaseEvidenceRefreshSteps(),
  { id: 'freshness', command: 'check:report-freshness:strict' },
  { id: 'manifest', command: 'report:release-evidence-contract' },
  { id: 'contract', command: 'check:release-evidence-contract:strict' },
  ...(!reportsOnly ? [{ id: 'release-build', command: 'build' }] : []),
];

for (const step of steps) {
  console.log(`\n[release-evidence] ${step.id}: npm run ${step.command}`);
  const result = spawnSync('npm', ['run', step.command], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\n[release-evidence] Complete (${steps.length} deterministic steps).`);
