#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectCiRuntimeTelemetryCheckIssues } from './ciRuntimeTelemetrySupport.mjs';

const root = process.cwd();
const reportPath = path.join(root, 'reports/ci-runtime-observed-profile.json');

const fail = issues => {
  console.error('[ci-runtime-telemetry] Contract failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
};

if (!fs.existsSync(reportPath)) {
  console.log('[ci-runtime-telemetry] OK advisory: no observed CI runtime report has been generated yet.');
  process.exit(0);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  fail([`reports/ci-runtime-observed-profile.json is not valid JSON: ${error.message}`]);
}

const issues = collectCiRuntimeTelemetryCheckIssues(report);

if (issues.length > 0) {
  fail(issues);
}

const advisoryFindings = report.comparison?.advisoryFindings || [];
if (advisoryFindings.length > 0) {
  console.log('[ci-runtime-telemetry] OK advisory findings:');
  for (const finding of advisoryFindings) {
    console.log(`- ${finding}`);
  }
} else {
  console.log('[ci-runtime-telemetry] OK');
}
