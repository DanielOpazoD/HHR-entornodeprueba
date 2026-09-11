#!/usr/bin/env node

/**
 * Enforces one wall clock for the hospital.
 *
 * Two rules, both in `src/` production code:
 *  1. The `'Pacific/Easter'` literal may only be declared in `src/utils/clinicalTimeZone.ts`.
 *     Everything else must import `CLINICAL_TIME_ZONE` so the zone cannot drift file by file.
 *  2. Nobody derives a `YYYY-MM-DD` "today" from the device clock via the
 *     `getTimezoneOffset()` + `toISOString().split('T')[0]` idiom. That idiom is exactly what let
 *     a mainland browser advance the census date ahead of the ward (incident 2026-09-10).
 *     `getTodayISO` / `getLocalDateInputValue` / `getClinicalCalendarDateISO` are the only doors.
 *
 * No allowlist on purpose: the baseline is zero and must stay there.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const CLOCK_SOURCE = 'src/utils/clinicalTimeZone.ts';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const RULES = [
  {
    rule: 'zone-literal',
    regex: /['"`]Pacific\/Easter['"`]/,
    hint: 'import { CLINICAL_TIME_ZONE } from "@/utils/clinicalTimeZone" instead of the literal',
    exempt: relativePath => relativePath === CLOCK_SOURCE,
  },
  {
    rule: 'device-clock-today',
    regex: /getTimezoneOffset\(\)[\s\S]{0,160}toISOString\(\)\s*\.\s*(split|slice)\(/,
    hint: 'use getTodayISO() / getLocalDateInputValue() (hospital calendar) instead of the device clock',
    exempt: () => false,
  },
];

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (filePath.endsWith('.d.ts')) return false;
  const relativePath = toPosix(path.relative(ROOT, filePath));
  if (relativePath.startsWith('src/tests/')) return false;
  if (relativePath.includes('.test.') || relativePath.includes('.spec.')) return false;
  return !relativePath.includes('.stories.');
};

const walkFiles = dirPath => {
  const files = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
    } else if (entry.isFile() && isSourceFile(absolutePath)) {
      files.push(absolutePath);
    }
  }
  return files;
};

const violations = [];
for (const absolutePath of walkFiles(SRC_ROOT)) {
  const relativePath = toPosix(path.relative(ROOT, absolutePath));
  const source = fs.readFileSync(absolutePath, 'utf8');
  for (const { rule, regex, hint, exempt } of RULES) {
    if (exempt(relativePath)) continue;
    if (regex.test(source)) violations.push({ rule, relativePath, hint });
  }
}

if (violations.length === 0) {
  console.log('Clinical clock checks passed (single time zone source, no device-clock dates).');
  process.exit(0);
}

console.error('\nClinical clock violations:');
for (const { rule, relativePath, hint } of violations) {
  console.error(`- [${rule}] ${relativePath} — ${hint}`);
}
process.exit(1);
