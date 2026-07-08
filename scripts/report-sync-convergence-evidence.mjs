#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildSyncConvergenceEvidenceReport,
  formatSyncConvergenceEvidenceReport,
} from './syncConvergenceEvidenceSupport.mjs';

const ROOT = process.cwd();
const report = buildSyncConvergenceEvidenceReport(ROOT);
const reportDir = path.join(ROOT, 'reports');

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(
  path.join(reportDir, 'sync-convergence.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(reportDir, 'sync-convergence.md'),
  formatSyncConvergenceEvidenceReport(report),
  'utf8'
);

if (!report.summary.ok) {
  console.error('[sync-convergence] Report generated with failing checks.');
  process.exit(1);
}

console.log('[sync-convergence] Report generated at reports/sync-convergence.{json,md}');
