#!/usr/bin/env node

/**
 * Enforces one wall clock for the hospital: Rapa Nui (`Pacific/Easter`), whatever the device
 * (docs/DOMAIN_RULES.md TIME-02).
 *
 *  1. zone-literal: the `'Pacific/Easter'` literal lives only in `src/utils/clinicalTimeZone.ts`.
 *     Everything else, e2e specs and Playwright configs included, imports `CLINICAL_TIME_ZONE`
 *     so the zone cannot drift file by file.
 *  2. device-clock-today: nobody derives a `YYYY-MM-DD` "today" from the device clock via the
 *     `getTimezoneOffset()` + `toISOString().split('T')[0]` idiom. That idiom is exactly what let
 *     a mainland browser advance the census date ahead of the ward (incident 2026-09-10).
 *  3. utc-today: nobody reads "today" from UTC (`new Date().toISOString()` cut to the date): in
 *     Rapa Nui the UTC date is already tomorrow from 18:00-19:00 hospital time. Tests and e2e
 *     specs follow the same clock as the app they check.
 *  4. zone-less-format: dates and times shown to people name their zone. Every
 *     `toLocaleDateString`, `toLocaleTimeString` and `new Intl.DateTimeFormat` call, and every
 *     date `toLocaleString`, passes `timeZone`: `CLINICAL_TIME_ZONE`, or `'UTC'` for calendar
 *     dates anchored in UTC. Without it the device zone (mainland Chile) leaks into the display.
 *  5. device-clock-time: nobody reads hours or minutes with `getHours()` / `getMinutes()`. They
 *     only exist on instants, and those local getters answer in the device zone.
 *  6. server-clock-today (functions/ only): local getFullYear/getMonth/getDate on a Date
 *     constructed from now or an instant are forbidden, both inline and through a variable.
 *     Calendar arithmetic on a multi-argument Date(year, month, day) and UTC getters is allowed.
 *     Use functions/lib/hospitalCalendarDay.js for the hospital calendar.
 *
 * `getTodayISO` / `getClinicalCalendarDateISO` / `calendarStampInClinicalTimeZone` and the
 * formatters in `src/utils/dateDisplayUtils.ts` (`formatCalendarDate`, `formatTimestamp`,
 * `readClinicalTimestamp`) are the doors. No allowlist on purpose: the baseline is zero and must
 * stay there.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CLOCK_SOURCE = 'src/utils/clinicalTimeZone.ts';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const DATE_OPTION = /\b(?:hour|minute|second|day|month|year|weekday|dateStyle|timeStyle|era)\b/;
const FORMAT_CALL =
  /\.toLocale(DateString|TimeString|String)\s*\(|new\s+Intl\.DateTimeFormat\s*\(/g;

const toPosix = value => value.split(path.sep).join('/');

const walk = (relativeDir, accept) => {
  const absoluteDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) files.push(...walk(relativePath, accept));
    else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      accept(relativePath)
    )
      files.push(relativePath);
  }
  return files;
};

const isTestFile = relativePath =>
  relativePath.startsWith('src/tests/') || /\.(?:test|spec|stories)\./.test(relativePath);

const productionFiles = walk(
  'src',
  relativePath => !relativePath.endsWith('.d.ts') && !isTestFile(relativePath)
);
const functionsFiles = [
  ...walk('functions/lib', relativePath => !isTestFile(relativePath)),
  ...(fs.existsSync(path.join(ROOT, 'functions/index.js')) ? ['functions/index.js'] : []),
];
const testFiles = walk('src/tests', () => true);
const e2eFiles = [
  ...walk('e2e', () => true),
  ...fs.readdirSync(ROOT).filter(name => /^playwright[\w.-]*\.config\.ts$/.test(name)),
];

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** Text between the parenthesis at `openIndex` and the one that closes it. */
const argumentsAt = (source, openIndex) => {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')' && --depth === 0) return source.slice(openIndex + 1, index);
  }
  return source.slice(openIndex + 1);
};

const regexRule = regex => source =>
  [...source.matchAll(new RegExp(regex.source, 'g'))].map(match => lineOf(source, match.index));

const zoneLessFormatLines = source => {
  const lines = [];
  for (const match of source.matchAll(FORMAT_CALL)) {
    const args = argumentsAt(source, match.index + match[0].length - 1);
    if (/\btimeZone\b/.test(args)) continue;
    if (match[1] === 'String') {
      // Number#toLocaleString shares the name: only date receivers or date options count.
      const receiver = source.slice(Math.max(0, match.index - 160), match.index);
      if (!/new\s+Date\([^;]*\)\s*$/.test(receiver) && !DATE_OPTION.test(args)) continue;
    }
    lines.push(lineOf(source, match.index));
  }
  return lines;
};

const serverClockCalendarLines = source => {
  const lines = [];
  const constructors = /(?:\b(?:const|let|var)\s+(\w+)\s*=\s*)?new\s+Date\s*\(/g;
  const localGetter = /^\s*\.\s*get(?:FullYear|Month|Date)\s*\(\s*\)/;
  for (const match of source.matchAll(constructors)) {
    const openIndex = match.index + match[0].length - 1;
    const args = argumentsAt(source, openIndex);
    // Multi-argument constructors build calendar values, rather than reading an instant.
    if (/^\s*\w+\s*,/.test(args)) continue;
    const afterConstructor = source.slice(openIndex + args.length + 2);
    const variableGetter = match[1]
      ? new RegExp(`\\b${match[1]}\\s*\\.\\s*get(?:FullYear|Month|Date)\\s*\\(\\s*\\)`)
      : null;
    const nextDeclaration = match[1]
      ? afterConstructor.search(new RegExp(`\\b(?:const|let|var)\\s+${match[1]}\\b`))
      : -1;
    const variableUses =
      nextDeclaration < 0 ? afterConstructor : afterConstructor.slice(0, nextDeclaration);
    if (localGetter.test(afterConstructor) || variableGetter?.test(variableUses)) {
      lines.push(lineOf(source, match.index));
    }
  }
  return lines;
};

const RULES = [
  {
    rule: 'server-clock-today',
    files: functionsFiles,
    find: serverClockCalendarLines,
    hint: 'use hospitalCalendarDay() from functions/lib/hospitalCalendarDay for the hospital day',
  },
  {
    rule: 'zone-literal',
    files: [...productionFiles, ...e2eFiles].filter(file => file !== CLOCK_SOURCE),
    find: regexRule(/['"`]Pacific\/Easter['"`]/),
    hint: 'import CLINICAL_TIME_ZONE from src/utils/clinicalTimeZone instead of the literal',
  },
  {
    rule: 'device-clock-today',
    files: productionFiles,
    find: regexRule(/getTimezoneOffset\(\)[\s\S]{0,160}toISOString\(\)\s*\.\s*(split|slice)\(/),
    hint: 'use getTodayISO() (hospital calendar) instead of the device clock',
  },
  {
    rule: 'utc-today',
    files: [...productionFiles, ...testFiles, ...e2eFiles, ...functionsFiles],
    find: regexRule(
      /new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*(?:(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/
    ),
    hint: 'use getTodayISO() (hospital calendar) instead of the UTC date',
  },
  {
    rule: 'zone-less-format',
    files: productionFiles,
    find: zoneLessFormatLines,
    hint: 'pass timeZone (CLINICAL_TIME_ZONE, or UTC for UTC-anchored calendar dates) or use dateDisplayUtils',
  },
  {
    rule: 'device-clock-time',
    files: productionFiles,
    find: source =>
      [...source.matchAll(/\.get(?:Hours|Minutes)\(\)/g)].map(match => lineOf(source, match.index)),
    hint: 'read the hospital clock: readClinicalTimestamp() / calendarStampInClinicalTimeZone()',
  },
];

const violations = [];
for (const { rule, files, find, hint } of RULES) {
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    for (const line of find(source))
      violations.push({ rule, location: `${relativePath}:${line}`, hint });
  }
}

if (violations.length === 0) {
  console.log('Clinical clock checks passed (one hospital clock, no device or UTC dates).');
  process.exit(0);
}

console.error('\nClinical clock violations:');
for (const { rule, location, hint } of violations) {
  console.error(`- [${rule}] ${location} — ${hint}`);
}
process.exit(1);
