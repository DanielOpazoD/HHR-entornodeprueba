#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildTestRuntimeGovernanceReport,
  formatTestRuntimeGovernanceMarkdown,
} from './testRuntimeGovernanceSupport.mjs';

const root = process.cwd();
const report = buildTestRuntimeGovernanceReport(root);
const reportDir = path.join(root, 'reports');

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(
  path.join(reportDir, 'test-runtime-governance.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(reportDir, 'test-runtime-governance.md'),
  formatTestRuntimeGovernanceMarkdown(report),
  'utf8'
);

console.log('[test-runtime-governance] Report generated at reports/test-runtime-governance.{json,md}');
