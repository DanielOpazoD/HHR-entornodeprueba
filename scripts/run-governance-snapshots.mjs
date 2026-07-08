#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildGovernanceSnapshotProfile,
  formatGovernanceSnapshotProfileMarkdown,
  getGovernanceSnapshotSteps,
  GOVERNANCE_SNAPSHOT_PROFILE_BASENAME,
} from './governanceSnapshotSupport.mjs';

const root = process.cwd();
const reportsDir = path.join(root, 'reports');
const startedAt = new Date();
const stepResults = [];

const writeProfile = completedAt => {
  const profile = buildGovernanceSnapshotProfile({
    root,
    startedAt,
    completedAt,
    steps: stepResults,
  });

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, `${GOVERNANCE_SNAPSHOT_PROFILE_BASENAME}.json`),
    `${JSON.stringify(profile, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(reportsDir, `${GOVERNANCE_SNAPSHOT_PROFILE_BASENAME}.md`),
    `${formatGovernanceSnapshotProfileMarkdown(profile)}\n`,
    'utf8'
  );
};

for (const step of getGovernanceSnapshotSteps()) {
  console.log(`::group::${step.command}`);
  const stepStartMs = Date.now();
  const result = spawnSync('npm', ['run', step.command], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - stepStartMs;
  const elapsedSeconds = (durationMs / 1000).toFixed(1);
  console.log(`::endgroup::`);
  console.log(`[governance-snapshots] ${step.command} finished in ${elapsedSeconds}s`);

  stepResults.push({
    id: step.id,
    command: step.command,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status ?? 1,
    durationMs,
    durationSeconds: Number((durationMs / 1000).toFixed(1)),
    artifacts: step.artifacts,
  });

  if (result.status !== 0) {
    writeProfile(new Date());
    process.exit(result.status ?? 1);
  }
}

writeProfile(new Date());
