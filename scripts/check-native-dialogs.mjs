#!/usr/bin/env node

/**
 * Forbids raw `confirm()`, `alert()` and `prompt()` calls in src/. The
 * canonical UX path is the `useConfirmDialog` / `useNotification` API exposed
 * from `src/context/UIContext`. Browser-native dialogs render inconsistently,
 * block the event loop, and break the visual identity of a clinical UI under
 * pressure.
 *
 * Wrappers via `defaultBrowserWindowRuntime.alert/confirm` are NOT this
 * script's concern: that is what `check-runtime-adapter-boundary` already
 * tracks. This script only catches the unwrapped, top-level calls.
 *
 * The `runtime-adapter-boundary-allowlist.json` baseline pattern is reused:
 * any pre-existing violation can be allowlisted explicitly so the gate
 * blocks new occurrences without forcing a sweeping refactor in this PR.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'native-dialogs-allowlist.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

// Match a TOP-LEVEL call to `alert/confirm/prompt` whose first argument is a
// string literal — that is the native browser API signature. The
// `useConfirmDialog` wrapper takes an options object (`confirm({title:...})`),
// so it never matches. The lookbehind also rejects member access like
// `notify.confirm({...})` or `defaultBrowserWindowRuntime.alert(...)`.
const FORBIDDEN_PATTERNS = [
  { rule: 'native-alert', regex: /(?<![\w.])alert\s*\(\s*['"`]/g },
  { rule: 'native-confirm', regex: /(?<![\w.])confirm\s*\(\s*['"`]/g },
  { rule: 'native-prompt', regex: /(?<![\w.])prompt\s*\(\s*['"`]/g },
];

// `src/shared/runtime/` is where the wrappers themselves live and *must* call
// the browser primitives. Tests are excluded by isSourceFile.
const EXCLUDED_PATH_PREFIXES = ['src/shared/runtime/'];

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
  console.log('Native dialog checks passed.');
  if (currentViolationIds.length > 0) {
    console.log(`Baseline debt tracked: ${currentViolationIds.length} native dialog occurrences.`);
  }
  process.exit(0);
}

console.error('\nNative dialog violations:');
for (const violationId of newViolations) {
  const [rule, file] = violationId.split('|');
  console.error(
    `- [${rule}] ${file} — replace with useConfirmDialog / useNotification from @/context/UIContext`
  );
}

process.exit(1);
