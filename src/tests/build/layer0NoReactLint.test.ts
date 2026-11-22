// @vitest-environment node
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const eslint = new ESLint({ cwd: ROOT });

const lintVirtual = async (relativeFile: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relativeFile) });
  return result.messages;
};

describe('Layer 0 (pure core) React and JSX restriction', () => {
  it('rejects explicit React imports in Layer 0 modules', async () => {
    const messages = await lintVirtual(
      'src/utils/layer0Probe.ts',
      "import { lazy } from 'react';\nexport const probe = lazy;\n"
    );
    expect(messages.some(m => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('rejects automatic-runtime JSX elements and fragments in Layer 0 .tsx files', async () => {
    const elementMessages = await lintVirtual(
      'src/shared/layer0Probe.tsx',
      'export const placeholder = <span />;\n'
    );
    expect(elementMessages.some(m => m.ruleId === 'no-restricted-syntax')).toBe(true);

    const fragmentMessages = await lintVirtual(
      'src/domain/layer0Probe.tsx',
      'export const fragment = <>ok</>;\n'
    );
    expect(fragmentMessages.some(m => m.ruleId === 'no-restricted-syntax')).toBe(true);
  });

  it('allows pure TypeScript modules in Layer 0', async () => {
    const messages = await lintVirtual(
      'src/utils/layer0Probe.ts',
      'export const add = (left: number, right: number): number => left + right;\n'
    );
    expect(messages).toEqual([]);
  });
});
