// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const NETLIFY_DIR = path.join(process.cwd(), 'netlify', 'functions');
const ALLOWED_FIREBASE_BRIDGES = new Set([
  '../../../functions/lib/auth/authConfig.js',
  '../../../functions/lib/auth/authEmailUtils.js',
]);

describe('netlify runtime isolation', () => {
  const entryFiles = readdirSync(NETLIFY_DIR)
    .filter(fileName => /\.(ts|js)$/.test(fileName))
    .map(fileName => path.join(NETLIFY_DIR, fileName));
  const libFiles = readdirSync(path.join(NETLIFY_DIR, 'lib'))
    .filter(fileName => /\.(ts|js)$/.test(fileName))
    .map(fileName => path.join(NETLIFY_DIR, 'lib', fileName));

  it('does not import firebase-functions runtime from netlify functions', () => {
    for (const filePath of [...entryFiles, ...libFiles]) {
      const content = readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(/firebase-functions(?:\/v1)?/);
    }
  });

  it('allows only pure bridges from firebase functions modules', () => {
    for (const filePath of [...entryFiles, ...libFiles]) {
      const content = readFileSync(filePath, 'utf8');
      const matches = [
        ...content.matchAll(/from ['"](\.\.\/\.\.\/\.\.\/functions\/lib\/[^'"]+)['"]/g),
      ];
      for (const match of matches) {
        expect(ALLOWED_FIREBASE_BRIDGES.has(match[1])).toBe(true);
      }
    }
  });
});
