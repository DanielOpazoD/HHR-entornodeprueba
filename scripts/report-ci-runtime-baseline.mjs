#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const runId = process.argv[2];

if (!runId) {
  console.error('Usage: node scripts/report-ci-runtime-baseline.mjs <github-run-id>');
  process.exit(1);
}

const result = spawnSync(
  'gh',
  [
    'run',
    'view',
    runId,
    '--json',
    'jobs',
    '--jq',
    '.jobs[] | {name, conclusion, startedAt, completedAt, durationSec: ((.completedAt | fromdateiso8601) - (.startedAt | fromdateiso8601))}',
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);

process.exit(result.status ?? 1);
