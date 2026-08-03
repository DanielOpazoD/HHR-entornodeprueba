#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const TARGET_DIRECTORIES = [
  'src/services/repositories',
  'src/services/exporters',
  'src/services/pdf',
  'src/services/admin',
  'src/services/storage/sync',
  'src/features/rayen-import',
];

const FORBIDDEN_PATTERNS = [
  { label: 'console.log', regex: /\bconsole\.log\s*\(/ },
  { label: 'console.info', regex: /\bconsole\.info\s*\(/ },
  { label: 'console.debug', regex: /\bconsole\.debug\s*\(/ },
  { label: 'console.warn', regex: /\bconsole\.warn\s*\(/ },
  { label: 'console.error', regex: /\bconsole\.error\s*\(/ },
];

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  return SOURCE_EXTENSIONS.has(extension) && !filePath.endsWith('.d.ts');
};

const walkFiles = dirPath => {
  if (!fs.existsSync(dirPath)) return [];
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

const violations = [];

for (const relativeDir of TARGET_DIRECTORIES) {
  const files = walkFiles(path.join(ROOT, relativeDir));
  for (const absolutePath of files) {
    const relativePath = toPosix(path.relative(ROOT, absolutePath));
    const source = fs.readFileSync(absolutePath, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(source)) {
        violations.push({ file: relativePath, pattern: pattern.label });
      }
    }
  }
}

if (violations.length === 0) {
  console.log('Core console usage checks passed.');
  process.exit(0);
}

console.error('\nCore console usage violations:');
for (const violation of violations) {
  console.error(`- ${violation.file} -> ${violation.pattern}`);
}

process.exit(1);
