// @vitest-environment node
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('rejects explicit any in production source as an error', async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  for (const file of [
    'src/services/storage/probe.ts',
    'src/services/repositories/probe.ts',
    'src/services/admin/probe.spec.ts',
    'src/utils/probe.ts',
    'src/features/census/components/Probe.tsx',
  ]) {
    const config = await eslint.calculateConfigForFile(file);
    expect(config.rules['@typescript-eslint/no-explicit-any'][0], file).toBe(2);
  }
});
