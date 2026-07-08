#!/usr/bin/env node

import {
  formatRuntimeAssetMarginMarkdown,
  loadRuntimeAssetMarginReport,
} from './runtimeAssetMarginReportSupport.mjs';

try {
  const report = loadRuntimeAssetMarginReport();
  if (report.status === 'blocking') {
    console.error('[runtime-asset-margin] Blocking runtime asset margin:');
    console.error('\n' + formatRuntimeAssetMarginMarkdown(report));
    process.exit(1);
  }

  console.log(
    `[runtime-asset-margin] ${report.status.toUpperCase()} - ${report.trackedSurfaces.length} tracked surfaces, ${report.topAssets.length} top assets.`
  );
} catch (error) {
  console.error(`[runtime-asset-margin] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
