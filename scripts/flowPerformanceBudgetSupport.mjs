#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

export const FLOW_REPORT_PATH = path.join('reports', 'e2e', 'flow-performance-budget.json');
export const FLOW_SUMMARY_JSON_PATH = path.join(
  'reports',
  'e2e',
  'flow-performance-budget-summary.json'
);
export const FLOW_MD_REPORT_PATH = path.join('reports', 'e2e', 'flow-performance-budget.md');

const REQUIRED_FLOWS = [
  'loginVisibleMs',
  'authFeedbackMs',
  'censoVisibleMs',
  'censoRecordReadyMs',
  'clinicalDocumentsVisibleMs',
  'backupFilesVisibleMs',
  'logoutToLoginVisibleMs',
];

const toOneDecimal = value => Number(value.toFixed(1));

const classifyFlowStatus = ({ actualMs, targetMs, enforcedMaxMs }) => {
  if (actualMs > enforcedMaxMs) return 'blocking';
  if (actualMs > targetMs) return 'target-miss';

  const headroomMs = enforcedMaxMs - actualMs;
  const headroomRatio = enforcedMaxMs > 0 ? headroomMs / enforcedMaxMs : 1;
  if (headroomRatio <= 0.15) return 'near-limit';

  return 'ok';
};

export const readFlowPerformanceReport = root => {
  const reportPath = path.join(root, FLOW_REPORT_PATH);
  if (!fs.existsSync(reportPath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  if (Array.isArray(raw.flows)) {
    return raw;
  }

  return raw;
};

export const buildFlowPerformanceReport = root => {
  const report = readFlowPerformanceReport(root);
  if (!report) {
    return null;
  }

  const metrics = report.metrics && typeof report.metrics === 'object' ? report.metrics : {};
  const budgets = report.budgets && typeof report.budgets === 'object' ? report.budgets : {};
  const breakdown = report.breakdown && typeof report.breakdown === 'object' ? report.breakdown : {};

  const flows = REQUIRED_FLOWS.map(flow => {
    const actualMs = Number(metrics[flow]);
    const budget = budgets[flow] || {};
    const enforcedMaxMs = Number(budget.enforcedMaxMs);
    const targetMs = Number(budget.targetMs);
    const hasMetric = Number.isFinite(actualMs);
    const hasBudget = Number.isFinite(enforcedMaxMs) && Number.isFinite(targetMs);

    if (!hasMetric || !hasBudget) {
      return {
        flow,
        actualMs: hasMetric ? actualMs : null,
        enforcedMaxMs: hasBudget ? enforcedMaxMs : null,
        targetMs: hasBudget ? targetMs : null,
        deltaToTargetMs: null,
        deltaToEnforcedMs: null,
        status: 'invalid',
      };
    }

    return {
      flow,
      actualMs: toOneDecimal(actualMs),
      enforcedMaxMs: toOneDecimal(enforcedMaxMs),
      targetMs: toOneDecimal(targetMs),
      deltaToTargetMs: toOneDecimal(actualMs - targetMs),
      deltaToEnforcedMs: toOneDecimal(actualMs - enforcedMaxMs),
      status: classifyFlowStatus({ actualMs, targetMs, enforcedMaxMs }),
    };
  });

  const missingFlows = flows.filter(flow => flow.status === 'invalid').map(flow => flow.flow);
  const blockingFlows = flows.filter(flow => flow.status === 'blocking');
  const targetMissFlows = flows.filter(flow => flow.status === 'target-miss');
  const nearLimitFlows = flows.filter(flow => flow.status === 'near-limit');

  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: report.generatedAt || null,
    requiredFlows: REQUIRED_FLOWS,
    rawStatus: report.status || 'unknown',
    flows,
    breakdown,
    summary: {
      missingFlows,
      blockingCount: blockingFlows.length,
      targetMissCount: targetMissFlows.length,
      nearLimitCount: nearLimitFlows.length,
      status:
        missingFlows.length > 0 || blockingFlows.length > 0
          ? 'failing'
          : targetMissFlows.length > 0
            ? 'target-violations'
            : nearLimitFlows.length > 0
              ? 'near-limit'
              : 'passing',
    },
  };
};

export const formatFlowPerformanceMarkdown = report => {
  const lines = [
    '# Flow Performance Budget Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Source report: ${report.sourceGeneratedAt || 'unknown'}`,
    `- Status: ${report.summary.status}`,
    '',
    '## Flows',
    '',
    '| Flow | Actual | Target | Enforced | Delta vs target | Delta vs enforced | Status |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const flow of report.flows) {
    lines.push(
      `| \`${flow.flow}\` | ${flow.actualMs ?? 'n/a'} | ${flow.targetMs ?? 'n/a'} | ${flow.enforcedMaxMs ?? 'n/a'} | ${flow.deltaToTargetMs ?? 'n/a'} | ${flow.deltaToEnforcedMs ?? 'n/a'} | ${flow.status} |`
    );
  }

  if (Object.keys(report.breakdown).length > 0) {
    lines.push('', '## Breakdown', '');
    for (const [section, values] of Object.entries(report.breakdown)) {
      lines.push(`### ${section}`, '');
      for (const [key, value] of Object.entries(values)) {
        lines.push(`- ${key}: ${value}ms`);
      }
      lines.push('');
    }
  }

  if (report.summary.missingFlows.length > 0) {
    lines.push('## Missing Flows', '');
    for (const flow of report.summary.missingFlows) {
      lines.push(`- ${flow}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};
