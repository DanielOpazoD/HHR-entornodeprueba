#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONTROLLERS_DIR = path.join(ROOT, 'src', 'features', 'census', 'controllers');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const FORBIDDEN_PATTERNS = [
  { id: 'window-access', regex: /\bwindow\./g },
  { id: 'globalThis-access', regex: /\bglobalThis\b/g },
  { id: 'localStorage-access', regex: /\blocalStorage\b/g },
  { id: 'document-access', regex: /\bdocument\./g },
  { id: 'clipboard-access', regex: /\bnavigator\.clipboard\b/g },
];

const RUNTIME_ADAPTER_FILE = 'src/features/census/controllers/censusBrowserRuntimeAdapter.ts';

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) return false;
  if (filePath.endsWith('.d.ts')) return false;
  const normalized = toPosix(filePath);
  return !normalized.includes('.test.');
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

const files = walkFiles(CONTROLLERS_DIR);
const violations = [];

for (const absolutePath of files) {
  const relativePath = toPosix(path.relative(ROOT, absolutePath));
  const source = fs.readFileSync(absolutePath, 'utf8');

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.regex.test(source)) {
      violations.push({
        file: relativePath,
        rule: pattern.id,
      });
    }
  }

  if (
    relativePath !== RUNTIME_ADAPTER_FILE &&
    source.includes('defaultBrowserWindowRuntime')
  ) {
    violations.push({
      file: relativePath,
      rule: 'default-browser-runtime-direct-import',
    });
  }
}

if (violations.length === 0) {
  console.log('Census runtime boundary checks passed.');
  process.exit(0);
}

console.error('\nCensus runtime boundary violations:');
for (const violation of violations) {
  console.error(`- [${violation.rule}] ${violation.file}`);
}

process.exit(1);
