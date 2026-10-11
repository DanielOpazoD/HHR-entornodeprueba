#!/usr/bin/env node

import { buildEvidenceProvenance } from './evidenceProvenanceSupport.mjs';

import fs from 'node:fs';
import path from 'node:path';
import { formatWorktreeState, getGitReportState } from './gitReportState.mjs';

const MATRIX_PATH = path.join('scripts', 'config', 'release-confidence-matrix.json');
const RELEASE_PACK_PATH = path.join('scripts', 'config', 'release-confidence-pack.json');
const CRITICAL_SMOKE_PATH = path.join('scripts', 'config', 'critical-smoke-pack.json');
const FLOW_BUDGETS_PATH = path.join('scripts', 'config', 'flow-performance-budgets.json');
const CRITICAL_COVERAGE_PATH = path.join('scripts', 'config', 'critical-coverage-thresholds.json');
const TECHNICAL_OWNERSHIP_PATH = path.join('scripts', 'config', 'technical-ownership-map.json');
const PACKAGE_JSON_PATH = path.join('package.json');

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const normalizeStringList = value =>
  Array.isArray(value)
    ? [...new Set(value.filter(entry => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean))]
    : [];

export const loadReleaseConfidenceMatrixConfig = root => {
  const absolutePath = path.join(root, MATRIX_PATH);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing ${MATRIX_PATH}`);
  }

  const parsed = readJson(absolutePath);
  const areas = Array.isArray(parsed.areas) ? parsed.areas : [];

  return {
    version: parsed.version,
    areas: areas.map(area => ({
      id: typeof area?.id === 'string' ? area.id.trim() : '',
      label: typeof area?.label === 'string' && area.label.trim() ? area.label.trim() : '',
      ownerAreaId:
        typeof area?.ownerAreaId === 'string' && area.ownerAreaId.trim()
          ? area.ownerAreaId.trim()
          : '',
      criticalCoverageZones: normalizeStringList(area?.criticalCoverageZones),
      blockingSteps: normalizeStringList(area?.blockingSteps),
      smokeScenarios: normalizeStringList(area?.smokeScenarios),
      flowBudgets: normalizeStringList(area?.flowBudgets),
      validationSuites: normalizeStringList(area?.validationSuites),
    })),
  };
};

const loadDependencies = root => {
  const releasePack = readJson(path.join(root, RELEASE_PACK_PATH));
  const criticalSmoke = readJson(path.join(root, CRITICAL_SMOKE_PATH));
  const flowBudgets = readJson(path.join(root, FLOW_BUDGETS_PATH));
  const criticalCoverage = readJson(path.join(root, CRITICAL_COVERAGE_PATH));
  const technicalOwnership = readJson(path.join(root, TECHNICAL_OWNERSHIP_PATH));
  const packageJson = readJson(path.join(root, PACKAGE_JSON_PATH));

  return {
    releaseStepIds: new Set(
      Array.isArray(releasePack.steps) ? releasePack.steps.map(step => step?.id).filter(Boolean) : []
    ),
    blockingStepIds: new Set(
      Array.isArray(releasePack.profiles?.blocking) ? releasePack.profiles.blocking.filter(Boolean) : []
    ),
    smokeScenarioIds: new Set(
      Array.isArray(criticalSmoke.scenarios)
        ? criticalSmoke.scenarios.map(scenario => scenario?.id).filter(Boolean)
        : []
    ),
    flowBudgetIds: new Set(Object.keys(flowBudgets.flows || {})),
    criticalCoverageZoneIds: new Set(Object.keys(criticalCoverage.zones || {})),
    ownershipAreaIds: new Set(
      Array.isArray(technicalOwnership.areas)
        ? technicalOwnership.areas.map(area => area?.id).filter(Boolean)
        : []
    ),
    scriptIds: new Set(Object.keys(packageJson.scripts || {})),
  };
};

export const buildReleaseConfidenceMatrixReport = root => {
  const matrix = loadReleaseConfidenceMatrixConfig(root);
  const dependencies = loadDependencies(root);
  const gitState = getGitReportState(root);
  const issues = [];

  if (matrix.version !== 1) {
    issues.push(`Expected matrix version 1, received ${String(matrix.version || 'unknown')}`);
  }

  const duplicateIds = matrix.areas
    .map(area => area.id)
    .filter(Boolean)
    .filter((id, index, collection) => collection.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    issues.push(`Duplicate matrix area ids: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const areas = matrix.areas.map(area => {
    const areaIssues = [];

    if (!area.id) {
      areaIssues.push('Missing area id');
    }

    if (!area.label) {
      areaIssues.push('Missing area label');
    }

    if (
      area.criticalCoverageZones.length === 0 &&
      area.smokeScenarios.length === 0 &&
      area.flowBudgets.length === 0 &&
      area.validationSuites.length === 0
    ) {
      areaIssues.push('Area must declare at least one evidence source');
    }

    if (area.blockingSteps.length === 0) {
      areaIssues.push('Area must declare at least one blocking release step');
    }

    if (!area.ownerAreaId) {
      areaIssues.push('Missing ownerAreaId');
    } else if (!dependencies.ownershipAreaIds.has(area.ownerAreaId)) {
      areaIssues.push(`Unknown technical ownership area: ${area.ownerAreaId}`);
    }

    const unknownCoverageZones = area.criticalCoverageZones.filter(
      zone => !dependencies.criticalCoverageZoneIds.has(zone)
    );
    if (unknownCoverageZones.length > 0) {
      areaIssues.push(`Unknown critical coverage zones: ${unknownCoverageZones.join(', ')}`);
    }

    const unknownBlockingSteps = area.blockingSteps.filter(step => !dependencies.releaseStepIds.has(step));
    if (unknownBlockingSteps.length > 0) {
      areaIssues.push(`Unknown release-confidence steps: ${unknownBlockingSteps.join(', ')}`);
    }

    const nonBlockingSteps = area.blockingSteps.filter(
      step => !dependencies.blockingStepIds.has(step)
    );
    if (nonBlockingSteps.length > 0) {
      areaIssues.push(`Non-blocking steps referenced as blocking: ${nonBlockingSteps.join(', ')}`);
    }

    const unknownSmokeScenarios = area.smokeScenarios.filter(
      scenario => !dependencies.smokeScenarioIds.has(scenario)
    );
    if (unknownSmokeScenarios.length > 0) {
      areaIssues.push(`Unknown smoke scenarios: ${unknownSmokeScenarios.join(', ')}`);
    }

    const unknownFlowBudgets = area.flowBudgets.filter(flow => !dependencies.flowBudgetIds.has(flow));
    if (unknownFlowBudgets.length > 0) {
      areaIssues.push(`Unknown flow budgets: ${unknownFlowBudgets.join(', ')}`);
    }

    const unknownValidationSuites = area.validationSuites.filter(
      suite => !dependencies.scriptIds.has(suite)
    );
    if (unknownValidationSuites.length > 0) {
      areaIssues.push(`Unknown validation suites: ${unknownValidationSuites.join(', ')}`);
    }

    return {
      ...area,
      status: areaIssues.length === 0 ? 'ok' : 'invalid',
      issues: areaIssues,
    };
  });

  const mappedCoverageZones = new Set(areas.flatMap(area => area.criticalCoverageZones));
  const mappedBlockingSteps = new Set(areas.flatMap(area => area.blockingSteps));
  const mappedSmokeScenarios = new Set(areas.flatMap(area => area.smokeScenarios));
  const mappedFlowBudgets = new Set(areas.flatMap(area => area.flowBudgets));
  const mappedOwnershipAreas = new Set(areas.map(area => area.ownerAreaId).filter(Boolean));

  const unmappedCoverageZones = [...dependencies.criticalCoverageZoneIds]
    .filter(zone => !mappedCoverageZones.has(zone))
    .sort((left, right) => left.localeCompare(right));
  const unmappedBlockingSteps = [...dependencies.blockingStepIds]
    .filter(step => !mappedBlockingSteps.has(step))
    .sort((left, right) => left.localeCompare(right));
  const unmappedSmokeScenarios = [...dependencies.smokeScenarioIds]
    .filter(scenario => !mappedSmokeScenarios.has(scenario))
    .sort((left, right) => left.localeCompare(right));
  const unmappedFlowBudgets = [...dependencies.flowBudgetIds]
    .filter(flow => !mappedFlowBudgets.has(flow))
    .sort((left, right) => left.localeCompare(right));
  const unmappedOwnershipAreas = [...dependencies.ownershipAreaIds]
    .filter(areaId => !mappedOwnershipAreas.has(areaId))
    .sort((left, right) => left.localeCompare(right));

  if (unmappedCoverageZones.length > 0) {
    issues.push(`Unmapped critical coverage zones: ${unmappedCoverageZones.join(', ')}`);
  }
  if (unmappedBlockingSteps.length > 0) {
    issues.push(`Unmapped blocking release steps: ${unmappedBlockingSteps.join(', ')}`);
  }
  if (unmappedSmokeScenarios.length > 0) {
    issues.push(`Unmapped smoke scenarios: ${unmappedSmokeScenarios.join(', ')}`);
  }
  if (unmappedFlowBudgets.length > 0) {
    issues.push(`Unmapped flow budgets: ${unmappedFlowBudgets.join(', ')}`);
  }
  if (unmappedOwnershipAreas.length > 0) {
    issues.push(`Unmapped technical ownership areas: ${unmappedOwnershipAreas.join(', ')}`);
  }

  for (const area of areas) {
    for (const issue of area.issues) {
      issues.push(`${area.id || 'unknown'}: ${issue}`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    ...gitState,
    generatedFor: buildEvidenceProvenance({ root, reportId: 'release-confidence-matrix', gitState }),
    overall: issues.length === 0 ? 'ok' : 'degraded',
    counts: {
      areaCount: areas.length,
      criticalCoverageZones: dependencies.criticalCoverageZoneIds.size,
      blockingSteps: dependencies.blockingStepIds.size,
      smokeScenarios: dependencies.smokeScenarioIds.size,
      flowBudgets: dependencies.flowBudgetIds.size,
      ownershipAreas: dependencies.ownershipAreaIds.size,
    },
    coverageZones: {
      mapped: mappedCoverageZones.size,
      unmapped: unmappedCoverageZones,
    },
    blockingSteps: {
      mapped: mappedBlockingSteps.size,
      unmapped: unmappedBlockingSteps,
    },
    smokeScenarios: {
      mapped: mappedSmokeScenarios.size,
      unmapped: unmappedSmokeScenarios,
    },
    flowBudgets: {
      mapped: mappedFlowBudgets.size,
      unmapped: unmappedFlowBudgets,
    },
    ownershipAreas: {
      mapped: mappedOwnershipAreas.size,
      unmapped: unmappedOwnershipAreas,
    },
    areas,
    issues,
  };
};

const formatList = values => (values.length > 0 ? values.join(', ') : '-');

export const formatReleaseConfidenceMatrixMarkdown = report => {
  const lines = [
    '# Release Confidence Matrix',
    '',
    `Generated at: ${report.generatedAt}`,
    `Commit: ${report.gitSha}`,
    `Worktree: ${formatWorktreeState(report.gitDirty)}`,
    `Overall: ${report.overall}`,
    '',
    '## Summary',
    '',
    `- Areas: ${report.counts.areaCount}`,
    `- Critical coverage zones mapped: ${report.coverageZones.mapped}/${report.counts.criticalCoverageZones}`,
    `- Blocking release steps mapped: ${report.blockingSteps.mapped}/${report.counts.blockingSteps}`,
    `- Smoke scenarios mapped: ${report.smokeScenarios.mapped}/${report.counts.smokeScenarios}`,
    `- Flow budgets mapped: ${report.flowBudgets.mapped}/${report.counts.flowBudgets}`,
    `- Technical ownership areas mapped: ${report.ownershipAreas.mapped}/${report.counts.ownershipAreas}`,
    '',
    '## Areas',
    '',
    '| Area | Owner | Coverage zones | Blocking steps | Smoke scenarios | Flow budgets | Validation suites | Status |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const area of report.areas) {
    lines.push(
      `| ${area.label} | ${area.ownerAreaId || '-'} | ${formatList(area.criticalCoverageZones)} | ${formatList(area.blockingSteps)} | ${formatList(area.smokeScenarios)} | ${formatList(area.flowBudgets)} | ${formatList(area.validationSuites)} | ${area.status} |`
    );
  }

  lines.push('', '## Governance gaps', '');
  lines.push(`- Unmapped critical coverage zones: ${formatList(report.coverageZones.unmapped)}`);
  lines.push(`- Unmapped blocking release steps: ${formatList(report.blockingSteps.unmapped)}`);
  lines.push(`- Unmapped smoke scenarios: ${formatList(report.smokeScenarios.unmapped)}`);
  lines.push(`- Unmapped flow budgets: ${formatList(report.flowBudgets.unmapped)}`);
  lines.push(`- Unmapped technical ownership areas: ${formatList(report.ownershipAreas.unmapped)}`);

  if (report.issues.length > 0) {
    lines.push('', '## Issues', '');
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join('\n');
};
