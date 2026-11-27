#!/usr/bin/env node

import {
  buildFlowPerformanceReport,
  FLOW_MD_REPORT_PATH,
  FLOW_SUMMARY_JSON_PATH,
  writeFlowPerformanceReportArtifacts,
} from './flowPerformanceBudgetSupport.mjs';

const root = process.cwd();
const enforceTargets =
  process.argv.includes('--enforce-targets') || process.env.FLOW_PERF_ENFORCE_TARGETS === '1';

const fail = message => {
  console.error(`[flow-performance-budget] ${message}`);
  process.exit(1);
};

const report = buildFlowPerformanceReport(root);
if (!report) {
  fail(
    'Missing reports/e2e/flow-performance-budget.json. Run the Playwright flow budget spec first.'
  );
}

console.log('[flow-performance-budget] Report found.');
for (const flow of report.flows) {
  console.log(
    `[flow-performance-budget] ${flow.flow}: ${flow.actualMs}ms (target=${flow.targetMs}, enforced=${flow.enforcedMaxMs}, status=${flow.status})`
  );
}

if (report.summary.missingFlows.length > 0) {
  fail(`Report is missing metrics or budgets for: ${report.summary.missingFlows.join(', ')}`);
}

const targetViolations = report.flows.filter(flow => flow.status === 'target-miss');
const blockingViolations = report.flows.filter(flow => flow.status === 'blocking');
const nearLimitFlows = report.flows.filter(flow => flow.status === 'near-limit');

if (nearLimitFlows.length > 0) {
  console.warn('[flow-performance-budget] Near-limit flows:');
  for (const flow of nearLimitFlows) {
    console.warn(
      `  - ${flow.flow}: ${flow.actualMs}ms is within 15% of enforced max ${flow.enforcedMaxMs}ms`
    );
  }
}

if (targetViolations.length > 0) {
  console.warn('[flow-performance-budget] Target violations:');
  for (const violation of targetViolations) {
    console.warn(
      `  - ${violation.flow}: ${violation.actualMs}ms exceeds target ${violation.targetMs}ms`
    );
  }

  if (enforceTargets) {
    fail('Target violations detected with --enforce-targets.');
  }
}

if (blockingViolations.length > 0) {
  fail(`Blocking violations detected: ${blockingViolations.map(flow => flow.flow).join(', ')}`);
}

writeFlowPerformanceReportArtifacts(root, report);

console.log(
  `[flow-performance-budget] Report generated at ${FLOW_SUMMARY_JSON_PATH} and ${FLOW_MD_REPORT_PATH}`
);
console.log('[flow-performance-budget] OK');
