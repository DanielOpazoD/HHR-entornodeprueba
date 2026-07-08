#!/usr/bin/env node

import { buildClinicalReleaseSignoffReport } from './clinicalReleaseSignoffSupport.mjs';

const report = buildClinicalReleaseSignoffReport(process.cwd(), { requirePassed: true });

if (report.issues.length > 0) {
  console.error('[clinical-release-signoff] Release signoff is incomplete:');
  for (const issue of report.issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`[clinical-release-signoff] OK (${report.counts.scenarioCount} scenarios)`);
