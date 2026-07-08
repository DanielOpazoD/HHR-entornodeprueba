#!/usr/bin/env node

import { formatLegacyRetirementDebtMarkdown, loadLegacyRetirementDebtReport } from './legacyRetirementDebtSupport.mjs';

let report;
try {
  report = loadLegacyRetirementDebtReport();
} catch (error) {
  console.error(`[legacy-retirement-debt] ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    '[legacy-retirement-debt] Run npm run report:legacy-bridge and npm run report:compatibility-governance before this check.'
  );
  process.exit(1);
}

if (report.status !== 'ok') {
  console.error('[legacy-retirement-debt] Validation failed:');
  for (const issue of report.issues) {
    console.error(`- ${issue}`);
  }
  console.error('\n' + formatLegacyRetirementDebtMarkdown(report));
  process.exit(1);
}

console.log(
  `[legacy-retirement-debt] OK — ${report.openSurfaceCount}/${report.maxOpenSurfaces || 'n/a'} open legacy surfaces remain within budget.`
);
