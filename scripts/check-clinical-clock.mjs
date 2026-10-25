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
 *  5. device-clock-time: nobody reads hours or minutes with `getHours()`, `getMinutes()` or
 *     `toTimeString()`. They only exist on instants and answer in the device zone.
 *  6. instant-calendar-slice: cutting a stored instant to its UTC date bypasses the hospital
 *     calendar. A preceding `clinical-clock-allow instant-calendar-slice: <reason>` comment
 *     exempts only the next line when a legacy field is actually a hospital wall-clock value.
 *  7. server-clock-today (functions/ only): local getFullYear/getMonth/getDate on a Date
 *     constructed from now or an instant are forbidden, both inline and through a variable.
 *     Calendar arithmetic on a multi-argument Date(year, month, day) and UTC getters is allowed.
 *     Use functions/lib/hospitalCalendarDay.js for the hospital calendar.
 *
 * `getTodayISO` / `getClinicalCalendarDateISO` / `calendarStampInClinicalTimeZone` and the
 * formatters in `src/utils/dateDisplayUtils.ts` (`formatCalendarDate`, `formatTimestamp`,
 * `readClinicalTimestamp`) are the doors. Exceptions are local and reasoned; unreviewed
 * violations must stay at zero.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
const netlifyFiles = walk(
  'netlify',
  relativePath => !relativePath.endsWith('.d.ts') && !isTestFile(relativePath)
);
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

// Follow syntax and local aliases so assertions, fallbacks and arbitrary alias names cannot
// conceal an instant. Explicit UTC calendar arithmetic stays calendar; ambiguous fields need a local reason.
const instantCalendarSliceLines = (source, relativePath) => {
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const scopes = new Map();
  const isScope = node => ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node);
  const scopeOf = node => {
    for (let current = node.parent; current; current = current.parent) {
      if (isScope(current)) return current;
    }
    return tree;
  };
  const collect = node => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const scope = scopeOf(node);
      if (!scopes.has(scope)) scopes.set(scope, new Map());
      scopes.get(scope).set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(tree);

  const initializerOf = node => {
    for (let scope = scopeOf(node); scope; scope = scope.parent && scopeOf(scope)) {
      if (scopes.get(scope)?.has(node.text)) return scopes.get(scope).get(node.text);
    }
  };
  const isCalendar = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node)
    ) {
      return isCalendar(node.expression, seen);
    }
    if (ts.isIdentifier(node)) return isCalendar(initializerOf(node), seen);
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      return /T(?:00|12):00:00(?:\.000)?Z$/.test(
        ts.isStringLiteralLike(node) ? node.text : (node.templateSpans.at(-1)?.literal.text ?? '')
      );
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date'
    ) {
      return node.arguments?.length === 1 && isCalendar(node.arguments[0], seen);
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression))
        return node.expression.text === 'parseCalendarDateUtcNoon';
      if (ts.isPropertyAccessExpression(node.expression)) {
        const { expression, name } = node.expression;
        if (ts.isIdentifier(expression) && expression.text === 'Date') {
          return (
            (name.text === 'UTC' &&
              node.arguments.length >= 3 &&
              node.arguments
                .slice(3)
                .every(
                  (arg, index) =>
                    arg.getText(tree) === '0' || (index === 0 && arg.getText(tree) === '12')
                )) ||
            (name.text === 'parse' && isCalendar(node.arguments[0], seen))
          );
        }
        if (name.text === 'getTime') return isCalendar(expression, seen);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operatorToken.kind)
    ) {
      return isCalendar(node.left, seen) || isCalendar(node.right, seen);
    }
    return false;
  };

  const instantName = /(?:At|[tT]imestamp|lastUpdated|isoNow)$/;
  const isInstant = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      return isInstant(node.expression, seen);
    }
    if (ts.isIdentifier(node)) {
      if (instantName.test(node.text)) return true;
      return isInstant(initializerOf(node), seen);
    }
    if (ts.isPropertyAccessExpression(node)) return instantName.test(node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      return instantName.test(node.argumentExpression.text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      return (
        ['toISOString', 'toJSON'].includes(node.expression.name.text) &&
        !isCalendar(node.expression.expression)
      );
    }
    if (ts.isBinaryExpression(node))
      return isInstant(node.left, seen) || isInstant(node.right, seen);
    if (ts.isConditionalExpression(node))
      return isInstant(node.whenTrue, seen) || isInstant(node.whenFalse, seen);
    return false;
  };

  const lines = new Set();
  const sourceLines = source.split('\n');
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { name, expression: receiver } = node.expression;
      const args = node.arguments;
      const isSlice =
        ['slice', 'substring', 'substr'].includes(name.text) &&
        args.length === 2 &&
        args[0].getText(tree) === '0' &&
        args[1].getText(tree) === '10';
      const isSplit =
        name.text === 'split' &&
        args.length === 1 &&
        ts.isStringLiteral(args[0]) &&
        args[0].text === 'T' &&
        ts.isElementAccessExpression(node.parent) &&
        node.parent.argumentExpression.getText(tree) === '0';
      if ((isSlice || isSplit) && isInstant(receiver)) {
        const line = lineOf(source, node.expression.name.getStart(tree));
        if (
          !/^\s*\/\/ clinical-clock-allow instant-calendar-slice:\s*\S.*$/.test(
            sourceLines[line - 2] ?? ''
          )
        ) {
          lines.add(line);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return [...lines];
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
    files: [...productionFiles, ...netlifyFiles, ...e2eFiles].filter(file => file !== CLOCK_SOURCE),
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
    rule: 'instant-calendar-slice',
    files: [...productionFiles, ...netlifyFiles],
    find: instantCalendarSliceLines,
    hint: 'convert stored instants with readClinicalTimestamp() / getClinicalCalendarDateISO(); exempt only documented wall-clock fields',
  },
];

const violations = [];
for (const { rule, files, find, hint } of RULES) {
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    for (const line of find(source, relativePath))
      violations.push({
        rule,
        location: `${relativePath}:${line}`,
        hint: typeof hint === 'function' ? hint(relativePath) : hint,
      });
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
