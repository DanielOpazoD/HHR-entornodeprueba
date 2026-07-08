#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  formatRuntimeAssetMarginMarkdown,
  loadRuntimeAssetMarginReport,
} from './runtimeAssetMarginReportSupport.mjs';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');

const gitShaResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const gitSha = gitShaResult.status === 0 ? gitShaResult.stdout.trim() : 'unknown';

try {
  const report = loadRuntimeAssetMarginReport({ root: ROOT, gitSha });

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'runtime-asset-margin.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'runtime-asset-margin.md'),
    `${formatRuntimeAssetMarginMarkdown(report)}\n`,
    'utf8'
  );

  console.log('[runtime-asset-margin] Report generated at reports/runtime-asset-margin.{md,json}');
} catch (error) {
  console.error(`[runtime-asset-margin] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
