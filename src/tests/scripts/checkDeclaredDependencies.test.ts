// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-declared-dependencies.mjs');
const roots: string[] = [];

/** Runs the guard on a synthetic repository declaring `declared` and holding `files`. */
const runGuard = (declared: Record<string, string>, files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-declared-deps-'));
  roots.push(root);
  const write = (relativePath: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  };
  write(
    'package.json',
    JSON.stringify({ name: 'fixture-app', dependencies: declared, devDependencies: {} })
  );
  for (const [relativePath, content] of Object.entries(files)) write(relativePath, content);
  const result = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-declared-dependencies', () => {
  it('reports each package imported without being declared, wherever the import lives', () => {
    const { status, output } = runGuard(
      { react: '^19.0.0' },
      {
        'src/view.tsx':
          "import React from 'react';\nimport vtkPlane from '@kitware/vtk.js/Plane';\n",
        'scripts/build.mjs': "\nconst { build } = await import('esbuild');\n",
        'e2e/fixture.ts': "const util = require('@firebase/util');\n",
        'src/tests/view.test.ts': "vi.mock('@tanstack/react-virtual', () => ({}));\n",
      }
    );

    expect(status).toBe(1);
    expect(output).toContain('src/view.tsx:2 imports undeclared "@kitware/vtk.js"');
    expect(output).toContain('scripts/build.mjs:2 imports undeclared "esbuild"');
    expect(output).toContain('e2e/fixture.ts:1 imports undeclared "@firebase/util"');
    expect(output).toContain(
      'src/tests/view.test.ts:1 imports undeclared "@tanstack/react-virtual"'
    );
    expect(output).not.toContain('"react"');
  });

  it('accepts declared packages, Node built-ins, aliases, relative paths and fixture text', () => {
    const { status, output } = runGuard(
      { firebase: '^12.0.0' },
      {
        'src/app.ts': [
          "import { initializeApp } from 'firebase/app';",
          "import fs from 'node:fs';",
          "import path from 'path';",
          "import { helper } from '@/utils/helper';",
          "import local from './local';",
          "import { registerSW } from 'virtual:pwa-register';",
          'const fixture = \'require("fixture-native")\';',
        ].join('\n'),
      }
    );

    expect(output).toContain('Declared dependency check passed');
    expect(status).toBe(0);
  });
});
