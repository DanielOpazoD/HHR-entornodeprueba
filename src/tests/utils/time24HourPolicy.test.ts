import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'functions', 'lib')];
const ALLOWED_AM_PM_FILES = new Set([
  // Official Chilean SUSESO DIAT paper PDF form checkboxes (AM/PM printed on the government form).
  'src/features/clinical-library/domain/forms/denuncia-accidente-trabajo-diat.json',
  'src/features/clinical-library/services/clinicalFormPdf.ts',
]);

const collectProductionFiles = (dir: string): string[] => {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests' || entry.name === 'e2e' || entry.name === '__tests__') continue;
      results.push(...collectProductionFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx|js)$/.test(entry.name)) continue;
    results.push(fullPath);
  }
  return results;
};

const extractCallSnippet = (source: string, startIndex: number): string => {
  let depth = 0;
  let seenOpen = false;
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      depth += 1;
      seenOpen = true;
    } else if (ch === ')') {
      depth -= 1;
      if (seenOpen && depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  return source.slice(startIndex, Math.min(source.length, startIndex + 400));
};

const usesExplicit24HourClock = (snippet: string): boolean =>
  /hourCycle\s*:\s*['"]h23['"]/.test(snippet) || /hour12\s*:\s*false/.test(snippet);

describe('24-hour time nomenclature policy', () => {
  const productionFiles = SCAN_ROOTS.flatMap(root =>
    fs.existsSync(root) ? collectProductionFiles(root) : []
  );

  it('forbids native <input type="time"> in production UI (use Time24Input instead)', () => {
    const violations: string[] = [];

    for (const filePath of productionFiles) {
      if (!/\.(ts|tsx)$/.test(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      if (/<input\b[^>]*\btype\s*=\s*["']time["']/s.test(content)) {
        violations.push(path.relative(REPO_ROOT, filePath));
      }
    }

    expect(violations).toEqual([]);
  });

  it('forbids hardcoded 12-hour AM/PM or a. m./p. m. clock strings in production code', () => {
    const violations: string[] = [];
    const amPmTimePattern = /\b\d{1,2}:\d{2}\s*(?:AM|PM|a\.\s*m\.|p\.\s*m\.)\b|\b[ap]\.\s*m\./gi;

    for (const filePath of productionFiles) {
      const relativePath = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
      if (ALLOWED_AM_PM_FILES.has(relativePath)) continue;
      if (relativePath === 'src/components/ui/Time24Input.tsx') continue;
      const content = fs.readFileSync(filePath, 'utf8');
      const matches = content.match(amPmTimePattern);
      if (matches) {
        violations.push(`${relativePath}: ${matches.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('requires explicit 24-hour clock options (hourCycle: "h23" or hour12: false) on time formatters', () => {
    const violations: string[] = [];
    const callPattern = /(?:toLocaleTimeString|toLocaleString|Intl\.DateTimeFormat)\s*\(/g;

    for (const filePath of productionFiles) {
      if (!/\.(ts|tsx|js|mjs)$/.test(filePath)) continue;
      const relativePath = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
      const content = fs.readFileSync(filePath, 'utf8');

      for (const match of content.matchAll(callPattern)) {
        const index = match.index ?? 0;
        const callName = match[0];
        const snippet = extractCallSnippet(content, index);

        // Date-only Intl.DateTimeFormat / toLocaleString calls and numeric toLocaleString('es-CL')
        // calls without timeZone/time components are exempt.
        const isDateTimeCall =
          callName.startsWith('toLocaleTimeString') ||
          /\b(?:timeStyle|hour)\s*:/.test(snippet) ||
          (callName.startsWith('toLocaleString') &&
            /\btimeZone\s*:/.test(snippet) &&
            !/\b(?:day|month|year|weekday|dateStyle)\s*:/.test(snippet));

        if (!isDateTimeCall) continue;
        if (usesExplicit24HourClock(snippet)) continue;
        // formatTimestamp helper in dateDisplayUtils injects hourCycle: 'h23' programmatically.
        if (
          relativePath === 'src/utils/dateDisplayUtils.ts' &&
          snippet.includes('resolvedOptions')
        ) {
          continue;
        }
        // clinicalTimeZone formats numeric parts (year/month/day/hour/minute) or passes hourCycle: 'h23'.
        const line = content.slice(0, index).split('\n').length;
        violations.push(`${relativePath}:${line} -> ${snippet.replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
