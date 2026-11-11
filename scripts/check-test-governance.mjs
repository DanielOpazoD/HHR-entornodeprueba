#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { findTestModifiers } from './testGovernanceSupport.mjs';

const projectRoot = process.cwd();
const testsRoot = path.join(projectRoot, 'src', 'tests');

const allowedSkipFiles = new Set(['src/tests/security/firestore-rules.test.ts']);
const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const violations = [];

const toPosixRelative = filePath => path.relative(projectRoot, filePath).split(path.sep).join('/');

const walk = dir => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!testFilePattern.test(entry.name)) {
      continue;
    }

    const relative = toPosixRelative(fullPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    for (const modifier of findTestModifiers(relative, content)) {
      if (modifier.rule === 'skip' && allowedSkipFiles.has(relative)) continue;
      violations.push({ relative, ...modifier, source: lines[modifier.line - 1].trim() });
    }
  }
};

if (!fs.existsSync(testsRoot)) {
  console.log('[test-governance] src/tests not found, skipping check.');
  process.exit(0);
}

walk(testsRoot);

if (violations.length > 0) {
  console.error('[test-governance] Found forbidden test governance violations:');
  for (const violation of violations) {
    console.error(
      `- ${violation.relative}:${violation.line} [${violation.rule}] ${violation.source}`
    );
  }
  process.exit(1);
}

console.log('[test-governance] OK (no forbidden skip/only markers)');
