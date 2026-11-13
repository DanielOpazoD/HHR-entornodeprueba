import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

const root = process.cwd();
const temporary = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-changed-'));
  temporary.push(cwd);
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const write = (file, content = '') => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), content);
  };
  git('init');
  git('config', 'user.email', 'synthetic@example.test');
  git('config', 'user.name', 'Synthetic');
  write('.gitignore', 'node_modules\n');
  write('src/base.ts');
  write('src/deleted.ts', 'export const deleted = true;');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  fs.mkdirSync(path.join(cwd, 'node_modules/.bin'), { recursive: true });
  return { cwd, git, write };
}
function run(cwd, args = []) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/test-changed.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('collects branch, staged, unstaged, deleted and untracked paths without duplicates', () => {
  const { cwd, git, write } = fixture();
  write('src/branch.ts');
  git('add', '.');
  git('commit', '-m', 'branch');
  write('src/branch.ts', 'also changed locally');
  write('src/staged.ts');
  git('add', '.');
  write('src/base.ts', 'changed');
  write('src/space name.ts');
  git('rm', 'src/deleted.ts');
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { getChangedFiles } from ${JSON.stringify(path.join(root, 'scripts/lib/changedFiles.mjs'))}; console.log(JSON.stringify([...getChangedFiles()].sort()));`,
    ],
    { cwd, encoding: 'utf8' }
  );
  assert.deepEqual(JSON.parse(output), [
    'src/base.ts',
    'src/branch.ts',
    'src/deleted.ts',
    'src/space name.ts',
    'src/staged.ts',
  ]);
});

test('does not invoke Vitest for non-source changes', () => {
  const { cwd, write } = fixture();
  write('README.md', 'documentation');
  const result = run(cwd);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No hay cambios en src/);
});

test('runs related unit tests, forwards arguments, explains emulator exclusion and propagates failure', () => {
  const { cwd, write } = fixture();
  write('src/tests/emulator/example.test.ts');
  write('src/space name.ts');
  write(
    'node_modules/.bin/vitest',
    '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2))); process.exit(7);\n'
  );
  fs.chmodSync(path.join(cwd, 'node_modules/.bin/vitest'), 0o755);
  const result = run(cwd, ['--maxWorkers=2']);
  assert.equal(result.status, 7);
  assert.match(result.stdout, /npm run test:emulator:file -- <ruta>/);
  const args = JSON.parse(result.stdout.split('\n').find(line => line.startsWith('["')));
  assert.equal(args[0], 'related');
  assert.ok(args.includes('src/space name.ts'));
  assert.ok(args.includes('--maxWorkers=2'));
  assert.ok(args.includes('--run'));
  assert.equal(args[args.indexOf('--config') + 1], 'vitest.config.ts');
  const excludes = args.filter((_, i) => args[i - 1] === '--exclude');
  const unit = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts[
    'test:ci:unit'
  ];
  assert.deepEqual(
    excludes,
    [...unit.matchAll(/--exclude "([^"]+)"/g)].map(match => match[1])
  );
});

test('reports missing prerequisites with the existing messages', () => {
  const { cwd, git } = fixture();
  git('update-ref', '-d', 'refs/remotes/origin/main');
  assert.match(
    run(cwd).stderr,
    /Falta origin\/main: ejecuta git fetch origin main y vuelve a intentar\./
  );
  fs.rmdirSync(path.join(cwd, 'node_modules/.bin'));
  fs.rmdirSync(path.join(cwd, 'node_modules'));
  const result = run(cwd);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Falta node_modules: enlázalo desde otra copia o instala con npm ci\./
  );
});
