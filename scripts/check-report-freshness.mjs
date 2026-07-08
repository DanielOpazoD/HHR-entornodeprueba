#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDirectMergeParentShas, getGitReportState } from './gitReportState.mjs';
import { getEvidenceReportDependencyFiles } from './evidenceDependencyGraph.mjs';
import {
  buildDependencyFingerprint,
  normalizeDependencyFingerprintValue,
} from './evidenceProvenanceSupport.mjs';

const ROOT = process.cwd();
const strictMode =
  process.argv.includes('--strict') || process.env.REPORT_FRESHNESS_STRICT === '1';
const dependencyFilesFor = reportId => getEvidenceReportDependencyFiles(reportId);

const readArgValues = flag => {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== flag) {
      continue;
    }
    const value = process.argv[index + 1] || '';
    values.push(
      ...value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    );
  }
  return values;
};

const trackedReports = [
  {
    id: 'quality-metrics',
    file: 'reports/quality-metrics.json',
    field: 'gitSha',
    refreshScript: 'report:quality-metrics',
  },
  {
    id: 'sync-convergence',
    file: 'reports/sync-convergence.json',
    field: 'gitSha',
    refreshScript: 'report:sync-convergence',
    dependsOn: dependencyFilesFor('sync-convergence'),
  },
  {
    id: 'system-confidence',
    file: 'reports/system-confidence.json',
    field: 'gitSha',
    refreshScript: 'report:system-confidence',
    dependsOn: dependencyFilesFor('system-confidence'),
  },
  {
    id: 'operational-health',
    file: 'reports/operational-health.json',
    field: 'gitSha',
    refreshScript: 'report:operational-health',
    dependsOn: dependencyFilesFor('operational-health'),
  },
  {
    id: 'clinical-release-signoff',
    file: 'reports/clinical-release-signoff.json',
    field: 'gitSha',
    refreshScript: 'report:clinical-release-signoff',
    dependsOn: dependencyFilesFor('clinical-release-signoff'),
  },
  {
    id: 'release-confidence-matrix',
    file: 'reports/release-confidence-matrix.json',
    field: 'gitSha',
    refreshScript: 'report:release-confidence-matrix',
    dependsOn: dependencyFilesFor('release-confidence-matrix'),
  },
  {
    id: 'release-readiness-scorecard',
    file: 'reports/release-readiness-scorecard.json',
    field: 'gitSha',
    refreshScript: 'report:release-readiness-scorecard',
    dependsOn: dependencyFilesFor('release-readiness-scorecard'),
  },
  {
    id: 'maintenance-debt-scorecard',
    file: 'reports/maintenance-debt-scorecard.json',
    field: 'gitSha',
    refreshScript: 'report:maintenance-debt-scorecard',
    dependsOn: dependencyFilesFor('maintenance-debt-scorecard'),
  },
];

const printIssues = (issues, { stream = console.error } = {}) => {
  stream('[report-freshness] Stale report artifacts found:');
  for (const issue of issues) {
    stream(`- ${issue}`);
  }
  const refreshScripts = [...new Set(selectedReports.map(report => report.refreshScript))];
  stream(
    `[report-freshness] Refresh with: ${refreshScripts.map(script => `npm run ${script}`).join(' && ')}`
  );
};

const fail = issues => {
  printIssues(issues);
  process.exit(1);
};

const onlyReportIds = new Set(readArgValues('--only'));
const selectedReports =
  onlyReportIds.size === 0
    ? trackedReports
    : trackedReports.filter(report => onlyReportIds.has(report.id));

const unknownReportIds = [...onlyReportIds].filter(
  reportId => !trackedReports.some(report => report.id === reportId)
);
if (unknownReportIds.length > 0) {
  fail([`Unknown report id(s) for --only: ${unknownReportIds.join(', ')}.`]);
}

const warn = issues => {
  printIssues(issues, { stream: console.warn });
  console.warn('[report-freshness] Advisory only. Use --strict for release evidence gates.');
};

const isSameCommit = (reportSha, currentSha) =>
  reportSha === currentSha || reportSha.startsWith(currentSha) || currentSha.startsWith(reportSha);

const matchesAnyAllowedCommit = (reportSha, allowedShas) =>
  allowedShas.some(allowedSha => isSameCommit(reportSha, allowedSha));

const findMatchingAllowedCommit = (reportSha, allowedShas) =>
  allowedShas.find(allowedSha => isSameCommit(reportSha, allowedSha)) || '';

const runGit = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const governedReportFiles = new Set(
  [
    ...selectedReports.map(report => report.file),
    'reports/clinical-release-validation.json',
  ].flatMap(file => [file, file.replace(/\.json$/, '.md')])
);

const getDirectParentSha = () => {
  try {
    return runGit(['rev-parse', '--short', 'HEAD^']);
  } catch {
    return '';
  }
};

const getHeadChangedFiles = () => {
  try {
    return runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
      .split('\n')
      .map(file => file.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const hasOnlyGovernedReportFiles = changedFiles => {
  return (
    changedFiles.length > 0 &&
    changedFiles.every(file => governedReportFiles.has(file))
  );
};

const currentGitState = getGitReportState(ROOT);
const currentGitSha = currentGitState.gitSha;
if (!currentGitSha) {
  fail(['Could not resolve current git commit.']);
}
const baseAllowedReportShas = [currentGitSha, ...getDirectMergeParentShas(ROOT)];
const directMergeParentShas = getDirectMergeParentShas(ROOT);
let evidenceOnlyAllowedReportShas;
const getEvidenceOnlyAllowedReportShas = () => {
  if (evidenceOnlyAllowedReportShas === undefined) {
    const changedFiles = getHeadChangedFiles();
    evidenceOnlyAllowedReportShas = hasOnlyGovernedReportFiles(changedFiles)
      ? [getDirectParentSha()].filter(Boolean)
      : [];
  }
  return evidenceOnlyAllowedReportShas;
};

const issues = [];
const advisories = [];

const pushProvenanceIssues = ({ report, parsedReport, reportSha }) => {
  const provenance = parsedReport?.generatedFor;
  if (!provenance || typeof provenance !== 'object') {
    return;
  }

  const malformedReasons = [];
  if (typeof provenance.reportId === 'string' && provenance.reportId !== report.id) {
    malformedReasons.push(`reportId=${provenance.reportId}`);
  }
  if (typeof provenance.gitSha === 'string' && !isSameCommit(provenance.gitSha, reportSha)) {
    malformedReasons.push(`gitSha=${provenance.gitSha}`);
  }

  if (malformedReasons.length > 0) {
    issues.push(
      `${report.file} has malformed provenance (${malformedReasons.join(', ')}); refresh with npm run ${report.refreshScript}.`
    );
  }

  if (typeof provenance.treeHash !== 'string' || !provenance.treeHash) {
    advisories.push(
      `${report.file} provenance does not declare treeHash; refresh with npm run ${report.refreshScript} to improve audit traceability.`
    );
  }
};

for (const report of selectedReports) {
  const reportPath = path.join(ROOT, report.file);

  if (!fs.existsSync(reportPath)) {
    issues.push(`${report.file} is missing.`);
    continue;
  }

  let parsedReport;
  try {
    parsedReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    issues.push(
      `${report.file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
    continue;
  }

  const reportSha = typeof parsedReport?.[report.field] === 'string' ? parsedReport[report.field] : '';
  if (!reportSha) {
    issues.push(`${report.file} does not declare ${report.field}.`);
    continue;
  }

  pushProvenanceIssues({ report, parsedReport, reportSha });

  if (
    !matchesAnyAllowedCommit(reportSha, baseAllowedReportShas) &&
    !matchesAnyAllowedCommit(reportSha, getEvidenceOnlyAllowedReportShas())
  ) {
    issues.push(
      `${report.file} is stale by commit ancestry: generated for ${reportSha}, current HEAD is ${currentGitSha}; refresh with npm run ${report.refreshScript}.`
    );
  }

  const matchingMergeParentSha = findMatchingAllowedCommit(reportSha, directMergeParentShas);
  if (matchingMergeParentSha) {
    const expectedFingerprint = buildDependencyFingerprint({
      root: ROOT,
      dependencyFiles: report.dependsOn || [],
    });
    const recordedFingerprint = parsedReport?.generatedFor?.dependencyFingerprint;
    const recordedFingerprintValue = normalizeDependencyFingerprintValue(recordedFingerprint);
    if (!recordedFingerprintValue) {
      issues.push(
        `${report.file} was generated for direct merge parent ${matchingMergeParentSha} without dependency fingerprint; refresh with npm run ${report.refreshScript} or run npm run postmerge:evidence on main.`
      );
    } else if (recordedFingerprintValue !== expectedFingerprint.value) {
      issues.push(
        `${report.file} is stale by real dependency fingerprint: generated for direct merge parent ${matchingMergeParentSha} with ${recordedFingerprintValue}, expected ${expectedFingerprint.value}; refresh with npm run ${report.refreshScript}.`
      );
    }
  }

  if (
    typeof parsedReport?.gitDirty === 'boolean' &&
    parsedReport.gitDirty !== currentGitState.gitDirty
  ) {
    issues.push(
      `${report.file} recorded worktree=${parsedReport.gitDirty ? 'dirty' : 'clean'}, current worktree is ${currentGitState.gitDirty ? 'dirty' : 'clean'}.`
    );
  }

  const reportMtimeMs = fs.statSync(reportPath).mtimeMs;
  for (const dependencyFile of report.dependsOn || []) {
    const dependencyPath = path.join(ROOT, dependencyFile);
    if (!fs.existsSync(dependencyPath)) {
      continue;
    }

    const dependencyMtimeMs = fs.statSync(dependencyPath).mtimeMs;
    if (dependencyMtimeMs > reportMtimeMs) {
      issues.push(`${report.file} is older than dependency ${dependencyFile}.`);
    }
  }
}

if (issues.length > 0 && strictMode) {
  fail(issues);
}

if (issues.length > 0) {
  warn(issues);
  process.exit(0);
}

if (advisories.length > 0) {
  console.warn('[report-freshness] Provenance advisories:');
  for (const advisory of advisories) {
    console.warn(`- ${advisory}`);
  }
}

console.log(
  `[report-freshness] OK (${selectedReports.length} reports match ${currentGitSha}, a direct merge parent, or an evidence-only direct parent, worktree=${currentGitState.gitDirty ? 'dirty' : 'clean'})`
);
