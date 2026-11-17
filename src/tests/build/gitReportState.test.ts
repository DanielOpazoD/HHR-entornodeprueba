// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  isGitWorktreeDirty,
  hasMeaningfulWorktreeChanges,
} from '../../../scripts/gitReportState.mjs';

describe('gitReportState', () => {
  it('treats any status line as a meaningful worktree change', () => {
    expect(hasMeaningfulWorktreeChanges(' M src/app.ts\n')).toBe(true);
    expect(hasMeaningfulWorktreeChanges('')).toBe(false);
  });

  it('keeps every generated report out of the index', () => {
    // Reports describe the commit that generated them; a tracked copy goes stale on the next merge.
    expect(execFileSync('git', ['ls-files', '--', 'reports'], { encoding: 'utf8' })).toBe('');
  });
});

// Reproduce a fresh checkout using the repository's real ignore policy.
describe('generated report checkout', () => {
  it('stays clean when a machine regenerates legacy retirement evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-report-checkout-'));
    const report = 'reports/legacy-retirement-debt.json';
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    try {
      git('init', '--quiet');
      fs.copyFileSync('.gitignore', path.join(root, '.gitignore'));
      fs.mkdirSync(path.join(root, 'reports'));
      fs.writeFileSync(path.join(root, report), '{"synthetic": "initial"}\n');
      git('add', '.gitignore');
      git(
        '-c',
        'user.name=Synthetic Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'test: synthetic checkout'
      );
      expect(isGitWorktreeDirty(root)).toBe(false);
      fs.writeFileSync(path.join(root, report), '{"synthetic": "regenerated"}\n');
      expect(isGitWorktreeDirty(root)).toBe(false);
      fs.writeFileSync(path.join(root, 'source.txt'), 'a real source change\n');
      expect(isGitWorktreeDirty(root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
