#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'module-size-allowlist.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) {
    return false;
  }

  if (filePath.endsWith('.d.ts')) {
    return false;
  }

  const normalized = toPosix(filePath);
  return !normalized.includes('/tests/') && !normalized.includes('.test.');
};

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

const countLines = filePath => {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.length === 0) {
    return 0;
  }
  return content.split('\n').length;
};

const loadAllowlist = () => {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { globalMax: 600, allowlist: {}, backlog: {} };
  }

  const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  return {
    globalMax: typeof parsed.globalMax === 'number' ? parsed.globalMax : 600,
    allowlist: parsed.allowlist && typeof parsed.allowlist === 'object' ? parsed.allowlist : {},
    backlog: parsed.backlog && typeof parsed.backlog === 'object' ? parsed.backlog : {},
  };
};

const files = walkFiles(SRC_ROOT);
const { globalMax, allowlist, backlog } = loadAllowlist();
const violations = [];
const seen = new Set();

for (const absolutePath of files) {
  const relativePath = toPosix(path.relative(ROOT, absolutePath));
  const lineCount = countLines(absolutePath);
  const allowedMax = allowlist[relativePath];
  const effectiveLimit = typeof allowedMax === 'number' ? allowedMax : globalMax;

  seen.add(relativePath);

  if (lineCount > effectiveLimit) {
    violations.push({
      file: relativePath,
      lines: lineCount,
      limit: effectiveLimit,
      mode: typeof allowedMax === 'number' ? 'allowlist-overflow' : 'new-overflow',
    });
  }
}

const staleAllowlistEntries = Object.keys(allowlist).filter(filePath => !seen.has(filePath));
const redundantAllowlistEntries = Object.entries(allowlist)
  .filter(([, limit]) => typeof limit === 'number' && limit > globalMax)
  .map(([filePath, limit]) => ({
    filePath,
    limit,
    absolutePath: path.join(ROOT, filePath),
  }))
  .filter(({ absolutePath }) => fs.existsSync(absolutePath))
  .map(entry => ({
    ...entry,
    lines: countLines(entry.absolutePath),
  }))
  .filter(entry => entry.lines <= globalMax);
const undocumentedHotspots = Object.entries(allowlist)
  .filter(([, limit]) => typeof limit === 'number' && limit > globalMax)
  .map(([filePath, limit]) => ({
    filePath,
    limit,
    metadata: backlog[filePath],
  }))
  .filter(({ metadata }) => !metadata || typeof metadata !== 'object');

if (
  violations.length === 0 &&
  staleAllowlistEntries.length === 0 &&
  redundantAllowlistEntries.length === 0 &&
  undocumentedHotspots.length === 0
) {
  console.log(`Module size checks passed (global max: ${globalMax} lines).`);
  process.exit(0);
}

if (violations.length > 0) {
  console.error('\nModule size violations:');
  for (const violation of violations.sort((a, b) => b.lines - a.lines)) {
    const label = violation.mode === 'allowlist-overflow' ? 'allowlist exceeded' : 'new overflow';
    console.error(
      `- [${label}] ${violation.file}: ${violation.lines} lines (limit ${violation.limit})`
    );
  }
}

if (staleAllowlistEntries.length > 0) {
  console.error('\nStale allowlist entries (file missing or moved):');
  for (const filePath of staleAllowlistEntries.sort()) {
    console.error(`- ${filePath}`);
  }
}

if (redundantAllowlistEntries.length > 0) {
  console.error('\nRedundant allowlist entries (module already fits global limit):');
  for (const entry of redundantAllowlistEntries.sort((left, right) =>
    left.filePath.localeCompare(right.filePath)
  )) {
    console.error(`- ${entry.filePath}: ${entry.lines} lines (global max ${globalMax})`);
  }
}

if (undocumentedHotspots.length > 0) {
  console.error('\nUndocumented hotspot allowlist entries:');
  for (const entry of undocumentedHotspots.sort((left, right) =>
    left.filePath.localeCompare(right.filePath)
  )) {
    console.error(
      `- ${entry.filePath}: limit ${entry.limit} must be documented in module-size-allowlist backlog`
    );
  }
}

process.exit(1);
