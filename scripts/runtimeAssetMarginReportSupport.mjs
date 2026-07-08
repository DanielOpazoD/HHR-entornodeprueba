import fs from 'node:fs';
import path from 'node:path';
import { classifyBuildAssetBudget } from './bundleBudgetSupport.mjs';

export const RUNTIME_ASSET_MARGIN_GENERATED_AT = 'stable:runtime-asset-margin';

const asArray = value => (Array.isArray(value) ? value : []);

const safeRegex = pattern => {
  if (typeof pattern !== 'string' || !pattern) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
};

const safeRegexTest = (pattern, value) => {
  const regex = safeRegex(pattern);
  return regex ? regex.test(value) : false;
};

const getAssetName = file => path.basename(String(file || ''));

const findStartupBudgetByLabel = ({ bundleBudgetConfig, label }) =>
  asArray(bundleBudgetConfig?.startupChunkBudgets).find(entry => entry?.label === label);

const resolveSurfaceBudgetPattern = ({ surface, bundleBudgetConfig }) => {
  if (surface?.chunkBudgetPattern) {
    return surface.chunkBudgetPattern;
  }

  const startupBudget = findStartupBudgetByLabel({
    bundleBudgetConfig,
    label: surface?.startupBudgetLabel,
  });
  return startupBudget?.pattern || '';
};

const resolveSurfaceBudget = ({ surface, bundleBudgetConfig }) => {
  const pattern = resolveSurfaceBudgetPattern({ surface, bundleBudgetConfig });
  const startupBudget = asArray(bundleBudgetConfig?.startupChunkBudgets).find(
    entry => entry?.pattern === pattern
  );
  const patternBudget = asArray(bundleBudgetConfig?.chunkPatternBudgets).find(
    entry => entry?.pattern === pattern
  );
  const matchedBudget = startupBudget || patternBudget;
  const budgetSource = startupBudget
    ? 'startupChunkBudget'
    : patternBudget
      ? 'chunkPatternBudget'
      : 'chunkMaxBytes';

  return {
    pattern,
    maxBytes:
      Number(matchedBudget?.maxBytes || 0) || Number(bundleBudgetConfig?.chunkMaxBytes || 0) || null,
    budgetLabel: matchedBudget?.label || budgetSource,
    budgetSource,
    severity: matchedBudget?.severity === 'warn' ? 'warn' : 'error',
  };
};

const findSurfaceAsset = ({ surface, assets, bundleBudgetConfig }) => {
  const pattern = resolveSurfaceBudgetPattern({ surface, bundleBudgetConfig });
  if (!pattern) return null;
  return (
    assets
      .filter(asset => safeRegexTest(pattern, getAssetName(asset.file)))
      .sort((left, right) => right.sizeBytes - left.sizeBytes)[0] || null
  );
};

const normalizeAction = ({ status, surface }) => {
  if (status === 'blocking' || status === 'missing') {
    return `Intervene before merge: ${surface.nextAction || 're-split the owning runtime asset.'}`;
  }
  if (status === 'near-limit' || status === 'target-miss') {
    return `Observe with owner: ${surface.nextAction || 'keep the current lazy boundary under review.'}`;
  }
  return surface.nextAction || 'No action while the asset remains under budget.';
};

const buildTrackedSurface = ({ surface, assets, bundleBudgetConfig }) => {
  const asset = findSurfaceAsset({ surface, assets, bundleBudgetConfig });
  const budget = resolveSurfaceBudget({ surface, bundleBudgetConfig });

  if (!asset) {
    return {
      id: surface.id,
      owner: surface.owner,
      workflow: surface.workflow,
      loadReason: surface.loadReason || surface.workflow,
      file: null,
      sizeBytes: 0,
      maxBytes: budget.maxBytes,
      budgetLabel: budget.budgetLabel,
      budgetSource: budget.budgetSource,
      budgetUtilizationPct: null,
      status: 'missing',
      releasePosture: surface.releasePosture,
      nextAction: normalizeAction({ status: 'missing', surface }),
    };
  }

  const classification = classifyBuildAssetBudget({
    file: asset.file,
    sizeBytes: asset.sizeBytes,
    budgetConfig: bundleBudgetConfig,
  });

  return {
    id: surface.id,
    owner: surface.owner,
    workflow: surface.workflow,
    loadReason: surface.loadReason || surface.workflow,
    file: asset.file,
    sizeBytes: asset.sizeBytes,
    maxBytes: classification.maxBytes,
    budgetLabel: classification.budgetLabel,
    budgetSource: classification.budgetSource,
    budgetUtilizationPct: classification.budgetUtilizationPct,
    status: classification.status,
    releasePosture: surface.releasePosture,
    nextAction: normalizeAction({ status: classification.status, surface }),
  };
};

const findTrackedSurfaceForAsset = ({ asset, surfaces, bundleBudgetConfig }) =>
  surfaces.find(surface =>
    safeRegexTest(
      resolveSurfaceBudgetPattern({ surface, bundleBudgetConfig }),
      getAssetName(asset.file)
    )
  );

const buildTopAsset = ({ asset, surfaces, bundleBudgetConfig }) => {
  const classification = classifyBuildAssetBudget({
    file: asset.file,
    sizeBytes: asset.sizeBytes,
    budgetConfig: bundleBudgetConfig,
  });
  const surface = findTrackedSurfaceForAsset({ asset, surfaces, bundleBudgetConfig });

  return {
    file: asset.file,
    sizeBytes: asset.sizeBytes,
    maxBytes: classification.maxBytes,
    budgetLabel: classification.budgetLabel,
    budgetUtilizationPct: classification.budgetUtilizationPct,
    status: classification.status,
    owner: surface?.owner || 'unassigned/runtime',
    loadReason: surface?.loadReason || surface?.workflow || 'Largest production asset by byte size',
  };
};

const summarizeStatus = trackedSurfaces => {
  const counts = trackedSurfaces.reduce(
    (summary, surface) => ({
      ...summary,
      [surface.status]: (summary[surface.status] || 0) + 1,
    }),
    {}
  );
  const hasBlocking = trackedSurfaces.some(surface =>
    ['blocking', 'missing'].includes(surface.status)
  );
  const hasNearLimit = trackedSurfaces.some(surface =>
    ['near-limit', 'target-miss'].includes(surface.status)
  );

  return {
    status: hasBlocking ? 'blocking' : hasNearLimit ? 'near-limit' : 'ok',
    counts,
  };
};

export const buildRuntimeAssetMarginReport = ({
  ledgerConfig,
  bundleBudgetConfig,
  assets,
  gitSha = 'unknown',
  generatedAt = RUNTIME_ASSET_MARGIN_GENERATED_AT,
}) => {
  const surfaces = asArray(ledgerConfig?.surfaces);
  const jsAssets = asArray(assets)
    .filter(asset => /\.(m?js)$/.test(String(asset?.file || '')))
    .map(asset => ({
      file: String(asset.file),
      sizeBytes: Number(asset.sizeBytes || 0),
    }));

  const trackedSurfaces = surfaces.map(surface =>
    buildTrackedSurface({ surface, assets: jsAssets, bundleBudgetConfig })
  );
  const summary = summarizeStatus(trackedSurfaces);
  const topAssets = [...jsAssets]
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, 10)
    .map(asset => buildTopAsset({ asset, surfaces, bundleBudgetConfig }));

  return {
    generatedAt,
    gitSha,
    policyVersion: ledgerConfig?.policyVersion || 'unknown',
    status: summary.status,
    summary: {
      trackedSurfaces: trackedSurfaces.length,
      topAssets: topAssets.length,
      ...summary.counts,
    },
    trackedSurfaces,
    topAssets,
  };
};

const readRequiredJson = (root, relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
};

const collectDistAssets = ({ root, distDir }) => {
  const assetsDir = path.join(root, distDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Missing ${path.relative(root, assetsDir)}. Run npm run build first.`);
  }

  return fs
    .readdirSync(assetsDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const filePath = path.join(assetsDir, entry.name);
      return {
        file: `dist/assets/${entry.name}`,
        sizeBytes: fs.statSync(filePath).size,
      };
    });
};

export const loadRuntimeAssetMarginReport = ({
  root = process.cwd(),
  distDir = 'dist',
  gitSha = 'unknown',
  generatedAt = RUNTIME_ASSET_MARGIN_GENERATED_AT,
} = {}) =>
  buildRuntimeAssetMarginReport({
    ledgerConfig: readRequiredJson(root, 'scripts/config/bundle-risk-ledger.json'),
    bundleBudgetConfig: readRequiredJson(root, 'scripts/config/bundle-budget.json'),
    assets: collectDistAssets({ root, distDir }),
    gitSha,
    generatedAt,
  });

const formatBytes = value => `${Math.round(Number(value || 0) / 1024)} KB`;

const formatPct = value => (value === null || value === undefined ? 'n/a' : `${value}%`);

const markdownCell = value =>
  String(value ?? 'n/a')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');

export const formatRuntimeAssetMarginMarkdown = report => {
  const lines = [
    '# Runtime Asset Margin',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Commit: ${report.gitSha || 'unknown'}`,
    `- Policy version: ${report.policyVersion}`,
    `- Status: ${report.status}`,
    '',
    '## Tracked Surfaces',
    '',
    '| Surface | Owner | Load reason | Asset | Size | Budget | Usage | Status | Next action |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |',
  ];

  for (const surface of report.trackedSurfaces || []) {
    lines.push(
      `| ${markdownCell(surface.id)} | ${markdownCell(surface.owner)} | ${markdownCell(surface.loadReason)} | ${
        markdownCell(surface.file || 'missing')
      } | ${formatBytes(surface.sizeBytes)} | ${formatBytes(surface.maxBytes)} | ${formatPct(
        surface.budgetUtilizationPct
      )} | ${markdownCell(surface.status)} | ${markdownCell(surface.nextAction)} |`
    );
  }

  lines.push(
    '',
    '## Top Production Assets',
    '',
    '| Asset | Owner | Load reason | Size | Budget | Usage | Status |',
    '| --- | --- | --- | ---: | ---: | ---: | --- |'
  );

  for (const asset of report.topAssets || []) {
    lines.push(
      `| ${markdownCell(asset.file)} | ${markdownCell(asset.owner)} | ${markdownCell(asset.loadReason)} | ${formatBytes(
        asset.sizeBytes
      )} | ${formatBytes(asset.maxBytes)} | ${formatPct(asset.budgetUtilizationPct)} | ${
        markdownCell(asset.status)
      } |`
    );
  }

  return lines.join('\n');
};
