#!/usr/bin/env node

/**
 * Layer rules for `src/` imports: controllers and hooks never import a component implementation,
 * and feature-restricted layers never cross features. Import cycles have their own control
 * (`check:import-cycles`). Module references are parsed with the TypeScript AST so comments,
 * strings and dynamic `import()` calls are handled accurately.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isDirectCliEntry } from './lib/cliEntry.mjs';
import { readClassifiedReferences, resolveSpecifier, toPosix } from './lib/sourceModules.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const FEATURE_RESTRICTED_CROSS_IMPORT_LAYERS = new Set(['controllers', 'hooks', 'domain', 'types']);

const isSourceFile = filePath =>
  SOURCE_EXTENSIONS.has(path.extname(filePath)) && !filePath.endsWith('.d.ts');

const walkSourceFiles = (root, relativeDir = 'src') => {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const result = [];

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      result.push(...walkSourceFiles(root, relativePath));
      continue;
    }
    if (entry.isFile() && isSourceFile(relativePath)) {
      result.push(relativePath);
    }
  }

  return result;
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

export const collectArchitectureViolations = (root = process.cwd()) => {
  const files = walkSourceFiles(root, 'src');
  const fileSet = new Set(files);
  const layerViolations = [];

  for (const importer of files) {
    const source = fs.readFileSync(path.join(root, importer), 'utf8');
    const seen = new Set();

    for (const ref of readClassifiedReferences(importer, source)) {
      const imported = resolveSpecifier(importer, ref.specifier, fileSet);
      if (!imported) continue;

      const importedExt = path.extname(imported);
      const importerIsController = importer.includes('/controllers/');
      const importerIsHook = importer.includes('/hooks/');
      const importedIsComponentImplementation =
        imported.includes('/components/') && (importedExt === '.tsx' || importedExt === '.jsx');

      const pushUnique = rule => {
        const key = `${rule}\0${importer}\0${imported}`;
        if (seen.has(key)) return;
        seen.add(key);
        layerViolations.push({ rule, importer, imported });
      };

      if (importerIsController && importedIsComponentImplementation) {
        pushUnique('controllers-must-not-import-component-implementation');
      }

      if (importerIsHook && importedIsComponentImplementation) {
        pushUnique('hooks-must-not-import-component-implementation');
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
        pushUnique('feature-restricted-layers-must-not-cross-import');
      }
    }
  }

  return layerViolations;
};

if (isDirectCliEntry(import.meta.url)) {
  const layerViolations = collectArchitectureViolations(process.cwd());

  if (layerViolations.length === 0) {
    console.log('Architecture checks passed.');
    process.exit(0);
  }

  console.error('\nLayer violations:');
  for (const { rule, importer, imported } of layerViolations) {
    console.error(`- [${rule}] ${importer} -> ${imported}`);
  }

  process.exit(1);
}
