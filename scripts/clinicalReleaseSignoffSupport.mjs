#!/usr/bin/env node

import { buildEvidenceProvenance } from './evidenceProvenanceSupport.mjs';

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  formatWorktreeState,
  getGitReportState,
  hasMeaningfulWorktreeChanges,
} from './gitReportState.mjs';
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

export const loadClinicalReleaseSignoffConfig = (root, signoffPath = SIGNOFF_PATH) => {
  const absolutePath = path.resolve(root, signoffPath);
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
  const duplicateIds = signoffIds.filter(
    (id, index, collection) => collection.indexOf(id) !== index
  );

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
      issues.push(
        `${signoff.scenarioId} is ${signoff.status || 'missing'}; release signoff requires passed.`
      );
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

// Release closeout validates a separately supplied record against an immutable checkout.
// It does not authenticate the reviewer or create/renew their clinical approval.
export const collectClinicalReleaseCandidateIssues = (
  root,
  { signoffPath = process.env.CLINICAL_RELEASE_SIGNOFF_FILE } = {}
) => {
  if (!signoffPath)
    return [
      'Current candidate requires CLINICAL_RELEASE_SIGNOFF_FILE; historical signoffs do not approve this release.',
    ];
  try {
    const candidate = loadClinicalReleaseSignoffConfig(root, signoffPath);
    const validation = loadClinicalReleaseValidationConfig(root);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const scenarioIds = validation.scenarios.map(scenario => scenario.id).filter(Boolean);
    const issues = collectClinicalReleaseSignoffIssues({
      scenarioIds,
      signoffs: candidate.signoffs,
      requirePassed: true,
    });
    if (candidate.version !== 1 || validation.version !== 1 || scenarioIds.length === 0) {
      issues.push(
        'Candidate signoff requires version 1 and a non-empty clinical scenario contract.'
      );
    }
    if (
      !/^[a-f0-9]{40}$/i.test(candidate.releaseCandidate) ||
      candidate.releaseCandidate.toLowerCase() !== head.toLowerCase()
    ) {
      issues.push('Clinical signoff releaseCandidate must equal the full current HEAD SHA.');
    }
    const status = execFileSync('git', ['status', '--short'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (hasMeaningfulWorktreeChanges(status))
      issues.push('Candidate signoff requires a clean checkout.');
    for (const signoff of candidate.signoffs) {
      if (signoff.status !== 'passed') continue;
      if (/nombre apellido|placeholder|pendiente/i.test(signoff.validatedBy)) {
        issues.push(`${signoff.scenarioId} has a placeholder reviewer.`);
      }
      const timestamp = Date.parse(signoff.validatedAt);
      const canonicalDate = Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString().replace('.000Z', 'Z')
        : '';
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(signoff.validatedAt) ||
        canonicalDate !== signoff.validatedAt.replace('.000Z', 'Z') ||
        timestamp > Date.now()
      ) {
        issues.push(`${signoff.scenarioId} requires a valid, non-future UTC validation timestamp.`);
      }
      if (!signoff.evidence.some(item => item.type === 'manual_signoff' && item.reference)) {
        issues.push(`${signoff.scenarioId} requires manual_signoff evidence for this candidate.`);
      }
    }
    return issues;
  } catch (error) {
    return [`Candidate clinical signoff could not be validated: ${error.message}`];
  }
};

export const buildClinicalReleaseSignoffReport = (root, { requirePassed = false } = {}) => {
  const validationConfig = loadClinicalReleaseValidationConfig(root);
  const signoffConfig = loadClinicalReleaseSignoffConfig(root);
  const gitState = getGitReportState(root);
  const scenarioIds = validationConfig.scenarios.map(scenario => scenario.id).filter(Boolean);
  const issues = [];

  if (signoffConfig.version !== 1) {
    issues.push(
      `Expected clinical release signoff version 1, received ${String(signoffConfig.version || 'unknown')}`
    );
  }

  issues.push(
    ...collectClinicalReleaseSignoffIssues({
      scenarioIds,
      signoffs: signoffConfig.signoffs,
      requirePassed,
    })
  );

  const pendingScenarioCount = signoffConfig.signoffs.filter(
    signoff => signoff.status !== 'passed'
  ).length;
  const structuralIssueCount = issues.filter(
    issue => !issue.includes('release signoff requires passed')
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    ...gitState,
    generatedFor: buildEvidenceProvenance({ root, reportId: 'clinical-release-signoff', gitState }),
    releaseCandidate: signoffConfig.releaseCandidate,
    approvalScope: 'historical_record',
    currentCandidateApproved: false,
    overall:
      issues.length === 0
        ? 'ok'
        : pendingScenarioCount > 0 && structuralIssueCount === 0
          ? 'pending'
          : 'degraded',
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
    `Report generation commit: ${report.gitSha || 'unknown'}`,
    `Worktree: ${formatWorktreeState(Boolean(report.gitDirty))}`,
    `Recorded release candidate: ${report.releaseCandidate || '-'}`,
    `Record completeness: ${report.overall}`,
    '',
    '## Approval scope',
    '',
    'Historical record only. Regenerating this report does not renew clinical approval.',
    'Current candidate approval: not verified. The recorded signoffs are not bound to the report generation commit.',
    'Reviewer names, dates and evidence below are preserved as recorded; their presence is not independent verification.',

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
