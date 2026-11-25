// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { LEGACY_FUNCTIONS_V1_FILES } from '../../../scripts/lib/eslint/syntaxRestrictions.mjs';

const ROOT = process.cwd();
const eslint = new ESLint({ cwd: ROOT });

const lintVirtual = async (relativeFile: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relativeFile) });
  return result.messages;
};

describe('Cloud Functions v1 downward-only restriction', () => {
  it('rejects firebase-functions/v1 in new Cloud Functions modules', async () => {
    const messages = await lintVirtual(
      'functions/lib/newCallableProbe.js',
      "const functions = require('firebase-functions/v1');\nmodule.exports = { functions };\n"
    );
    expect(
      messages.some(m => m.ruleId === 'no-restricted-syntax' && m.message.includes('v1'))
    ).toBe(true);
  });

  it('allows firebase-functions/v2 while keeping Cloud Functions role restrictions active', async () => {
    const cleanMessages = await lintVirtual(
      'functions/lib/newCallableProbe.js',
      "const { HttpsError } = require('firebase-functions/v2/https');\nmodule.exports = { HttpsError };\n"
    );
    expect(cleanMessages).toEqual([]);

    const roleMessages = await lintVirtual(
      'functions/lib/newCallableProbe.js',
      "const isAllowed = role => role === 'admin';\nmodule.exports = { isAllowed };\n"
    );
    expect(
      roleMessages.some(
        m => m.ruleId === 'no-restricted-syntax' && m.message.includes('rolePredicates.js')
      )
    ).toBe(true);
  });

  it('keeps LEGACY_FUNCTIONS_V1_FILES strictly downward-only (every listed file still uses v1)', () => {
    for (const relativeFile of LEGACY_FUNCTIONS_V1_FILES) {
      const fullPath = path.join(ROOT, relativeFile);
      expect(fs.existsSync(fullPath), `${relativeFile} no longer exists`).toBe(true);
      const source = fs.readFileSync(fullPath, 'utf8');
      expect(
        /firebase-functions\/v1(?:\/|['"])/.test(source),
        `${relativeFile} no longer imports firebase-functions/v1 — remove it from LEGACY_FUNCTIONS_V1_FILES`
      ).toBe(true);
    }
  });
});
