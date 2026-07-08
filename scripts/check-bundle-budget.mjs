#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const indexHtmlPath = path.join(distDir, 'index.html');
const serviceWorkerPath = path.join(distDir, 'service-worker.js');
const configPath = path.join(rootDir, 'scripts', 'config', 'bundle-budget.json');

const fail = message => {
  console.error(`[bundle-budget] ${message}`);
  process.exit(1);
};

const toKb = value => `${(value / 1024).toFixed(1)} KB`;
const toPct = (value, max) => `${((value / max) * 100).toFixed(1)}%`;
const nearLimitThresholdRatio = 0.9;

if (!fs.existsSync(configPath)) {
  fail(`Missing config file: ${configPath}`);
}

if (!fs.existsSync(indexHtmlPath) || !fs.existsSync(assetsDir)) {
  fail('dist assets not found. Run "npm run build" before checking bundle budgets.');
}

let parsedConfig;
try {
  parsedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  fail(`Invalid JSON in config: ${error instanceof Error ? error.message : String(error)}`);
}

const entryMaxBytes = Number(parsedConfig?.entryMaxBytes || 0);
const chunkMaxBytes = Number(parsedConfig?.chunkMaxBytes || 0);
const precacheMaxBytes = Number(parsedConfig?.precacheMaxBytes || 0);
const precacheIgnoredAssetPatterns = Array.isArray(parsedConfig?.precacheIgnoredAssetPatterns)
  ? parsedConfig.precacheIgnoredAssetPatterns
  : [];
const forbiddenAssetPatterns = Array.isArray(parsedConfig?.forbiddenAssetPatterns)
  ? parsedConfig.forbiddenAssetPatterns
  : [];
const startupChunkBudgets = Array.isArray(parsedConfig?.startupChunkBudgets)
  ? parsedConfig.startupChunkBudgets
  : [];
const assetPatternBudgets = Array.isArray(parsedConfig?.assetPatternBudgets)
  ? parsedConfig.assetPatternBudgets
  : [];
const chunkPatternBudgets = Array.isArray(parsedConfig?.chunkPatternBudgets)
  ? parsedConfig.chunkPatternBudgets
  : [];

if (!entryMaxBytes || !chunkMaxBytes) {
  fail('Config must include positive entryMaxBytes and chunkMaxBytes');
}

if (!precacheMaxBytes || precacheIgnoredAssetPatterns.length === 0) {
  fail('Config must include positive precacheMaxBytes and precacheIgnoredAssetPatterns');
}

if (forbiddenAssetPatterns.length === 0) {
  fail('Config must include forbiddenAssetPatterns');
}

const buildRegex = (pattern, label) => {
  try {
    return new RegExp(pattern);
  } catch (error) {
    fail(
      `Invalid ${label} regex "${pattern}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const html = fs.readFileSync(indexHtmlPath, 'utf8');
const entryScriptMatches = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)];

if (entryScriptMatches.length === 0) {
  fail('No entry script found in dist/index.html');
}

const entryFiles = entryScriptMatches.map(match => {
  const sourcePath = match[1];
  const normalized = sourcePath.startsWith('/') ? sourcePath.slice(1) : sourcePath;
  const fullPath = path.join(distDir, normalized);
  if (!fs.existsSync(fullPath)) {
    fail(`Entry script declared in HTML not found on disk: ${normalized}`);
  }
  return {
    name: path.basename(fullPath),
    filePath: fullPath,
    size: fs.statSync(fullPath).size,
  };
});

const jsAssets = fs
  .readdirSync(assetsDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
  .map(entry => {
    const filePath = path.join(assetsDir, entry.name);
    return {
      name: entry.name,
      filePath,
      size: fs.statSync(filePath).size,
    };
  });

const collectDistAssets = directory =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectDistAssets(filePath);
    }
    if (!entry.isFile()) {
      return [];
    }
    return [
      {
        name: path.relative(distDir, filePath).replace(/\\/g, '/'),
        filePath,
        size: fs.statSync(filePath).size,
      },
    ];
  });

const distAssets = collectDistAssets(distDir);

const violations = [];
const nearLimitWarnings = [];

const forbiddenAssetRegexes = forbiddenAssetPatterns
  .filter(pattern => typeof pattern === 'string' && pattern.length > 0)
  .map(pattern => buildRegex(pattern, 'forbidden asset'));

const forbiddenAssets = distAssets.filter(asset =>
  forbiddenAssetRegexes.some(regex => regex.test(asset.name))
);
if (forbiddenAssets.length > 0) {
  violations.push(
    `Forbidden dist assets found: ${forbiddenAssets
      .map(asset => asset.name)
      .slice(0, 5)
      .join(', ')}${forbiddenAssets.length > 5 ? ', ...' : ''}`
  );
}

const ignoredPrecacheRegexes = precacheIgnoredAssetPatterns
  .filter(pattern => typeof pattern === 'string' && pattern.length > 0)
  .map(pattern => buildRegex(pattern, 'precache ignore'));

const chunkPatternBudgetEntries = chunkPatternBudgets
  .map(patternBudget => {
    const pattern = typeof patternBudget?.pattern === 'string' ? patternBudget.pattern : '';
    const maxBytes = Number(patternBudget?.maxBytes || 0);
    if (!pattern || !maxBytes) return null;
    return {
      pattern,
      maxBytes,
      regex: buildRegex(pattern, 'chunk budget'),
    };
  })
  .filter(Boolean);

if (!fs.existsSync(serviceWorkerPath)) {
  fail('dist/service-worker.js not found. Run "npm run build" before checking bundle budgets.');
}

const serviceWorker = fs.readFileSync(serviceWorkerPath, 'utf8');
const precacheAssetNames = [
  ...new Set([...serviceWorker.matchAll(/"url":"([^"]+)"/g)].map(match => match[1])),
]
  .map(assetName => assetName.replace(/^\//, '').split('?')[0])
  .filter(assetName => assetName.length > 0);

const precacheAssets = precacheAssetNames
  .map(assetName => {
    const filePath = path.join(distDir, assetName);
    if (!fs.existsSync(filePath)) return null;
    return {
      name: assetName,
      filePath,
      size: fs.statSync(filePath).size,
    };
  })
  .filter(Boolean);

const missingPrecacheAssets = precacheAssetNames.filter(
  assetName => !fs.existsSync(path.join(distDir, assetName))
);
if (missingPrecacheAssets.length > 0) {
  violations.push(
    `Service worker precaches files that are not present in dist: ${missingPrecacheAssets
      .slice(0, 5)
      .join(', ')}${missingPrecacheAssets.length > 5 ? ', ...' : ''}`
  );
}

const ignoredPrecacheAssets = precacheAssets.filter(asset =>
  ignoredPrecacheRegexes.some(regex => regex.test(asset.name))
);
if (ignoredPrecacheAssets.length > 0) {
  violations.push(
    `Service worker precaches ignored assets: ${ignoredPrecacheAssets
      .map(asset => asset.name)
      .slice(0, 5)
      .join(', ')}${ignoredPrecacheAssets.length > 5 ? ', ...' : ''}`
  );
}

const precacheTotalBytes = precacheAssets.reduce((total, asset) => total + asset.size, 0);
if (precacheTotalBytes > precacheMaxBytes) {
  violations.push(
    `Precache payload is ${toKb(precacheTotalBytes)} (limit ${toKb(precacheMaxBytes)})`
  );
} else if (precacheTotalBytes / precacheMaxBytes >= nearLimitThresholdRatio) {
  nearLimitWarnings.push(
    `Precache payload is near limit: ${toKb(precacheTotalBytes)} (${toPct(precacheTotalBytes, precacheMaxBytes)} of ${toKb(precacheMaxBytes)})`
  );
}

for (const entryFile of entryFiles) {
  if (entryFile.size > entryMaxBytes) {
    violations.push(
      `Entry "${entryFile.name}" is ${toKb(entryFile.size)} (limit ${toKb(entryMaxBytes)})`
    );
  } else if (entryFile.size / entryMaxBytes >= nearLimitThresholdRatio) {
    nearLimitWarnings.push(
      `Entry "${entryFile.name}" is near limit: ${toKb(entryFile.size)} (${toPct(entryFile.size, entryMaxBytes)} of ${toKb(entryMaxBytes)})`
    );
  }
}

for (const asset of jsAssets) {
  if (chunkPatternBudgetEntries.some(patternBudget => patternBudget.regex.test(asset.name))) {
    continue;
  }

  if (asset.size > chunkMaxBytes) {
    violations.push(
      `Chunk "${asset.name}" is ${toKb(asset.size)} (global chunk limit ${toKb(chunkMaxBytes)})`
    );
  } else if (asset.size / chunkMaxBytes >= nearLimitThresholdRatio) {
    nearLimitWarnings.push(
      `Chunk "${asset.name}" is near global limit: ${toKb(asset.size)} (${toPct(asset.size, chunkMaxBytes)} of ${toKb(chunkMaxBytes)})`
    );
  }
}

for (const patternBudget of chunkPatternBudgetEntries) {
  for (const asset of jsAssets.filter(candidate => patternBudget.regex.test(candidate.name))) {
    if (asset.size > patternBudget.maxBytes) {
      violations.push(
        `Chunk "${asset.name}" is ${toKb(asset.size)} (pattern ${patternBudget.pattern} limit ${toKb(patternBudget.maxBytes)})`
      );
    } else if (asset.size / patternBudget.maxBytes >= nearLimitThresholdRatio) {
      nearLimitWarnings.push(
        `Chunk "${asset.name}" is near pattern limit: ${toKb(asset.size)} (${toPct(asset.size, patternBudget.maxBytes)} of ${toKb(patternBudget.maxBytes)}) [pattern ${patternBudget.pattern}]`
      );
    }
  }
}

for (const patternBudget of assetPatternBudgets) {
  const pattern = typeof patternBudget?.pattern === 'string' ? patternBudget.pattern : '';
  const maxBytes = Number(patternBudget?.maxBytes || 0);
  if (!pattern || !maxBytes) continue;

  const regex = buildRegex(pattern, 'asset budget');

  const matchingAssets = distAssets.filter(candidate => regex.test(candidate.name));
  if (matchingAssets.length === 0) {
    violations.push(`No dist asset matched budget pattern ${pattern}`);
  }

  for (const asset of matchingAssets) {
    if (asset.size > maxBytes) {
      violations.push(
        `Asset "${asset.name}" is ${toKb(asset.size)} (pattern ${pattern} limit ${toKb(maxBytes)})`
      );
    } else if (asset.size / maxBytes >= nearLimitThresholdRatio) {
      nearLimitWarnings.push(
        `Asset "${asset.name}" is near pattern limit: ${toKb(asset.size)} (${toPct(asset.size, maxBytes)} of ${toKb(maxBytes)}) [pattern ${pattern}]`
      );
    }
  }
}

for (const startupBudget of startupChunkBudgets) {
  const label = typeof startupBudget?.label === 'string' ? startupBudget.label : 'startup-chunk';
  const source = startupBudget?.source === 'entry' ? 'entry' : 'pattern';
  const pattern = typeof startupBudget?.pattern === 'string' ? startupBudget.pattern : '';
  const maxBytes = Number(startupBudget?.maxBytes || 0);
  const severity = startupBudget?.severity === 'warn' ? 'warn' : 'error';

  if ((!pattern && source !== 'entry') || !maxBytes) {
    fail(`Invalid startup chunk budget for ${label}`);
  }

  let candidateAssets;
  if (source === 'entry') {
    candidateAssets = entryFiles;
  } else {
    const regex = buildRegex(pattern, `startup chunk budget for ${label}`);

    candidateAssets = jsAssets.filter(candidate => regex.test(candidate.name));
  }

  for (const asset of candidateAssets) {
    if (asset.size > maxBytes) {
      const message = `Startup chunk budget (${label}): "${asset.name}" is ${toKb(asset.size)} (limit ${toKb(maxBytes)})`;
      if (severity === 'error') {
        violations.push(message);
      } else {
        nearLimitWarnings.push(message);
      }
    } else if (asset.size / maxBytes >= nearLimitThresholdRatio) {
      nearLimitWarnings.push(
        `Startup chunk (${label}) is near limit: "${asset.name}" is ${toKb(asset.size)} (${toPct(asset.size, maxBytes)} of ${toKb(maxBytes)})`
      );
    }
  }
}

if (violations.length > 0) {
  console.error('[bundle-budget] Validation failed:');
  violations.forEach(violation => console.error(`- ${violation}`));
  process.exit(1);
}

const largestChunks = [...jsAssets].sort((a, b) => b.size - a.size).slice(0, 5);
console.warn('[bundle-budget] OK');
console.warn(
  `[bundle-budget] Entry budget: ${toKb(entryMaxBytes)} | Chunk budget: ${toKb(chunkMaxBytes)}`
);
console.warn(
  `[bundle-budget] Precache payload: ${toKb(precacheTotalBytes)} (${precacheAssets.length} files, limit ${toKb(precacheMaxBytes)})`
);
entryFiles.forEach(entryFile => {
  console.warn(`[bundle-budget] Entry asset: ${entryFile.name} (${toKb(entryFile.size)})`);
});
largestChunks.forEach(chunk => {
  console.warn(`[bundle-budget] Largest chunk: ${chunk.name} (${toKb(chunk.size)})`);
});
assetPatternBudgets.forEach(patternBudget => {
  const pattern = typeof patternBudget?.pattern === 'string' ? patternBudget.pattern : '';
  const regex = pattern ? new RegExp(pattern) : null;
  if (!regex) return;
  distAssets
    .filter(candidate => regex.test(candidate.name))
    .forEach(asset => {
      console.warn(`[bundle-budget] Runtime asset: ${asset.name} (${toKb(asset.size)})`);
    });
});
if (nearLimitWarnings.length > 0) {
  console.warn('[bundle-budget] Near-limit warnings:');
  nearLimitWarnings.forEach(warning => console.warn(`- ${warning}`));
}
