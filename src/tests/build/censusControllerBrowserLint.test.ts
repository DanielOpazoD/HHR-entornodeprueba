// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const RULE = 'no-restricted-globals';
const CONTROLLERS = 'src/features/census/controllers/';

const eslint = new ESLint({ cwd: process.cwd() });
const messages = async (code: string, filePath: string) =>
  (await eslint.lintText(code, { filePath }))[0].messages.filter(
    message => message.ruleId === RULE
  );

describe('census controllers reach the browser only through the adapter', () => {
  // Each case failed the textual rule this one replaced (census-controller-browser) and must
  // keep failing; the last two are browser accesses the textual rule did not see.
  it.each([
    [`${CONTROLLERS}a.ts`, 'export const top = () => window.scrollTo(0, 0);'],
    [`${CONTROLLERS}a.ts`, 'export const x = () => globalThis.x;'],
    [`${CONTROLLERS}a.ts`, 'export const s = () => localStorage;'],
    [`${CONTROLLERS}a.ts`, 'export const title = () => document.title;'],
    [`${CONTROLLERS}a.ts`, 'export const copy = () => navigator.clipboard;'],
    [`${CONTROLLERS}censusBrowserRuntimeAdapter.ts`, 'export const x = () => window.x;'],
    [`${CONTROLLERS}nested/a.tsx`, 'export const title = () => document.title;'],
    [`${CONTROLLERS}a.ts`, "export const hasWindow = () => typeof window !== 'undefined';"],
    [`${CONTROLLERS}a.ts`, 'export const pass = (use: (w: unknown) => void) => use(window);'],
  ])('rejects the browser global in %s: %s', async (filePath, code) => {
    const [message] = await messages(code, filePath);
    expect(message?.message).toContain('censusBrowserRuntimeAdapter.ts');
  });

  it.each([
    ['a comment that names it', `${CONTROLLERS}a.ts`, '// document.title\nexport const x = 1;'],
    [
      'a parameter named document',
      `${CONTROLLERS}a.ts`,
      'export const title = (document: { title: string }) => document.title;',
    ],
    [
      'a property named like a global',
      `${CONTROLLERS}a.ts`,
      'export const read = (runtime: { localStorage: string }) => runtime.localStorage;',
    ],
    ['a census controller test', `${CONTROLLERS}a.test.ts`, 'export const x = () => window.x;'],
    [
      'a census file outside the controllers',
      'src/features/census/components/a.ts',
      'export const title = () => document.title;',
    ],
  ])('accepts %s', async (_why, filePath, code) => {
    expect(await messages(code, filePath)).toEqual([]);
  });
});
