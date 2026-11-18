// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeFolderDependencies,
  checkFolderDependencies,
} from '../../../scripts/check-folder-dependencies.mjs';

type Exception = { from: string; to: string; kind: string; reason: string };
const POLICY = 'scripts/folder-dependency-matrix.json';
// The live layers with a synthetic book: the verdicts below are written by hand, never derived.
const liveLayers = JSON.parse(readFileSync(POLICY, 'utf8')).layers;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const createRepository = (files: Record<string, string>, exceptions: Exception[] = []) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-folder-dependencies-'));
  roots.push(root);
  const policy = JSON.stringify({ layers: liveLayers, exceptions });
  for (const [relativePath, content] of Object.entries({ [POLICY]: policy, ...files })) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return root;
};

const check = (files: Record<string, string>, exceptions: Exception[] = []) => {
  const result = checkFolderDependencies(createRepository(files, exceptions));
  return { ...result, output: `${result.stdout}${result.stderr}` };
};

const target = (file: string) => ({ [file]: 'export const x = 1;' });
const relativeFrom = (from: string, to: string) => {
  const relative = path.posix.relative(path.posix.dirname(from), to.replace(/\.tsx?$/, ''));
  return relative.startsWith('.') ? relative : `./${relative}`;
};

// Every spelling of one reference. All of them are the same relation.
const spellings = (from: string, to: string) => {
  const alias = `@/${to.replace(/^src\//, '').replace(/\.tsx?$/, '')}`;
  const relative = relativeFrom(from, to);
  return {
    alias: `import { x } from '${alias}';`,
    'alias .ts': `import { x } from '${alias}.ts';`,
    relativa: `import { x } from '${relative}';`,
    'relativa .ts': `import { x } from '${relative}.ts';`,
    reexportación: `export { x } from '${alias}';`,
    'sin nombres': `import '${relative}';`,
    // Built in two parts so check:declared-dependencies does not read it as an import.
    'import()': `export const load = () => import(${`'${alias}'`});`,
    'new URL (worker)': `export const w = new URL('${relative}.ts', import.meta.url);`,
  };
};

// What eslint-plugin-boundaries prohibited, measured on 3d96acba9 (W15-A1 probe-table.md:
// only relative spellings with an explicit `.ts`), and what decides each case now.
const formerBoundaryCases = [
  {
    name: 'servicios → feature',
    from: 'src/services/admin/probe.ts',
    to: 'src/features/census/public.ts',
    now: 'rejected',
  },
  {
    name: 'servicios → application',
    from: 'src/services/admin/probe.ts',
    to: 'src/application/census/public.ts',
    now: 'rejected',
  },
  {
    name: 'hooks/<sub> → feature',
    from: 'src/hooks/controllers/probe.ts',
    to: 'src/features/census/public.ts',
    now: 'rejected',
  },
  {
    name: 'components/<sub> → feature',
    from: 'src/components/layout/probe.tsx',
    to: 'src/features/census/public.ts',
    now: 'rejected',
  },
  // Prohibitions the boundaries block had and the design retires on purpose (see the PR).
  {
    name: 'servicios → servicios (otra subcarpeta)',
    from: 'src/services/admin/probe.ts',
    to: 'src/services/storage/sessionOwnerKey.ts',
    now: 'allowed',
  },
  {
    name: 'feature → application',
    from: 'src/features/whatsapp/probe.ts',
    to: 'src/application/census/public.ts',
    now: 'allowed',
  },
  {
    name: 'hooks/<sub> → application',
    from: 'src/hooks/controllers/probe.ts',
    to: 'src/application/census/public.ts',
    now: 'allowed',
  },
  {
    name: 'components/<sub> → application',
    from: 'src/components/layout/probe.tsx',
    to: 'src/application/census/public.ts',
    now: 'allowed',
  },
  {
    name: 'components/<sub> → servicios',
    from: 'src/components/layout/probe.tsx',
    to: 'src/services/storage/sessionOwnerKey.ts',
    now: 'allowed',
  },
  // Never seen by boundaries in any spelling; the folder rule sees them in all.
  {
    name: 'utils → servicios',
    from: 'src/utils/probe.ts',
    to: 'src/services/admin/attributionService.ts',
    now: 'rejected',
  },
  {
    name: 'hooks → application',
    from: 'src/hooks/probe.ts',
    to: 'src/application/census/public.ts',
    now: 'allowed',
  },
  {
    name: 'servicios → hooks',
    from: 'src/services/admin/probe.ts',
    to: 'src/hooks/useDailyRecordDomainModules.ts',
    now: 'rejected',
  },
  {
    name: 'application → feature',
    from: 'src/application/census/probe.ts',
    to: 'src/features/census/census-view.ts',
    now: 'rejected',
  },
  {
    name: 'servicios → utils',
    from: 'src/services/admin/probe.ts',
    to: 'src/utils/stringUtils.ts',
    now: 'allowed',
  },
];

describe('one direction rule between the folders of src/', () => {
  describe('the spelling table of the former boundaries block', () => {
    for (const fixture of formerBoundaryCases) {
      for (const [spelling, code] of Object.entries(spellings(fixture.from, fixture.to))) {
        it(`${fixture.name}, ${spelling}: ${fixture.now}`, () => {
          const result = check({ [fixture.from]: code, ...target(fixture.to) });
          expect(result.status, result.output).toBe(fixture.now === 'rejected' ? 1 : 0);
        });
      }
    }
  });

  it.each([
    ['utils', 'services'],
    ['shared', 'services'],
    ['schemas', 'services'],
    ['constants', 'services'],
    ['domain', 'application'],
    ['types', 'hooks'],
    ['services', 'application'],
    ['config', 'application'],
    ['services', 'components'],
    ['application', 'hooks'],
    ['application', 'context'],
    ['hooks', 'components'],
    ['context', 'components'],
    ['components', 'features'],
    ['components', 'views'],
    ['hooks', 'app-shell'],
    ['features', 'app-shell'],
    ['features', 'views'],
  ])('rejects a new value import %s → %s', (from, to) => {
    const result = check({
      [`src/${from}/probe.ts`]: `import { x } from '@/${to}/target';`,
      ...target(`src/${to}/target.ts`),
    });
    expect(result.status, result.output).toBe(1);
  });

  it.each([
    ['types', 'domain'],
    ['domain', 'shared'],
    ['utils', 'schemas'],
    ['services', 'config'],
    ['config', 'services'],
    ['application', 'services'],
    ['hooks', 'context'],
    ['context', 'hooks'],
    ['components', 'services'],
    ['features', 'application'],
    ['features', 'components'],
    ['app-shell', 'features'],
    ['views', 'features'],
  ])('accepts %s → %s', (from, to) => {
    const result = check({
      [`src/${from}/probe.ts`]: `import { x } from '@/${to}/target';`,
      ...target(`src/${to}/target.ts`),
    });
    expect(result.status, result.output).toBe(0);
  });

  it('rejects a file of services that imports one directly in src/', () => {
    const result = check({
      'src/services/probe.ts': "import { x } from '../firebaseConfig';",
      ...target('src/firebaseConfig.ts'),
    });
    expect(result.stderr).toContain('services está en la capa 1 (servicios) y (raíz) en la capa 6');
  });

  it('names origin, line, destination, class, both layers and the fix', () => {
    const result = check({
      'src/services/probe.ts': "// synthetic\nimport { x } from '@/application/target';",
      ...target('src/application/target.ts'),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '- src/services/probe.ts:2 → src/application/target.ts (valor, «@/application/target»)'
    );
    expect(result.stderr).toContain(
      'services está en la capa 1 (servicios) y application en la capa 2 (casos de uso compartidos)'
    );
    expect(result.stderr).toContain('mueve hacia abajo lo que comparten');
    expect(result.stderr).toContain('«import type»');
    expect(result.stderr).toContain(`No la agregues a "exceptions" en ${POLICY}`);
  });

  it('rejects a deferred upward load and names its class', () => {
    const result = check({
      'src/components/probe.tsx': "export const load = () => import('@/features/census/public');",
      ...target('src/features/census/public.ts'),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('(carga diferida, «@/features/census/public»)');
  });

  it.each([
    "import type { x } from '@/hooks/target';",
    "import { type x } from '@/hooks/target';",
    "import { type x, type y } from '@/hooks/target';",
    "export type { x } from '@/hooks/target';",
    "export type T = import('@/hooks/target').X;",
  ])('lets a type-only reference cross upward: %s', code => {
    const result = check({ 'src/services/probe.ts': code, ...target('src/hooks/target.ts') });
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain('1 de tipo hacia arriba, permitidas');
  });

  it('treats a mixed type and value import as a value import', () => {
    const result = check({
      'src/services/probe.ts': "import { type x, y } from '@/hooks/target';",
      ...target('src/hooks/target.ts'),
    });
    expect(result.status).toBe(1);
  });

  it('suggests the feature only when that feature is the only consumer', () => {
    const files = {
      'src/services/onlyCensus.ts': "import { x } from '@/features/census/model';\nexport { x };",
      'src/features/census/view.ts': "import { x } from '@/services/onlyCensus';\nexport { x };",
      ...target('src/features/census/model.ts'),
    };
    expect(check(files).stderr).toContain(
      'src/services/onlyCensus.ts solo lo usa features/census: muévelo a src/features/census/.'
    );
    const shared = check({
      ...files,
      'netlify/functions/fn.ts':
        "import { x } from '../../src/services/onlyCensus';\nexport { x };",
    });
    expect(shared.stderr).not.toContain('muévelo a');
    expect(shared.stderr).toContain('mueve hacia abajo lo que comparten');
  });

  describe('the exceptions book only shrinks', () => {
    const upward = {
      'src/services/probe.ts': "import { x } from '@/application/target';",
      ...target('src/application/target.ts'),
    };
    const listed = {
      from: 'src/services/probe.ts',
      to: 'src/application/target.ts',
      kind: 'value',
      reason: 'synthetic',
    };

    it('accepts a listed relation', () => {
      const result = check(upward, [listed]);
      expect(result.status, result.output).toBe(0);
      expect(result.stdout).toContain('1 relaciones hacia arriba, todas en el libro (1 de valor');
    });

    it('asks to remove a listed relation the code no longer has', () => {
      const result = check(target('src/application/target.ts'), [listed]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `- src/services/probe.ts → src/application/target.ts (valor)\n  Sácala de "exceptions" en ${POLICY}: el libro solo baja.`
      );
    });

    it('rejects a new upward relation even when a listed one disappeared', () => {
      const result = check(
        {
          'src/utils/other.ts': "import { x } from '@/services/target';",
          ...target('src/services/target.ts'),
          ...target('src/application/target.ts'),
        },
        [listed]
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('- src/utils/other.ts:1 → src/services/target.ts (valor');
      expect(result.stderr).toContain('Sácala de "exceptions"');
    });

    it('does not let a value listing cover a deferred load', () => {
      const result = check(
        {
          'src/services/probe.ts': "export const l = () => import('@/application/target');",
          ...target('src/application/target.ts'),
        },
        [listed]
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('(carga diferida');
      expect(result.stderr).toContain('Sácala de "exceptions"');
    });

    it('rejects entries without a reason or listed twice', () => {
      expect(check(upward, [{ ...listed, reason: ' ' }]).stderr).toContain('Excepción inválida');
      expect(check(upward, [listed, listed]).stderr).toContain('Excepción repetida');
    });

    it('ignores the former exception list file', () => {
      const result = check({
        'scripts/folder-dependency-allowlist.json': JSON.stringify({ violations: ['x'] }),
        'src/components/probe.ts': "import('@/features/census/target');",
        ...target('src/features/census/target.ts'),
      });
      expect(result.status).toBe(1);
    });
  });

  it('rejects a top-level folder without a layer', () => {
    const result = check({ 'src/platform/probe.ts': 'export const x = 1;' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/platform/ no tiene capa');
  });

  it.each([
    ['test', 'src/services/probe.test.ts'],
    ['spec', 'src/services/probe.spec.ts'],
    ['story', 'src/services/probe.stories.tsx'],
    ['declaration', 'src/services/probe.d.ts'],
    ['test tree', 'src/tests/services/probe.ts'],
  ])('leaves out a %s file', (_name, file) => {
    const result = check({
      [file]: "import { x } from '@/hooks/target';",
      ...target('src/hooks/target.ts'),
    });
    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['unresolved', "import('@/hooks/missing');"],
    ['package', "import('react');"],
    ['non-literal', 'import(target);'],
    ['comment', "// import('@/hooks/target');"],
    ['string', 'export const s = "import(\'@/hooks/target\')";'],
    ['same folder', "import { x } from './local';"],
  ])('ignores a %s reference', (_name, code) => {
    const result = check({
      'src/services/probe.ts': code,
      ...target('src/hooks/target.ts'),
      ...target('src/services/local.ts'),
    });
    expect(result.status, result.output).toBe(0);
  });

  it('leaves feature to feature imports to the feature matrix in ESLint', () => {
    const result = check({
      'src/features/whatsapp/probe.ts': "import { x } from '@/features/census/controllers/x';",
      ...target('src/features/census/controllers/x.ts'),
    });
    expect(result.status, result.output).toBe(0);
  });

  describe('ownership report', () => {
    const consumers = (files: Record<string, string>, module: string) => {
      const analysis = analyzeFolderDependencies(createRepository(files));
      return [...(analysis.consumersOf?.get(module) ?? [])].sort();
    };
    const module = { 'src/services/m.ts': 'export const x = 1;' };

    it('names the single feature that reaches a shared module through shared layers', () => {
      expect(
        consumers(
          {
            ...module,
            'src/hooks/useM.ts': "import { x } from '@/services/m';\nexport { x };",
            'src/features/census/view.ts': "import { x } from '@/hooks/useM';\nexport { x };",
          },
          'src/services/m.ts'
        )
      ).toEqual(['features/census']);
    });

    it('counts workers, Netlify, composition and declared server entries as consumers', () => {
      expect(
        consumers(
          {
            'src/services/m.worker.ts': 'export {};',
            'src/features/cudyr/read.ts':
              "export const w = new URL('../../services/m.worker.ts', import.meta.url);",
          },
          'src/services/m.worker.ts'
        )
      ).toEqual(['features/cudyr']);
      expect(
        consumers(
          {
            ...module,
            'src/features/cudyr/a.ts': "import { x } from '@/services/m';",
            'netlify/functions/fn.ts': "import { x } from '../../src/services/m';",
            'src/app-shell/boot.ts': "import type { x } from '@/services/m';",
          },
          'src/services/m.ts'
        )
      ).toEqual(['Netlify Functions', 'composición', 'features/cudyr']);
      expect(
        consumers(
          {
            ...module,
            'src/features/cudyr/a.ts': "import { x } from '@/services/m';",
            'scripts/config/unreachable-modules.json': JSON.stringify({
              entryPoints: [{ file: 'src/services/m.ts', declaredIn: 'scripts/build.mjs' }],
            }),
          },
          'src/services/m.ts'
        )
      ).toEqual(['entrada: scripts/build.mjs', 'features/cudyr']);
    });

    it('is a report: the command passes whatever it finds', () => {
      const root = createRepository({
        ...module,
        'src/features/census/view.ts': "import { x } from '@/services/m';",
      });
      const result = spawnSync(
        process.execPath,
        [path.resolve('scripts/check-folder-dependencies.mjs'), '--ownership'],
        { cwd: root, encoding: 'utf8' }
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('features/census (1):\n- src/services/m.ts');
    });
  });

  it('prints and exits as the command exactly what it decides in process', () => {
    for (const [files, status] of [
      [target('src/services/target.ts'), 0],
      [
        {
          'src/utils/probe.ts': "import('@/services/target');",
          ...target('src/services/target.ts'),
        },
        1,
      ],
    ] as const) {
      const root = createRepository(files);
      const result = spawnSync(
        process.execPath,
        [path.resolve('scripts/check-folder-dependencies.mjs')],
        { cwd: root, encoding: 'utf8' }
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(status);
      expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual(
        checkFolderDependencies(root)
      );
    }
  });
});
