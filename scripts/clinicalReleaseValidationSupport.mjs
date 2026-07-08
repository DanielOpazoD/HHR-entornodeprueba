#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { formatWorktreeState, getGitReportState } from './gitReportState.mjs';
import { loadReleaseConfidenceMatrixConfig } from './releaseConfidenceMatrixSupport.mjs';

const CONFIG_PATH = path.join('scripts', 'config', 'clinical-release-validation.json');
const PACKAGE_JSON_PATH = 'package.json';
const RUNBOOK_PATH = path.join('docs', 'runbooks', 'deployment-checklist.md');
const REQUIRED_CLOSURE_GATES = ['codigo_corregido', 'regresion_automatizada', 'flujo_clinico_validado'];
const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high']);
const REQUIRED_RUNBOOK_PATTERNS = [
  'scripts/config/clinical-release-validation.json',
  'npm run check:clinical-release-validation',
  'codigo_corregido',
  'regresion_automatizada',
  'flujo_clinico_validado',
];

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const normalizeStringList = value =>
  Array.isArray(value)
    ? [...new Set(value.filter(entry => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean))]
    : [];

const sameList = (left, right) => left.length === right.length && left.every((entry, index) => entry === right[index]);

export const loadClinicalReleaseValidationConfig = root => {
  const absolutePath = path.join(root, CONFIG_PATH);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing ${CONFIG_PATH}`);
  }

  const parsed = readJson(absolutePath);
  const defaultClosureGates = normalizeStringList(parsed.closureGates);
  const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios : [];

  return {
    version: parsed.version,
    closureGates: defaultClosureGates,
    scenarios: scenarios.map(scenario => ({
      id: typeof scenario?.id === 'string' ? scenario.id.trim() : '',
      label: typeof scenario?.label === 'string' ? scenario.label.trim() : '',
      riskLevel: typeof scenario?.riskLevel === 'string' ? scenario.riskLevel.trim() : '',
      matrixAreas: normalizeStringList(scenario?.matrixAreas),
      automatedRegression: normalizeStringList(scenario?.automatedRegression),
      manualValidation: normalizeStringList(scenario?.manualValidation),
      closureGates: normalizeStringList(scenario?.closureGates).length
        ? normalizeStringList(scenario?.closureGates)
        : defaultClosureGates,
    })),
  };
};

export const buildClinicalReleaseValidationReport = root => {
  const config = loadClinicalReleaseValidationConfig(root);
  const gitState = getGitReportState(root);
  const matrixAreaIds = new Set(loadReleaseConfidenceMatrixConfig(root).areas.map(area => area.id).filter(Boolean));
  const packageScripts = new Set(Object.keys(readJson(path.join(root, PACKAGE_JSON_PATH)).scripts || {}));
  const issues = [];
  const runbookPath = path.join(root, RUNBOOK_PATH);
  const runbookContent = fs.existsSync(runbookPath) ? fs.readFileSync(runbookPath, 'utf8') : '';
  const missingRunbookPatterns = REQUIRED_RUNBOOK_PATTERNS.filter(pattern => !runbookContent.includes(pattern));
  const runbook = {
    file: RUNBOOK_PATH,
    status: missingRunbookPatterns.length === 0 ? 'ok' : 'invalid',
    missingPatterns: missingRunbookPatterns,
  };

  if (!runbookContent) {
    issues.push(`${RUNBOOK_PATH} is missing.`);
  } else if (missingRunbookPatterns.length > 0) {
    issues.push(`${RUNBOOK_PATH} is missing references to: ${missingRunbookPatterns.join(', ')}`);
  }

  if (config.version !== 1) {
    issues.push(`Expected clinical release validation version 1, received ${String(config.version || 'unknown')}`);
  }

  if (!sameList(config.closureGates, REQUIRED_CLOSURE_GATES)) {
    issues.push(`closureGates must be ${REQUIRED_CLOSURE_GATES.join(', ')}`);
  }

  const duplicateIds = config.scenarios
    .map(scenario => scenario.id)
    .filter(Boolean)
    .filter((id, index, collection) => collection.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    issues.push(`Duplicate clinical validation scenario ids: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const scenarios = config.scenarios.map(scenario => {
    const scenarioIssues = [];

    if (!scenario.id) {
      scenarioIssues.push('Missing scenario id');
    }
    if (!scenario.label) {
      scenarioIssues.push('Missing scenario label');
    }
    if (!VALID_RISK_LEVELS.has(scenario.riskLevel)) {
      scenarioIssues.push(`Invalid riskLevel: ${scenario.riskLevel || 'missing'}`);
    }
    if (!sameList(scenario.closureGates, REQUIRED_CLOSURE_GATES)) {
      scenarioIssues.push(`Invalid closure gates: ${scenario.closureGates.join(', ') || 'missing'}`);
    }
    if (scenario.matrixAreas.length === 0) {
      scenarioIssues.push('Missing release matrix area mapping');
    }
    if (scenario.automatedRegression.length === 0) {
      scenarioIssues.push('Missing automated regression evidence');
    }
    if (scenario.manualValidation.length === 0) {
      scenarioIssues.push('Missing manual clinical validation');
    }

    const unknownMatrixAreas = scenario.matrixAreas.filter(area => !matrixAreaIds.has(area));
    if (unknownMatrixAreas.length > 0) {
      scenarioIssues.push(`Unknown release matrix areas: ${unknownMatrixAreas.join(', ')}`);
    }

    const unknownRegressionScripts = scenario.automatedRegression.filter(script => !packageScripts.has(script));
    if (unknownRegressionScripts.length > 0) {
      scenarioIssues.push(`Unknown package scripts: ${unknownRegressionScripts.join(', ')}`);
    }

    return {
      ...scenario,
      status: scenarioIssues.length === 0 ? 'ok' : 'invalid',
      issues: scenarioIssues,
    };
  });

  for (const scenario of scenarios) {
    for (const issue of scenario.issues) {
      issues.push(`${scenario.id || 'unknown'}: ${issue}`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    ...gitState,
    overall: issues.length === 0 ? 'ok' : 'degraded',
    counts: {
      scenarioCount: scenarios.length,
      highRiskScenarioCount: scenarios.filter(scenario => scenario.riskLevel === 'high').length,
    },
    runbook,
    scenarios,
    issues,
  };
};

const formatList = values => (values.length > 0 ? values.join(', ') : '-');

export const formatClinicalReleaseValidationMarkdown = report => {
  const lines = [
    '# Clinical Release Validation',
    '',
    `Generated at: ${report.generatedAt || 'unknown'}`,
    `Commit: ${report.gitSha || 'unknown'}`,
    `Worktree: ${formatWorktreeState(Boolean(report.gitDirty))}`,
    `Overall: ${report.overall}`,
    `Runbook: ${report.runbook?.file || '-'} (${report.runbook?.status || 'unknown'})`,
    '',
    '## Closure Gates',
    '',
    '- codigo_corregido',
    '- regresion_automatizada',
    '- flujo_clinico_validado',
    '',
    '## Scenarios',
    '',
    '| Scenario | Risk | Matrix areas | Automated regression | Manual validation |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.label || scenario.id} | ${scenario.riskLevel} | ${formatList(scenario.matrixAreas)} | ${formatList(
        scenario.automatedRegression
      )} | ${formatList(scenario.manualValidation)} |`
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
