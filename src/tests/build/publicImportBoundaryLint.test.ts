// @vitest-environment node
import path from 'node:path';
import fs from 'node:fs';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { GOVERNED_APPLICATION_PUBLIC_IMPORTS } from '../../../scripts/lib/publicImportBoundaryRule.mjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../');
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});
const errors = async (file: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return result.messages.filter(
    message => message.ruleId === 'hhr/public-import-boundaries' && message.severity === 2
  );
};
// Parse declarations instead of matching text: comments and strings are not consumers.
const importTargets = (file: string, source: string): Set<string> => {
  const targets = new Set<string>();
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    const target =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : undefined;
    if (target && ts.isStringLiteral(target)) targets.add(target.text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return targets;
};
const realImports = (file: string) =>
  importTargets(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
const productionFiles = (directory: string): string[] =>
  fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : productionFiles(file);
    return /\.[jt]sx?$/.test(file) && !/\.(test|spec|stories|d)\./.test(file) ? [file] : [];
  });
const forms = [
  (target: string) => `import { x } from '${target}';`,
  (target: string) => `import '${target}';`,
  (target: string) => `export { x } from '${target}';`,
  (target: string) => `export * from '${target}';`,
  (target: string) => `import('${target}');`,
];
describe('public imports in ESLint', () => {
  it('counts actual static, type-only, re-export and dynamic imports, not comments or strings', () => {
    expect([
      ...importTargets(
        'probe.ts',
        `
      // import './comment';
      /* export * from './block-comment'; */
      const example = "import('./string')";
      import type { T } from './type';
      import './side-effect';
      export { x } from './named';
      export * from './star';
      const lazy = () => import('./dynamic');
    `
      ),
    ]).toEqual(['./type', './side-effect', './named', './star', './dynamic']);
  });
  for (const extension of ['ts', 'tsx', 'js', 'jsx']) {
    for (const [index, code] of forms.entries()) {
      it(`rejects resolved deep alias/relative imports (${extension}, form ${index})`, async () => {
        for (const feature of ['laboratory', 'census', 'clinical-documents']) {
          const module =
            feature === 'laboratory'
              ? 'hooks/useSyslabAccess'
              : feature === 'census'
                ? 'controllers/censusCmaController'
                : 'internal';
          // internal is a governed public module for clinical-documents; explicit extension is not.
          const target = `${feature}/${module}.ts`;
          for (const prefix of ['@/features/', '../features/']) {
            expect(
              await errors(`src/views/Probe.${extension}`, code(`${prefix}${target}`))
            ).toHaveLength(1);
          }
        }
      });
      // Whether a shared layer may depend on a feature is check:folder-dependencies' rule
      // (checkFolderDependencies.test.ts); this rule only asks for the public surface.
      it(`leaves the direction of shared layers to the folder rule (${extension}, form ${index})`, async () => {
        for (const layer of ['components', 'hooks', 'services', 'context', 'domain']) {
          expect(
            await errors(`src/${layer}/Probe.${extension}`, code('@/features/census/public'))
          ).toEqual([]);
          expect(
            await errors(
              `src/${layer}/Probe.${extension}`,
              code('@/features/census/controllers/censusCmaController')
            )
          ).toHaveLength(1);
        }
      });
    }
  }
  it('accepts public surfaces, own internals, unresolved imports and non-feature imports', async () => {
    for (const target of [
      '@/features/laboratory',
      '@/features/laboratory/public',
      '@/features/laboratory/index',
      '@/features/laboratory/census-inbox',
      '@/features/laboratory/not-a-file',
      '@/utils/rutUtils',
    ]) {
      expect(await errors('src/views/Probe.ts', forms[0](target))).toEqual([]);
    }
    expect(
      await errors(
        'src/features/laboratory/Probe.ts',
        forms[0]('@/features/laboratory/hooks/useSyslabAccess')
      )
    ).toEqual([]);
  });
  it('distinguishes synthetic features sharing a prefix while allowing own internals', async () => {
    const target = '@/features/n5-probe/internal';
    const resolved = path.join(ROOT, 'src/features/n5-probe/internal.ts');
    const exists = fs.existsSync.bind(fs);
    const stat = fs.statSync.bind(fs);
    const fileStat = stat(path.join(ROOT, 'eslint.config.js'));
    vi.spyOn(fs, 'existsSync').mockImplementation(file => file === resolved || exists(file));
    vi.spyOn(fs, 'statSync').mockImplementation(file =>
      file === resolved ? fileStat : stat(file)
    );
    try {
      for (const code of forms) {
        expect(await errors('src/features/n5-probe/Probe.ts', code(target))).toEqual([]);
        expect(await errors('src/features/n5-probe-extra/Probe.ts', code(target))).toHaveLength(1);
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('accepts every governed additional public module', async () => {
    const { publicModulesByFeature }: { publicModulesByFeature: Record<string, string[]> } =
      JSON.parse(
        fs.readFileSync(path.join(ROOT, 'scripts/feature-dependency-matrix.json'), 'utf8')
      );
    const consumers = productionFiles('src').map(file => ({ file, targets: realImports(file) }));
    for (const [feature, targets] of Object.entries(publicModulesByFeature))
      for (const target of targets) {
        expect(
          consumers.some(
            consumer =>
              !consumer.file.startsWith(`src/features/${feature}/`) && consumer.targets.has(target)
          ),
          `Remove unused public module authorization: ${target}`
        ).toBe(true);
        for (const code of forms)
          expect(await errors('src/views/Probe.ts', code(target))).toEqual([]);
      }
  });
  it('keeps all governed census facade imports live and scoped to that facade', async () => {
    const file = 'src/application/census/public.ts';
    const targets = realImports(file);
    const stale = [...GOVERNED_APPLICATION_PUBLIC_IMPORTS].filter(target => !targets.has(target));
    expect(stale).toEqual([]);
    for (const target of GOVERNED_APPLICATION_PUBLIC_IMPORTS) {
      expect(await errors(file, forms[0](target))).toEqual([]);
      expect(await errors('src/views/Probe.ts', forms[0](target))).toHaveLength(1);
    }
  });
  it('keeps no census shim or overlay exception', async () => {
    const target = '@/features/census/controllers/censusCmaController';
    const file = 'src/hooks/controllers/censusCmaController.ts';
    expect(await errors(file, `export * from '${target}';`)).toHaveLength(1);
    expect(await errors(file, `import('${target}');`)).toHaveLength(1);
    // The overlay import is a public surface; the folder rule rejects it from components
    // (sharedLayerFeatureImports.test.ts).
    for (const code of forms)
      expect(
        await errors(
          'src/components/layout/app-content/AppContentOverlays.tsx',
          code('@/features/census/public-components')
        )
      ).toEqual([]);
  });
  it.each([
    'src/views/Probe.test.ts',
    'src/views/Probe.spec.ts',
    'src/views/Probe.stories.tsx',
    'src/views/Probe.d.ts',
    'src/tests/Probe.ts',
  ])('preserves generic exclusions %s', async file => {
    expect(await errors(file, forms[0]('@/features/laboratory/hooks/useSyslabAccess'))).toEqual([]);
  });
  it('leaves shared tests out and keeps relative public spelling restricted by the generic policy', async () => {
    expect(
      await errors('src/hooks/tests/Probe.ts', forms[0]('@/features/census/controllers/x'))
    ).toEqual([]);
    expect(await errors('src/hooks/Probe.ts', forms[0]('../features/census/public'))).toHaveLength(
      1
    );
  });
  it('does not add require/mock restrictions', async () => {
    for (const code of [
      "require('@/features/census/public');",
      "vi.mock('@/features/census/public');",
    ])
      expect(await errors('src/hooks/Probe.ts', code)).toEqual([]);
  });
});

// Former source-text tests, now ESLint restrictions whose message names the fix.
describe('module homes in ESLint', () => {
  const restrictions = async (file: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
    return result.messages
      .filter(message => /^no-restricted-(syntax|imports)$/.test(message.ruleId ?? ''))
      .map(message => message.message);
  };
  const key = 'export const k = (a: string, b: string) => `${a}__${b}`;';
  const parse = "export const p = (episodeKey: string) => episodeKey.split('__');";

  it('keeps extensionless deep feature imports behind the public surface', async () => {
    for (const target of [
      '@/features/laboratory/hooks/useSyslabAccess',
      '@/features/clinical-documents/components/ClinicalDocumentsWorkspace',
    ])
      expect(await errors('src/views/Probe.ts', `import '${target}';`)).toHaveLength(1);
  });

  it('builds and parses episode keys only in the patient-flow resolver', async () => {
    expect(await restrictions('src/views/Probe.ts', key)).toEqual([
      expect.stringContaining('buildClinicalEpisodeKey()'),
    ]);
    expect(await restrictions('src/tests/Probe.test.ts', key)).toHaveLength(1);
    expect(await restrictions('src/services/reminders/reminderShared.ts', key)).toEqual([]);
    for (const code of [
      parse,
      "export const p = (x: { episodeKey: string }) => x.episodeKey.includes('__');",
    ])
      expect(await restrictions('src/views/Probe.ts', code)).toEqual([
        expect.stringContaining('parseLegacyClinicalEpisodeKey()'),
      ]);
    expect(await restrictions('src/tests/Probe.test.ts', parse)).toEqual([]);
    const home = 'src/domain/clinical-episode/clinicalEpisode.ts';
    expect(await restrictions(home, `${key}\n${parse}`)).toEqual([]);
  });

  it('keeps public entrypoints as re-exports of their focused modules', async () => {
    for (const [file, code] of [
      ['src/utils/clinicalDayUtils.ts', 'export const getShiftSchedule = () => 1;'],
      ['src/utils/clinicalDayUtils.ts', "import { isHoliday } from './chileanHolidays';"],
      ['src/components/shared/BaseModal.tsx', "import { createPortal } from 'react-dom';"],
      ['src/components/shared/BaseModal.tsx', 'export interface BaseModalProps { id: string }'],
    ])
      expect(await restrictions(file, code), `${file}: ${code}`).toHaveLength(1);
    expect(
      await restrictions('src/utils/clinicalDayUtils.ts', "export { getShiftSchedule } from './x';")
    ).toEqual([]);
  });

  it('passes on the real homes and entrypoints', async () => {
    for (const file of [
      'src/domain/clinical-episode/clinicalEpisode.ts',
      'src/services/reminders/reminderShared.ts',
      'src/utils/clinicalDayUtils.ts',
      'src/components/shared/BaseModal.tsx',
      'src/features/census/components/patient-row/patientRowContracts.ts',
    ])
      expect(
        await restrictions(file, fs.readFileSync(path.join(ROOT, file), 'utf8')),
        file
      ).toEqual([]);
  });
});
