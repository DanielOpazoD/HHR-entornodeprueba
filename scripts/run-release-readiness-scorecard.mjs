#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { buildReleaseReadinessPlan, formatReleaseReadinessPlanSummary } from './releaseReadinessRunnerSupport.mjs';
import { getGitReportState } from './gitReportState.mjs';

const root = process.cwd();
const plan = buildReleaseReadinessPlan(root, getGitReportState(root));

console.log(formatReleaseReadinessPlanSummary(plan));

const runNpmScript = command => {
  const result = spawnSync('npm', ['run', command], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status ?? 1;
};

for (const step of plan.steps) {
  if (step.action === 'reuse') {
    console.log(`[release-readiness] Reusing ${step.artifacts.join(', ')} (${step.reason})`);
    continue;
  }

  const status = runNpmScript(step.command);
  if (status !== 0) {
    process.exit(status);
  }
}

const result = spawnSync(process.execPath, ['scripts/report-release-readiness-scorecard.mjs'], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
