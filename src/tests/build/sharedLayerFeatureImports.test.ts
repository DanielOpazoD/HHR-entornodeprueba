// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkFolderDependencies } from '../../../scripts/check-folder-dependencies.mjs';

const ROOT = path.resolve(__dirname, '../../../');
const OVERLAYS = 'src/components/layout/app-content/AppContentOverlays.tsx';
const FORMER_EXCEPTION = `
export const ReintroducedSearch = lazyWithRetry(() =>
  import('@/features/census/public-components').then(m => ({
    default: m.GlobalPatientSearchModal,
  }))
);
`;

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const boundaryRules = async (file: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return [
    ...new Set(
      result.messages
        .filter(message => /^hhr\//.test(message.ruleId ?? '') && message.severity === 2)
        .map(message => message.ruleId)
    ),
  ];
};

describe('shared layers import no feature in runtime', () => {
  it('keeps no folder exception list file and passes on the real tree', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts/folder-dependency-allowlist.json'))).toBe(false);
    const check = spawnSync(process.execPath, ['scripts/check-folder-dependencies.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
  });

  it('lints the overlays without any feature import', async () => {
    expect(
      await boundaryRules(OVERLAYS, fs.readFileSync(path.join(ROOT, OVERLAYS), 'utf8'))
    ).toEqual([]);
  });

  it('rejects the former overlay exception in the real overlays module', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hhr-shared-layer-'));
    roots.push(root);
    const policy = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'scripts/folder-dependency-matrix.json'), 'utf8')
    );
    const files = {
      'scripts/folder-dependency-matrix.json': JSON.stringify({
        layers: policy.layers,
        dataAccess: { ...policy.dataAccess, exceptions: [] },
      }),
      [OVERLAYS]: `${fs.readFileSync(path.join(ROOT, OVERLAYS), 'utf8')}${FORMER_EXCEPTION}`,
      'src/features/census/public-components.ts': 'export const GlobalPatientSearchModal = 1;',
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), content);
    }
    const result = checkFolderDependencies(root, {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`- ${OVERLAYS}:`);
    expect(result.stderr).toContain(
      '→ src/features/census/public-components.ts (carga diferida, «@/features/census/public-components»)'
    );
  });

  // The feature to feature rows of the former boundaries spelling table (W15-A1): ESLint still
  // owns them, in every spelling, after the boundaries plugin left.
  it.each([
    ['alias', '@/features/census/controllers/patientMainRowSectionsController'],
    ['alias .ts', '@/features/census/controllers/patientMainRowSectionsController.ts'],
    ['relativa', '../census/controllers/patientMainRowSectionsController'],
    ['relativa .ts', '../census/controllers/patientMainRowSectionsController.ts'],
    ['public surface without permission', '@/features/census/public'],
  ])('rejects a feature import the matrix does not allow (%s)', async (_spelling, target) => {
    const rules = await boundaryRules(
      'src/features/reminders/public.ts',
      `import * as probe from '${target}';\nexport const __probe = probe;\n`
    );
    expect(rules).toContain('hhr/feature-boundaries');
  });
});
