import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { resolveBookBase } from '../folderDependencyBook.mjs';

export const CALENDAR_SOURCES = new Set([
  'src/utils/clinicalDateUtils.ts',
  'functions/lib/hospitalCalendarDay.js',
]);

export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

const HAND_DATE_PATTERN = String.raw`\d{4}-\d{2}-\d{2}`;

const toPosix = value => value.split(path.sep).join('/');

export const walkIn = (root, relativeDir, accept) => {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) files.push(...walkIn(root, relativePath, accept));
    else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      accept(relativePath)
    )
      files.push(relativePath);
  }
  return files;
};

export const isTestFile = relativePath =>
  relativePath.startsWith('src/tests/') || /\.(?:test|spec|stories)\./.test(relativePath);

/** Files where a hand-written date pattern counts: production src/ and functions/lib/ code. */
const countsHandDatePattern = file =>
  (file.startsWith('src/') || file.startsWith('functions/lib/')) &&
  SOURCE_EXTENSIONS.has(path.extname(file)) &&
  !file.endsWith('.d.ts') &&
  !isTestFile(file) &&
  !CALENDAR_SOURCES.has(file);

/** Hand-written date patterns in the working tree, every occurrence (`rg -o -F` counts them). */
const handDatePatterns = root =>
  [
    ...walkIn(root, 'src', countsHandDatePattern),
    ...walkIn(root, 'functions/lib', countsHandDatePattern),
  ]
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
    .reduce((total, source) => total + source.split(HAND_DATE_PATTERN).length - 1, 0);

/** The same count at commit `base`, or null when git cannot read it. */
const baseHandDatePatterns = (root, base) => {
  // `-o` prints one `<base>:<path>:<match>` line per occurrence, so two on one line count twice.
  const result = spawnSync(
    'git',
    ['-C', root, 'grep', '-o', '-F', '-e', HAND_DATE_PATTERN, base, '--', 'src', 'functions/lib'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status === 1) return 0;
  if (result.status !== 0) return null;
  const suffix = `:${HAND_DATE_PATTERN}`;
  return result.stdout
    .split('\n')
    .filter(line => line.endsWith(suffix))
    .map(line => line.slice(base.length + 1, -suffix.length))
    .filter(countsHandDatePattern).length;
};

/** Fails when hand-written date patterns grew from the base; without a base, says so. */
export const handDatePatternRatchet = (root, env) => {
  const resolved = resolveBookBase(root, env);
  if (resolved.error) return { violation: resolved.error };
  if (!resolved.base)
    return {
      notice:
        'Aviso: sin base (falta origin/main o FOLDER_BOOK_BASE), no se comparó la cuenta de fechas escritas a mano; CI la compara con la base de la PR.\n',
    };
  const before = baseHandDatePatterns(root, resolved.base);
  if (before === null) return { violation: `git grep could not read base ${resolved.base}` };
  const now = handDatePatterns(root);
  return now > before
    ? {
        violation: `${now} hand-written \\d{4}-\\d{2}-\\d{2} patterns, ${before} at the base ${resolved.base.slice(0, 9)}: validate a calendar day with isCalendarDate() from src/utils/clinicalDateUtils (isCalendarDay() from functions/lib/hospitalCalendarDay on the server)`,
      }
    : {};
};
