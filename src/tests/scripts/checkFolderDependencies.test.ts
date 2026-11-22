// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  analyzeFolderDependencies,
  checkFolderDependencies,
} from '../../../scripts/check-folder-dependencies.mjs';

type Exception = { from: string; to: string; kind: string; reason: string };
const POLICY = 'scripts/folder-dependency-matrix.json';
// The live layers and data packages with a synthetic book: the verdicts below are written by
// hand, never derived.
const livePolicy = JSON.parse(readFileSync(POLICY, 'utf8'));
const liveLayers = livePolicy.layers;
const policyText = (exceptions: Exception[] = [], dataExceptions: Exception[] = []) =>
  JSON.stringify({
    layers: liveLayers,
    dataAccess: { ...livePolicy.dataAccess, exceptions: dataExceptions },
    exceptions,
  });
// No CI base leaks into the synthetic repositories.
const NO_BASE = {};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const createRepository = (
  files: Record<string, string>,
  exceptions: Exception[] = [],
  dataExceptions: Exception[] = []
) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-folder-dependencies-'));
  roots.push(root);
  const policy = policyText(exceptions, dataExceptions);
  for (const [relativePath, content] of Object.entries({ [POLICY]: policy, ...files })) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return root;
};

const check = (
  files: Record<string, string>,
  exceptions: Exception[] = [],
  dataExceptions: Exception[] = []
) => {
  const result = checkFolderDependencies(
    createRepository(files, exceptions, dataExceptions),
    NO_BASE
  );
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
    // Spellings Vite compiles to the same file.
    'reexportación .js': `export { x } from '${relative}.js';`,
    'absoluta /src/': `export * from '/${to}';`,
    '?worker': `import W from '${relative}.ts?worker';\nexport { W };`,
    '?sharedworker': `import S from '${relative}.ts?sharedworker';\nexport { S };`,
  };
};

// What eslint-plugin-boundaries prohibited, measured on 3d96acba9 (W15-A1 probe-table.md:
// only relative spellings with an explicit `.ts`), and what decides each case now.
const formerBoundaryCases: {
  name: string;
  from: string;
  to: string;
  content?: string;
  now: 'rejected' | 'allowed';
}[] = [
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
    name: 'components/<sub> → servicios sin datos',
    from: 'src/components/layout/probe.tsx',
    to: 'src/services/storage/sessionOwnerKey.ts',
    now: 'allowed',
  },
  // Kept on purpose, now in every spelling: shared UI opens no data (dataAccess).
  {
    name: 'components/<sub> → servicio de datos',
    from: 'src/components/layout/probe.tsx',
    to: 'src/services/repositories/PatientMasterRepository.ts',
    content: "import { getFirestore } from 'firebase/firestore';\nexport const x = getFirestore;",
    now: 'rejected',
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
          const result = check({
            [fixture.from]: code,
            [fixture.to]: fixture.content ?? 'export const x = 1;',
          });
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

  it.each(['?worker', '?sharedworker'])('counts a %s import as a deferred load', query => {
    const result = check({
      'src/utils/probe.ts': `import W from '../services/target.ts${query}';\nexport { W };`,
      ...target('src/services/target.ts'),
    });
    expect(result.stderr).toContain(
      '→ src/services/target.ts (carga diferida, «../services/target.ts»)'
    );
  });

  // Vite brings these as text or a URL: no code of the file runs, so they are not references.
  it.each(['?raw', '?url', '?inline'])('does not count a %s import as a dependency', query => {
    const result = check({
      'src/utils/probe.ts': `import text from '../services/target.ts${query}';\nexport { text };`,
      ...target('src/services/target.ts'),
    });
    expect(result.status, result.output).toBe(0);
  });

  // Vite serves `.mts` for `.mjs` and `.cts` for `.cjs`, as `.ts` for `.js`.
  it.each([
    ['.mjs', '.mts'],
    ['.cjs', '.cts'],
    ['.js', '.ts'],
  ])('resolves a %s specifier to the %s module', (written, actual) => {
    const result = check({
      'src/utils/entry.ts': `export { x } from '../services/target${written}';`,
      [`src/services/target${actual}`]: 'export const x = 1;',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `- src/utils/entry.ts:1 → src/services/target${actual} (valor, «../services/target${written}»)`
    );
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

  describe('shared UI opens no data', () => {
    const firestore =
      "import { getFirestore } from 'firebase/firestore';\nexport const x = getFirestore;";
    const component = (code: string) => ({ 'src/components/probe.tsx': code });
    const dataRead = {
      from: 'src/components/probe.tsx',
      to: 'src/services/bookmarks/bookmarkService.ts',
      kind: 'value',
      reason: 'synthetic',
    };

    it('rejects a component that imports a service which imports Firestore', () => {
      const result = check({
        ...component("import { x } from '@/services/bookmarks/bookmarkService';"),
        'src/services/bookmarks/bookmarkService.ts': firestore,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '- src/components/probe.tsx:1 → src/services/bookmarks/bookmarkService.ts (valor'
      );
      expect(result.stderr).toContain(
        'components es interfaz compartida sin acceso a datos, y src/services/bookmarks/bookmarkService.ts abre datos: usa firebase/firestore.'
      );
      expect(result.stderr).toContain('sube la lectura o la escritura a un hook o contexto');
      expect(result.stderr).toContain(`No la agregues a "dataAccess.exceptions" en ${POLICY}`);
    });

    it.each([
      ['Storage', "import { ref } from 'firebase/storage';\nexport const x = ref;"],
      ['Dexie', "import Dexie from 'dexie';\nexport const x = Dexie;"],
      ['a lazy Firestore load', "export const x = () => import('firebase/firestore');"],
      ['the raw indexedDB global', 'export const x = () => indexedDB.deleteDatabase("db");'],
    ])('treats a service that opens %s as data', (_name, content) => {
      const result = check({
        ...component("import { x } from '@/services/bookmarks/bookmarkService';"),
        'src/services/bookmarks/bookmarkService.ts': content,
      });
      expect(result.status, result.output).toBe(1);
    });

    it('follows services that reach data through other services, and names the path', () => {
      const result = check({
        ...component("export const load = () => import('@/services/patient/history');"),
        'src/services/patient/history.ts': "export { x } from './loader';",
        'src/services/patient/loader.ts': "export { x } from '@/services/storage/db';",
        'src/services/storage/db.ts': "import Dexie from 'dexie';\nexport const x = Dexie;",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('(carga diferida');
      expect(result.stderr).toContain(
        'abre datos: llega a dexie por src/services/patient/loader.ts.'
      );
    });

    it.each([
      ['a type-only import', "import type { x } from '@/services/bookmarks/bookmarkService';"],
      ['a service without data', "import { y } from '@/services/bookmarks/format';"],
      ['a mention of indexedDB in a comment', "import { z } from '@/services/bookmarks/note';"],
    ])('accepts %s', (_name, code) => {
      const result = check({
        ...component(code),
        'src/services/bookmarks/bookmarkService.ts': firestore,
        'src/services/bookmarks/format.ts': 'export const y = 1;',
        'src/services/bookmarks/note.ts':
          '// indexedDB is opened elsewhere\nexport const z = "indexedDB";',
      });
      expect(result.status, result.output).toBe(0);
    });

    // The raw global, by syntax: the free identifier or a member of window, globalThis or self.
    it.each([
      ['window.indexedDB', "export const x = () => window.indexedDB.open('db');", 1],
      ["window['indexedDB']", "export const x = () => window['indexedDB'].open('db');", 1],
      ['globalThis.indexedDB', "export const x = () => globalThis.indexedDB.open('db');", 1],
      ['a property type', 'export interface Caps { indexedDB: boolean }\nexport const x = 1;', 0],
      ['an object property', 'export const x = { indexedDB: true };', 0],
      ['a parameter', 'export const x = (indexedDB: number) => indexedDB + 1;', 0],
      ['a member of another object', 'export const x = (o: { indexedDB: 1 }) => o.indexedDB;', 0],
      [
        'a destructured property key',
        'export const x = ({ indexedDB: enabled }: { indexedDB: boolean }) => enabled;',
        0,
      ],
      ['self.indexedDB', "export const x = () => self.indexedDB.open('db');", 1],
    ])('reads %s through an intermediate service as %s', (_name, leaf, status) => {
      const result = check({
        ...component("import { x } from '@/services/bookmarks/bookmarkService';"),
        'src/services/bookmarks/bookmarkService.ts': "export { x } from '@/services/storage/leaf';",
        'src/services/storage/leaf.ts': leaf,
      });
      expect(result.status, result.output).toBe(status);
    });

    // Readers no package reveals are listed by path in dataAccess.modules.
    it.each([
      [
        'src/services/storage/firestore/firestoreServerDocumentRead.ts',
        'the Firestore REST reader',
      ],
      ['src/services/storage/localpersistence/localPersistenceService.ts', 'the local backup'],
    ])('treats %s (%s) as data', file => {
      const alias = `@/${file.replace(/^src\//, '').replace(/\.ts$/, '')}`;
      const result = check({
        ...component(`import { x } from '${alias}';`),
        [file]: 'export const x = 1;',
        'src/services/storage/format.ts': 'export const y = 1;',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${file} abre datos: figura en "dataAccess.modules".`);
      const helper = check({
        ...component("import { y } from '@/services/storage/format';"),
        [file]: 'export const x = 1;',
        'src/services/storage/format.ts': 'export const y = 1;',
      });
      expect(helper.status, helper.output).toBe(0);
    });

    it('binds shared UI only: hooks and features may read data', () => {
      for (const from of ['src/hooks/useProbe.ts', 'src/features/census/probe.ts']) {
        const result = check({
          [from]: "import { x } from '@/services/bookmarks/bookmarkService';",
          'src/services/bookmarks/bookmarkService.ts': firestore,
        });
        expect(result.status, result.output).toBe(0);
      }
    });

    it('accepts a listed data read and asks to remove it once gone', () => {
      const files = {
        ...component("import { x } from '@/services/bookmarks/bookmarkService';"),
        'src/services/bookmarks/bookmarkService.ts': firestore,
      };
      const listed = check(files, [], [dataRead]);
      expect(listed.status, listed.output).toBe(0);
      expect(listed.stdout).toContain(
        '1 lecturas de datos desde la interfaz compartida, todas en el libro'
      );
      const gone = check(
        { 'src/services/bookmarks/bookmarkService.ts': firestore },
        [],
        [dataRead]
      );
      expect(gone.status).toBe(1);
      expect(gone.stderr).toContain('Sácala de "dataAccess.exceptions"');
    });
  });

  describe('the book only shrinks against the base of the change', () => {
    const upward = (file: string) => ({
      [file]: "import { x } from '@/application/target';",
      ...target('src/application/target.ts'),
    });
    const entry = (from: string): Exception => ({
      from,
      to: 'src/application/target.ts',
      kind: 'value',
      reason: 'synthetic',
    });
    const gitIn = (root: string, ...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', encoding: 'utf8' });
    // A repository whose origin/main holds `baseBook`; the working tree is then changed.
    const repositoryWithBase = (files: Record<string, string>, baseBook: Exception[] | null) => {
      const root = createRepository(files, baseBook ?? []);
      if (baseBook === null)
        writeFileSync(path.join(root, POLICY), JSON.stringify({ layers: liveLayers }));
      gitIn(root, 'init', '-q');
      gitIn(root, 'add', '-A');
      gitIn(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
      gitIn(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      return root;
    };
    const rewrite = (root: string, files: Record<string, string>, book: Exception[]) => {
      for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), content);
      }
      writeFileSync(path.join(root, POLICY), policyText(book));
    };

    it('rejects a new relation listed in the same change', () => {
      const root = repositoryWithBase(upward('src/services/a.ts'), [entry('src/services/a.ts')]);
      rewrite(root, upward('src/services/b.ts'), [
        entry('src/services/a.ts'),
        entry('src/services/b.ts'),
      ]);
      const result = checkFolderDependencies(root, NO_BASE);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'El libro solo baja: estas entradas no están en el de la base'
      );
      expect(result.stderr).toContain(
        '- "exceptions": src/services/b.ts → src/application/target.ts (valor)'
      );
    });

    it('rejects swapping a listed relation for a new one with the same total', () => {
      const root = repositoryWithBase(upward('src/services/a.ts'), [entry('src/services/a.ts')]);
      writeFileSync(path.join(root, 'src/services/a.ts'), 'export const a = 1;');
      rewrite(root, upward('src/services/b.ts'), [entry('src/services/b.ts')]);
      const result = checkFolderDependencies(root, NO_BASE);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('- "exceptions": src/services/b.ts');
    });

    it('accepts removing a relation and its entry', () => {
      const root = repositoryWithBase(upward('src/services/a.ts'), [entry('src/services/a.ts')]);
      writeFileSync(path.join(root, 'src/services/a.ts'), 'export const a = 1;');
      rewrite(root, {}, []);
      const result = checkFolderDependencies(root, NO_BASE);
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    });

    it('compares with FOLDER_BOOK_BASE when CI passes it, and fails when it is missing', () => {
      const root = repositoryWithBase(upward('src/services/a.ts'), [entry('src/services/a.ts')]);
      gitIn(root, 'update-ref', '-d', 'refs/remotes/origin/main');
      rewrite(root, upward('src/services/b.ts'), [
        entry('src/services/a.ts'),
        entry('src/services/b.ts'),
      ]);
      expect(checkFolderDependencies(root, { FOLDER_BOOK_BASE: 'HEAD' }).status).toBe(1);
      const missing = checkFolderDependencies(root, { FOLDER_BOOK_BASE: 'deadbeef' });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain(
        'FOLDER_BOOK_BASE=deadbeef no es un commit de este checkout'
      );
    });

    it('creates the book when the base has none, and only warns without a base', () => {
      const created = repositoryWithBase(upward('src/services/a.ts'), null);
      rewrite(created, {}, [entry('src/services/a.ts')]);
      expect(checkFolderDependencies(created, NO_BASE).status).toBe(0);
      const local = check(upward('src/services/a.ts'), [entry('src/services/a.ts')]);
      expect(local.status).toBe(0);
      expect(local.stdout).toContain('Aviso: no hay base para comprobar que el libro solo baja');
    });

    it('gets the pull request base in the CI jobs that run the rule', () => {
      type Step = {
        uses?: string;
        run?: string;
        with?: Record<string, unknown>;
        env?: Record<string, string>;
      };
      const workflow = parse(readFileSync('.github/workflows/ci-cd.yml', 'utf8')) as {
        jobs: Record<string, { steps: Step[] }>;
      };
      const groups = workflow.jobs['quality-static-groups'].steps;
      const checkout = groups.find(step => step.uses === 'actions/checkout@v7');
      expect(Number(checkout?.with?.['fetch-depth'])).toBeGreaterThanOrEqual(2);
      const run = groups.find(step => step.run?.includes('check:quality:group'));
      expect(run?.env?.FOLDER_BOOK_BASE).toContain("'HEAD^1'");
      const tooling = workflow.jobs['tooling-scope-gate'].steps.find(
        step => step.run === 'npm run check:quality'
      );
      expect(tooling?.env?.FOLDER_BOOK_BASE).toBe('${{ github.event.pull_request.base.sha }}');
    });
  });

  it('keeps the layer table of docs/architecture.md equal to the matrix', () => {
    const page = readFileSync('docs/architecture.md', 'utf8');
    const section = page.slice(page.indexOf('## Capas y dirección'), page.indexOf('## Reglas'));
    const rows = section
      .split('\n')
      .filter(line => /^\|\s*\d+\s*\|/.test(line))
      .map(line => {
        const cells = line.split('|').map(cell => cell.trim());
        return {
          layer: Number(cells[1]),
          folders: [...cells[3].matchAll(/`([^`]+)`/g)].map(match => match[1]).sort(),
        };
      });
    expect(
      rows,
      'Actualiza la tabla «Capas y dirección» de docs/architecture.md con las capas de la matriz'
    ).toEqual(
      liveLayers.map((entry: { layer: number; folders: string[] }) => ({
        layer: entry.layer,
        folders: [...entry.folders].sort(),
      }))
    );
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
      const env = { ...process.env };
      delete env.FOLDER_BOOK_BASE;
      const result = spawnSync(
        process.execPath,
        [path.resolve('scripts/check-folder-dependencies.mjs')],
        { cwd: root, encoding: 'utf8', env }
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(status);
      expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual(
        checkFolderDependencies(root, env)
      );
    }
  });
});
