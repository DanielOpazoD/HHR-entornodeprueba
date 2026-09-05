// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = path.resolve('scripts/check-feature-public-api-boundary.mjs');
const fixtures: string[] = [];
afterEach(() => fixtures.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('feature boundary CLI contract', () => {
  it.each([
    ['public alias', "import { x } from '@/features/alpha/public';", true],
    ['index alias', "import { x } from '@/features/alpha';", true],
    ['static deep import', "import { x } from '@/features/alpha/private';", false],
    ['relative deep import', "import { x } from './features/alpha/private';", false],
    ['dynamic deep import', "const x = import('@/features/alpha/private');", false],
    ['re-export', "export { x } from '@/features/alpha/private';", false],
    ['second feature', "import { x } from '@/features/beta/private';", false],
    ['exact exception', "import { x } from '@/features/alpha/quick';", true],
    ['exception does not cover sibling', "import { x } from '@/features/alpha/private';", false],
  ])('%s', (_label, source, allowed) => {
    const root = mkdtempSync(path.join(tmpdir(), 'hhr-boundary-'));
    fixtures.push(root);
    const write = (relative: string, content: string) => {
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    };
    for (const feature of ['alpha', 'beta']) {
      for (const module of ['index', 'public', 'private', 'quick']) {
        write(`src/features/${feature}/${module}.ts`, 'export const x = 1;');
      }
      write(`src/features/${feature}/internal.ts`, "import { x } from './private';");
    }
    write('src/consumer.ts', source);
    write('src/tests/ignored.ts', "import { x } from '@/features/beta/private';");
    write(
      'scripts/feature-public-api-allowlist.json',
      JSON.stringify({
        exceptionsByFeature: { alpha: ['src/consumer.ts -> @/features/alpha/quick'] },
      })
    );
    const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(allowed ? 0 : 1);
    if (!allowed) expect(result.stderr).toContain('src/consumer.ts ->');
  });
});
