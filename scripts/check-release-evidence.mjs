#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGitReportState, formatWorktreeState } from './gitReportState.mjs';
import { buildClinicalReleaseSignoffReport } from './clinicalReleaseSignoffSupport.mjs';

const ROOT = process.cwd();
const trackedReports = [
  'reports/quality-metrics.json',
  'reports/system-confidence.json',
  'reports/operational-health.json',
  'reports/clinical-release-validation.json',
  'reports/clinical-release-signoff.json',
  'reports/release-confidence-matrix.json',
  'reports/release-readiness-scorecard.json',
  'reports/maintenance-debt-scorecard.json',
];
const clinicalVisualReleaseReport = 'reports/e2e/clinical-visual-release-report.json';
const clinicalVisualReleaseSpec = 'clinical-release-visual-smoke.spec.ts';
const clinicalVisualReleaseTest =
  'creates release-critical clinical surfaces without layout overflow';
const clinicalVisualReleaseAttachments = [
  'clinical-release-census.png',
  'clinical-release-census-after-refresh.png',
  'clinical-release-census-excel-download.json',
  'clinical-release-documents.png',
  'clinical-release-documents-mobile.png',
  'clinical-release-cudyr.png',
  'clinical-release-cudyr-mobile.png',
  'clinical-release-cudyr-excel-download.json',
  'clinical-release-medical-handoff.png',
];

const fail = issues => {
  console.error('[release-evidence] Release evidence is not clean:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  console.error(
    '[release-evidence] Regenerate reports from a clean checkout before using report artifacts as release evidence.'
  );
  process.exit(1);
};

const collectQualityMetricEvidenceIssues = (reportFile, parsedReport) => {
  const issues = [];
  const flakeRiskFiles = Number(parsedReport?.tests?.flakeRiskFiles ?? 0);
  if (flakeRiskFiles > 0) {
    const filePaths = Array.isArray(parsedReport?.tests?.flakeRiskFilePaths)
      ? parsedReport.tests.flakeRiskFilePaths
          .filter(filePath => typeof filePath === 'string' && filePath.trim())
          .map(filePath => filePath.trim())
      : [];
    const fileList = filePaths.length > 0 ? `: ${filePaths.join(', ')}` : '';
    issues.push(`${reportFile} reports ${flakeRiskFiles} flake-risk test file(s)${fileList}.`);
  }

  return issues;
};

export const collectReleaseEvidenceIssues = (root = ROOT) => {
  const issues = [];
  const gitState = getGitReportState(root);

  if (gitState.gitDirty) {
    issues.push(
      `current worktree is ${formatWorktreeState(gitState.gitDirty)}; release evidence must be generated from a clean checkout.`
    );
  }

  for (const reportFile of trackedReports) {
    const reportPath = path.join(root, reportFile);
    if (!fs.existsSync(reportPath)) {
      issues.push(`${reportFile} is missing.`);
      continue;
    }

    let parsedReport;
    try {
      parsedReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch (error) {
      issues.push(
        `${reportFile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    if (parsedReport?.gitDirty === true) {
      issues.push(`${reportFile} was generated with worktree=dirty.`);
    }

    if (reportFile === 'reports/quality-metrics.json') {
      issues.push(...collectQualityMetricEvidenceIssues(reportFile, parsedReport));
    }
  }

  issues.push(...collectClinicalVisualReleaseEvidenceIssues(root));
  issues.push(...collectClinicalReleaseSignoffEvidenceIssues(root));

  return issues;
};

const collectSpecs = suites => {
  const specs = [];
  for (const suite of Array.isArray(suites) ? suites : []) {
    if (Array.isArray(suite?.specs)) {
      for (const spec of suite.specs) {
        specs.push({
          suiteFile: String(suite?.file || ''),
          suiteTitle: String(suite?.title || ''),
          spec,
        });
      }
    }
    specs.push(...collectSpecs(suite?.suites));
  }
  return specs;
};

const collectAttachmentNames = spec =>
  (Array.isArray(spec?.tests) ? spec.tests : []).flatMap(test =>
    (Array.isArray(test?.results) ? test.results : []).flatMap(result =>
      (Array.isArray(result?.attachments) ? result.attachments : [])
        .map(attachment => attachment?.name)
        .filter(Boolean)
    )
  );

const collectClinicalVisualReleaseEvidenceIssues = root => {
  const issues = [];
  const reportPath = path.join(root, clinicalVisualReleaseReport);
  if (!fs.existsSync(reportPath)) {
    return [`${clinicalVisualReleaseReport} is missing.`];
  }

  let parsedReport;
  try {
    parsedReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return [
      `${clinicalVisualReleaseReport} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  if ((parsedReport?.stats?.unexpected ?? 0) > 0 || (parsedReport?.stats?.flaky ?? 0) > 0) {
    issues.push(`${clinicalVisualReleaseReport} has unexpected or flaky failures.`);
  }

  const matchingSpecs = collectSpecs(parsedReport?.suites).filter(
    ({ suiteFile, suiteTitle, spec }) =>
      (spec?.file === clinicalVisualReleaseSpec ||
        suiteFile === clinicalVisualReleaseSpec ||
        suiteTitle === clinicalVisualReleaseSpec) &&
      spec?.title === clinicalVisualReleaseTest
  );

  if (matchingSpecs.length === 0) {
    issues.push(`${clinicalVisualReleaseReport} does not include ${clinicalVisualReleaseSpec}.`);
    return issues;
  }

  const passed = matchingSpecs.some(({ spec }) =>
    (Array.isArray(spec?.tests) ? spec.tests : []).some(test =>
      (Array.isArray(test?.results) ? test.results : []).some(result => result?.status === 'passed')
    )
  );
  if (!passed) {
    issues.push(`${clinicalVisualReleaseReport} did not pass the clinical visual release test.`);
  }

  const attachmentNames = new Set(
    matchingSpecs.flatMap(({ spec }) => collectAttachmentNames(spec))
  );
  const missingAttachments = clinicalVisualReleaseAttachments.filter(
    attachmentName => !attachmentNames.has(attachmentName)
  );
  if (missingAttachments.length > 0) {
    issues.push(
      `${clinicalVisualReleaseReport} is missing visual attachments: ${missingAttachments.join(', ')}.`
    );
  }

  return issues;
};

const collectClinicalReleaseSignoffEvidenceIssues = root => {
  try {
    const report = buildClinicalReleaseSignoffReport(root, { requirePassed: true });
    return report.issues.map(issue => `clinical release signoff: ${issue}`);
  } catch (error) {
    return [
      `clinical release signoff could not be validated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
};

const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const issues = collectReleaseEvidenceIssues();
  if (issues.length > 0) {
    fail(issues);
  }

  console.log('[release-evidence] OK (fresh reports from clean checkout required)');
}
