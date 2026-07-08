#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildCiRuntimeObservedProfile,
  compareEstimatedAndObservedRuntime,
  formatCiRuntimeObservedProfileMarkdown,
} from './ciRuntimeTelemetrySupport.mjs';
import { getGitReportState } from './gitReportState.mjs';

const DEFAULT_INPUT_PATH = 'reports/ci-runtime-observed-input.json';
const ESTIMATED_PROFILE_PATH = 'reports/unit-shard-runtime-profile.json';
const OUTPUT_JSON_PATH = 'reports/ci-runtime-observed-profile.json';
const OUTPUT_MD_PATH = 'reports/ci-runtime-observed-profile.md';

const root = process.cwd();

const readJsonIfExists = relativePath => {
  const filePath = path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${relativePath} JSON: ${error.message}`);
  }
};

const readObservedJobsInput = input => {
  if (input === null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'object' && Array.isArray(input.jobs)) return input.jobs;
  throw new Error('CI runtime observed input must be an array of jobs or an object with a jobs array.');
};

const readObservedInputSource = input => {
  if (input && typeof input === 'object' && !Array.isArray(input) && typeof input.source === 'object') {
    return input.source;
  }
  return {};
};

const inputArgIndex = process.argv.findIndex(arg => arg === '--input');
const inputPath =
  inputArgIndex >= 0 && process.argv[inputArgIndex + 1]
    ? process.argv[inputArgIndex + 1]
    : process.env.CI_RUNTIME_OBSERVED_INPUT || DEFAULT_INPUT_PATH;

try {
  const input = readJsonIfExists(inputPath);
  const jobs = readObservedJobsInput(input);
  const inputSource = readObservedInputSource(input);
  const estimatedProfile = readJsonIfExists(ESTIMATED_PROFILE_PATH);
  const profile = {
    ...buildCiRuntimeObservedProfile({
      jobs,
      tolerancePercent: estimatedProfile?.summary?.tolerancePercent || 25,
    }),
    generatedAt: new Date().toISOString(),
    ...getGitReportState(root),
    source: {
      ...inputSource,
      inputPath,
      hasInput: Boolean(input),
    },
  };

  const comparison = compareEstimatedAndObservedRuntime({
    estimatedProfile,
    observedProfile: profile,
  });
  const report = {
    ...profile,
    comparison,
  };

  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, OUTPUT_JSON_PATH), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(root, OUTPUT_MD_PATH), formatCiRuntimeObservedProfileMarkdown(report), 'utf8');

  console.log('[ci-runtime-observed-profile] Report generated at reports/ci-runtime-observed-profile.{json,md}');
} catch (error) {
  console.error(`[ci-runtime-observed-profile] ${error.message}`);
  process.exit(1);
}
