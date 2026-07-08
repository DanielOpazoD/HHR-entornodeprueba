import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');
const NEEDLE = 'viewer_census';

const SEARCH_ROOTS = [
  'firestore.rules',
  'storage.rules',
  'functions',
  'netlify',
  'scripts',
  'src/services',
  'src/shared',
  'src/hooks',
  'src/features',
  'src/types',
];

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

const SCANNABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.rules',
  '.md',
  '.yml',
  '.yaml',
  '.html',
]);

const ALLOWED_COMPATIBILITY_REFERENCES = [
  'firestore.rules',
  'storage.rules',
  'functions/lib/auth/authHelpersFactory.js',
  'netlify/functions/lib/firebase-auth.ts',
  'scripts/config/compatibility-governance.json',
  'src/services/admin/roleService.ts',
];

const toPosix = (value: string): string => value.split(path.sep).join('/');

const collectFiles = (relativeRoot: string, accumulator: string[]): void => {
  const absolute = path.join(ROOT, relativeRoot);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    accumulator.push(relativeRoot);
    return;
  }
  if (!stat.isDirectory()) return;

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const childRelative = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      collectFiles(childRelative, accumulator);
      continue;
    }
    if (entry.isFile()) {
      const extension = path.extname(entry.name);
      if (SCANNABLE_EXTENSIONS.has(extension)) {
        accumulator.push(childRelative);
      }
    }
  }
};

describe('legacy role alias governance', () => {
  it('limits viewer_census references to the approved migration surfaces', () => {
    const candidateFiles: string[] = [];
    for (const root of SEARCH_ROOTS) collectFiles(root, candidateFiles);

    const matches = candidateFiles
      .filter(relative => fs.readFileSync(path.join(ROOT, relative), 'utf8').includes(NEEDLE))
      .map(toPosix)
      .sort();

    expect(matches).toEqual(ALLOWED_COMPATIBILITY_REFERENCES.slice().sort());
  });
});
