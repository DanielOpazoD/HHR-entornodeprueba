import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');
const SRC_ROOT = path.join(ROOT, 'src');

const ALLOWED_MANUAL_EPISODE_KEY_BUILDERS = new Set([
  'src/application/patient-flow/clinicalEpisode.ts',
]);
const ALLOWED_LEGACY_EPISODE_KEY_READERS = new Set([
  'src/application/patient-flow/clinicalEpisode.ts',
]);
const ALLOWED_NON_CLINICAL_COMPOSITE_KEY_BUILDERS = new Set([
  'src/services/reminders/reminderShared.ts',
]);

const MANUAL_TEMPLATE_KEY_PATTERN = /\$\{[^`]*\}__\$\{[^`]*\}/;
const MANUAL_LEGACY_EPISODE_KEY_READ_PATTERN = /episodeKey\.(?:split|includes)\(['"]__['"]\)/;

const collectSourceFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }

    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
};

describe('clinical episode key governance', () => {
  it('keeps manual episode-key string construction inside the canonical resolver', () => {
    const violations = collectSourceFiles(SRC_ROOT)
      .map(file => {
        const relativePath = path.relative(ROOT, file);
        if (
          ALLOWED_MANUAL_EPISODE_KEY_BUILDERS.has(relativePath) ||
          ALLOWED_NON_CLINICAL_COMPOSITE_KEY_BUILDERS.has(relativePath)
        ) {
          return null;
        }
        const content = fs.readFileSync(file, 'utf8');
        return MANUAL_TEMPLATE_KEY_PATTERN.test(content) ? relativePath : null;
      })
      .filter(Boolean)
      .sort();

    expect(violations).toEqual([]);
  });

  it('keeps legacy episode-key parsing inside the patient-flow compatibility boundary', () => {
    const violations = collectSourceFiles(SRC_ROOT)
      .map(file => {
        const relativePath = path.relative(ROOT, file);
        if (
          relativePath.includes('/tests/') ||
          relativePath.includes('.test.') ||
          ALLOWED_LEGACY_EPISODE_KEY_READERS.has(relativePath)
        ) {
          return null;
        }

        const content = fs.readFileSync(file, 'utf8');
        return MANUAL_LEGACY_EPISODE_KEY_READ_PATTERN.test(content) ? relativePath : null;
      })
      .filter(Boolean)
      .sort();

    expect(violations).toEqual([]);
  });
});
