#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildUnitShardBalanceReport,
  formatUnitShardRuntimeProfileMarkdown,
} from './unitShardBalanceSupport.mjs';

const root = process.cwd();
const report = buildUnitShardBalanceReport(root);
const reportDir = path.join(root, 'reports');

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(
  path.join(reportDir, 'unit-shard-runtime-profile.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(reportDir, 'unit-shard-runtime-profile.md'),
  formatUnitShardRuntimeProfileMarkdown(report),
  'utf8'
);

console.log('[unit-shard-runtime-profile] Report generated at reports/unit-shard-runtime-profile.{json,md}');
