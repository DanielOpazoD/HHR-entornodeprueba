import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');
const ALLOWED_COMPATIBILITY_REFERENCES = [
  'firestore.rules',
  'storage.rules',
  'functions/lib/auth/authHelpersFactory.js',
  'netlify/functions/lib/firebase-auth.ts',
  'scripts/config/compatibility-governance.json',
  'src/services/admin/roleService.ts',
];

describe('legacy role alias governance', () => {
  it('limits viewer_census references to the approved migration surfaces', () => {
    const rawOutput = execFileSync(
      'rg',
      [
        '--files-with-matches',
        '--fixed-strings',
        'viewer_census',
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
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    const referencedFiles = rawOutput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .sort();

    expect(referencedFiles).toEqual(ALLOWED_COMPATIBILITY_REFERENCES.sort());
  });
});
