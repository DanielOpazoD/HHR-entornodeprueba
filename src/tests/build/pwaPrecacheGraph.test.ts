// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { chunkForModule } from '../../../scripts/config/chunkingPolicy';
import {
  assertPrecacheStaticImports,
  createPrecacheGraphGuard,
  PRECACHE_STATIC_IMPORT_EXCEPTIONS,
} from '../../../scripts/config/pwaPrecacheGraph';

const sourceRoot = fs.realpathSync(process.env.PWA_PRECACHE_SOURCE_ROOT || process.cwd());
const absolute = (file: string) => path.resolve(sourceRoot, file);

it('keeps the real generated login and callable graph available from precache', async () => {
  const entries = [
    'src/features/auth/components/NursingAccessForm.tsx',
    'src/services/auth/authClaimSyncService.ts',
    'src/services/auth/authRoleLookup.ts',
    'src/services/auth/sharedCensusAuth.ts',
    'src/services/storage/firestore/dailyRecordAuthorityTransport.ts',
    'src/services/storage/firestore/firestoreDailyRecordAuthorityRouting.ts',
  ];
  const ownedModules = new Set(
    [
      ...entries,
      'src/services/auth/nursingAccountService.ts',
      'src/services/auth/nursingPasswordPolicy.ts',
      'src/components/ui/PasswordInput.tsx',
    ].map(file => absolute(file).replace(/\.tsx?$/, ''))
  );
  const guard = createPrecacheGraphGuard(['App']);
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    plugins: [guard.plugin],
    resolve: { alias: { '@': absolute('src') } },
    esbuild: { jsx: 'automatic' },
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: entries.map(absolute),
        preserveEntrySignatures: 'strict',
        external: id => {
          const resolved = id.startsWith('@/') ? absolute(`src/${id.slice(2)}`) : id;
          if (resolved.includes('/src/') && !resolved.includes('/node_modules/')) {
            return !ownedModules.has(resolved.replace(/\.tsx?$/, ''));
          }
          return (
            !id.startsWith('.') &&
            !path.isAbsolute(id) &&
            id !== 'firebase/functions' &&
            !id.startsWith('@firebase/')
          );
        },
        output: {
          entryFileNames: chunk =>
            `assets/${chunk.name === 'NursingAccessForm' ? 'App' : chunk.name}-fixture.js`,
          chunkFileNames: 'assets/[name]-fixture.js',
          manualChunks: id =>
            id === absolute('src/services/auth/nursingPasswordPolicy.ts')
              ? 'nursingPasswordPolicy'
              : chunkForModule(id),
        },
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap(output => ('output' in output ? output.output : []))
    .filter(output => output.type === 'chunk');
  const { precacheIgnoredAssetPatterns } = JSON.parse(
    fs.readFileSync(absolute('scripts/config/bundle-budget.json'), 'utf8')
  );
  const ignored = precacheIgnoredAssetPatterns.map((pattern: string) => new RegExp(pattern));
  const manifest = chunks
    .filter(chunk => !ignored.some((pattern: RegExp) => pattern.test(chunk.fileName)))
    .map(chunk => ({ url: chunk.fileName, revision: null }));

  expect(chunks.some(chunk => chunk.fileName.includes('vendor-firebase-functions-'))).toBe(true);
  expect(chunks.some(chunk => chunk.fileName.includes('nursingPasswordPolicy-'))).toBe(true);
  await expect(guard.manifestTransform(manifest)).resolves.toEqual({ manifest, warnings: [] });
}, 30_000);

describe('precache static import guard', () => {
  it('rejects an uncached side-effect import in a precached chunk', () => {
    expect(() =>
      assertPrecacheStaticImports(
        [
          { fileName: 'assets/App-test.js', imports: ['assets/missing-test.js'], isEntry: true },
          { fileName: 'assets/missing-test.js', imports: [], isEntry: false },
        ],
        ['assets/App-test.js'],
        ['App']
      )
    ).toThrow('assets/App-test.js -> assets/missing-test.js');
  });

  it.each(PRECACHE_STATIC_IMPORT_EXCEPTIONS)(
    'allows $name only outside the transitive boot graph, with a reason',
    ({ name, reason }) => {
      expect(reason.trim().length).toBeGreaterThan(0);
      const dependency = `assets/${name}-test.js`;
      const chunks = [
        { fileName: 'assets/App-test.js', imports: ['assets/shared-test.js'], isEntry: true },
        { fileName: 'assets/shared-test.js', imports: [], isEntry: false },
        { fileName: 'assets/optional-test.js', imports: [dependency], isEntry: false },
        { fileName: dependency, imports: [], isEntry: false },
      ];
      const urls = ['assets/App-test.js', 'assets/shared-test.js', 'assets/optional-test.js'];
      expect(() => assertPrecacheStaticImports(chunks, urls, ['App'])).not.toThrow();
      chunks[1].imports.push(dependency);
      expect(() => assertPrecacheStaticImports(chunks, urls, ['App'])).toThrow(dependency);
    }
  );
});

// These are separate dynamic import boundaries, including lazyWithRetry mounts.
it.each([
  'App',
  'app-authenticated-shell',
  'CensusRouteView',
  'census-view',
  'CensusRegisterSections',
  'CensusModals',
  'EmptyDayPrompt',
  'AppContentOverlays',
  'ReminderBadge',
  'BookmarkBar',
  'CensusConflictQuickAction',
  'DateStripQuickActions',
  'quick-action',
  'DateStripYearNavigator',
  'DateStripMonthNavigator',
  'SaveDropdown',
  'EmailDropdown',
  'PdfButtons',
])('protects %s and its static dependencies across dynamic boot boundaries', name => {
  for (const dependency of ['terminologyService', 'replanRayenStructure']) {
    const root = `assets/${name}-fixture.js`;
    const shared = 'assets/shared-fixture.js';
    const missing = `assets/${dependency}-fixture.js`;
    const chunks = [
      { fileName: root, imports: [shared], isEntry: false },
      { fileName: shared, imports: [], isEntry: false },
      { fileName: missing, imports: [], isEntry: false },
    ];
    expect(() => assertPrecacheStaticImports(chunks, [root, shared], [name])).not.toThrow();
    chunks[0].imports.push(missing);
    expect(() => assertPrecacheStaticImports(chunks, [root, shared], [name])).toThrow(missing);
    chunks[0].imports.pop();
    chunks[1].imports.push(missing);
    expect(() => assertPrecacheStaticImports(chunks, [root, shared], [name])).toThrow(missing);
  }
});

it.each(['CensusRouteView', 'census-view', 'CensusRegisterSections'])(
  'rejects an omitted %s dynamic boot chunk itself',
  name => {
    const fileName = `assets/${name}-fixture.js`;
    expect(() =>
      assertPrecacheStaticImports([{ fileName, imports: [], isEntry: false }], [], [name])
    ).toThrow(`offline boot -> ${fileName}`);
  }
);

const bootRoots = [
  'App',
  'app-authenticated-shell',
  'quick-action',
  'CensusRouteView',
  'census-view',
  'CensusRegisterSections',
  'CensusModals',
  'EmptyDayPrompt',
  'AppContentOverlays',
  'ReminderBadge',
  'BookmarkBar',
  'CensusConflictQuickAction',
  'DateStripQuickActions',
  'DateStripYearNavigator',
  'DateStripMonthNavigator',
  'SaveDropdown',
  'EmailDropdown',
  'PdfButtons',
];
const bootFixture = (): Parameters<typeof assertPrecacheStaticImports>[0][number][] =>
  bootRoots.map(name => ({
    fileName: `assets/${name}-fixture.js`,
    imports: [],
    isEntry: false,
  }));

it.each(bootRoots)('rejects a configured root without a generated chunk: %s', name => {
  const chunks = bootFixture().filter(chunk => chunk.fileName !== `assets/${name}-fixture.js`);
  expect(() =>
    assertPrecacheStaticImports(
      chunks,
      chunks.map(chunk => chunk.fileName)
    )
  ).toThrow(`Offline boot roots have no generated chunks: ${name}`);
});

it.each([
  'terminologyService-fixture',
  'replanRayenStructure-first',
  'replanRayenStructure-second',
])('rejects either quick-action mount importing excluded %s', dependency => {
  const chunks = bootFixture();
  chunks.push({ fileName: 'assets/quick-action-second.js', imports: [], isEntry: false });
  const missing = `assets/${dependency}.js`;
  const urls = chunks.map(chunk => chunk.fileName);
  chunks.push({ fileName: missing, imports: [], isEntry: false });
  expect(() => assertPrecacheStaticImports(chunks, urls)).not.toThrow();
  for (const quick of chunks.filter(chunk => chunk.fileName.startsWith('assets/quick-action-'))) {
    quick.imports.push(missing);
    expect(() => assertPrecacheStaticImports(chunks, urls)).toThrow(missing);
    quick.imports.pop();
  }
});
