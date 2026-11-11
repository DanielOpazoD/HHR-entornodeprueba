#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LAZY_VIEWS_PATH = path.join(ROOT, 'src', 'app-shell', 'LazyViews.ts');
const source = fs.readFileSync(LAZY_VIEWS_PATH, 'utf8');

// Subpaths explicitly sanctioned as lazy entrypoints. Keep this list tight:
// each entry must be a light barrel that is intentionally split out of the
// feature's default public surface (e.g. to keep the authenticated-shell
// chunk under its budget).
const ALLOWED_LAZY_SUBPATHS = new Set([
  '@/features/admin/admission-audit',
  '@/features/census/census-view',
  '@/features/census/public-components',
]);

const violations = [...source.matchAll(/@\/features\/([^/'"]+)\/([^'"]+)/g)]
  .map(match => ({
    feature: match[1],
    importPath: `@/features/${match[1]}/${match[2]}`,
  }))
  .filter(entry => entry.feature !== 'whatsapp')
  .filter(entry => !ALLOWED_LAZY_SUBPATHS.has(entry.importPath));

if (violations.length > 0) {
  console.error('\nLazyViews feature entrypoint violations:');
  for (const violation of violations) {
    console.error(`- ${violation.importPath}`);
  }
  process.exit(1);
}

console.log('LazyViews feature entrypoint checks passed.');
