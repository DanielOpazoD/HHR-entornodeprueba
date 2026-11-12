// @vitest-environment node
import path from 'node:path';
import fs from 'node:fs';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../');
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

/** Boundary messages ESLint reports for `code` if it lived at `filePath`. */
const boundaryMessages = async (filePath: string, code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, filePath) });
  return (result?.messages ?? [])
    .filter(
      message =>
        (message.ruleId === 'hhr/feature-boundaries' ||
          message.ruleId === 'no-restricted-imports') &&
        message.severity === 2
    )
    .map(message => message.message);
};

describe('feature boundaries in ESLint (from scripts/feature-dependency-matrix.json)', () => {
  const forms = [
    ['import', (target: string) => `import { x } from '${target}';`],
    ['export', (target: string) => `export { x } from '${target}';`],
    ['export-all', (target: string) => `export * from '${target}';`],
    ['side-effect', (target: string) => `import '${target}';`],
    ['dynamic', (target: string) => `import('${target}');`],
    ['require', (target: string) => `require('${target}');`],
  ] satisfies [string, (target: string) => string][];

  for (const extension of ['ts', 'tsx', 'js', 'jsx']) {
    for (const [form, code] of forms) {
      for (const relative of [false, true]) {
        it(`rejects forbidden and deep ${form} in ${extension} (${relative ? 'relative' : 'alias'})`, async () => {
          const prefix = relative ? '../../' : '@/features/';
          for (const [feature, target] of [
            ['laboratory', 'census'],
            ['census', 'laboratory/hooks/useSyslabAccess'],
          ]) {
            const file = `src/features/${feature}/components/Probe.${extension}`;
            expect(await boundaryMessages(file, code(`${prefix}${target}`))).toHaveLength(1);
          }
        });
      }
    }
  }

  it('accepts relative public imports and imports within the same feature', async () => {
    for (const [, code] of forms) {
      for (const target of [
        '../../laboratory/public',
        '../hooks/internal',
        '@/features/census/hooks/internal',
      ]) {
        expect(
          await boundaryMessages('src/features/census/components/Probe.ts', code(target))
        ).toEqual([]);
      }
    }
  });

  it('preserves the existing recovery-panel dynamic scope while enforcing static imports', async () => {
    const file = 'src/features/cudyr/components/CudyrRecoveryPanel.tsx';
    expect(
      await boundaryMessages(file, "import('@/features/rayen-import/clinical-panel');")
    ).toEqual([]);
    expect(
      await boundaryMessages(file, "import { x } from '@/features/rayen-import/clinical-panel';")
    ).toHaveLength(1);
    expect(
      await boundaryMessages(
        'src/features/cudyr/components/Probe.tsx',
        "import('@/features/rayen-import/clinical-panel');"
      )
    ).toHaveLength(1);
  });

  it('keeps the matrix in parity with the feature directories', () => {
    const matrix = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'scripts/feature-dependency-matrix.json'), 'utf8')
    );
    const directories = fs
      .readdirSync(path.join(ROOT, 'src/features'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
    expect(Object.keys(matrix.features).sort()).toEqual(directories);
  });

  it('preserves every exact exception and rejects a different deep path there', async () => {
    const { violations } = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'scripts/feature-dependency-allowlist.json'), 'utf8')
    ) satisfies { violations: string[] };
    expect(new Set(violations).size).toBe(17);
    for (const entry of violations) {
      const [, importer, target] = entry.split('|');
      const source = fs.readFileSync(path.join(ROOT, importer), 'utf8');
      expect(source.includes(`'${target}'`) || source.includes(`"${target}"`)).toBe(true);
      expect(await boundaryMessages(importer, `import { x } from '${target}';`)).toEqual([]);
      expect(
        await boundaryMessages(importer, `import { x } from '${target}/__probe';`)
      ).toHaveLength(1);
    }
  });

  it.each(['Probe.spec.ts', 'Probe.d.ts', 'Probe.config.ts'])(
    'enforces the existing or broader scope in %s',
    async name => {
      expect(
        await boundaryMessages(
          `src/features/laboratory/${name}`,
          "import type { X } from '@/features/census';"
        )
      ).toHaveLength(1);
    }
  );

  it.each([
    'src/features/laboratory/Probe.test.ts',
    'src/features/laboratory/Probe.stories.tsx',
    'src/tests/Probe.ts',
    'e2e/Probe.ts',
    'scripts/Probe.ts',
    'functions/Probe.js',
    'netlify/functions/Probe.js',
  ])('keeps files outside the feature rule scope: %s', async file => {
    expect(await boundaryMessages(file, "import { x } from '@/features/census';")).toEqual([]);
    expect(await boundaryMessages(file, "vi.mock('@/features/census');")).toEqual([]);
  });

  it.each(['ts', 'tsx'])('rejects type-only dependencies in %s', async extension => {
    expect(
      await boundaryMessages(
        `src/features/laboratory/Probe.${extension}`,
        "import type { X } from '@/features/census';"
      )
    ).toHaveLength(1);
  });

  it('rejects a feature the matrix does not list', async () => {
    const messages = await boundaryMessages(
      'src/features/laboratory/components/Probe.tsx',
      "import { x } from '@/features/census';\nexport const y = x;\n"
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('feature-dependency-matrix.json');
  });

  it('accepts the public surface of an allowed feature and rejects its internals', async () => {
    const file = 'src/features/census/components/Probe.tsx';
    expect(
      await boundaryMessages(
        file,
        "import { a } from '@/features/laboratory';\nimport { b } from '@/features/laboratory/public';\nexport const c = [a, b];\n"
      )
    ).toEqual([]);
    const deep = await boundaryMessages(
      file,
      "import { a } from '@/features/laboratory/hooks/useSyslabAccess';\nexport const c = a;\n"
    );
    expect(deep).toHaveLength(1);
    expect(deep[0]).toContain('superficie pública');
  });

  it('accepts a governed entry point listed in publicModulesByFeature', async () => {
    expect(
      await boundaryMessages(
        'src/features/census/components/Probe.tsx',
        "import { a } from '@/features/clinical-documents/internal';\nexport const c = a;\n"
      )
    ).toEqual([]);
  });

  it('tolerates only the allowlisted deep import of an allowlisted importer', async () => {
    const messages = await boundaryMessages(
      'src/features/census/components/CensusStaffHeader.tsx',
      "import { RayenImportButton } from '@/features/rayen-import/RayenImportButton';\nimport { y } from '@/features/rayen-import/clinical-panel';\nexport const z = [RayenImportButton, y];\n"
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('@/features/rayen-import/clinical-panel');
  });

  it('keeps the data-access rule of cudyr and handoff next to their feature boundaries', async () => {
    const messages = await boundaryMessages(
      'src/features/handoff/components/Probe.tsx',
      "import { repo } from '@/services/repositories/PatientMasterRepository';\nimport { w } from '@/features/wound-care';\nexport const z = [repo, w];\n"
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('controllers/use-cases/ports');
  });

  it('keeps the feature-matrix rule limited to src/features', async () => {
    expect(
      await boundaryMessages(
        'src/views/Probe.tsx',
        "import { a } from '@/features/laboratory/hooks/useSyslabAccess';\nexport const c = a;\n"
      )
    ).toEqual([]);
  });
});
