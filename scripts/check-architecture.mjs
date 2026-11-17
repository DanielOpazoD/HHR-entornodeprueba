#!/usr/bin/env node

/**
 * Layer rules for `src/` imports: controllers and hooks never import a component implementation,
 * feature-restricted layers never cross features, and code outside the daily record context uses
 * its scoped actions. Import cycles have their own control (`check:import-cycles`).
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IMPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']([^"']+)["']/g;
const FEATURE_RESTRICTED_CROSS_IMPORT_LAYERS = new Set(['controllers', 'hooks', 'domain', 'types']);

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath =>
  SOURCE_EXTENSIONS.includes(path.extname(filePath)) && !filePath.endsWith('.d.ts');

const walkFiles = dirPath => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && isSourceFile(absolutePath)) {
      result.push(absolutePath);
    }
  }

  return result;
};

const resolveImport = (importerFilePath, importPath) => {
  if (!importPath.startsWith('@/') && !importPath.startsWith('.')) {
    return null;
  }

  const basePath = importPath.startsWith('@/')
    ? path.join(SRC_ROOT, importPath.slice(2))
    : path.resolve(path.dirname(importerFilePath), importPath);

  const candidates = [];

  if (path.extname(basePath)) {
    candidates.push(basePath);
  } else {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(`${basePath}${extension}`);
    }
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(path.join(basePath, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }

  return null;
};

const resolveFeatureLayer = relativePath => {
  if (relativePath.includes('/controllers/')) return 'controllers';
  if (relativePath.includes('/hooks/')) return 'hooks';
  if (relativePath.includes('/domain/')) return 'domain';
  if (relativePath.includes('/types/')) return 'types';
  if (relativePath.includes('/components/')) return 'components';
  return null;
};

const resolveFeatureName = relativePath => {
  const match = relativePath.match(/^src\/features\/([^/]+)\//);
  return match ? match[1] : null;
};

const collectViolations = files => {
  const layerViolations = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    let match;

    while ((match = IMPORT_REGEX.exec(source)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath) {
        continue;
      }
      const resolved = resolveImport(filePath, importPath);
      if (!resolved) {
        continue;
      }

      const importer = toPosix(path.relative(ROOT, filePath));
      const imported = toPosix(path.relative(ROOT, resolved));
      const importedExt = path.extname(imported);

      const importerIsController = importer.includes('/controllers/');
      const importerIsHook = importer.includes('/hooks/');
      const importedIsComponentImplementation =
        imported.includes('/components/') && (importedExt === '.tsx' || importedExt === '.jsx');

      if (importerIsController && importedIsComponentImplementation) {
        layerViolations.push({
          rule: 'controllers-must-not-import-component-implementation',
          importer,
          imported,
        });
      }

      if (importerIsHook && importedIsComponentImplementation) {
        layerViolations.push({
          rule: 'hooks-must-not-import-component-implementation',
          importer,
          imported,
        });
      }

      const importerFeature = resolveFeatureName(importer);
      const importedFeature = resolveFeatureName(imported);
      const importerLayer = resolveFeatureLayer(importer);
      if (
        importerFeature &&
        importedFeature &&
        importerFeature !== importedFeature &&
        importerLayer &&
        FEATURE_RESTRICTED_CROSS_IMPORT_LAYERS.has(importerLayer)
      ) {
        layerViolations.push({
          rule: 'feature-restricted-layers-must-not-cross-import',
          importer,
          imported,
        });
      }

      const isDailyRecordContextImport =
        imported === 'src/context/DailyRecordContext.tsx' ||
        imported === 'src/context/DailyRecordContext.ts';
      const importerIsTest = importer.includes('/tests/') || importer.includes('.test.');
      const importerIsDailyRecordContext = importer.includes('/context/DailyRecordContext.');
      const sourceUsesMonolithicActionsHook = source.includes('useDailyRecordActions');

      if (
        isDailyRecordContextImport &&
        sourceUsesMonolithicActionsHook &&
        !importerIsTest &&
        !importerIsDailyRecordContext
      ) {
        layerViolations.push({
          rule: 'source-must-use-scoped-daily-record-actions',
          importer,
          imported,
        });
      }
    }
  }

  return layerViolations;
};

const files = walkFiles(SRC_ROOT);
const layerViolations = collectViolations(files);

if (layerViolations.length === 0) {
  console.log('Architecture checks passed.');
  process.exit(0);
}

console.error('\nLayer violations:');
for (const { rule, importer, imported } of layerViolations) {
  console.error(`- [${rule}] ${importer} -> ${imported}`);
}

process.exit(1);
