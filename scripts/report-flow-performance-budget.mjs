#!/usr/bin/env node

import {
  buildFlowPerformanceReport,
  FLOW_MD_REPORT_PATH,
  FLOW_SUMMARY_JSON_PATH,
  writeFlowPerformanceReportArtifacts,
} from './flowPerformanceBudgetSupport.mjs';

const root = process.cwd();
const report = buildFlowPerformanceReport(root);

if (!report) {
  console.error('[flow-performance-budget] Missing reports/e2e/flow-performance-budget.json');
  process.exit(1);
}

writeFlowPerformanceReportArtifacts(root, report);

console.log(
  `[flow-performance-budget] Report generated at ${FLOW_SUMMARY_JSON_PATH} and ${FLOW_MD_REPORT_PATH}`
);
