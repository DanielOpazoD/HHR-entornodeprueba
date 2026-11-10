// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { checkExtensionSource } from '../../../scripts/check-extension-source.mjs';

it('rejects local divergence, preserves pending work and synchronizes only the pinned source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-extension-source-'));
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-extension-authority-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    fs.mkdirSync(path.join(root, 'extension'));
    fs.writeFileSync(path.join(sourceRoot, 'runtime.js'), 'new source');
    fs.writeFileSync(path.join(root, 'extension/runtime.js'), 'old source');
    fs.writeFileSync(path.join(root, 'extension/obsolete.js'), 'obsolete');
    fs.writeFileSync(path.join(root, 'extension/README.md'), 'HHR integration guide');
    git('init');
    git('config', 'user.name', 'Synthetic');
    git('config', 'user.email', 'synthetic@example.invalid');
    git('add', '.');
    git('commit', '-m', 'base');
    expect(() => checkExtensionSource({ root, sourceRoot })).toThrow(
      /npm ci .* npm run extension:sync/
    );
    fs.writeFileSync(path.join(root, 'extension/runtime.js'), 'pending change');
    expect(() => checkExtensionSource({ root, sourceRoot, write: true })).toThrow(/pendientes/);
    expect(fs.readFileSync(path.join(root, 'extension/runtime.js'), 'utf8')).toBe('pending change');
    git('restore', 'extension/runtime.js');
    expect(checkExtensionSource({ root, sourceRoot, write: true }).synchronized).toBe(2);
    expect(fs.existsSync(path.join(root, 'extension/obsolete.js'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'extension/README.md'), 'utf8')).toBe(
      'HHR integration guide'
    );
    expect(checkExtensionSource({ root, sourceRoot }).synchronized).toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

it('runs in the quality aggregate, where CI has installed the pinned package', () => {
  const governance = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'scripts/config/guardrail-governance.json'), 'utf8')
  ) as { qualityAggregate: { checks: Array<{ id: string; group: string }> } };
  expect(governance.qualityAggregate.checks).toContainEqual({
    id: 'check:extension-source',
    group: 'hygiene',
  });
});
