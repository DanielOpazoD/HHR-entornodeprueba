// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO = path.resolve('.');
const SCRIPT = path.join(REPO, 'scripts/move-modules.mjs');
const VITEST = path.join(REPO, 'node_modules/vitest/vitest.mjs');
const roots: string[] = [];

/** A synthetic git repository made of `files`, with everything staged. */
const createRepo = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-move-modules-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
};

const run = (root: string, args: string[]) => {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

const read = (root: string, file: string) => readFileSync(path.join(root, file), 'utf8');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// One reference per format of the inventory (evidence/W15/A3/INVENTARIO.md).
const EVERY_FORMAT = {
  'src/lib/greeting.ts':
    "import { tone } from './tone';\nexport const greet = () => `real${tone}`;\n",
  'src/lib/tone.ts': "export const tone = '';\n",
  'src/lib/index.ts': "export { greet } from './greeting';\n",
  'src/app/consumer.ts': [
    "import { greet } from '../lib/greeting';",
    "export const lazy = () => import('@/lib/greeting');",
    "export const worker = () => new Worker(new URL('../lib/greeting.ts', import.meta.url));",
    'export const message = () => greet();',
    '',
  ].join('\n'),
  'src/app/barrel.ts': "export { greet } from '../lib';\n",
  'src/tests/consumer.test.ts': [
    "vi.mock('@/lib/greeting', async () => ({",
    "  ...(await vi.importActual<object>('@/lib/greeting')),",
    "  greet: () => 'double',",
    '}));',
    "vi.doMock('../lib/greeting.ts');",
    "vi.unmock('../lib/greeting');",
    "const legacy = require('../lib/greeting');",
    '',
  ].join('\n'),
  'e2e/session.spec.ts':
    "const modulePath = '/src/lib/greeting.ts';\nexport const load = () => import(modulePath);\n",
  'functions/index.js': "const b = require('./lib/b');\nmodule.exports = { b };\n",
  'functions/lib/b.js': "const { a } = require('./a.js');\nmodule.exports = { a };\n",
  'functions/lib/a.js': 'module.exports = { a: 1 };\n',
  'scripts/config/zones.json':
    '{\n  "src/lib/greeting.ts": { "owner": "lib" },\n  "functions/lib/b.js": 1,\n  "keep": "src/lib/tone.ts"\n}\n',
  'scripts/config/chunks.ts': "export const owned = new Set(['/src/lib/greeting.ts']);\n",
  'vitest.config.ts': "export const alias = { '@/lib/greeting': 'src/lib/greeting.ts' };\n",
  'src/lib/README.md':
    '# lib\n\n- [saludo](./greeting.ts) and `src/lib/greeting.ts`.\n- Partial path: `lib/greeting.ts`.\n',
  'docs/notes.md': 'See [greeting](../src/lib/greeting.ts#L1) and `@/lib/greeting`.\n',
  // Detected, not rewritten: a path built from segments and a synthetic module id.
  'scripts/check-thing.mjs': "export const file = path.join(root, 'src', 'lib', 'greeting.ts');\n",
  'src/tests/build/chunks.test.ts': "expect(chunkFor('/repo/src/lib/greeting.ts')).toBe('lib');\n",
};

describe('move-modules', () => {
  it('lists every rewrite with --check and changes nothing', () => {
    const root = createRepo(EVERY_FORMAT);

    const { status, output } = run(root, [
      '--check',
      'src/lib/greeting.ts',
      'src/shared/text/greeting.ts',
    ]);

    expect(status).toBe(0);
    expect(output).toContain('would move src/lib/greeting.ts → src/shared/text/greeting.ts');
    expect(output).toContain(
      'src/tests/consumer.test.ts:1  @/lib/greeting → @/shared/text/greeting'
    );
    expect(output).toContain(
      'e2e/session.spec.ts:1  /src/lib/greeting.ts → /src/shared/text/greeting.ts'
    );
    expect(output).toContain('To review by hand');
    expect(existsSync(path.join(root, 'src/lib/greeting.ts'))).toBe(true);
    expect(existsSync(path.join(root, 'src/shared/text/greeting.ts'))).toBe(false);
    expect(read(root, 'src/app/consumer.ts')).toBe(EVERY_FORMAT['src/app/consumer.ts']);
  });

  it('refuses to apply while there is something to review, until --reviewed', () => {
    const root = createRepo(EVERY_FORMAT);

    const refused = run(root, ['src/lib/greeting.ts', 'src/shared/text/greeting.ts']);
    expect(refused.status).toBe(1);
    expect(refused.output).toContain(
      'src/lib/README.md:4  path lib/greeting.ts names a moved file and was not rewritten'
    );
    expect(refused.output).toContain(
      'scripts/check-thing.mjs:1  path greeting.ts names a moved file and was not rewritten'
    );
    expect(refused.output).toContain(
      'src/tests/build/chunks.test.ts:1  path /repo/src/lib/greeting.ts names a moved file'
    );
    expect(refused.output).toContain('run again with --reviewed. Nothing was changed.');
    expect(existsSync(path.join(root, 'src/lib/greeting.ts'))).toBe(true);
  });

  it('moves the files and rewrites each format in its own style', () => {
    const root = createRepo(EVERY_FORMAT);

    const { status, output } = run(root, [
      '--reviewed',
      'src/lib/greeting.ts',
      'src/shared/text/greeting.ts',
      'functions/lib/b.js',
      'functions/lib/sub/b.js',
    ]);

    expect(status, output).toBe(0);
    expect(existsSync(path.join(root, 'src/lib/greeting.ts'))).toBe(false);
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
    expect(tracked).toContain('src/shared/text/greeting.ts');
    expect(tracked).not.toContain('src/lib/greeting.ts');
    // The moved file's own relative imports follow it.
    expect(read(root, 'src/shared/text/greeting.ts')).toContain("from '../../lib/tone';");
    expect(read(root, 'src/lib/index.ts')).toBe(
      "export { greet } from '../shared/text/greeting';\n"
    );
    expect(read(root, 'src/app/barrel.ts')).toBe(EVERY_FORMAT['src/app/barrel.ts']);
    expect(read(root, 'src/app/consumer.ts')).toBe(
      [
        "import { greet } from '../shared/text/greeting';",
        "export const lazy = () => import('@/shared/text/greeting');",
        "export const worker = () => new Worker(new URL('../shared/text/greeting.ts', import.meta.url));",
        'export const message = () => greet();',
        '',
      ].join('\n')
    );
    expect(read(root, 'src/tests/consumer.test.ts')).toBe(
      [
        "vi.mock('@/shared/text/greeting', async () => ({",
        "  ...(await vi.importActual<object>('@/shared/text/greeting')),",
        "  greet: () => 'double',",
        '}));',
        "vi.doMock('../shared/text/greeting.ts');",
        "vi.unmock('../shared/text/greeting');",
        "const legacy = require('../shared/text/greeting');",
        '',
      ].join('\n')
    );
    expect(read(root, 'e2e/session.spec.ts')).toContain("'/src/shared/text/greeting.ts'");
    expect(read(root, 'functions/index.js')).toContain("require('./lib/sub/b')");
    expect(read(root, 'functions/lib/sub/b.js')).toContain("require('../a.js')");
    expect(read(root, 'scripts/config/zones.json')).toBe(
      '{\n  "src/shared/text/greeting.ts": { "owner": "lib" },\n  "functions/lib/sub/b.js": 1,\n  "keep": "src/lib/tone.ts"\n}\n'
    );
    expect(read(root, 'scripts/config/chunks.ts')).toContain("'/src/shared/text/greeting.ts'");
    expect(read(root, 'vitest.config.ts')).toBe(
      "export const alias = { '@/shared/text/greeting': 'src/shared/text/greeting.ts' };\n"
    );
    expect(read(root, 'src/lib/README.md')).toBe(
      '# lib\n\n- [saludo](../shared/text/greeting.ts) and `src/shared/text/greeting.ts`.\n- Partial path: `lib/greeting.ts`.\n'
    );
    expect(read(root, 'docs/notes.md')).toBe(
      'See [greeting](../src/shared/text/greeting.ts#L1) and `@/shared/text/greeting`.\n'
    );
  });

  it('rewrites a folder move as a prefix, globs included, and lists folders that lose a file', () => {
    const root = createRepo({
      'src/lib/greeting.ts': "export const greet = () => 'real';\n",
      'src/app/consumer.ts':
        "import { greet } from '../lib/greeting';\nexport const message = greet;\n",
      'scripts/config/coverage.json':
        '{ "src/lib": { "tests": "src/tests/lib" }, "include": ["src/lib/**"] }\n',
      'scripts/config/chunking.ts':
        "export const owner = (id: string) => id.includes('/src/app/');\n",
    });

    const folder = run(root, ['--check', 'src/lib', 'src/shared/lib']);
    expect(folder.status).toBe(0);
    expect(folder.output).toContain('scripts/config/coverage.json:1  src/lib → src/shared/lib');
    expect(folder.output).not.toContain('To review by hand');

    const file = run(root, ['--check', 'src/app/consumer.ts', 'src/features/consumer.ts']);
    expect(file.output).toContain(
      'scripts/config/chunking.ts:1  folder src/app/ will no longer hold src/app/consumer.ts'
    );
  });

  it('fails naming a reference it cannot rewrite, and moves nothing', () => {
    const root = createRepo({
      'src/lib/greeting.ts': "export const greet = () => 'real';\n",
      'scripts/config/coverage.json': '{\n  "include": ["src/lib/greeting*.ts"]\n}\n',
    });

    const { status, output } = run(root, ['src/lib/greeting.ts', 'src/shared/greeting.ts']);

    expect(status).toBe(1);
    expect(output).toContain('scripts/config/coverage.json:2  src/lib/greeting');
    expect(output).toContain('Nothing was changed.');
    expect(existsSync(path.join(root, 'src/lib/greeting.ts'))).toBe(true);
    expect(read(root, 'scripts/config/coverage.json')).toContain('src/lib/greeting*.ts');
  });

  it('keeps a vi.mock double intercepting the real consumer after the move', () => {
    // The double returns a value the real module never does, so the inner test fails if the mock
    // stops applying. The control proves it: moving by hand without the mock path breaks it.
    const files = {
      '.gitignore': 'node_modules\n',
      'vitest.config.mjs': [
        "import path from 'node:path';",
        'export default {',
        "  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },",
        "  test: { include: ['src/**/*.test.ts'], environment: 'node' },",
        '};',
        '',
      ].join('\n'),
      'src/lib/greeting.ts': "export const greet = () => 'real';\n",
      'src/app/consumer.ts':
        "import { greet } from '../lib/greeting';\nexport const message = () => greet();\n",
      'src/tests/alias.test.ts': [
        "import { expect, it, vi } from 'vitest';",
        "import { message } from '../app/consumer';",
        "vi.mock('@/lib/greeting', () => ({ greet: () => 'alias double' }));",
        "it('uses the alias double', () => expect(message()).toBe('alias double'));",
        '',
      ].join('\n'),
      'src/tests/relative.test.ts': [
        "import { expect, it, vi } from 'vitest';",
        "import { message } from '../app/consumer';",
        "vi.mock('../lib/greeting', () => ({ greet: () => 'relative double' }));",
        "it('uses the relative double', () => expect(message()).toBe('relative double'));",
        '',
      ].join('\n'),
    };
    const runInnerTests = (root: string) => {
      symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'));
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST'))
      );
      return spawnSync(process.execPath, [VITEST, 'run', '--root', root], {
        cwd: root,
        encoding: 'utf8',
        env,
      });
    };

    const moved = createRepo(files);
    expect(run(moved, ['src/lib/greeting.ts', 'src/shared/greeting.ts']).status).toBe(0);
    const afterScript = runInnerTests(moved);
    expect(afterScript.status, `${afterScript.stdout}${afterScript.stderr}`).toBe(0);
    expect(afterScript.stdout).toMatch(/2 passed/);

    const byHand = createRepo(files);
    execFileSync('git', ['mv', 'src/lib/greeting.ts', 'src/shared-greeting.ts'], { cwd: byHand });
    writeFileSync(
      path.join(byHand, 'src/app/consumer.ts'),
      "import { greet } from '../shared-greeting';\nexport const message = () => greet();\n"
    );
    const stale = runInnerTests(byHand);
    expect(stale.status).toBe(1);
    expect(`${stale.stdout}${stale.stderr}`).toContain("expected 'real' to be 'alias double'");
  }, 60_000);

  it('lists the rewrites of a sample move on the real repository without applying it', () => {
    // A module with references in e2e, tests, hooks and docs. If it moves, pick another one.
    const { status, output } = run(REPO, [
      '--check',
      'src/config/queryClient.ts',
      'src/services/query/queryClient.ts',
    ]);

    expect(status, output).toBe(0);
    expect(output).toMatch(
      /e2e\/nursing-private-accounts\.spec\.ts:\d+ {2}\/src\/config\/queryClient\.ts → \/src\/services\/query\/queryClient\.ts/
    );
    expect(output).toMatch(
      /src\/hooks\/useStaffQuery\.ts:\d+ {2}\.\.\/config\/queryClient → \.\.\/services\/query\/queryClient/
    );
    expect(existsSync(path.join(REPO, 'src/config/queryClient.ts'))).toBe(true);
    expect(existsSync(path.join(REPO, 'src/services/query/queryClient.ts'))).toBe(false);
  }, 30_000);
});
