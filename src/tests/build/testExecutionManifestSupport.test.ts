// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureTestSourceIdentity,
  collectE2eOwnershipIssues,
  summarizeTestReporter,
  validateTestEvidence,
} from '../../../scripts/testExecutionManifestSupport.mjs';

const identity = { gitSha: 'a'.repeat(40), worktreeDirty: false, sourceFingerprint: 'source-a' };
const vitest = {
  testResults: [
    {
      name: '/repo/test.ts',
      assertionResults: [
        { fullName: 'success', status: 'passed' },
        { fullName: 'regression', status: 'failed' },
        { fullName: 'disabled', status: 'pending' },
        { fullName: 'unfinished', status: 'todo' },
      ],
    },
  ],
};
const evidence = () => ({
  schemaVersion: 1,
  identity,
  sourceUnchanged: true,
  command: ['npx', 'vitest', 'run'],
  mode: 'execution',
  kind: 'vitest',
  report: vitest,
  exitCode: 0,
});
const tempRoots: string[] = [];
afterEach(() =>
  tempRoots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }))
);

describe('test execution manifest evidence', () => {
  it('exposes a failed suite import even when no assertions were reached', () => {
    const summary = summarizeTestReporter({
      kind: 'vitest',
      mode: 'execution',
      report: {
        success: false,
        testResults: [
          {
            name: 'broken-import.test.ts',
            status: 'failed',
            message: 'Cannot load module',
            assertionResults: [],
          },
        ],
      },
    });
    expect(summary.counts.executed).toBe(0);
    expect(summary.reporterSuccess).toBe(false);
    expect(summary.suiteErrors).toEqual([
      { file: 'broken-import.test.ts', message: 'Cannot load module' },
    ]);
  });

  it('keeps same-named Playwright tests distinct by their suite ancestry', () => {
    const summary = summarizeTestReporter({
      kind: 'playwright',
      mode: 'collection',
      report: {
        suites: [
          {
            title: 'a.spec.ts',
            suites: ['admission', 'discharge'].map(title => ({
              title,
              specs: [{ title: 'persists', tests: [{ projectName: 'chromium', results: [] }] }],
            })),
          },
        ],
      },
    });
    expect(summary.cases.map(test => test.title)).toEqual([
      'chromium: a.spec.ts > admission > persists',
      'chromium: a.spec.ts > discharge > persists',
    ]);
  });

  it('separates executed Vitest cases from skipped and todo registrations', () => {
    expect(validateTestEvidence(evidence(), identity).counts).toEqual({
      registered: 4,
      executed: 2,
      passed: 1,
      failed: 1,
      skipped: 1,
      todo: 1,
      interrupted: 0,
      notRun: 0,
      collected: 0,
      attempts: 2,
      flaky: 0,
      retryAttempts: 0,
    });
  });

  it('counts one final Playwright outcome and all actual retry attempts', () => {
    const summary = summarizeTestReporter({
      kind: 'playwright',
      mode: 'execution',
      report: {
        suites: [
          {
            suites: [
              {
                file: 'e2e/a.spec.ts',
                specs: [
                  {
                    title: 'retry',
                    tests: [
                      {
                        projectName: 'chromium',
                        results: [{ status: 'failed' }, { status: 'passed' }],
                      },
                      { projectName: 'webkit', results: [{ status: 'skipped' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        errors: [{ message: 'global error' }],
      },
    });
    expect(summary.counts).toMatchObject({
      registered: 2,
      executed: 1,
      passed: 1,
      skipped: 1,
      attempts: 2,
      flaky: 1,
    });
    expect(summary.globalErrors).toBe(1);
  });

  it('does not call Playwright collection execution', () => {
    const summary = summarizeTestReporter({
      kind: 'playwright',
      mode: 'collection',
      report: {
        suites: [
          {
            specs: [
              {
                file: 'e2e/a.spec.ts',
                title: 'collected',
                tests: [{ projectName: 'chromium', results: [] }],
              },
            ],
          },
        ],
      },
    });
    expect(summary.counts).toMatchObject({
      registered: 1,
      collected: 1,
      executed: 0,
      passed: 0,
      attempts: 0,
    });
  });

  it('rejects SHA mismatches, changed source snapshots and unattributed raw reports', () => {
    expect(() => validateTestEvidence(evidence(), { ...identity, gitSha: 'b'.repeat(40) })).toThrow(
      'SHA differs'
    );
    expect(() =>
      validateTestEvidence(evidence(), { ...identity, sourceFingerprint: 'new-source' })
    ).toThrow('source differs');
    expect(() => validateTestEvidence({ ...evidence(), sourceUnchanged: false }, identity)).toThrow(
      'Sources changed'
    );
    expect(() => validateTestEvidence(vitest, identity)).toThrow('Unattributed');
  });

  it('preserves missing Playwright results as not-run evidence and rejects unknown Vitest outcomes', () => {
    const incomplete = summarizeTestReporter({
      kind: 'playwright',
      mode: 'execution',
      report: {
        suites: [{ specs: [{ title: 'missing', tests: [{ results: [] }] }] }],
      },
    });
    expect(incomplete.counts).toMatchObject({ notRun: 1, executed: 0 });
    expect(incomplete.globalErrors).toBe(1);
    expect(incomplete.diagnostics[0]).toContain('missing');
    expect(() =>
      summarizeTestReporter({
        kind: 'vitest',
        mode: 'execution',
        report: {
          testResults: [{ assertionResults: [{ status: 'mystery' }] }],
        },
      })
    ).toThrow('Unknown Vitest status');
  });

  it('requires an explicit decision for every E2E source and detects stale or duplicate decisions', () => {
    const decision = {
      file: 'e2e/a.spec.ts',
      lane: 'manual',
      reason: 'Synthetic local scenario',
      command: 'npx playwright test e2e/a.spec.ts',
    };
    expect(collectE2eOwnershipIssues(['e2e/a.spec.ts'], { specs: [decision] })).toEqual([]);
    expect(collectE2eOwnershipIssues(['e2e/b.spec.ts'], { specs: [decision, decision] })).toEqual([
      'Owned E2E file does not exist: e2e/a.spec.ts',
      'Duplicate E2E owner: e2e/a.spec.ts',
      'Owned E2E file does not exist: e2e/a.spec.ts',
      'Unowned E2E file: e2e/b.spec.ts',
    ]);
  });

  it('rejects missing or stale CI evidence instead of presenting a green zero', () => {
    expect(() => validateTestEvidence(null, identity)).toThrow('artifact is absent');
    const ci = { runId: '123', runAttempt: '2' };
    expect(() => validateTestEvidence(evidence(), identity, ci)).toThrow('CI run or attempt');
    const complete = {
      ...evidence(),
      report: {
        success: true,
        testResults: [
          { name: '/repo/test.ts', assertionResults: [{ fullName: 'passes', status: 'passed' }] },
        ],
      },
    };
    expect(
      validateTestEvidence({ ...complete, ci: { runId: '123', runAttempt: '1' } }, identity, ci)
        .counts.executed
    ).toBe(1);
    expect(validateTestEvidence({ ...complete, ci }, identity, ci).counts.executed).toBe(1);
    expect(() =>
      validateTestEvidence({ ...complete, ci: { runId: '123', runAttempt: '3' } }, identity, ci)
    ).toThrow('CI run or attempt');
    expect(() =>
      validateTestEvidence({ ...evidence(), ci: { runId: '123', runAttempt: '1' } }, identity, ci)
    ).toThrow('errors');
  });

  it('does not call an E2E script automated merely because package.json defines it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-test-ownership-'));
    tempRoots.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { 'test:flow': 'playwright test e2e/a.spec.ts' } })
    );
    const workflowRunning = (command: string, comment = '') =>
      `${comment}jobs:\n  e2e:\n    steps:\n      - run: ${command}\n`;
    fs.writeFileSync(path.join(root, 'ci.yml'), workflowRunning('npm run other-script'));
    const entry = {
      file: 'e2e/a.spec.ts',
      lane: 'ci',
      reason: 'Critical flow',
      command: 'npm run test:flow',
      workflow: 'ci.yml',
    };
    expect(collectE2eOwnershipIssues([entry.file], { specs: [entry] }, root)).toEqual([
      'E2E entry script is not invoked by its workflow: e2e/a.spec.ts',
    ]);
    // A comment that mentions the script is not an invocation.
    fs.writeFileSync(
      path.join(root, 'ci.yml'),
      workflowRunning('npm run other-script', '# npm run test:flow\n')
    );
    expect(collectE2eOwnershipIssues([entry.file], { specs: [entry] }, root)).toEqual([
      'E2E entry script is not invoked by its workflow: e2e/a.spec.ts',
    ]);
    fs.writeFileSync(path.join(root, 'ci.yml'), workflowRunning('npm run test:flow'));
    expect(collectE2eOwnershipIssues([entry.file], { specs: [entry] }, root)).toEqual([]);
  });

  it('requires the canonical preview script, every lane and an executable lane invocation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-preview-ownership-'));
    tempRoots.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          'ci:preview-smoke:built': 'playwright test e2e/a.spec.ts e2e/dicom-viewer.spec.ts',
          'test:other': 'playwright test e2e/a.spec.ts',
        },
      })
    );
    const lanes = ['app', 'dicom-graphics-stress', 'dicom-1', 'dicom-2'];
    const run = 'node scripts/run-preview-smoke-lane.mjs --lane=${{ matrix.lane }}';
    const writeWorkflow = (selected: string[], command: string) =>
      fs.writeFileSync(
        path.join(root, 'ci.yml'),
        JSON.stringify({
          jobs: {
            'preview-smoke-lanes': {
              strategy: { matrix: { lane: selected } },
              steps: [{ run: command }],
            },
          },
        })
      );
    const entry = {
      file: 'e2e/a.spec.ts',
      lane: 'ci',
      reason: 'Built preview',
      command: 'npm run ci:preview-smoke:built',
      entryJob: 'preview-smoke-lanes',
      workflow: 'ci.yml',
    };
    const check = (selected = entry) =>
      collectE2eOwnershipIssues([entry.file], { specs: [selected] }, root);
    writeWorkflow(lanes, run);
    expect(check()).toEqual([]);
    expect(check({ ...entry, command: 'npm run test:other' })).toContain(
      'Invalid preview lane entrypoint: e2e/a.spec.ts'
    );
    expect(check({ ...entry, entryJob: 'other-job' })).toContain(
      'Invalid preview lane entrypoint: e2e/a.spec.ts'
    );
    writeWorkflow(lanes.slice(0, -1), run);
    expect(check()).toContain('Invalid preview lane entrypoint: e2e/a.spec.ts');
    writeWorkflow([...lanes, 'dicom-1'], run);
    expect(check()).toContain('Invalid preview lane entrypoint: e2e/a.spec.ts');
    writeWorkflow(lanes, `# ${run}`);
    expect(check()).toContain('Invalid preview lane entrypoint: e2e/a.spec.ts');
  });

  it('distinguishes changed contents in the same dirty worktree and fails closed outside Git', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-test-manifest-'));
    tempRoots.push(root);
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    expect(() => captureTestSourceIdentity(root)).toThrow();
    git(['init']);
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ]);
    const clean = captureTestSourceIdentity(root);
    expect(clean.worktreeDirty).toBe(false);
    fs.writeFileSync(path.join(root, 'source.ts'), 'first');
    const first = captureTestSourceIdentity(root);
    fs.writeFileSync(path.join(root, 'source.ts'), 'second');
    const second = captureTestSourceIdentity(root);
    expect(first.gitSha).toBe(clean.gitSha);
    expect(first.worktreeDirty).toBe(true);
    expect(second.sourceFingerprint).not.toBe(first.sourceFingerprint);
  });
});
