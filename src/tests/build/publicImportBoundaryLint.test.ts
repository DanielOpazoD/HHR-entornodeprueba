// @vitest-environment node
import path from 'node:path';
import fs from 'node:fs';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { GOVERNED_APPLICATION_PUBLIC_IMPORTS } from '../../../scripts/lib/publicImportBoundaryRule.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

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
                ? 'controllers/bedManagerModalController'
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
      it(`keeps shared-layer alias restrictions (${extension}, form ${index})`, async () => {
        for (const layer of ['components', 'hooks', 'services', 'context', 'domain']) {
          expect(
            await errors(`src/${layer}/Probe.${extension}`, code('@/features/census/public'))
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
  it('accepts every governed additional public module', async () => {
    const { publicModulesByFeature }: { publicModulesByFeature: Record<string, string[]> } =
      JSON.parse(
        fs.readFileSync(path.join(ROOT, 'scripts/feature-public-api-allowlist.json'), 'utf8')
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
  it('preserves all exact JSON exceptions and detects stale entries', async () => {
    const { exceptionsByFeature }: { exceptionsByFeature: Record<string, string[]> } = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'scripts/feature-public-api-allowlist.json'), 'utf8')
    );
    for (const entries of Object.values(exceptionsByFeature))
      for (const entry of entries) {
        const [file, target] = entry.split(' -> ');
        expect(realImports(file).has(target), `Remove unused exception: ${entry}`).toBe(true);
        expect(await errors(file, forms[0](target))).toEqual([]);
        expect(await errors('src/views/Probe.ts', forms[0](target))).toHaveLength(1);
      }
  });
  it('keeps all governed census facade imports live and scoped to that facade', async () => {
    const file = 'src/application/census/public.ts';
    const targets = realImports(file);
    const stale = [...GOVERNED_APPLICATION_PUBLIC_IMPORTS].filter(target => !targets.has(target));
    // Existing policy debt: preserve the exception, but detect any change in stale entries.
    expect(stale).toEqual(['@/features/census/components/global-search/useGlobalPatientSearch']);
    for (const target of GOVERNED_APPLICATION_PUBLIC_IMPORTS) {
      expect(await errors(file, forms[0](target))).toEqual([]);
      expect(await errors('src/views/Probe.ts', forms[0](target))).toHaveLength(1);
    }
  });
  it('retains the exact census shim exception', async () => {
    const target = '@/features/census/controllers/bedManagerModalController';
    const file = 'src/hooks/controllers/bedManagerModalController.ts';
    expect(await errors(file, `export * from '${target}';`)).toEqual([]);
    expect(await errors(file, `export * from '${target}';\nexport const extra = 1;`)).toHaveLength(
      1
    );
    expect(await errors(file, `import('${target}');`)).toHaveLength(1);
    // The former overlay exception is gone: every import form is rejected.
    for (const code of forms)
      expect(
        await errors(
          'src/components/layout/app-content/AppContentOverlays.tsx',
          code('@/features/census/public-components')
        )
      ).toHaveLength(1);
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
  it('keeps shared tests in scope and relative public spelling restricted by the generic policy', async () => {
    expect(
      await errors('src/hooks/tests/Probe.ts', forms[0]('@/features/census/public'))
    ).toHaveLength(1);
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
