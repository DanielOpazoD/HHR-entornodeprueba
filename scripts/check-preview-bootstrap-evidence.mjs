#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import { getReusedEvidenceSource } from './gitReportState.mjs';
import {
  collectPreviewBootstrapEvidenceIssues,
  readPreviewBootstrapEvidence,
} from './previewBootstrapEvidenceSupport.mjs';

const root = process.cwd();
const gitCommit = () =>
  spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
// A main push that reuses a pull request run checks that run's preview evidence: its
// producer may not be newer than that run's latest attempt.
const reusedEvidence = getReusedEvidenceSource(root);
const expected = {
  workflow: process.env.GITHUB_WORKFLOW || 'local',
  runId: reusedEvidence?.runId || process.env.GITHUB_RUN_ID || 'local',
  runAttempt: reusedEvidence?.runAttempt || process.env.GITHUB_RUN_ATTEMPT || '1',
  commit: reusedEvidence?.commit || process.env.GITHUB_SHA || gitCommit(),
};
const evidence = readPreviewBootstrapEvidence(root);
const issues = [
  ...evidence.issues,
  ...(evidence.issues.length === 0
    ? collectPreviewBootstrapEvidenceIssues({
        report: evidence.report,
        provenance: evidence.provenance,
        expected,
      })
    : []),
];

if (issues.length > 0) {
  console.error('[preview-bootstrap] Invalid or incomplete post-merge preview evidence:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(
  `[preview-bootstrap] Evidence is valid for ${expected.workflow} run ${expected.runId} ` +
    `attempt ${expected.runAttempt} at ${expected.commit}.`
);
