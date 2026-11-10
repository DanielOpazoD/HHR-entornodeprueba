// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const baselinePath = 'scripts/config/unchecked-index-baseline.json';
const baseline = JSON.stringify({ version: 1, total: 2, areas: { 'src/example/read': 2 } });

const fixture = (
  prefix: string,
  files: Record<string, string> = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { strict: true, types: [] },
      include: ['src'],
    }),
    'src/example/read.ts': 'export const value: string = ["synthetic"][0];\n',
  }
) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  roots.push(root);
  for (const [relative, content] of Object.entries({ [baselinePath]: baseline, ...files })) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }
  copyFileSync(
    'scripts/check-unchecked-index-ratchet.mjs',
    path.join(root, 'scripts/check-unchecked-index-ratchet.mjs')
  );
  symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir');
  return root;
};

const run = (root: string, args: string[] = []) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/check-unchecked-index-ratchet.mjs'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('unchecked-index CLI', () => {
  it.each(['hhr-unchecked-', 'hhr unchecked ', 'hhr unchecked #%?[$] '])(
    'rejects a wrong baseline in %s',
    prefix => {
      const { status, output } = run(fixture(prefix));
      expect({ status, output }).toEqual({
        status: 1,
        output: expect.stringContaining('src/example/read: 2 → 1'),
      });
      expect(output).toContain('lower its count');
      expect(status).toBe(1);
    }
  );

  it('rejects growth and accepts zero errors only after evaluating production files', () => {
    const root = fixture('hhr unchecked growth ');
    writeFileSync(
      path.join(root, baselinePath),
      JSON.stringify({ version: 1, total: 0, areas: {} })
    );
    const growth = run(root);
    expect(growth.status).toBe(1);
    expect(growth.output).toContain('src/example/read: 0 → 1. Guard the new indexed read');

    writeFileSync(path.join(root, 'src/example/read.ts'), 'export const value = 1;\n');
    const clean = run(root);
    expect(clean.status).toBe(0);
    expect(clean.output).toContain('0 production reads still unchecked');
    expect(clean.output).toContain('1 production files evaluated');
  });

  it('rejects an analysis with no production files, including baseline writes', () => {
    const root = fixture('hhr unchecked empty ', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { types: [] }, include: ['src'] }),
      'src/tests/only.ts': 'export const value = 1;\n',
    });
    for (const args of [[], ['--write-baseline']]) {
      const result = run(root, args);
      expect(result.output).toContain('[unchecked-index] No production files evaluated');
      expect(result.status).toBe(1);
      expect(readFileSync(path.join(root, baselinePath), 'utf8')).toBe(baseline);
    }
  });

  it('reports compiler configuration failures instead of writing an empty baseline', () => {
    const root = fixture('hhr unchecked invalid ', {
      'src/example/read.ts': 'export const x = 1;\n',
    });
    const result = run(root, ['--write-baseline']);
    expect(result.output).toContain('[unchecked-index] Analysis failed');
    expect(result.output).toContain('tsconfig.json');
    expect(result.status).toBe(1);
    expect(readFileSync(path.join(root, baselinePath), 'utf8')).toBe(baseline);
  });

  it('rejects invalid compiler options even when production files are listed', () => {
    const root = fixture('hhr unchecked options ', {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { types: [], unknownCompilerOption: true },
        include: ['src'],
      }),
      'src/example/read.ts': 'export const value = 1;\n',
      [baselinePath]: JSON.stringify({ version: 1, total: 0, areas: {} }),
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('[unchecked-index] Analysis failed');
    expect(result.output).toContain('unknownCompilerOption');
  });
});
