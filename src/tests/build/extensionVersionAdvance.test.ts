// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
const checker = path.resolve('scripts/check-extension-version-advance.mjs');
describe('extension publication version guard', () => {
  it.each([
    ['0.48.86', 'extension/worker.js', false],
    ['0.48.85', 'extension/worker.js', false],
    ['0.48.87', 'extension/worker.js', true],
    ['0.49.0', 'extension/worker.js', true],
    ['0.48.86', 'extension/README.md', true],
    ['0.48.86', 'scripts/config/extensionDownloadPlugin.ts', false],
  ])('checks %s for a change to %s against the published base', (version, file, passes) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-extension-version-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    try {
      git('init');
      git('config', 'user.name', 'Synthetic');
      git('config', 'user.email', 'synthetic@example.invalid');
      fs.mkdirSync(path.join(root, 'extension'));
      fs.writeFileSync(
        path.join(root, 'extension/manifest.json'),
        JSON.stringify({ version: '0.48.86' })
      );
      git('add', '.');
      git('commit', '-m', 'base');
      const baseSha = git('rev-parse', 'HEAD');
      fs.writeFileSync(path.join(root, 'extension/manifest.json'), JSON.stringify({ version }));
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'synthetic change');
      git('add', '.');
      git('commit', '-m', 'candidate');
      const result = spawnSync(process.execPath, [checker], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CI_GIT_ROOT: root,
          CI_EXTENSION_BASE_SHA: baseSha,
          CI_EXTENSION_HEAD_SHA: git('rev-parse', 'HEAD'),
        },
      });
      expect(result.status, result.stderr).toBe(passes ? 0 : 1);
      if (!passes) expect(result.stderr).toContain('Incorpora la última base');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
