#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { formatWorktreeState, getGitReportState } from './gitReportState.mjs';
import { buildEvidenceProvenance } from './evidenceProvenanceSupport.mjs';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const JSON_OUTPUT = path.join(REPORTS_DIR, 'system-confidence.json');
const MD_OUTPUT = path.join(REPORTS_DIR, 'system-confidence.md');

const readJson = relativePath =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

const readOptionalJson = relativePath => {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    return { data: null, missing: true };
  }

  return { data: readJson(relativePath), missing: false };
};

const qualityMetrics = readJson('reports/quality-metrics.json');
const operationalHealthReport = readOptionalJson('reports/operational-health.json');
const criticalCoverageReport = readOptionalJson('reports/critical-coverage.json');
const failureCatalog = readJson('scripts/config/test-failure-catalog.json');
const flakyQuarantine = readJson('scripts/config/flaky-quarantine.json');
const operationalHealth = operationalHealthReport.data;
const criticalCoverage = criticalCoverageReport.data;
const gitState = getGitReportState(ROOT);

const openFailureEntries = failureCatalog.entries.filter(entry => entry.status !== 'fixed');
const failureCounts = openFailureEntries.reduce((accumulator, entry) => {
  accumulator[entry.classification] = (accumulator[entry.classification] || 0) + 1;
  return accumulator;
}, {});

const indicators = [
  {
    name: 'worktree_state',
    status: gitState.gitDirty ? 'degraded' : 'ok',
    summary: `status=${formatWorktreeState(gitState.gitDirty)}`,
  },
  {
    name: 'structural_quality',
    status:
      qualityMetrics.moduleSize.oversizedCount === 0 &&
      qualityMetrics.folderDependencyDebt.violations === 0 &&
      qualityMetrics.typeSafety.explicitAnySourceCount === 0
        ? 'ok'
        : 'degraded',
    summary: `oversized=${qualityMetrics.moduleSize.oversizedCount}, folderDebt=${qualityMetrics.folderDependencyDebt.violations}, sourceAny=${qualityMetrics.typeSafety.explicitAnySourceCount}`,
  },
  {
    name: 'test_governance',
    status:
      qualityMetrics.tests.flakeRiskFiles === 0 &&
      qualityMetrics.tests.onlyMarkers === 0 &&
      qualityMetrics.tests.skippedMarkers === 0
        ? 'ok'
        : 'degraded',
    summary: `flakeRisk=${qualityMetrics.tests.flakeRiskFiles}, skip=${qualityMetrics.tests.skippedMarkers}, only=${qualityMetrics.tests.onlyMarkers}, quarantined=${Array.isArray(flakyQuarantine.quarantined) ? flakyQuarantine.quarantined.length : 0}`,
  },
  {
    name: 'known_failures',
    status: openFailureEntries.length === 0 ? 'ok' : 'degraded',
    summary: `open=${openFailureEntries.length}, deterministic=${failureCounts.deterministic || 0}, bugReal=${failureCounts.bug_real || 0}, flaky=${failureCounts.flaky || 0}, obsolete=${failureCounts.test_obsolete || 0}, infra=${failureCounts.infra || 0}`,
  },
  {
    name: 'critical_coverage',
    status: criticalCoverage?.status === 'passing' ? 'ok' : 'degraded',
    summary: criticalCoverage
      ? `status=${criticalCoverage.status}, zones=${Array.isArray(criticalCoverage.criticalZones) ? criticalCoverage.criticalZones.length : 0}`
      : 'missing report: reports/critical-coverage.json',
  },
  {
    name: 'operational_budgets',
    status:
      operationalHealth?.flowPerformance?.status === 'passing' &&
      operationalHealth?.criticalCoverage?.status === 'passing'
        ? 'ok'
        : 'degraded',
    summary: operationalHealth
      ? `flow=${operationalHealth.flowPerformance?.status || 'unknown'}, coverage=${operationalHealth.criticalCoverage?.status || 'unknown'}`
      : 'missing report: reports/operational-health.json',
  },
  {
    name: 'frontend_startup',
    status: operationalHealth?.frontendStartup?.status === 'ok' ? 'ok' : 'degraded',
    summary: operationalHealth
      ? `status=${operationalHealth.frontendStartup?.status || 'unknown'}, preview=${operationalHealth.frontendStartup?.previewGate?.status || 'unknown'}, issues=${operationalHealth.frontendStartup?.issues?.length || 0}`
      : 'missing report: reports/operational-health.json',
  },
];

const degradedIndicators = indicators.filter(indicator => indicator.status !== 'ok');
const degradedByWorktreeOnly =
  gitState.gitDirty &&
  degradedIndicators.length === 1 &&
  degradedIndicators[0]?.name === 'worktree_state';
const overallStatus = indicators.every(indicator => indicator.status === 'ok') ? 'ok' : 'degraded';

const report = {
  generatedAt: new Date().toISOString(),
  ...gitState,
  generatedFor: buildEvidenceProvenance({
    root: ROOT,
    reportId: 'system-confidence',
    gitState,
  }),
  overallStatus,
  degradedByWorktreeOnly,
  overallStatusReason: degradedByWorktreeOnly
    ? 'worktree_state only'
    : overallStatus === 'ok'
      ? 'all indicators ok'
      : 'one or more technical indicators degraded',
  indicators,
  knownFailures: {
    openCount: openFailureEntries.length,
    byClassification: failureCounts,
    owners: [...new Set(openFailureEntries.map(entry => entry.owner))].sort(),
  },
  missingPrerequisites: [
    ...(operationalHealthReport.missing ? ['reports/operational-health.json'] : []),
    ...(criticalCoverageReport.missing ? ['reports/critical-coverage.json'] : []),
  ],
};

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const markdown = [
  '# System Confidence Snapshot',
  '',
  `- Generated: ${report.generatedAt}`,
  `- Commit: ${report.gitSha}`,
  `- Worktree: ${formatWorktreeState(report.gitDirty)}`,
  `- Overall status: ${report.overallStatus}`,
  ...(report.degradedByWorktreeOnly
    ? ['- Advisory: degraded only because the snapshot was generated with a dirty worktree; technical indicators are ok.']
    : []),
  '',
  '## Indicators',
  '',
  '| Indicator | Status | Summary |',
  '| --- | --- | --- |',
  ...report.indicators.map(
    indicator => `| \`${indicator.name}\` | ${indicator.status} | ${indicator.summary} |`
  ),
  '',
  '## Known Failures',
  '',
  `- Open entries: ${report.knownFailures.openCount}`,
  `- Owners: ${report.knownFailures.owners.join(', ') || 'none'}`,
  `- By classification: ${JSON.stringify(report.knownFailures.byClassification)}`,
  `- Missing prerequisites: ${report.missingPrerequisites.join(', ') || 'none'}`,
  '',
];

fs.writeFileSync(MD_OUTPUT, `${markdown.join('\n')}\n`, 'utf8');
console.log('[system-confidence] Report generated at reports/system-confidence.{md,json}');
