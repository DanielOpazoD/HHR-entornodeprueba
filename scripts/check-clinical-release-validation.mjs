#!/usr/bin/env node

import { buildClinicalReleaseValidationReport } from './clinicalReleaseValidationSupport.mjs';

const report = buildClinicalReleaseValidationReport(process.cwd());

if (report.issues.length > 0) {
  console.error('[clinical-release-validation] Contract gaps found:');
  for (const issue of report.issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`[clinical-release-validation] OK (${report.counts.scenarioCount} scenarios)`);
