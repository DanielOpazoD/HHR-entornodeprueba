#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { ONLINE_ONLY_PRECACHE_PATTERNS } from './config/onlineOnlyAssets.mjs';
import { isDirectCliEntry } from './lib/cliEntry.mjs';

export const BUNDLE_RISK_LEDGER_GENERATED_AT = 'stable:bundle-risk-ledger';

const asArray = value => (Array.isArray(value) ? value : []);

const findChunkBudget = ({ surface, bundleBudgetConfig }) => {
  const pattern = surface.chunkBudgetPattern;
  if (!pattern) return null;
  return (
    asArray(bundleBudgetConfig?.chunkPatternBudgets).find(entry => entry?.pattern === pattern) ||
    null
  );
};

const findStartupBudget = ({ surface, bundleBudgetConfig }) => {
  const label = surface.startupBudgetLabel;
  if (!label) return null;
  return (
    asArray(bundleBudgetConfig?.startupChunkBudgets).find(entry => entry?.label === label) || null
  );
};

const formatDerivedThresholdLabel = ({ thresholdBytes, isStartupBudget, precacheExcluded }) => {
  if (!thresholdBytes) {
    return 'missing enforced budget';
  }

  const formattedBytes = thresholdBytes.toLocaleString('en-US');
  if (isStartupBudget) {
    return `${formattedBytes} bytes startup chunk budget`;
  }
  if (precacheExcluded === true) {
    return `${formattedBytes} bytes async chunk budget`;
  }
  if (precacheExcluded === false) {
    return `${formattedBytes} bytes chunk budget (precache exclusion missing)`;
  }
  return `${formattedBytes} bytes precached chunk budget`;
};

const hasPrecacheExclusion = ({ surface, bundleBudgetConfig }) => {
  const pattern = surface.precacheIgnoredPattern;
  if (!pattern) return null;
  // The budget file no longer carries the list; it comes from onlineOnlyAssets.mjs unless a
  // caller (tests) supplies one explicitly.
  const patterns = Array.isArray(bundleBudgetConfig?.precacheIgnoredAssetPatterns)
    ? bundleBudgetConfig.precacheIgnoredAssetPatterns
    : ONLINE_ONLY_PRECACHE_PATTERNS;
  return patterns.includes(pattern);
};

const buildSurface = ({ surface, bundleBudgetConfig }) => {
  const startupBudget = findStartupBudget({ surface, bundleBudgetConfig });
  const chunkBudget = findChunkBudget({ surface, bundleBudgetConfig });
  const enforcedBudget = startupBudget || chunkBudget;
  const maxBytes = Number(enforcedBudget?.maxBytes || 0);
  const thresholdBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : null;
  const budgetCovered = thresholdBytes !== null;
  const precacheExcluded = hasPrecacheExclusion({ surface, bundleBudgetConfig });
  const thresholdLabel = formatDerivedThresholdLabel({
    thresholdBytes,
    isStartupBudget: Boolean(startupBudget),
    precacheExcluded,
  });
  const issues = [];

  if (!budgetCovered) {
    issues.push(`${surface.id} is missing an enforced bundle budget`);
  }
  if (precacheExcluded === false) {
    issues.push(`${surface.id} is missing precache exclusion`);
  }

  return {
    id: surface.id,
    owner: surface.owner,
    workflow: surface.workflow,
    thresholdBytes,
    thresholdLabel,
    releasePosture: surface.releasePosture,
    guardrails: asArray(surface.guardrails),
    nextAction: surface.nextAction,
    budgetCovered,
    precacheExcluded,
    status: issues.length === 0 ? 'ok' : 'degraded',
    issues,
  };
};

export const buildBundleRiskLedgerReport = ({ ledgerConfig, bundleBudgetConfig }) => {
  const surfaces = asArray(ledgerConfig?.surfaces).map(surface =>
    buildSurface({ surface, bundleBudgetConfig })
  );
  const issues = surfaces.flatMap(surface => surface.issues);

  return {
    generatedAt: BUNDLE_RISK_LEDGER_GENERATED_AT,
    policyVersion: ledgerConfig?.policyVersion || 'unknown',
    status: issues.length === 0 ? 'ok' : 'degraded',
    surfaces,
    issues,
  };
};

const readRequiredJson = (root, relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
};

export const loadBundleRiskLedgerReport = (root = process.cwd()) =>
  buildBundleRiskLedgerReport({
    ledgerConfig: readRequiredJson(root, 'scripts/config/bundle-risk-ledger.json'),
    bundleBudgetConfig: readRequiredJson(root, 'scripts/config/bundle-budget.json'),
  });

export const formatBundleRiskLedgerMarkdown = report => {
  const lines = [
    '# Bundle Risk Ledger Snapshot',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Policy version: ${report.policyVersion}`,
    `- Status: ${report.status}`,
    '',
    '## Surfaces',
    '',
    '| Surface | Owner | Workflow | Threshold | Status | Budget | Precache | Release posture | Guardrails |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const surface of report.surfaces) {
    lines.push(
      `| ${surface.id} | ${surface.owner} | ${surface.workflow} | ${surface.thresholdLabel || 'n/a'} | ${surface.status} | ${surface.budgetCovered ? 'covered' : 'missing'} | ${
        surface.precacheExcluded === null
          ? 'n/a'
          : surface.precacheExcluded
            ? 'excluded'
            : 'missing'
      } | ${surface.releasePosture || 'n/a'} | ${surface.guardrails.join(', ') || 'n/a'} |`
    );
  }

  lines.push('', '## Next Actions', '');
  for (const surface of report.surfaces) {
    lines.push(`- ${surface.id}: ${surface.nextAction}`);
  }

  if (report.issues.length > 0) {
    lines.push('', '## Issues', '');
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join('\n');
};

if (isDirectCliEntry(import.meta.url)) {
  const report = loadBundleRiskLedgerReport();

  if (report.status !== 'ok') {
    console.error('[bundle-risk-ledger] Validation failed:');
    for (const issue of report.issues) {
      console.error(`- ${issue}`);
    }
    console.error('\n' + formatBundleRiskLedgerMarkdown(report));
    process.exit(1);
  }

  console.log(`[bundle-risk-ledger] OK - ${report.surfaces.length} surfaces covered by budgets.`);
}
