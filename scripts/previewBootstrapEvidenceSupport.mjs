import fs from 'node:fs';
import path from 'node:path';

import { summarizePreviewGate } from './operationalHealthSupport.mjs';

export const PREVIEW_BOOTSTRAP_ARTIFACT = 'preview-bootstrap-artifacts';
export const PREVIEW_BOOTSTRAP_PRODUCER_JOB = 'build';
export const PREVIEW_BOOTSTRAP_REPORT = 'reports/e2e/preview-bootstrap/report.json';
export const PREVIEW_BOOTSTRAP_PROVENANCE = 'reports/e2e/preview-bootstrap/ci-provenance.json';

const asText = value => (typeof value === 'string' ? value.trim() : '');

const readJson = (root, relativePath, label) => {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    return { value: null, issues: [`${label} is missing at ${relativePath}.`] };
  }

  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), issues: [] };
  } catch (error) {
    return {
      value: null,
      issues: [
        `${label} at ${relativePath} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
};

export const readPreviewBootstrapEvidence = root => {
  const report = readJson(root, PREVIEW_BOOTSTRAP_REPORT, 'Preview bootstrap report');
  const provenance = readJson(root, PREVIEW_BOOTSTRAP_PROVENANCE, 'Preview bootstrap provenance');

  return {
    report: report.value,
    provenance: provenance.value,
    issues: [...report.issues, ...provenance.issues],
  };
};

export const buildPreviewBootstrapProvenance = ({ workflow, runId, runAttempt, commit }) => ({
  schemaVersion: 1,
  artifact: {
    name: PREVIEW_BOOTSTRAP_ARTIFACT,
    producerJob: PREVIEW_BOOTSTRAP_PRODUCER_JOB,
  },
  workflow: {
    name: asText(workflow),
    runId: asText(runId),
    producerRunAttempt: asText(runAttempt),
    commit: asText(commit),
  },
});

const validateCounter = (stats, name, { optional = false } = {}) => {
  if (optional && stats[name] === undefined) return [];
  const value = stats[name];
  return Number.isInteger(value) && value >= 0
    ? []
    : [`Preview bootstrap report has an invalid stats.${name} counter.`];
};

const collectReportIssues = report => {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return ['Preview bootstrap report must be a JSON object.'];
  }
  if (!report.stats || typeof report.stats !== 'object' || Array.isArray(report.stats)) {
    return ['Preview bootstrap report does not contain Playwright stats.'];
  }

  const issues = [
    ...validateCounter(report.stats, 'expected'),
    ...validateCounter(report.stats, 'unexpected'),
    ...validateCounter(report.stats, 'flaky'),
    ...validateCounter(report.stats, 'skipped'),
    ...validateCounter(report.stats, 'interrupted', { optional: true }),
  ];
  if (issues.length > 0) return issues;

  const gate = summarizePreviewGate(report);
  if (gate.status !== 'ok') {
    issues.push(
      `Preview bootstrap gate must be ok; received ${gate.status} ` +
        `(expected=${gate.expected}, unexpected=${gate.unexpected}, flaky=${gate.flaky}, ` +
        `skipped=${gate.skipped}, interrupted=${gate.interrupted}).`
    );
  }

  return issues;
};

const collectProvenanceIssues = (provenance, expected) => {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return ['Preview bootstrap provenance must be a JSON object.'];
  }

  const issues = [];
  if (provenance.schemaVersion !== 1) {
    issues.push('Preview bootstrap provenance schemaVersion must be 1.');
  }

  const comparisons = [
    ['artifact.name', provenance.artifact?.name, PREVIEW_BOOTSTRAP_ARTIFACT],
    ['artifact.producerJob', provenance.artifact?.producerJob, PREVIEW_BOOTSTRAP_PRODUCER_JOB],
    ['workflow.name', provenance.workflow?.name, expected.workflow],
    ['workflow.runId', provenance.workflow?.runId, expected.runId],
    ['workflow.commit', provenance.workflow?.commit, expected.commit],
  ];

  for (const [field, actual, expectedValue] of comparisons) {
    if (!asText(expectedValue)) {
      issues.push(`Expected preview bootstrap ${field} is missing.`);
    } else if (asText(actual) !== asText(expectedValue)) {
      issues.push(
        `Preview bootstrap provenance ${field} mismatch: expected ${expectedValue}, ` +
          `received ${asText(actual) || 'missing'}.`
      );
    }
  }

  const producerAttempt = Number.parseInt(provenance.workflow?.producerRunAttempt, 10);
  const consumerAttempt = Number.parseInt(expected.runAttempt, 10);
  if (!Number.isInteger(producerAttempt) || producerAttempt < 1) {
    issues.push('Preview bootstrap provenance workflow.producerRunAttempt must be positive.');
  } else if (!Number.isInteger(consumerAttempt) || consumerAttempt < 1) {
    issues.push('Expected preview bootstrap workflow.runAttempt must be positive.');
  } else if (producerAttempt > consumerAttempt) {
    issues.push(
      `Preview bootstrap provenance producer attempt ${producerAttempt} cannot be newer than ` +
        `consumer attempt ${consumerAttempt}.`
    );
  }

  return issues;
};

export const collectPreviewBootstrapEvidenceIssues = ({ report, provenance, expected }) => [
  ...collectReportIssues(report),
  ...collectProvenanceIssues(provenance, expected),
];
