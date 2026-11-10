// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-unreachable-modules.mjs');
const CONFIG = 'scripts/config/unreachable-modules.json';
const INDEX_HTML = '<script type="module" src="/src/index.tsx"></script>\n';
const roots: string[] = [];

/** Runs the guard on a synthetic repository made of `files`. */
const runGuard = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-unreachable-modules-'));
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

describe('check-unreachable-modules', () => {
  it('reports a module that only its own test imports', () => {
    const { status, output } = runGuard({
      'index.html': INDEX_HTML,
      'src/index.tsx': "import { used } from './used';\nused();\n",
      'src/used.ts': 'export const used = () => 1;\n',
      'src/orphan.ts': 'export const orphan = () => 2;\n',
      'src/tests/orphan.test.ts': "import { orphan } from '../orphan';\norphan();\n",
      'src/orphan.stories.tsx': "import { orphan } from './orphan';\nexport default orphan;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain('- src/orphan.ts');
    expect(output).not.toContain('- src/used.ts');
    expect(output).toContain('Delete each one with the tests that only test it');
  });

  it('follows lazy imports, type-only imports, re-exports and worker URLs', () => {
    const { status, output } = runGuard({
      'index.html': INDEX_HTML,
      'src/index.tsx': [
        "import type { Model } from '@/model';",
        "export { helper } from './barrel';",
        'const view = () => import(/* webpackChunkName: "view" */ \'@/view\');',
        "const worker = new Worker(new URL('./parse.worker.ts', import.meta.url));",
        'export const start = (model: Model) => [view, worker, model];',
        '',
      ].join('\n'),
      'src/model.ts': 'export interface Model { id: string }\n',
      'src/barrel/index.ts': "export * from './helper';\n",
      'src/barrel/helper.ts': 'export const helper = 1;\n',
      'src/view.tsx': 'export const View = () => null;\n',
      'src/parse.worker.ts': 'export {};\n',
    });

    expect(output).toContain('Unreachable module check passed (6 modules');
    expect(status).toBe(0);
  });

  it('treats Netlify functions and declared entry points as roots', () => {
    const { status } = runGuard({
      'index.html': INDEX_HTML,
      'src/index.tsx': 'export {};\n',
      'netlify/functions/report.ts': "import { build } from '../../src/server/report';\nbuild();\n",
      'src/server/report.ts': 'export const build = () => 1;\n',
      'src/service-worker.ts': "import { cache } from './pwa/cache';\ncache();\n",
      'src/pwa/cache.ts': 'export const cache = () => 1;\n',
      [CONFIG]: JSON.stringify({
        entryPoints: [{ file: 'src/service-worker.ts', declaredIn: 'vite.config.ts' }],
      }),
    });

    expect(status).toBe(0);
  });

  it('accepts a module retained on purpose and names every stale entry of that list', () => {
    const files = {
      'index.html': INDEX_HTML,
      'src/index.tsx': "import './used';\n",
      'src/used.ts': 'export {};\n',
      'src/kept.ts': 'export const kept = 1;\n',
    };
    const config = (kept: string[]) =>
      JSON.stringify({ retained: [{ reason: 'owner decision pending', files: kept }] });

    expect(runGuard({ ...files, [CONFIG]: config(['src/kept.ts']) }).status).toBe(0);

    const stale = runGuard({
      ...files,
      [CONFIG]: config(['src/kept.ts', 'src/used.ts', 'src/gone.ts']),
    });
    expect(stale.status).toBe(1);
    expect(stale.output).toContain('Listed as retained, but reachable again or no longer there:');
    expect(stale.output).toContain('- src/gone.ts');
    expect(stale.output).toContain('- src/used.ts');
    expect(stale.output).not.toContain('- src/kept.ts');
  });

  it('fails when a declared entry point does not exist', () => {
    const { status, output } = runGuard({
      'index.html': INDEX_HTML,
      'src/index.tsx': 'export {};\n',
      [CONFIG]: JSON.stringify({
        entryPoints: [{ file: 'src/missing-entry.ts', declaredIn: 'nowhere' }],
      }),
    });

    expect(status).toBe(1);
    expect(output).toContain('Declared entry points that do not exist:');
    expect(output).toContain('- src/missing-entry.ts');
  });
});
