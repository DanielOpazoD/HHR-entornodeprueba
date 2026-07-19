#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildPreviewBootstrapProvenance,
  collectPreviewBootstrapEvidenceIssues,
  PREVIEW_BOOTSTRAP_PRODUCER_JOB,
  PREVIEW_BOOTSTRAP_PROVENANCE,
  PREVIEW_BOOTSTRAP_REPORT,
} from './previewBootstrapEvidenceSupport.mjs';

const root = process.cwd();
const gitCommit = () =>
  spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const context = {
  workflow: process.env.GITHUB_WORKFLOW || 'local',
  runId: process.env.GITHUB_RUN_ID || 'local',
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
  commit: process.env.GITHUB_SHA || gitCommit(),
};

if (
  process.env.GITHUB_ACTIONS === 'true' &&
  process.env.GITHUB_JOB !== PREVIEW_BOOTSTRAP_PRODUCER_JOB
) {
  console.error(
    `[preview-bootstrap] Provenance must be written by ${PREVIEW_BOOTSTRAP_PRODUCER_JOB}; ` +
      `received ${process.env.GITHUB_JOB || 'missing'}.`
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(path.join(root, PREVIEW_BOOTSTRAP_REPORT), 'utf8'));
} catch (error) {
  console.error(
    `[preview-bootstrap] Cannot read ${PREVIEW_BOOTSTRAP_REPORT}: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
}

const provenance = buildPreviewBootstrapProvenance(context);
const issues = collectPreviewBootstrapEvidenceIssues({ report, provenance, expected: context });
if (issues.length > 0) {
  console.error('[preview-bootstrap] Refusing to record invalid preview evidence:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

const outputPath = path.join(root, PREVIEW_BOOTSTRAP_PROVENANCE);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`[preview-bootstrap] Wrote ${PREVIEW_BOOTSTRAP_PROVENANCE}.`);
