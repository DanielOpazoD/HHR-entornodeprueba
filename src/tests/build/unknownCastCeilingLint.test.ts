// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const RULE = 'types/unknown-cast-ceiling';
const CEILINGS: Record<string, number> = JSON.parse(
  readFileSync('scripts/config/unknown-cast-ceilings.json', 'utf8')
).files;

const eslint = new ESLint({ cwd: process.cwd() });
const messages = async (code: string, filePath: string) =>
  (await eslint.lintText(code, { filePath }))[0].messages.filter(
    message => message.ruleId === RULE
  );

const listedFile = Object.keys(CEILINGS).find(file => file.endsWith('.ts') && CEILINGS[file] === 1);

describe('production files never add an `as unknown as`', () => {
  it.each([
    'export const toNumber = (value: string) => value as unknown as number;',
    'export const toNumber = (value: string) => <number>(<unknown>value);',
  ])('rejects one in a file without a ceiling and names the fix: %s', async code => {
    const [message] = await messages(code, 'src/services/storage/newProbe.ts');
    expect(message?.message).toContain('Este archivo tiene 1 y su techo es 0');
    expect(message?.message).toContain('un solo `as` si TypeScript lo acepta');
  });

  it('accepts a single checked cast and a cast to unknown alone', async () => {
    expect(
      await messages(
        'export const read = (value: object) => [value as Record<string, unknown>, value as unknown];',
        'src/services/storage/newProbe.ts'
      )
    ).toEqual([]);
  });

  it('keeps each listed file at its ceiling, and asks to lower a ceiling no longer reached', async () => {
    expect(listedFile).toBeDefined();
    const file = listedFile as string;
    const cast = 'export const a = (value: string) => value as unknown as number;';
    expect(await messages(cast, file)).toEqual([]);
    const grown = await messages(
      `${cast}\nexport const b = (value: string) => value as unknown as number;`,
      file
    );
    expect(grown.map(message => message.message)).toEqual([
      expect.stringContaining('Este archivo tiene 2 y su techo es 1'),
      expect.stringContaining('Este archivo tiene 2 y su techo es 1'),
    ]);
    const [lower] = await messages('export const a = 1;', file);
    expect(lower?.message).toContain('Baja su techo en scripts/config/unknown-cast-ceilings.json');
  });

  it('applies to production source only', async () => {
    const cast = 'export const toNumber = (value: string) => value as unknown as number;';
    expect(await messages(cast, 'src/tests/probe.test.ts')).toEqual([]);
    expect(await messages(cast, 'src/services/storage/probe.test.ts')).toEqual([]);
  });

  it('lists only existing files, each with at least one cast', () => {
    for (const [file, ceiling] of Object.entries(CEILINGS)) {
      expect(existsSync(file), file).toBe(true);
      expect(ceiling, file).toBeGreaterThan(0);
    }
  });
});
