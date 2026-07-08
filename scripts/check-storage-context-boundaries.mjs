#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const RESTRICTED_EXACT_IMPORTS = new Set([
  '@/services/storage/firestoreService',
  '@/services/storage/syncQueueService',
  '@/services/storage/legacyFirebaseService',
]);

const RESTRICTED_SUFFIXES = [
  '/storage/firestoreService',
  '/storage/syncQueueService',
  '/storage/legacyFirebaseService',
];

const ALLOWED_IMPORTERS = new Set([
  'src/services/storage/firestore/index.ts',
  'src/services/storage/sync/index.ts',
  'src/services/storage/legacyFirebaseService.ts',
]);

const IMPORT_EXPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_REGEX = /import\(\s*["']([^"']+)["']\s*\)/g;

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension) || filePath.endsWith('.d.ts')) return false;

  const relativePath = toPosix(path.relative(ROOT, filePath));
  if (relativePath.includes('/tests/')) return false;
  if (relativePath.includes('.test.') || relativePath.includes('.spec.')) return false;
  return !relativePath.includes('.stories.');
};

const walkFiles = dirPath => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && isSourceFile(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
};

const isRestrictedImport = importPath =>
  RESTRICTED_EXACT_IMPORTS.has(importPath) ||
  RESTRICTED_SUFFIXES.some(suffix => importPath.endsWith(suffix));

const files = walkFiles(SRC_ROOT);
const violations = [];

for (const absolutePath of files) {
  const importerPath = toPosix(path.relative(ROOT, absolutePath));
  if (ALLOWED_IMPORTERS.has(importerPath)) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  IMPORT_EXPORT_REGEX.lastIndex = 0;
  DYNAMIC_IMPORT_REGEX.lastIndex = 0;

  let match;
  while ((match = IMPORT_EXPORT_REGEX.exec(source)) !== null) {
    const importPath = match[1] || match[2];
    if (importPath && isRestrictedImport(importPath)) {
      violations.push(`${importerPath} -> ${importPath}`);
    }
  }

  while ((match = DYNAMIC_IMPORT_REGEX.exec(source)) !== null) {
    const importPath = match[1];
    if (importPath && isRestrictedImport(importPath)) {
      violations.push(`${importerPath} -> ${importPath}`);
    }
  }
}

if (violations.length > 0) {
  console.error('\nStorage context boundary violations:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Storage context boundary checks passed.');
