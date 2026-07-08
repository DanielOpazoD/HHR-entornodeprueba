#!/usr/bin/env node

import { formatBundleRiskLedgerMarkdown, loadBundleRiskLedgerReport } from './bundleRiskLedgerSupport.mjs';

const report = loadBundleRiskLedgerReport();

if (report.status !== 'ok') {
  console.error('[bundle-risk-ledger] Validation failed:');
  for (const issue of report.issues) {
    console.error(`- ${issue}`);
  }
  console.error('\n' + formatBundleRiskLedgerMarkdown(report));
  process.exit(1);
}

console.log(`[bundle-risk-ledger] OK - ${report.surfaces.length} surfaces covered by budgets.`);
