#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildQualityProfile,
  getQualityGroupNames,
  selectQualitySteps,
  writeQualityProfileFiles,
} from './qualityAggregateSupport.mjs';

const ROOT = process.cwd();
const GOVERNANCE_CONFIG_PATH = path.join(ROOT, 'scripts/config/guardrail-governance.json');

const readArgValue = flag => {
  const flagIndex = process.argv.indexOf(flag);
  if (flagIndex === -1) {
    return '';
  }
  return process.argv[flagIndex + 1] || '';
};

const requestedGroup = readArgValue('--group');
if (process.argv.includes('--group') && !requestedGroup) {
  console.error(
    `[quality] --group flag requires a value. Expected one of: ${getQualityGroupNames().join(', ')}`
  );
  process.exit(1);
}

const runGit = args => {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
};

if (!fs.existsSync(GOVERNANCE_CONFIG_PATH)) {
  console.error('[quality] Missing scripts/config/guardrail-governance.json');
  process.exit(1);
}

const governanceConfig = JSON.parse(fs.readFileSync(GOVERNANCE_CONFIG_PATH, 'utf8'));
const QUALITY_STEPS = Array.isArray(governanceConfig.qualityAggregate?.checks)
  ? governanceConfig.qualityAggregate.checks.filter(entry => entry?.id)
  : [];

if (QUALITY_STEPS.length === 0) {
  console.error('[quality] qualityAggregate.checks is empty in guardrail-governance.json');
  process.exit(1);
}

let selectedSteps;
try {
  selectedSteps = selectQualitySteps(QUALITY_STEPS, { group: requestedGroup });
} catch (error) {
  console.error(`[quality] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (selectedSteps.length === 0) {
  console.error(
    requestedGroup
      ? `[quality] No quality checks mapped to group "${requestedGroup}".`
      : '[quality] No quality checks selected.'
  );
  process.exit(1);
}

if (requestedGroup) {
  console.log(
    `[quality] Running group "${requestedGroup}" (${selectedSteps.length} checks). Available groups: ${getQualityGroupNames().join(', ')}`
  );
}

const failures = [];
const advisoryFailures = [];
const results = [];
const startedAt = new Date().toISOString();

for (const entry of selectedSteps) {
  const step = entry.id;
  const isReportOnly = entry.reportOnly === true;
  const label = isReportOnly ? `${step} (advisory)` : step;
  console.log(`\n[quality] Running ${label}`);
  const stepStartedAt = Date.now();
  const result = spawnSync('npm', ['run', step], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - stepStartedAt;
  const status = result.status === 0 ? 'passed' : 'failed';

  results.push({
    id: step,
    group: entry.group,
    status,
    durationMs,
    reportOnly: isReportOnly,
  });

  if (status === 'failed') {
    if (isReportOnly) {
      advisoryFailures.push(step);
    } else {
      failures.push(step);
    }
  }
}

if (advisoryFailures.length > 0) {
  console.warn('\n[quality] Advisory (non-blocking) steps reporting issues:');
  for (const step of advisoryFailures) {
    console.warn(`- ${step}`);
  }
}

if (failures.length > 0) {
  console.error('\n[quality] Failing steps:');
  for (const step of failures) {
    console.error(`- ${step}`);
  }
}

const profile = buildQualityProfile({
  scope: requestedGroup || 'all',
  gitSha: runGit(['rev-parse', '--short', 'HEAD']),
  startedAt,
  completedAt: new Date().toISOString(),
  results,
});
const writtenProfile = writeQualityProfileFiles(profile, { root: ROOT });
console.log(
  `\n[quality] Profile written: ${path.relative(ROOT, writtenProfile.jsonPath)} and ${path.relative(
    ROOT,
    writtenProfile.mdPath
  )}`
);

if (failures.length > 0) {
  process.exit(1);
}

console.log(
  advisoryFailures.length > 0
    ? '\n[quality] All blocking checks passed (with advisories above).'
    : '\n[quality] All checks passed.'
);
