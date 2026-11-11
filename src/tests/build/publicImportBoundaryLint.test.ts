// @vitest-environment node
import path from 'node:path';
import fs from 'node:fs';
import { ESLint } from 'eslint';
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
const forms = [
  (target: string) => `import { x } from '${target}';`,
  (target: string) => `import '${target}';`,
  (target: string) => `export { x } from '${target}';`,
  (target: string) => `export * from '${target}';`,
  (target: string) => `import('${target}');`,
];
describe('public imports in ESLint', () => {
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
    for (const targets of Object.values(publicModulesByFeature))
      for (const target of targets) {
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
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        expect(source.includes(`'${target}'`) || source.includes(`"${target}"`), entry).toBe(true);
        expect(await errors(file, forms[0](target))).toEqual([]);
        expect(await errors('src/views/Probe.ts', forms[0](target))).toHaveLength(1);
      }
  });
  it('keeps all governed census facade imports live and scoped to that facade', async () => {
    const file = 'src/application/census/public.ts';
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const stale = [...GOVERNED_APPLICATION_PUBLIC_IMPORTS].filter(
      target => !source.includes(`'${target}'`)
    );
    // Existing policy debt: preserve the exception, but detect any change in stale entries.
    expect(stale).toEqual(['@/features/census/components/global-search/useGlobalPatientSearch']);
    for (const target of GOVERNED_APPLICATION_PUBLIC_IMPORTS) {
      expect(await errors(file, forms[0](target))).toEqual([]);
      expect(await errors('src/views/Probe.ts', forms[0](target))).toHaveLength(1);
    }
  });
  it('retains the exact census shim and overlay exceptions', async () => {
    const target = '@/features/census/controllers/bedManagerModalController';
    const file = 'src/hooks/controllers/bedManagerModalController.ts';
    expect(await errors(file, `export * from '${target}';`)).toEqual([]);
    expect(await errors(file, `export * from '${target}';\nexport const extra = 1;`)).toHaveLength(
      1
    );
    expect(await errors(file, `import('${target}');`)).toHaveLength(1);
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
  it('keeps shared tests in scope and relative public spelling restricted by the generic policy', async () => {
    expect(
      await errors('src/hooks/tests/Probe.ts', forms[0]('@/features/census/public'))
    ).toHaveLength(1);
    expect(await errors('src/hooks/Probe.ts', forms[0]('../features/census/public'))).toHaveLength(
      1
    );
    const file = 'src/components/layout/app-content/AppContentOverlays.tsx';
    expect(fs.readFileSync(path.join(ROOT, file), 'utf8')).toContain(
      '@/features/census/public-components'
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
