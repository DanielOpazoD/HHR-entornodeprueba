// @vitest-environment node
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('rejects explicit any in production while preserving test configuration', async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  for (const area of ['storage', 'repositories', 'admin']) {
    const config = await eslint.calculateConfigForFile(`src/services/${area}/probe.ts`);
    expect(config.rules['@typescript-eslint/no-explicit-any'][0]).toBe(2);
  }
  for (const [file, severity] of [
    ['src/tests/probe.ts', 1],
    ['src/tests/probe.test.ts', 0],
    ['src/utils/probe.test.ts', 0],
    ['src/utils/probe.spec.ts', 1],
    ['e2e/probe.spec.ts', 1],
  ] as const) {
    const config = await eslint.calculateConfigForFile(file);
    expect(config.rules['@typescript-eslint/no-explicit-any'][0]).toBe(severity);
  }
});
