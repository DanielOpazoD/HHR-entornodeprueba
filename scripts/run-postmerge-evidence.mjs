#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildPostMergeEvidencePayload,
  buildPostMergeEvidenceSummary,
  collectPostMergeEvidenceContractIssues,
  POST_MERGE_EVIDENCE_COMMANDS,
} from './postMergeEvidenceSupport.mjs';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const JSON_OUTPUT = path.join(REPORTS_DIR, 'postmerge-evidence.json');
const MD_OUTPUT = path.join(REPORTS_DIR, 'postmerge-evidence.md');

const git = args => {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
};

const runCommand = ({ name, command }) => {
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });

  return {
    name,
    command,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status ?? 1,
  };
};

fs.mkdirSync(REPORTS_DIR, { recursive: true });

const contractIssues = collectPostMergeEvidenceContractIssues();
if (contractIssues.length > 0) {
  console.error('[postmerge-evidence] Invalid freshness contract:');
  for (const issue of contractIssues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

const results = POST_MERGE_EVIDENCE_COMMANDS.map(runCommand);
const payload = buildPostMergeEvidencePayload({
  generatedAt: new Date().toISOString(),
  branch: git(['branch', '--show-current']),
  commit: git(['rev-parse', '--short', 'HEAD']),
  workflow: {
    eventName: process.env.GITHUB_EVENT_NAME,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  },
  results,
});

fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
fs.writeFileSync(MD_OUTPUT, buildPostMergeEvidenceSummary(payload));

if (results.some(result => result.status !== 'passed')) {
  process.exitCode = 1;
}
