#!/usr/bin/env node

/**
 * Ratchet: no new data-layer read may turn a failure into "no data".
 *
 * A `catch` that returns `[]`, `null`, `{}` or an empty Map/Set without rethrowing hands its
 * caller something it cannot tell apart from a real empty result. A census email, an export or
 * a backup then goes out incomplete, and a missing record can look like a discharge or a free
 * bed. The data layer (repositories, Firestore, IndexedDB and sync) still has such reads; they
 * are listed in scripts/config/empty-on-failure-reads-baseline.json, one entry per catch.
 *
 * The check fails when a new one appears (throw, or return a result the caller must handle), and
 * when a listed one disappears without being removed from the baseline, so the list only shrinks.
 * `--write-baseline` rewrites it from the current code.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = 'scripts/config/empty-on-failure-reads-baseline.json';
const AREAS = [
  'src/services/repositories',
  'src/services/storage/firestore',
  'src/services/storage/indexeddb',
  'src/services/storage/sync',
];
const EMPTY_RETURN = /\breturn\s+(?:\[\]|null|\{\}|new (?:Map|Set)\(\))\s*;/;
const DECLARATION = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>|<)/,
  /^\s*(?:(?:public|private|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:\(|function\b)/,
];
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);

const toPosix = value => value.split(path.sep).join('/');

const walk = relativeDir => {
  const absoluteDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) files.push(...walk(relativePath));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      files.push(relativePath);
  }
  return files;
};

const indentOf = line => line.match(/^\s*/)[0].length;

/** Name of the closest enclosing declaration, by indentation, above `lineIndex`. */
const enclosingName = (lines, lineIndex) => {
  let indent = indentOf(lines[lineIndex]);
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    // Blank lines, deeper lines and the closing lines of a multi-line signature are not parents.
    if (!line.trim() || indentOf(line) >= indent || /^[)\]}>]/.test(line.trim())) continue;
    indent = indentOf(line);
    for (const pattern of DECLARATION) {
      const name = line.match(pattern)?.[1];
      if (name && !KEYWORDS.has(name)) return name;
    }
  }
  return '(module)';
};

const findEntries = () => {
  const entries = [];
  for (const file of AREAS.flatMap(walk)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const lines = source.split('\n');
    for (const match of source.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
      let depth = 1;
      let end = match.index + match[0].length;
      for (; end < source.length && depth > 0; end += 1) {
        if (source[end] === '{') depth += 1;
        else if (source[end] === '}') depth -= 1;
      }
      const body = source.slice(match.index + match[0].length, end - 1);
      if (!EMPTY_RETURN.test(body) || /\bthrow\b/.test(body)) continue;
      const lineIndex = source.slice(0, match.index).split('\n').length - 1;
      entries.push(`${file}::${enclosingName(lines, lineIndex)}`);
    }
  }
  return entries.sort();
};

const count = list =>
  list.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map());

const current = findEntries();

if (process.argv.includes('--write-baseline')) {
  fs.writeFileSync(
    path.join(ROOT, BASELINE_PATH),
    `${JSON.stringify({ version: 1, entries: current }, null, 2)}\n`
  );
  console.log(`[empty-on-failure-reads] Baseline written: ${current.length} entries.`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_PATH), 'utf8')).entries;
const currentCounts = count(current);
const baselineCounts = count(baseline);
const added = [...currentCounts].filter(([key, n]) => n > (baselineCounts.get(key) ?? 0));
const fixed = [...baselineCounts].filter(([key, n]) => n > (currentCounts.get(key) ?? 0));

if (added.length === 0 && fixed.length === 0) {
  console.log(
    `[empty-on-failure-reads] OK (${current.length} known reads still return empty on failure; 0 new).`
  );
  process.exit(0);
}

for (const [key] of added) {
  console.error(
    `- new: ${key} returns empty on failure. Throw, or return a result the caller must handle.`
  );
}
for (const [key] of fixed) {
  console.error(
    `- fixed: ${key} no longer returns empty on failure. Remove it from ${BASELINE_PATH}.`
  );
}
process.exit(1);
