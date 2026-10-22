// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';

const script = path.resolve('.github/actions/setup-ci-chromium/install-chromium.sh');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** Runs the install script against a fake `npx` that fails its first `failures` calls. */
const runInstall = (failures: number) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-chromium-install-'));
  roots.push(root);
  const bin = path.join(root, 'bin');
  const sources = path.join(root, 'sources.list.d');
  const disabled = path.join(root, 'disabled');
  fs.mkdirSync(bin);
  fs.mkdirSync(sources);
  fs.writeFileSync(
    path.join(sources, 'ubuntu.sources'),
    'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble\n'
  );
  fs.writeFileSync(
    path.join(sources, 'microsoft-prod.list'),
    'deb [arch=amd64] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n'
  );
  const calls = path.join(root, 'calls');
  fs.writeFileSync(
    path.join(bin, 'npx'),
    `#!/usr/bin/env bash\necho "$*" >> "${calls}"\n[ "$(wc -l < "${calls}")" -gt ${failures} ]\n`,
    { mode: 0o755 }
  );
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      APT_SOURCES_DIR: sources,
      APT_DISABLED_SOURCES_DIR: disabled,
      CI_SUDO: '',
    },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls: fs.readFileSync(calls, 'utf8').trim().split('\n'),
    remaining: fs.readdirSync(sources).sort(),
    disabled: fs.existsSync(disabled) ? fs.readdirSync(disabled).sort() : [],
  };
};

it('installs once and leaves apt sources alone when the first attempt succeeds', () => {
  const result = runInstall(0);
  expect(result.status).toBe(0);
  expect(result.calls).toEqual(['playwright install --with-deps chromium']);
  expect(result.remaining).toEqual(['microsoft-prod.list', 'ubuntu.sources']);
  expect(result.disabled).toEqual([]);
});

it('retries once with only the Ubuntu archive when a third-party repository breaks apt', () => {
  const result = runInstall(1);
  expect(result.status).toBe(0);
  expect(result.calls).toHaveLength(2);
  expect(result.remaining).toEqual(['ubuntu.sources']);
  expect(result.disabled).toEqual(['microsoft-prod.list']);
  expect(result.output).toContain('::warning::Chromium install failed');
});

it('fails after the single retry instead of looping', () => {
  const result = runInstall(2);
  expect(result.status).not.toBe(0);
  expect(result.calls).toHaveLength(2);
});
