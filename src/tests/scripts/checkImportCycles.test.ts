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

  // Vite brings `?raw`, `?url` and `?inline` imports as text or a URL: no code of the file runs.
  it.each(['raw', 'url', 'inline'])('does not count a ?%s import as a runtime edge', query => {
    const { status, output } = runGuard({
      'src/a.ts': `import text from './b.ts?${query}';\nexport const a = text;\n`,
      'src/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(output).toContain('Import cycle check passed');
    expect(status).toBe(0);
  });

  it('still reports the same pair with a static import', () => {
    const { status } = runGuard({
      'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'src/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    expect(status).toBe(1);
  });

  it('covers Functions and Netlify code, where a require() inside a function still closes a cycle', () => {
    const functionsCycle = runGuard({
      'functions/lib/store.js':
        "const { matches } = require('./restore');\nmodule.exports = { read: () => matches() };\n",
      'functions/lib/restore.js':
        "const matches = () => true;\nconst attest = () => require('./store').read();\nmodule.exports = { matches, attest };\n",
    });
    const netlifyCycle = runGuard({
      'netlify/functions/a.ts': "import { b } from './lib/b';\nexport const a = b;\n",
      'netlify/functions/lib/b.ts': "import { a } from '../a';\nexport const b = () => a;\n",
    });

    expect(functionsCycle.status).toBe(1);
    expect(functionsCycle.output).toContain(
      '[2 files] functions/lib/restore.js ↔ functions/lib/store.js'
    );
    expect(netlifyCycle.status).toBe(1);
    expect(netlifyCycle.output).toContain(
      '[2 files] netlify/functions/a.ts ↔ netlify/functions/lib/b.ts'
    );
  });

  it('reports a module that imports itself', () => {
    const { status, output } = runGuard({
      'src/self/index.ts': "import { x } from '.';\nexport const x = 1;\nexport const y = x;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain('[1 files] src/self/index.ts');
  });
});
