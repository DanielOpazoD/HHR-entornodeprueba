#!/usr/bin/env node
/**
 * Inventory of `TODO`/`FIXME`/`HACK`/`XXX` markers in source code.
 *
 * Reads `src/**` and `functions/**` (excluding tests, generated files,
 * `node_modules`, `dist`, `coverage`), groups occurrences by file, and
 * writes a snapshot to `reports/source/todos-inventory.{json,md}`.
 *
 * The intent is to keep an honest, dated map of postponed decisions:
 * - Newly added markers are easy to spot in the diff.
 * - Stale markers stand out by file age.
 * - Triage decisions (close, convert to tracker activo, convert to test
 *   pending) get recorded against the snapshot.
 *
 * Triage labels (colocated in this script so the inventory keeps a
 * single source of truth):
 *
 *   close       — already addressed, comment can be deleted.
 *   activo      — promote to docs/TECHNICAL_DEBT_REGISTER.md.
 *   test_gap    — convert to a vitest `it.todo(...)` referencing the
 *                  expected behaviour.
 *   document    — leave the marker but expand context inline.
 *   accepted    — invariant we deliberately accept (rare).
 *
 * Run with `node scripts/scan-todos.mjs`. No CI gating intended; this is
 * an inventory tool for developers.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = [path.join(ROOT, 'src'), path.join(ROOT, 'functions')];
const IGNORE_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'reports',
  '.next',
  '.cache',
  '.git',
]);
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// Match a marker only when it is inside a comment (preceded by `//`,
// `/*` or a leading `*` from a block comment continuation). Avoids
// false positives like the Spanish word "TODO" inside UI strings (e.g.
// "DESCARGAR TODO"). Capture the surrounding noise so we can read
// the comment cleanly in the report.
const MARKER_REGEX =
  /(?:\/\/|\/\*|^\s*\*)\s*[^*\n]*?\b(TODO|FIXME|HACK|XXX)\b[:\s-]?(.*)$/;

const collectFiles = dir => {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (IGNORE_SEGMENTS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
};

const isTestFile = filePath => /(__tests__|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|\/tests\/)/.test(filePath);

const scanFile = filePath => {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(MARKER_REGEX);
    if (!match) continue;
    hits.push({
      line: i + 1,
      marker: match[1],
      text: match[2].trim(),
      raw: lines[i].trim(),
    });
  }
  return hits;
};

const allFiles = SCAN_DIRS.flatMap(collectFiles);

const buildInventory = files => {
  const inventory = [];
  let total = 0;
  const byMarker = {};
  for (const file of files) {
    const hits = scanFile(file);
    if (hits.length === 0) continue;
    inventory.push({
      file: path.relative(ROOT, file),
      count: hits.length,
      hits,
    });
    total += hits.length;
    for (const hit of hits) {
      byMarker[hit.marker] = (byMarker[hit.marker] || 0) + 1;
    }
  }
  inventory.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  return { inventory, total, byMarker };
};

const sourceFiles = allFiles.filter(file => !isTestFile(file));
const testFiles = allFiles.filter(isTestFile);
const sourceReport = buildInventory(sourceFiles);
const testReport = buildInventory(testFiles);
const inventory = sourceReport.inventory;
const total = sourceReport.total;
const byMarker = sourceReport.byMarker;

const reportDir = path.join(ROOT, 'reports', 'source');
fs.mkdirSync(reportDir, { recursive: true });

const generatedAt = new Date().toISOString();
const jsonOut = {
  generatedAt,
  totals: {
    source: { files: inventory.length, markers: total, byMarker },
    tests: {
      files: testReport.inventory.length,
      markers: testReport.total,
      byMarker: testReport.byMarker,
    },
  },
  inventory: { source: inventory, tests: testReport.inventory },
};
fs.writeFileSync(path.join(reportDir, 'todos-inventory.json'), `${JSON.stringify(jsonOut, null, 2)}\n`);

const formatSection = (label, report) => {
  const out = [];
  out.push(`## ${label}`);
  out.push('');
  out.push(`Files with markers: **${report.inventory.length}**`);
  out.push(`Total markers: **${report.total}**`);
  out.push('');
  if (Object.keys(report.byMarker).length > 0) {
    out.push('| Marker | Count |');
    out.push('| ------ | ----- |');
    for (const [marker, count] of Object.entries(report.byMarker).sort((a, b) => b[1] - a[1])) {
      out.push(`| ${marker} | ${count} |`);
    }
    out.push('');
  }
  if (report.inventory.length > 0) {
    out.push('### By file (descending count)');
    out.push('');
    for (const entry of report.inventory) {
      out.push(`#### ${entry.file} (${entry.count})`);
      out.push('');
      for (const hit of entry.hits) {
        out.push(`- L${hit.line} \`${hit.marker}\` — ${hit.text || '(no inline text)'}`);
      }
      out.push('');
    }
  } else {
    out.push('_No markers in this scope. Worth celebrating: deferred decisions live in the formal tracker, not in scattered comments._');
    out.push('');
  }
  return out;
};

const md = [];
md.push('# TODO/FIXME inventory');
md.push('');
md.push(`Generated at: ${generatedAt}`);
md.push('');
md.push('See [TODO_TRIAGE_PROCESS](../../docs/TODO_TRIAGE_PROCESS.md) for the playbook on closing each marker.');
md.push('');
md.push(...formatSection('Source (`src/**`, `functions/**`, excluding tests)', sourceReport));
md.push(...formatSection('Tests (`*.test.*`, `*.spec.*`, `tests/`)', testReport));
fs.writeFileSync(path.join(reportDir, 'todos-inventory.md'), md.join('\n'));

console.log(
  `[scan-todos] source: ${total} markers / ${inventory.length} files; tests: ${testReport.total} markers / ${testReport.inventory.length} files.`
);
console.log(`[scan-todos] Wrote ${path.relative(ROOT, path.join(reportDir, 'todos-inventory.json'))}`);
console.log(`[scan-todos] Wrote ${path.relative(ROOT, path.join(reportDir, 'todos-inventory.md'))}`);
