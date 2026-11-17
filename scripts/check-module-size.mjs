#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'module-size-allowlist.json');
// The app (`src/`), the Cloud Functions (`functions/lib/`) and the Netlify Functions
// (`netlify/functions/`), both deployed with real patient data, share one cap. A missing root is
// an error: an unscanned tree is unmeasured, not compliant.
const SOURCE_ROOTS = [
  { dir: 'src', extensions: new Set(['.ts', '.tsx']) },
  { dir: 'functions/lib', extensions: new Set(['.js']) },
  { dir: 'netlify/functions', extensions: new Set(['.ts', '.js']) },
];
const SPLIT_HINT = 'split it by responsibility (CONTRIBUTING.md, "Elegir dónde cambiar")';
const FIX_HINT_BY_MODE = {
  'new-overflow': `${SPLIT_HINT}; a cohesive exception needs an allowlist entry with its backlog reason`,
  'allowlist-overflow': `${SPLIT_HINT}; the ceiling is the size it was listed at and does not rise`,
};

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = (filePath, extensions) => {
  if (!extensions.has(path.extname(filePath))) {
    return false;
  }

  if (filePath.endsWith('.d.ts')) {
    return false;
  }

  const normalized = toPosix(filePath);
  return !normalized.includes('/tests/') && !normalized.includes('.test.');
};

const walkFiles = (dirPath, extensions) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(absolutePath, extensions));
      continue;
    }
    if (entry.isFile() && isSourceFile(absolutePath, extensions)) {
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

const missingRoots = SOURCE_ROOTS.filter(({ dir }) => !fs.existsSync(path.join(ROOT, dir)));
if (missingRoots.length > 0) {
  console.error(
    `Module size check cannot measure missing source roots: ${missingRoots
      .map(({ dir }) => dir)
      .join(', ')}. Run it from the repository root.`
  );
  process.exit(1);
}

const files = SOURCE_ROOTS.flatMap(({ dir, extensions }) =>
  walkFiles(path.join(ROOT, dir), extensions)
);
const { globalMax, allowlist, backlog } = loadAllowlist();
const violations = [];
const seen = new Map();

for (const absolutePath of files) {
  const relativePath = toPosix(path.relative(ROOT, absolutePath));
  const lineCount = countLines(absolutePath);
  const allowedMax = allowlist[relativePath];
  const effectiveLimit = typeof allowedMax === 'number' ? allowedMax : globalMax;

  seen.set(relativePath, lineCount);

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
// A ceiling is the file's size when it was listed; once the file shrinks, the ceiling follows,
// so the lines just moved out cannot come back.
const slackAllowlistEntries = Object.entries(allowlist)
  .filter(([filePath, limit]) => typeof limit === 'number' && seen.has(filePath))
  .map(([filePath, limit]) => ({ filePath, limit, lines: seen.get(filePath) }))
  .filter(({ limit, lines }) => lines > globalMax && lines < limit);
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
  slackAllowlistEntries.length === 0 &&
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
      `- [${label}] ${violation.file}: ${violation.lines} lines (limit ${violation.limit}); ${FIX_HINT_BY_MODE[violation.mode]}`
    );
  }
}

if (staleAllowlistEntries.length > 0) {
  console.error('\nStale allowlist entries (file missing or moved):');
  for (const filePath of staleAllowlistEntries.sort()) {
    console.error(`- ${filePath}`);
  }
}

if (slackAllowlistEntries.length > 0) {
  console.error(
    '\nAllowlist ceilings above the current size (lower them in module-size-allowlist):'
  );
  for (const entry of slackAllowlistEntries.sort((left, right) =>
    left.filePath.localeCompare(right.filePath)
  )) {
    console.error(`- ${entry.filePath}: set its limit from ${entry.limit} to ${entry.lines}`);
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
