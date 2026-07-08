import path from 'node:path';

const NEAR_LIMIT_RATIO = 0.85;

const asArray = value => (Array.isArray(value) ? value : []);

const safeRegexTest = (pattern, value) => {
  if (typeof pattern !== 'string' || !pattern) return false;

  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
};

const findMatchingBudget = ({ budgets, assetName }) =>
  asArray(budgets).find(budget => safeRegexTest(budget?.pattern, assetName));

const inferBudgetLabel = ({ budget, fallback }) => {
  if (typeof budget?.label === 'string' && budget.label) {
    return budget.label;
  }

  const pattern = typeof budget?.pattern === 'string' ? budget.pattern : '';
  const vendorMatch = pattern.match(/\^?(vendor-[A-Za-z0-9_-]+)-/);
  if (vendorMatch) {
    return vendorMatch[1];
  }

  const appMatch = pattern.match(/\^?(app-[A-Za-z0-9_-]+)-/);
  if (appMatch) {
    return appMatch[1];
  }

  return fallback;
};

export const classifyBudgetStatus = ({ actual, target, enforced }) => {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || !Number.isFinite(enforced)) {
    return 'unknown';
  }
  if (actual > enforced) return 'blocking';
  if (actual > target) return 'target-miss';
  if (actual >= enforced * NEAR_LIMIT_RATIO || actual >= target * NEAR_LIMIT_RATIO) {
    return 'near-limit';
  }
  return 'ok';
};

export const resolveBuildAssetBudget = ({ file, budgetConfig }) => {
  const assetName = path.basename(String(file || ''));
  const startupBudget = findMatchingBudget({
    budgets: budgetConfig?.startupChunkBudgets,
    assetName,
  });
  if (startupBudget) {
    return {
      maxBytes: Number(startupBudget.maxBytes || 0) || null,
      budgetLabel: inferBudgetLabel({ budget: startupBudget, fallback: 'startupChunkBudget' }),
      budgetSource: 'startupChunkBudget',
      severity: startupBudget.severity === 'warn' ? 'warn' : 'error',
    };
  }

  const patternBudget = findMatchingBudget({
    budgets: budgetConfig?.chunkPatternBudgets,
    assetName,
  });
  if (patternBudget) {
    return {
      maxBytes: Number(patternBudget.maxBytes || 0) || null,
      budgetLabel: inferBudgetLabel({ budget: patternBudget, fallback: 'chunkPatternBudget' }),
      budgetSource: 'chunkPatternBudget',
      severity: 'error',
    };
  }

  return {
    maxBytes: Number(budgetConfig?.chunkMaxBytes || 0) || null,
    budgetLabel: 'chunkMaxBytes',
    budgetSource: 'chunkMaxBytes',
    severity: 'error',
  };
};

export const classifyBuildAssetBudget = ({ file, sizeBytes, budgetConfig }) => {
  const budget = resolveBuildAssetBudget({ file, budgetConfig });
  const maxBytes = Number(budget.maxBytes || 0) || null;
  const numericSizeBytes = Number(sizeBytes || 0);
  const budgetUtilizationPct = maxBytes
    ? Number(((numericSizeBytes / maxBytes) * 100).toFixed(1))
    : null;
  const status =
    maxBytes && numericSizeBytes > maxBytes
      ? budget.severity === 'warn'
        ? 'target-miss'
        : 'blocking'
      : classifyBudgetStatus({
          actual: numericSizeBytes,
          target: maxBytes,
          enforced: maxBytes,
        });

  return {
    file,
    sizeBytes,
    ...budget,
    maxBytes,
    budgetUtilizationPct,
    status,
  };
};
