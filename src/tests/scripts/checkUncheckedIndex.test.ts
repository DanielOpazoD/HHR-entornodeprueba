// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
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

const run = (root: string, args: string[] = [], ci = '', env: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/check-unchecked-index-ratchet.mjs'), ...args],
    {
      cwd: root,
      env: { ...process.env, CI: ci, ...env },
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
  it('keeps warm local diagnostics and baseline writes identical to CI without sharing its cache', () => {
    const root = fixture('hhr unchecked cache ');
    const cache = path.join(root, 'output/typecheck/unchecked-index.tsbuildinfo');
    const full = run(root, [], 'true');
    expect(existsSync(cache)).toBe(false);
    expect(run(root)).toEqual(full);
    expect(existsSync(cache)).toBe(true);
    expect(run(root)).toEqual(full);
    writeFileSync(
      path.join(root, 'src/example/read.ts'),
      'export const value: string = ["synthetic"][0];\nexport const second: number = [1][0];\n'
    );
    expect(run(root)).toEqual(run(root, [], 'true'));
    expect(run(root)).toEqual(run(root, [], 'true'));
    writeFileSync(cache, '{truncated');
    expect(run(root)).toEqual(run(root, [], 'true'));
    const info = JSON.parse(readFileSync(cache, 'utf8'));
    info.version = '0.0.0-synthetic';
    writeFileSync(cache, JSON.stringify(info));
    expect(run(root)).toEqual(run(root, [], 'true'));
    run(root, ['--write-baseline']);
    const local = readFileSync(path.join(root, baselinePath), 'utf8');
    expect(run(root, ['--write-baseline'], 'true').status).toBe(0);
    expect(readFileSync(path.join(root, baselinePath), 'utf8')).toBe(local);
  });

  it('rejects invalid configuration after warming diagnostics and preserves the baseline', () => {
    const root = fixture('hhr unchecked warm invalid ');
    run(root);
    run(root);
    writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { strict: true, types: [], unknownCompilerOption: true },
        include: ['src'],
      })
    );
    for (const ci of ['', 'true']) {
      const result = run(root, ['--write-baseline'], ci);
      expect(result.status).toBe(1);
      expect(result.output).toContain('Analysis failed');
      expect(readFileSync(path.join(root, baselinePath), 'utf8')).toBe(baseline);
    }
  });
  it.each(['', 'error TS5000: synthetic configuration failure', 'fatal compiler failure'])(
    'rejects exit 1 without valid diagnostics: %s',
    failure => {
      const root = fixture('hhr unchecked failed compiler ');
      const bin = path.join(root, 'bin');
      mkdirSync(bin);
      const executable = path.join(bin, 'npx');
      const output = `${failure}\n${path.join(root, 'src/example/read.ts')}\n`;
      writeFileSync(
        executable,
        `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(output)}); process.exit(1);\n`
      );
      chmodSync(executable, 0o755);
      const result = run(root, [], '', {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain('Analysis failed');
      expect(readFileSync(path.join(root, baselinePath), 'utf8')).toBe(baseline);
    }
  );

  describe('a compiler that exits 1 with the diagnostics of the baseline', () => {
    const fakeCompiler = (stderr: string) => {
      const root = fixture('hhr unchecked exit one ');
      const bin = path.join(root, 'bin');
      mkdirSync(bin);
      const file = path.join(root, 'src/example/read.ts');
      const diagnostic = (line: number) =>
        `src/example/read.ts(${line},30): error TS2322: synthetic unchecked read`;
      const output = `${diagnostic(1)}\n${diagnostic(2)}\n${file}\n`;
      const executable = path.join(bin, 'npx');
      writeFileSync(
        executable,
        `#!/usr/bin/env node\nprocess.stderr.write(${JSON.stringify(stderr)}); process.stdout.write(${JSON.stringify(output)}); process.exit(1);\n`
      );
      chmodSync(executable, 0o755);
      return { root, env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
    };
    const expectRejected = (root: string, result: { status: number | null; output: string }) => {
      expect(result.status).toBe(1);
      expect(result.output).toContain('Analysis failed');
      expect(readFileSync(path.join(root, baselinePath), 'utf8')).toBe(baseline);
    };

    it('is a warm local repetition: the count is compared as usual', () => {
      const { root, env } = fakeCompiler('');
      const result = run(root, [], '', env);
      expect(result.output).toContain('[unchecked-index] OK (2 production reads');
      expect(result.status).toBe(0);
    });

    it('is rejected when the compiler also wrote to stderr', () => {
      const { root, env } = fakeCompiler('compiler crashed halfway');
      expectRejected(root, run(root, [], '', env));
    });

    it('is rejected in CI, which never compiles incrementally', () => {
      const { root, env } = fakeCompiler('');
      expectRejected(root, run(root, [], 'true', env));
    });

    it('never writes the baseline, which always comes from a full compilation', () => {
      const { root, env } = fakeCompiler('');
      expectRejected(root, run(root, ['--write-baseline'], '', env));
      expectRejected(root, run(root, ['--write-baseline'], 'true', env));
    });
  });
});
