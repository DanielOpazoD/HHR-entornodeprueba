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
  it('temporarily ignores snapshots awaiting reader migration or clinical-owner decision', () => {
    expect(
      hasMeaningfulWorktreeChanges(
        [
          ' M reports/quality-metrics.json',
          ' M reports/clinical-release-validation.md',
          ' M reports/clinical-release-signoff.json',
          ' M reports/clinical-release-signoff.md',
        ].join('\n')
      )
    ).toBe(false);
  });

  it('keeps non-generated paths as meaningful worktree changes', () => {
    expect(hasMeaningfulWorktreeChanges(' M src/app.ts\n')).toBe(true);
  });
});

// Reproduce a fresh checkout using the repository's real tracking and ignore policy.
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
      const tracked = execFileSync('git', ['ls-files', '--', report], { encoding: 'utf8' });
      if (tracked.trim()) git('add', '-f', report);
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
