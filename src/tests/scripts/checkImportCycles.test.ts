// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-import-cycles.mjs');
const roots: string[] = [];

/** Runs the guard on a synthetic repository made of `files`. */
const runGuard = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-import-cycles-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  const result = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-import-cycles', () => {
  it('reports a cycle of static value imports with every file in it', () => {
    const { status, output } = runGuard({
      'src/a.ts': "import { b } from './b';\nexport const a = () => b;\n",
      'src/b.ts': "import { c } from '@/c';\nexport const b = 1;\nexport const viaC = c;\n",
      'src/c.ts': "import {\n  a,\n} from './a';\nexport const c = a;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain('[3 files] src/a.ts ↔ src/b.ts ↔ src/c.ts');
  });

  it('counts re-exports, namespace imports and mixed type/value specifiers as runtime edges', () => {
    const { status, output } = runGuard({
      'src/feature/index.ts': "export * from './service';\n",
      'src/feature/service.ts':
        "import * as store from '../store';\nexport const service = () => store.read();\n",
      'src/store.tsx':
        "import { type Model, service } from '@/feature';\nexport const read = service;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain('[3 files]');
  });

  it('ignores type-only imports, dynamic import() and test files', () => {
    const { status, output } = runGuard({
      'src/a.ts':
        "import type { B } from './b';\nexport const a = (b: B) => import('./c').then(m => m.c(b));\n",
      'src/b.ts':
        "import { type A } from './a';\nexport type { A } from './a';\nexport interface B { a: A }\n",
      'src/c.ts': "import { a } from './a';\nexport const c = a;\n",
      'src/tests/a.test.ts': "import { a } from '../a';\nimport './loop.test';\n",
      'src/tests/loop.test.ts': "import './a.test';\n",
    });

    expect(output).toContain('Import cycle check passed');
    expect(status).toBe(0);
  });

  it('reports a module that imports itself', () => {
    const { status, output } = runGuard({
      'src/self/index.ts': "import { x } from '.';\nexport const x = 1;\nexport const y = x;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain('[1 files] src/self/index.ts');
  });
});
