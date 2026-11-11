// @vitest-environment node
import path from 'node:path';
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
    .filter(message => message.ruleId === 'no-restricted-imports')
    .map(message => message.message);
};

describe('feature boundaries in ESLint (from scripts/feature-dependency-matrix.json)', () => {
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

  it('leaves files outside src/features to the scripts', async () => {
    expect(
      await boundaryMessages(
        'src/views/Probe.tsx',
        "import { a } from '@/features/laboratory/hooks/useSyslabAccess';\nexport const c = a;\n"
      )
    ).toEqual([]);
  });
});
