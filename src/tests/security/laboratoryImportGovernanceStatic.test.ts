// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');

describe('Laboratory import governance', () => {
  it('keeps external modules out of deep laboratory imports', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    for (const [target, expected] of [
      ['@/features/laboratory/hooks/useSyslabAccess', 1],
      ['@/features/laboratory/census-inbox', 0],
    ] satisfies [string, number][]) {
      const [result] = await eslint.lintText(`import '${target}';`, {
        filePath: path.join(ROOT, 'src/views/Probe.ts'),
      });
      expect(
        result.messages.filter(
          message => message.ruleId === 'hhr/public-import-boundaries' && message.severity === 2
        )
      ).toHaveLength(expected);
    }
  });
});
