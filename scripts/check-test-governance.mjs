#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const testsRoot = path.join(projectRoot, 'src', 'tests');
const allowlistPath = path.join(projectRoot, 'scripts', 'test-governance-allowlist.json');

const allowedSkipFiles = new Set(['src/tests/security/firestore-rules.test.ts']);
const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const skipPattern = /\b(?:it|test|describe)\.skip\s*\(/g;
const onlyPattern = /\b(?:it|test|describe)\.only\s*\(/g;
const MEGATEST_LINE_LIMIT = 500;

const loadMegatestAllowlist = () => {
  if (!fs.existsSync(allowlistPath)) {
    return new Set();
  }

  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  return new Set(Array.isArray(parsed.megatests) ? parsed.megatests : []);
};

const allowedMegatestFiles = loadMegatestAllowlist();

const violations = [];

const toPosixRelative = filePath =>
  path.relative(projectRoot, filePath).split(path.sep).join('/');

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
    const lineCount = content.length === 0 ? 0 : content.split('\n').length;

    if (lineCount > MEGATEST_LINE_LIMIT && !allowedMegatestFiles.has(relative)) {
      violations.push({
        relative,
        line: 1,
        rule: 'megatest',
        source: `${lineCount} lines (limit ${MEGATEST_LINE_LIMIT})`,
      });
    }

    const lineIndexes = content.split('\n');
    lineIndexes.forEach((line, index) => {
      const hasSkip = skipPattern.test(line);
      skipPattern.lastIndex = 0;

      const hasOnly = onlyPattern.test(line);
      onlyPattern.lastIndex = 0;

      if (hasOnly) {
        violations.push({
          relative,
          line: index + 1,
          rule: 'only',
          source: line.trim(),
        });
      }

      if (hasSkip && !allowedSkipFiles.has(relative)) {
        violations.push({
          relative,
          line: index + 1,
          rule: 'skip',
          source: line.trim(),
        });
      }
    });
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
