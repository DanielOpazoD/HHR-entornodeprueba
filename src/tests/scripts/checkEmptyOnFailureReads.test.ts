// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-empty-on-failure-reads.mjs');
const BASELINE = 'scripts/config/empty-on-failure-reads-baseline.json';
const roots: string[] = [];

const READ_WITH_EMPTY_FALLBACK = [
  'export const getMonth = async (',
  '  year: number',
  '): Promise<string[]> => {',
  '  try {',
  '    return await read(year);',
  '  } catch (error) {',
  '    log(error);',
  '    return [];',
  '  }',
  '};',
].join('\n');

const createRepository = (files: Record<string, string>, baseline: string[]) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-empty-reads-'));
  roots.push(root);
  const write = (relativePath: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  };
  write(BASELINE, JSON.stringify({ version: 1, entries: baseline }));
  for (const [relativePath, content] of Object.entries(files)) write(relativePath, content);
  return root;
};

const runGuard = (root: string, args: string[] = []) => {
  const result = spawnSync(process.execPath, [GUARD, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-empty-on-failure-reads', () => {
  it('fails a new data-layer read that turns a failure into an empty result', () => {
    const root = createRepository(
      { 'src/services/storage/firestore/reads.ts': READ_WITH_EMPTY_FALLBACK },
      []
    );

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain('new: src/services/storage/firestore/reads.ts::getMonth');
  });

  it('accepts the known backlog and reads that rethrow or live outside the data layer', () => {
    const root = createRepository(
      {
        'src/services/storage/firestore/reads.ts': READ_WITH_EMPTY_FALLBACK,
        'src/services/repositories/rethrows.ts':
          'export const load = async () => {\n  try {\n    return await read();\n  } catch (error) {\n    if (isMissing(error)) return null;\n    throw error;\n  }\n};\n',
        'src/features/view.ts':
          'export const view = () => {\n  try {\n    return compute();\n  } catch {\n    return [];\n  }\n};\n',
      },
      ['src/services/storage/firestore/reads.ts::getMonth']
    );

    const { status, output } = runGuard(root);

    expect(output).toContain('OK (1 known reads still return empty on failure; 0 new)');
    expect(status).toBe(0);
  });

  it('asks to shrink the baseline once a listed read is fixed', () => {
    const root = createRepository(
      {
        'src/services/storage/firestore/reads.ts':
          'export const getMonth = async () => {\n  try {\n    return await read();\n  } catch (error) {\n    throw new MonthUnavailable(error);\n  }\n};\n',
      },
      ['src/services/storage/firestore/reads.ts::getMonth']
    );

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain('fixed: src/services/storage/firestore/reads.ts::getMonth');
  });

  it('rewrites the baseline from the current code on request', () => {
    const root = createRepository(
      { 'src/services/storage/indexeddb/reads.ts': READ_WITH_EMPTY_FALLBACK },
      []
    );

    expect(runGuard(root, ['--write-baseline']).status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, BASELINE), 'utf8')).entries).toEqual([
      'src/services/storage/indexeddb/reads.ts::getMonth',
    ]);
  });
});
