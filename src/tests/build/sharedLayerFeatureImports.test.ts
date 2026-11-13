// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

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
const sharedLayerErrors = async (file: string, code?: string) => {
  const [result] =
    code === undefined
      ? await eslint.lintFiles([path.join(ROOT, file)])
      : await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return result.messages.filter(
    message => message.ruleId === 'hhr/public-import-boundaries' && message.severity === 2
  );
};

describe('shared layers import no feature, without an exception list', () => {
  it('keeps no folder exception list for the folder dependency check to accept', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts/folder-dependency-allowlist.json'))).toBe(false);
    const check = spawnSync(process.execPath, ['scripts/check-folder-dependencies.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
  });

  it('lints the overlays without any feature import', async () => {
    expect(await sharedLayerErrors(OVERLAYS)).toEqual([]);
  });

  it('rejects the former overlay exception in the real overlays module', async () => {
    const source = fs.readFileSync(path.join(ROOT, OVERLAYS), 'utf8');
    const errors = await sharedLayerErrors(OVERLAYS, `${source}${FORMER_EXCEPTION}`);
    expect(errors.map(error => error.messageId)).toEqual(['shared']);
  });
});
