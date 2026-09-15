import { describe, expect, it, vi } from 'vitest';

import {
  classifyCiChangeScope,
  collectChangedFilesFromGit,
  parseGitNameStatus,
} from '../../../scripts/ciChangeScopeSupport.mjs';

const config = {
  maxFiles: 3,
  docsOnly: {
    directories: ['docs/**'],
    rootFiles: ['README.md'],
    excluded: ['docs/api/**'],
  },
  functionsOnly: {
    directories: ['functions/**'],
    supportFiles: ['scripts/check-firebase-function-regions.mjs'],
    excluded: ['functions/package.json', 'functions/package-lock.json'],
  },
};

const changed = (filename: string, status = 'modified') => ({ filename, status });

describe('CI change scope classification', () => {
  it('classifies only explicit documentation paths as docs-only', () => {
    expect(
      classifyCiChangeScope({
        eventName: 'pull_request',
        files: [changed('README.md'), changed('docs/CI_GATES.md')],
        config,
      })
    ).toMatchObject({ scope: 'docs-only', usedFallback: false });
  });

  it('classifies function source and its approved verification helper as functions-only', () => {
    expect(
      classifyCiChangeScope({
        eventName: 'pull_request',
        files: [
          changed('functions/src/index.ts'),
          changed('scripts/check-firebase-function-regions.mjs'),
        ],
        config,
      })
    ).toMatchObject({ scope: 'functions-only', usedFallback: false });
  });

  it.each([
    ['pushes', 'push', [changed('docs/guide.md')]],
    ['mixed paths', 'pull_request', [changed('docs/guide.md'), changed('src/App.tsx')]],
    ['generated API docs', 'pull_request', [changed('docs/api/index.html')]],
    ['function dependencies', 'pull_request', [changed('functions/package.json')]],
    ['workflow changes', 'pull_request', [changed('.github/workflows/ci-cd.yml')]],
    ['deletions', 'pull_request', [changed('docs/old.md', 'removed')]],
    ['missing files', 'pull_request', []],
    [
      'large changes',
      'pull_request',
      [changed('docs/1.md'), changed('docs/2.md'), changed('docs/3.md'), changed('docs/4.md')],
    ],
  ])('falls back to full for %s', (_label, eventName, files) => {
    expect(classifyCiChangeScope({ eventName, files, config }).scope).toBe('full');
  });

  it('collects a revision-pinned git diff and marks deletions or renames unsafe', () => {
    const execFile = vi
      .fn()
      .mockReturnValue(
        Buffer.from('M\0docs/guide.md\0D\0docs/old.md\0R100\0src/old.ts\0docs/renamed.ts\0')
      );

    expect(
      collectChangedFilesFromGit({
        root: '/tmp/candidate',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        execFile,
      })
    ).toEqual([
      { filename: 'docs/guide.md', status: 'modified' },
      { filename: 'docs/old.md', status: 'unsafe' },
      { filename: 'docs/renamed.ts', status: 'unsafe' },
    ]);
    expect(execFile).toHaveBeenCalledOnce();
  });

  it('preserves Git pathname identity when safe and unsafe paths resemble each other', () => {
    expect(
      parseGitNameStatus(Buffer.from('R100\0src/old.ts\0docs\\guide.md\0A\0docs/guide.md\0'))
    ).toEqual([
      { filename: 'docs\\guide.md', status: 'unsafe' },
      { filename: 'docs/guide.md', status: 'modified' },
    ]);
  });
});
