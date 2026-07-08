import fs from 'node:fs';
import path from 'node:path';

export const BUNDLE_RISK_LEDGER_GENERATED_AT = 'stable:bundle-risk-ledger';

const asArray = value => (Array.isArray(value) ? value : []);

const hasChunkBudget = ({ surface, bundleBudgetConfig }) => {
  const pattern = surface.chunkBudgetPattern;
  if (!pattern) return false;
  return asArray(bundleBudgetConfig?.chunkPatternBudgets).some(entry => entry?.pattern === pattern);
};

const hasStartupBudget = ({ surface, bundleBudgetConfig }) => {
  const label = surface.startupBudgetLabel;
  if (!label) return false;
  return asArray(bundleBudgetConfig?.startupChunkBudgets).some(entry => entry?.label === label);
};

const hasPrecacheExclusion = ({ surface, bundleBudgetConfig }) => {
  const pattern = surface.precacheIgnoredPattern;
  if (!pattern) return null;
  return asArray(bundleBudgetConfig?.precacheIgnoredAssetPatterns).includes(pattern);
};

const buildSurface = ({ surface, bundleBudgetConfig }) => {
  const budgetCovered =
    hasChunkBudget({ surface, bundleBudgetConfig }) ||
    hasStartupBudget({ surface, bundleBudgetConfig });
  const precacheExcluded = hasPrecacheExclusion({ surface, bundleBudgetConfig });
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
    thresholdLabel: surface.thresholdLabel,
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
        surface.precacheExcluded === null ? 'n/a' : surface.precacheExcluded ? 'excluded' : 'missing'
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
