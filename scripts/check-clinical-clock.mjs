#!/usr/bin/env node

/**
 * Enforces one wall clock for the hospital: Rapa Nui (`Pacific/Easter`), whatever the device
 * (docs/DOMAIN_RULES.md TIME-02).
 *
 *  1. zone-literal: the `'Pacific/Easter'` literal lives only in `src/utils/clinicalTimeZone.ts`.
 *  2. device-clock-today: nobody derives a `YYYY-MM-DD` "today" from `getTimezoneOffset()` + `toISOString()`.
 *  3. utc-today: nobody reads "today" from UTC (`new Date().toISOString()` cut to the date).
 *  4. zone-less-format: dates and times shown to people pass `timeZone`.
 *  5. device-clock-time: nobody reads hours or minutes with `getHours()`, `getMinutes()` or `toTimeString()`.
 *  6. instant-calendar-slice: cutting a stored instant to its UTC date bypasses the hospital calendar.
 *  7. server-clock-today (functions/) and device-calendar-today (src/): no local calendar getters on instants.
 *  8. raw-offset-clock (rayen-import/ and extension/): ISO regex prefixes and time slices convert offsets to Rapa Nui.
 *  9. hand-calendar-anchor: the `T12:00:00Z` noon anchor lives only in the two calendar modules.
 * 10. device-wall-clock-instant: a zone-less `…Thh:mm` cannot be used in instant arithmetic/comparisons.
 * 11. shift-start-literal: shift hours (08:00, 09:00, 20:00) live only in `src/utils/clinicalDayScheduleUtils.ts`.
 * 12. hand-date-pattern: `\d{4}-\d{2}-\d{2}` patterns outside calendar modules may only go down from base.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  deviceWallClockInstantLines,
  instantCalendarSliceLines,
  lineOf,
  rawOffsetClockLines,
} from './lib/clinicalClock/astDetectors.mjs';
import {
  CALENDAR_SOURCES,
  handDatePatternRatchet,
  isTestFile,
  walkIn,
} from './lib/clinicalClock/handDatePatternRatchet.mjs';

const CLOCK_SOURCE = 'src/utils/clinicalTimeZone.ts';
const SHIFT_SOURCE = 'src/utils/clinicalDayScheduleUtils.ts';
// '08:00', "9:00", `20:00`, or 8 * 60 minutes; 8 * 60 * 1000 is a duration, not a time of day.
const SHIFT_START_LITERAL = /(['"`])(?:0?[89]|20):00\1|\b(?:8|9|20)\s*\*\s*60\b(?!\s*\*)/g;
const DATE_OPTION = /\b(?:hour|minute|second|day|month|year|weekday|dateStyle|timeStyle|era)\b/;
const FORMAT_CALL =
  /\.toLocale(DateString|TimeString|String)\s*\(|new\s+Intl\.DateTimeFormat\s*\(/g;

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

const shiftStartLiteralLines = source => {
  const sourceLines = source.split('\n');
  const allowed = /^\s*\/\/ clinical-clock-allow shift-start-literal:\s*\S/;
  const lines = new Set();
  for (const match of source.matchAll(SHIFT_START_LITERAL)) {
    const line = lineOf(source, match.index);
    if (!allowed.test(sourceLines[line - 2] ?? '')) lines.add(line);
  }
  return [...lines];
};

const localCalendarGetterLines = rule => source => {
  const lines = [];
  const sourceLines = source.split('\n');
  const allowed = new RegExp(`^\\s*// clinical-clock-allow ${rule}:\\s*\\S.*$`);
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
    const line = lineOf(source, match.index);
    if (
      (localGetter.test(afterConstructor) || variableGetter?.test(variableUses)) &&
      !allowed.test(sourceLines[line - 2] ?? '')
    ) {
      lines.push(line);
    }
  }
  return lines;
};

/** Checks the hospital clock rules in the repository at `root`, as the command prints and exits. */
export const checkClinicalClock = (root = process.cwd(), env = process.env) => {
  const walk = (relativeDir, accept) => walkIn(root, relativeDir, accept);
  const productionFiles = walk(
    'src',
    relativePath => !relativePath.endsWith('.d.ts') && !isTestFile(relativePath)
  );
  const functionsFiles = [
    ...walk('functions/lib', relativePath => !isTestFile(relativePath)),
    ...(fs.existsSync(path.join(root, 'functions/index.js')) ? ['functions/index.js'] : []),
  ];
  const netlifyFiles = walk(
    'netlify',
    relativePath => !relativePath.endsWith('.d.ts') && !isTestFile(relativePath)
  );
  const testFiles = walk('src/tests', () => true);
  const e2eFiles = [
    ...walk('e2e', () => true),
    ...fs.readdirSync(root).filter(name => /^playwright[\w.-]*\.config\.ts$/.test(name)),
  ];

  const RULES = [
    {
      rule: 'raw-offset-clock',
      files: [
        ...walk('src/features/rayen-import', file => !isTestFile(file)),
        ...walk('extension', file => !isTestFile(file) && !file.endsWith('.min.js')),
      ],
      find: rawOffsetClockLines,
      hint: 'use encounterWallClockInRapaNui() or hora de Rapa Nui con Intl (timeZone: Pacific/Easter); document unzoned local history with clinical-clock-allow raw-offset-clock: <reason>',
    },
    {
      rule: 'server-clock-today',
      files: functionsFiles,
      find: localCalendarGetterLines('server-clock-today'),
      hint: 'use hospitalCalendarDay() from functions/lib/hospitalCalendarDay for the hospital day',
    },
    {
      rule: 'device-calendar-today',
      files: productionFiles,
      find: localCalendarGetterLines('device-calendar-today'),
      hint: 'use getClinicalCalendarDateISO() / calendarStampInClinicalTimeZone() from src/utils/clinicalTimeZone for the hospital day; document a local calendar value with clinical-clock-allow device-calendar-today: <reason>',
    },
    {
      rule: 'zone-literal',
      files: [...productionFiles, ...netlifyFiles, ...e2eFiles].filter(
        file => file !== CLOCK_SOURCE
      ),
      find: regexRule(/['"`]Pacific\/Easter['"`]/),
      hint: 'import CLINICAL_TIME_ZONE from src/utils/clinicalTimeZone instead of the literal',
    },
    {
      rule: 'device-clock-today',
      files: [...productionFiles, ...netlifyFiles],
      find: regexRule(/getTimezoneOffset\(\)[\s\S]{0,160}toISOString\(\)\s*\.\s*(split|slice)\(/),
      hint: 'use getTodayISO() (hospital calendar) instead of the device clock',
    },
    {
      rule: 'utc-today',
      files: [...productionFiles, ...netlifyFiles, ...testFiles, ...e2eFiles, ...functionsFiles],
      find: regexRule(
        /new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*(?:(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/
      ),
      hint: relativePath =>
        relativePath.startsWith('functions/')
          ? 'use hospitalCalendarDay() from functions/lib/hospitalCalendarDay instead of the UTC date'
          : 'use getTodayISO() (hospital calendar) instead of the UTC date',
    },
    {
      rule: 'zone-less-format',
      files: [...productionFiles, ...netlifyFiles],
      find: zoneLessFormatLines,
      hint: 'pass timeZone (CLINICAL_TIME_ZONE, or UTC for UTC-anchored calendar dates) or use dateDisplayUtils',
    },
    {
      rule: 'device-clock-time',
      files: [...productionFiles, ...netlifyFiles],
      find: source =>
        [...source.matchAll(/\.(?:get(?:Hours|Minutes)|toTimeString)\s*\(\s*\)/g)].map(match =>
          lineOf(source, match.index)
        ),
      hint: 'read the hospital clock: readClinicalTimestamp() / calendarStampInClinicalTimeZone()',
    },
    {
      rule: 'hand-calendar-anchor',
      files: [...productionFiles, ...netlifyFiles, ...functionsFiles].filter(
        file => !CALENDAR_SOURCES.has(file)
      ),
      find: regexRule(/T12:00:00(?:\.000)?Z/),
      hint: relativePath =>
        relativePath.startsWith('functions/')
          ? 'use addCalendarDays() / isCalendarDay() / calendarDayAtUtcNoon() from functions/lib/hospitalCalendarDay'
          : 'use addCalendarDays() / diffCalendarDays() / isCalendarDate() / calendarDayAtUtcNoon() from src/utils/clinicalDateUtils',
    },
    {
      rule: 'device-wall-clock-instant',
      files: [...productionFiles, ...netlifyFiles],
      find: deviceWallClockInstantLines,
      hint: "a zone-less Thh:mm is the device's wall clock: use clinicalWallClockToDate(day, 'hh:mm') from src/utils/clinicalWallClock for the hospital's, a day-write predicate of src/shared/access/censusDayWriteAccessPolicy for the 48 h window, and diffCalendarDays() for day counts",
    },
    {
      rule: 'shift-start-literal',
      files: [...productionFiles, ...netlifyFiles].filter(file => file !== SHIFT_SOURCE),
      find: shiftStartLiteralLines,
      hint: 'the shift hours live in src/utils/clinicalDayScheduleUtils.ts: use getShiftSchedule(), resolveClinicalDayBounds(), getCurrentShift(), DEFAULT_SHIFT_SCHEDULE or NIGHT_SHIFT_START_MINUTES from src/utils/clinicalDayUtils; an hour with another meaning gets its own named constant behind clinical-clock-allow shift-start-literal: <reason>',
    },
    {
      rule: 'instant-calendar-slice',
      files: [...productionFiles, ...netlifyFiles],
      find: instantCalendarSliceLines,
      hint: 'convert stored instants with readClinicalTimestamp() / getClinicalCalendarDateISO(); exempt only documented wall-clock fields',
    },
  ];

  const violations = [];
  for (const { rule, files, find, hint } of RULES) {
    for (const relativePath of files) {
      const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
      for (const line of find(source, relativePath))
        violations.push({
          rule,
          location: `${relativePath}:${line}`,
          hint: typeof hint === 'function' ? hint(relativePath) : hint,
        });
    }
  }

  const ratchet = handDatePatternRatchet(root, env);
  if (ratchet.violation)
    violations.push({
      rule: 'hand-date-pattern',
      location: 'src/ + functions/lib/',
      hint: ratchet.violation,
    });

  if (violations.length === 0) {
    return {
      status: 0,
      stdout: `${ratchet.notice ?? ''}Clinical clock checks passed (one hospital clock, no device or UTC dates).\n`,
      stderr: '',
    };
  }
  const lines = ['\nClinical clock violations:'];
  for (const { rule, location, hint } of violations) {
    lines.push(`- [${rule}] ${location} — ${hint}`);
  }
  return { status: 1, stdout: '', stderr: `${lines.join('\n')}\n` };
};

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { status, stdout, stderr } = checkClinicalClock();
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = status;
}
