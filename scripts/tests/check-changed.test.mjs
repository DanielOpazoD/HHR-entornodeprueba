import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runner = path.resolve('scripts/check-changed.mjs');
const temporary = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-changed-'));
  temporary.push(dir);
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  git(['init']);
  git(['config', 'user.name', 'Synthetic test']);
  git(['config', 'user.email', 'test@example.invalid']);
  write('README.md', 'Initial\n');
  write('.gitignore', 'node_modules/\n');
  write('src/deleted.ts', 'export {};\n');
  git(['add', '.']);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'initial']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const bin = path.join(dir, 'node_modules/.bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ['npm', 'prettier', 'eslint']) {
    write(
      `node_modules/.bin/${name}`,
      `#!/bin/sh\nprintf '%s\\n' '${name}' "$@" >> "$CALLS"\n[ "$1" != "$FAIL_ARG" ]\n`
    );
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  const run = (extra = {}) => {
    const log = path.join(os.tmpdir(), path.basename(dir) + '.log');
    const result = spawnSync(process.execPath, [runner], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: log, ...extra },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    fs.rmSync(log, { force: true });
    return { ...result, calls };
  };
  return { dir, git, write, run };
};

test('includes committed, staged, unstaged, untracked and deleted changes', () => {
  const { dir, git, write, run } = fixture();
  write('src/committed.ts', 'export {};\n');
  git(['add', 'src/committed.ts']);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'committed']);
  write('src/staged.ts', 'export {};\n');
  git(['add', 'src/staged.ts']);
  write('README.md', 'Changed\n');
  write('src/new file.ts', 'export {};\n');
  fs.unlinkSync(path.join(dir, 'src/deleted.ts'));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const file of ['src/committed.ts', 'src/staged.ts', 'README.md', 'src/new file.ts']) {
    assert.ok(result.calls.includes(file), file);
  }
  assert.ok(!result.calls.includes('src/deleted.ts'));
  assert.match(result.calls, /check:unchecked-index/);
  assert.match(result.calls, /check:module-size/);
  assert.match(result.calls, /check:architecture/);
});

test('docs run formatting without source checks', () => {
  const { write, run } = fixture();
  write('README.md', 'Changed\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /prettier/);
  assert.doesNotMatch(result.calls, /check:unchecked-index|check:test-governance|eslint/);
});

test('test changes select governance and propagate a failed command with repair advice', () => {
  const { write, run } = fixture();
  write('src/tests/example.test.ts', '// synthetic\n');
  const result = run({ FAIL_ARG: '--check' });
  assert.equal(result.status, 1);
  assert.match(result.calls, /check:test-governance/);
  assert.match(result.stderr, /prettier --write/);
});

test('missing comparison ref fails with the fetch command', () => {
  const { git, run } = fixture();
  git(['update-ref', '-d', 'refs/remotes/origin/main']);
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git fetch origin main/);
});

test('includes a staged change even if the working copy equals HEAD', () => {
  const { git, write, run } = fixture();
  write('src/deleted.ts', 'export const staged = true;\n');
  git(['add', 'src/deleted.ts']);
  write('src/deleted.ts', 'export {};\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /src\/deleted.ts/);
  assert.match(result.calls, /check:module-size/);
});
