#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const SHARED_LAYERS = ['components', 'hooks', 'services', 'context', 'domain'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IMPORT_EXPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_REGEX = /import\(\s*["']([^"']+)["']\s*\)/g;
const GOVERNED_PUBLIC_FEATURE_IMPORTS = new Set([
  // AppContentOverlays dynamically loads the census heavy-component barrel so
  // it stays out of the app-authenticated-shell chunk. Static imports to this
  // path are still forbidden for other shared-layer files.
  'src/components/layout/app-content/AppContentOverlays.tsx|@/features/census/public-components',
]);

const toPosix = value => value.split(path.sep).join('/');

const isGovernedCensusControllerShim = ({ relativePath, importPath, source }) => {
  if (!relativePath.startsWith('src/hooks/controllers/')) return false;
  if (!importPath.startsWith('@/features/census/controllers/')) return false;

  const importerModule = path.basename(relativePath, path.extname(relativePath));
  const expectedSource = `export * from '@/features/census/controllers/${importerModule}';`;
  return source.trim() === expectedSource;
};

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension) || filePath.endsWith('.d.ts')) return false;

  const relative = toPosix(path.relative(ROOT, filePath));
  if (
    relative.includes('.test.') ||
    relative.includes('.spec.') ||
    relative.includes('.stories.')
  ) {
    return false;
  }
  return true;
};

const walkFiles = dirPath => {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
      continue;
    }
    if (entry.isFile() && isSourceFile(absolute)) {
      files.push(absolute);
    }
  }

  return files;
};

const violations = [];

for (const layer of SHARED_LAYERS) {
  const files = walkFiles(path.join(SRC_ROOT, layer));

  for (const absolutePath of files) {
    const relativePath = toPosix(path.relative(ROOT, absolutePath));
    const source = fs.readFileSync(absolutePath, 'utf8');
    const seen = new Set();
    let match;
    IMPORT_EXPORT_REGEX.lastIndex = 0;
    DYNAMIC_IMPORT_REGEX.lastIndex = 0;

    while ((match = IMPORT_EXPORT_REGEX.exec(source)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath || !importPath.startsWith('@/features/')) continue;
      if (isGovernedCensusControllerShim({ relativePath, importPath, source })) continue;
      if (GOVERNED_PUBLIC_FEATURE_IMPORTS.has(`${relativePath}|${importPath}`)) continue;
      if (seen.has(importPath)) continue;
      seen.add(importPath);
      violations.push(`${relativePath} -> ${importPath}`);
    }

    while ((match = DYNAMIC_IMPORT_REGEX.exec(source)) !== null) {
      const importPath = match[1];
      if (!importPath || !importPath.startsWith('@/features/')) continue;
      if (GOVERNED_PUBLIC_FEATURE_IMPORTS.has(`${relativePath}|${importPath}`)) continue;
      if (seen.has(importPath)) continue;
      seen.add(importPath);
      violations.push(`${relativePath} -> ${importPath}`);
    }
  }
}

if (violations.length === 0) {
  console.log('Shared layer boundary checks passed.');
  process.exit(0);
}

console.error(
  '\nShared layer boundary violations (no direct imports from shared layers to features):'
);
for (const violation of violations) {
  console.error(`- ${violation}`);
}
process.exit(1);
