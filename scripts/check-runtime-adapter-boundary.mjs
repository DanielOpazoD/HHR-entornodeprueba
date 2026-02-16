#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'runtime-adapter-boundary-allowlist.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const FORBIDDEN_PATTERNS = [
  { rule: 'window-alert-access', regex: /\bwindow\.alert\(/g },
  { rule: 'window-confirm-access', regex: /\bwindow\.confirm\(/g },
  { rule: 'window-open-access', regex: /\bwindow\.open\(/g },
  { rule: 'window-reload-access', regex: /\bwindow\.location\.reload\(/g },
  { rule: 'navigator-clipboard-access', regex: /\bnavigator\.clipboard\b/g },
];

const EXCLUDED_PATH_PREFIXES = ['src/shared/runtime/'];
const EXCLUDED_FILES = new Set(['src/hooks/controllers/censusEmailBrowserRuntimeController.ts']);

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (filePath.endsWith('.d.ts')) return false;

  const relativePath = toPosix(path.relative(ROOT, filePath));
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

const allowlist = fs.existsSync(ALLOWLIST_PATH)
  ? JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'))
  : { violations: [] };
const knownViolations = new Set(allowlist.violations || []);

const files = walkFiles(SRC_ROOT);
const currentViolationIds = [];

for (const absolutePath of files) {
  const relativePath = toPosix(path.relative(ROOT, absolutePath));
  if (EXCLUDED_FILES.has(relativePath)) continue;
  if (EXCLUDED_PATH_PREFIXES.some(prefix => relativePath.startsWith(prefix))) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  for (const pattern of FORBIDDEN_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(source)) {
      currentViolationIds.push(`${pattern.rule}|${relativePath}`);
    }
  }
}

const newViolations = currentViolationIds.filter(id => !knownViolations.has(id));
if (newViolations.length === 0) {
  console.log('Runtime adapter boundary checks passed.');
  if (currentViolationIds.length > 0) {
    console.log(`Baseline debt tracked: ${currentViolationIds.length} runtime adapter issues.`);
  }
  process.exit(0);
}

console.error('\nRuntime adapter boundary violations:');
for (const violationId of newViolations) {
  const [rule, file] = violationId.split('|');
  console.error(`- [${rule}] ${file}`);
}

process.exit(1);
