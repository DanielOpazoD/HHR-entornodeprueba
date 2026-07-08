#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { formatWorktreeState, getGitReportState } from './gitReportState.mjs';
import { loadClinicalReleaseValidationConfig } from './clinicalReleaseValidationSupport.mjs';

const SIGNOFF_PATH = path.join('scripts', 'config', 'clinical-release-signoff.json');
const VALID_STATUSES = new Set(['pending_human_review', 'passed', 'failed', 'blocked']);

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');

const normalizeEvidence = value =>
  Array.isArray(value)
    ? value.map(entry => ({
        type: normalizeString(entry?.type),
        reference: normalizeString(entry?.reference),
      }))
    : [];

export const loadClinicalReleaseSignoffConfig = root => {
  const absolutePath = path.join(root, SIGNOFF_PATH);
  if (!fs.existsSync(absolutePath)) {
    return {
      version: 1,
      releaseCandidate: '',
      signoffs: [],
    };
  }

  const parsed = readJson(absolutePath);
  return {
    version: parsed.version,
    releaseCandidate: normalizeString(parsed.releaseCandidate),
    signoffs: Array.isArray(parsed.signoffs)
      ? parsed.signoffs.map(signoff => ({
          scenarioId: normalizeString(signoff?.scenarioId),
          status: normalizeString(signoff?.status),
          validatedBy: normalizeString(signoff?.validatedBy),
          validatedAt: normalizeString(signoff?.validatedAt),
          evidence: normalizeEvidence(signoff?.evidence),
          notes: normalizeString(signoff?.notes),
        }))
      : [],
  };
};

export const collectClinicalReleaseSignoffIssues = ({ scenarioIds, signoffs, requirePassed }) => {
  const issues = [];
  const scenarioIdSet = new Set(scenarioIds);
  const signoffIds = signoffs.map(signoff => signoff.scenarioId).filter(Boolean);
  const duplicateIds = signoffIds.filter((id, index, collection) => collection.indexOf(id) !== index);

  for (const duplicateId of [...new Set(duplicateIds)]) {
    issues.push(`Duplicate signoff entry for scenario ${duplicateId}.`);
  }

  for (const scenarioId of scenarioIds) {
    if (!signoffIds.includes(scenarioId)) {
      issues.push(`Missing signoff entry for scenario ${scenarioId}.`);
    }
  }

  for (const signoff of signoffs) {
    const evidence = normalizeEvidence(signoff.evidence);
    if (!signoff.scenarioId) {
      issues.push('Signoff entry is missing scenarioId.');
      continue;
    }

    if (!scenarioIdSet.has(signoff.scenarioId)) {
      issues.push(`Unknown signoff scenario ${signoff.scenarioId}.`);
      continue;
    }

    if (!VALID_STATUSES.has(signoff.status)) {
      issues.push(`${signoff.scenarioId} has invalid status ${signoff.status || 'missing'}.`);
    }

    if (requirePassed && signoff.status !== 'passed') {
      issues.push(`${signoff.scenarioId} is ${signoff.status || 'missing'}; release signoff requires passed.`);
    }

    if (signoff.status === 'passed') {
      if (!signoff.validatedBy) {
        issues.push(`${signoff.scenarioId} is missing validatedBy.`);
      }
      if (!signoff.validatedAt) {
        issues.push(`${signoff.scenarioId} is missing validatedAt.`);
      }
      if (evidence.length === 0) {
        issues.push(`${signoff.scenarioId} is missing validation evidence.`);
      }
      for (const evidenceItem of evidence) {
        if (!evidenceItem.type || !evidenceItem.reference) {
          issues.push(`${signoff.scenarioId} has incomplete validation evidence.`);
        }
      }
    }
  }

  return issues;
};

export const buildClinicalReleaseSignoffReport = (root, { requirePassed = false } = {}) => {
  const validationConfig = loadClinicalReleaseValidationConfig(root);
  const signoffConfig = loadClinicalReleaseSignoffConfig(root);
  const gitState = getGitReportState(root);
  const scenarioIds = validationConfig.scenarios.map(scenario => scenario.id).filter(Boolean);
  const issues = [];

  if (signoffConfig.version !== 1) {
    issues.push(`Expected clinical release signoff version 1, received ${String(signoffConfig.version || 'unknown')}`);
  }

  issues.push(
    ...collectClinicalReleaseSignoffIssues({
      scenarioIds,
      signoffs: signoffConfig.signoffs,
      requirePassed,
    })
  );

  const pendingScenarioCount = signoffConfig.signoffs.filter(signoff => signoff.status !== 'passed').length;
  const structuralIssueCount = issues.filter(issue => !issue.includes('release signoff requires passed')).length;

  return {
    generatedAt: new Date().toISOString(),
    ...gitState,
    releaseCandidate: signoffConfig.releaseCandidate,
    overall: issues.length === 0 ? 'ok' : pendingScenarioCount > 0 && structuralIssueCount === 0 ? 'pending' : 'degraded',
    counts: {
      scenarioCount: scenarioIds.length,
      signoffCount: signoffConfig.signoffs.length,
      pendingScenarioCount,
    },
    signoffs: signoffConfig.signoffs,
    issues,
  };
};

const formatEvidence = evidence =>
  evidence.length > 0
    ? evidence.map(item => `${item.type}: ${item.reference}`).join('<br>')
    : 'Pendiente';

export const formatClinicalReleaseSignoffMarkdown = report => {
  const lines = [
    '# Clinical Release Signoff',
    '',
    `Generated at: ${report.generatedAt || 'unknown'}`,
    `Commit: ${report.gitSha || 'unknown'}`,
    `Worktree: ${formatWorktreeState(Boolean(report.gitDirty))}`,
    `Release candidate: ${report.releaseCandidate || '-'}`,
    `Overall: ${report.overall}`,
    '',
    '| Scenario | Status | Validated by | Validated at | Evidence | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const signoff of report.signoffs) {
    lines.push(
      `| ${signoff.scenarioId} | ${signoff.status || '-'} | ${signoff.validatedBy || 'Pendiente'} | ${
        signoff.validatedAt || 'Pendiente'
      } | ${formatEvidence(signoff.evidence)} | ${signoff.notes || '-'} |`
    );
  }

  if (report.issues.length > 0) {
    lines.push('', '## Issues', '');
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join('\n');
};
