#!/usr/bin/env node

/**
 * Ratchet: production code may not add new unchecked indexed reads.
 *
 * `noUncheckedIndexedAccess` would type `list[i]` and `record[key]` as possibly `undefined`. The
 * project does not enable it yet, and the count kept growing (1,335 production reads on
 * 2026-11-04): each one is an `undefined` that TypeScript cannot see. This check compiles
 * with the flag on, counts the errors outside `src/tests/` per area (`src/<layer>/<module>`), and
 * fails when an area grows. When an area shrinks it asks to lower its count, so the totals only
 * go down. `--write-baseline` rewrites scripts/config/unchecked-index-baseline.json.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASELINE_PATH = 'scripts/config/unchecked-index-baseline.json';
const ERROR_LINE = /^(src\/[^(]+)\(\d+,\d+\): error TS\d+:/;

/** Production error counts per `src/<layer>/<module>` area from `tsc --pretty false` output. */
export const countUncheckedIndexErrors = output => {
  const areas = {};
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line.trim());
    if (!match || match[1].startsWith('src/tests/')) continue;
    const area = match[1]
      .split('/')
      .slice(0, 3)
      .join('/')
      .replace(/\.(tsx?|mts)$/, '');
    areas[area] = (areas[area] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(areas).sort(([left], [right]) => left.localeCompare(right))
  );
};

/** Areas above their baseline, and areas below it whose count should be lowered. */
export const compareWithBaseline = (current, baseline) => {
  const grown = [];
  const shrunk = [];
  for (const area of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const now = current[area] ?? 0;
    const before = baseline[area] ?? 0;
    if (now > before) grown.push({ area, before, now });
    else if (now < before) shrunk.push({ area, before, now });
  }
  return { grown, shrunk };
};

const compile = () => {
  try {
    execFileSync(
      'npx',
      [
        'tsc',
        '--noEmit',
        '--skipLibCheck',
        '-p',
        'tsconfig.json',
        '--noUncheckedIndexedAccess',
        '--pretty',
        'false',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return '';
  } catch (error) {
    if (typeof error.stdout === 'string') return error.stdout;
    throw error;
  }
};

const main = () => {
  const current = countUncheckedIndexErrors(compile());
  const total = Object.values(current).reduce((sum, count) => sum + count, 0);
  if (process.argv.includes('--write-baseline')) {
    fs.writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify({ version: 1, total, areas: current }, null, 2)}\n`
    );
    console.log(`[unchecked-index] Baseline written: ${total} production reads.`);
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const { grown, shrunk } = compareWithBaseline(current, baseline.areas);
  if (grown.length || shrunk.length) {
    for (const { area, before, now } of grown) {
      console.error(
        `[unchecked-index] ${area}: ${before} → ${now}. Guard the new indexed read (optional chaining, a length or \`in\` check, or a typed lookup) instead of assuming it exists.`
      );
    }
    for (const { area, before, now } of shrunk) {
      console.error(
        `[unchecked-index] ${area}: ${before} → ${now}. Good: lower its count with \`npm run check:unchecked-index -- --write-baseline\`.`
      );
    }
    process.exit(1);
  }
  console.log(`[unchecked-index] OK (${total} production reads still unchecked; 0 new).`);
};

if (import.meta.url === `file://${process.argv[1]}`) main();
