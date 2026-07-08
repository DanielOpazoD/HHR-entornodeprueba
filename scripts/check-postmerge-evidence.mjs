#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findPostMergeEvidenceIssues } from './postMergeEvidenceSupport.mjs';

const ROOT = process.cwd();
const EVIDENCE_PATH = path.join(ROOT, 'reports/postmerge-evidence.json');
const strictMode =
  process.argv.includes('--strict') || process.env.POSTMERGE_EVIDENCE_STRICT === '1';

const runGit = args => {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
};

const printIssues = (issues, { stream = console.error } = {}) => {
  stream('[postmerge-evidence] Stale or incomplete post-merge evidence found:');
  for (const issue of issues) {
    stream(`- ${issue}`);
  }
  stream('[postmerge-evidence] Refresh with: npm run postmerge:evidence');
};

const warn = issues => {
  printIssues(issues, { stream: console.warn });
  console.warn('[postmerge-evidence] Advisory only. Use --strict for release verification.');
};

const fail = issues => {
  printIssues(issues);
  process.exit(1);
};

const issues = [];

if (!fs.existsSync(EVIDENCE_PATH)) {
  issues.push('reports/postmerge-evidence.json is missing.');
} else {
  try {
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf8'));
    issues.push(
      ...findPostMergeEvidenceIssues({
        evidence,
        currentCommit: runGit(['rev-parse', '--short', 'HEAD']),
      })
    );
  } catch (error) {
    issues.push(
      `reports/postmerge-evidence.json is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

if (issues.length > 0 && strictMode) {
  fail(issues);
}

if (issues.length > 0) {
  warn(issues);
  process.exit(0);
}

console.log('[postmerge-evidence] OK (post-merge evidence matches HEAD and all blocks passed)');
