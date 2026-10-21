// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectE2eOwnershipIssues,
  collectRequiredCiEvidenceIssues,
  summarizeTestReporter,
  validateTestEvidence,
} from '../../../scripts/testExecutionManifestSupport.mjs';

const identity = { gitSha: 'a'.repeat(40), worktreeDirty: false, sourceFingerprint: 'clean' };
const expected = [
  {
    suiteId: 'unit-1',
    job: 'unit-risk-shards',
    kind: 'vitest',
    script: 'test:ci:unit:shard',
    shard: '1/4',
    files: ['src/tests/a.test.ts', 'src/tests/b.test.ts'],
  },
  {
    suiteId: 'unit-2',
    job: 'unit-risk-shards',
    kind: 'vitest',
    script: 'test:ci:unit:shard',
    shard: '2/4',
    files: ['src/tests/c.test.ts'],
  },
  {
    suiteId: 'storage',
    job: 'rules-emulator',
    kind: 'vitest',
    script: 'test:storage-rules:ci',
    files: ['src/tests/security/storage-rules.test.ts'],
    allowSkipped: false,
  },
  {
    suiteId: 'critical',
    job: 'e2e-critical-emulator',
    kind: 'playwright',
    script: 'test:e2e:critical:ci',
    files: ['e2e/clinical.spec.ts'],
  },
];
const observation = (suite: (typeof expected)[number]) => ({
  accepted: true,
  suiteId: suite.suiteId,
  ci: { runId: '123', runAttempt: '1', job: suite.job },
  kind: suite.kind,
  mode: 'execution',
  command: ['npm', 'run', suite.script, ...(suite.shard ? ['--', suite.shard] : [])],
  exitCode: 0,
  files: suite.files,
  duplicateFiles: [],
  suiteErrors: [],
  reporterSuccess: true,
  globalErrors: 0,
  counts: { executed: 2, failed: 0, skipped: 0, todo: 0, interrupted: 0, notRun: 0, collected: 0 },
});
const completeEvidence = () => ({
  schemaVersion: 1,
  identity,
  sourceUnchanged: true,
  sourceRoot: '/producer/repo',
  ci: { runId: '123', runAttempt: '1', job: 'rules-emulator' },
  command: ['npm', 'run', 'test:storage-rules:ci'],
  mode: 'execution',
  kind: 'vitest',
  exitCode: 0,
  report: {
    success: true,
    testResults: [
      {
        name: '/producer/repo/src/tests/security/storage-rules.test.ts',
        status: 'passed',
        assertionResults: [{ fullName: 'denies anonymous access', status: 'passed' }],
      },
    ],
  },
});
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe('test evidence reconciliation', () => {
  it('accepts exact sources, commands and producer jobs once per required suite', () => {
    expect(collectRequiredCiEvidenceIssues(expected.map(observation), expected)).toEqual([]);
  });

  it.each([
    ['-t', 'one case'],
    ['--testNamePattern=one'],
    ['--grep=one'],
    ['--changed'],
    ['--project=other'],
  ])('rejects partial execution selected through extra argv %j', (...filters) => {
    const item = observation(expected[0]);
    expect(
      collectRequiredCiEvidenceIssues(
        [
          {
            ...item,
            command: [...item.command, ...filters],
            counts: { ...item.counts, executed: 1, skipped: 654 },
          },
        ],
        expected,
        { requireAll: false }
      )
    ).toContain('unit-1: Unexpected runner arguments or test filters');
  });

  it('rejects absent, duplicate, unnamed and wrong producer evidence', () => {
    expect(collectRequiredCiEvidenceIssues([], expected)).toContain(
      'unit-1: Required evidence is absent'
    );
    expect(
      collectRequiredCiEvidenceIssues(
        [observation(expected[0]), observation(expected[0])],
        expected,
        { requireAll: false }
      )
    ).toContain('unit-1: Duplicate suite evidence');
    expect(
      collectRequiredCiEvidenceIssues(
        [{ ...observation(expected[0]), suiteId: undefined }],
        expected
      )
    ).toContain('Unknown required CI suite: (missing suiteId)');
    expect(
      collectRequiredCiEvidenceIssues(
        [{ ...observation(expected[0]), ci: { job: 'other' } }],
        expected,
        { requireAll: false }
      )
    ).toContain('unit-1: Expected producer job unit-risk-shards');
  });

  it('rejects a swapped shard and any missing, duplicated or extra observed test file', () => {
    const item = observation(expected[0]);
    expect(
      collectRequiredCiEvidenceIssues(
        [{ ...item, command: ['npm', 'run', 'test:ci:unit:shard', '--', '2/4'] }],
        expected,
        { requireAll: false }
      )
    ).toContain('unit-1: Expected shard argument 1/4');
    expect(
      collectRequiredCiEvidenceIssues(
        [
          {
            ...item,
            files: ['src/tests/a.test.ts', 'src/tests/c.test.ts'],
            duplicateFiles: ['src/tests/a.test.ts'],
          },
        ],
        expected,
        { requireAll: false }
      )
    ).toEqual(
      expect.arrayContaining([
        'unit-1: Missing observed file: src/tests/b.test.ts',
        'unit-1: Unexpected observed file: src/tests/c.test.ts',
        'unit-1: Duplicate observed file: src/tests/a.test.ts',
      ])
    );
    expect(
      collectRequiredCiEvidenceIssues(
        [{ ...item, command: ['npm', 'run', 'test:other', '--', '1/4'], kind: 'playwright' }],
        expected,
        { requireAll: false }
      )
    ).toEqual(
      expect.arrayContaining([
        'unit-1: Expected command npm run test:ci:unit:shard',
        'unit-1: Expected reporter vitest',
      ])
    );
  });

  it('rejects collection, seven skipped Storage cases, nonzero exit and reported failures', () => {
    const item = observation(expected[2]);
    for (const patch of [
      { mode: 'collection' },
      { counts: { ...item.counts, executed: 0, skipped: 7 } },
      { exitCode: 1 },
      { reporterSuccess: false },
      { globalErrors: 1 },
      { suiteErrors: [{ message: 'afterAll' }] },
    ])
      expect(
        collectRequiredCiEvidenceIssues([{ ...item, ...patch }], expected, { requireAll: false })
          .length
      ).toBeGreaterThan(0);
    expect(
      collectRequiredCiEvidenceIssues(
        [{ ...item, counts: { ...item.counts, skipped: 1 } }],
        expected,
        { requireAll: false }
      )
    ).toContain('storage: Required Storage rules cases were skipped or unfinished');
  });

  it('allows legitimate unit todo cases while preventing zero-execution unit evidence', () => {
    const item = observation(expected[0]);
    expect(
      collectRequiredCiEvidenceIssues(
        [{ ...item, counts: { ...item.counts, todo: 6 } }],
        expected,
        { requireAll: false }
      )
    ).toEqual([]);
    expect(
      collectRequiredCiEvidenceIssues(
        [{ ...item, counts: { ...item.counts, executed: 0, todo: 6 } }],
        expected,
        { requireAll: false }
      )
    ).toContain('unit-1: Required evidence executed zero cases');
  });

  it('normalizes producer absolute Vitest names and Playwright paths from report rootDir', () => {
    expect(summarizeTestReporter(completeEvidence()).files).toEqual([
      'src/tests/security/storage-rules.test.ts',
    ]);
    const report = {
      config: { rootDir: '/producer/repo/e2e' },
      suites: [
        {
          title: 'clinical.spec.ts',
          specs: [
            {
              file: 'clinical.spec.ts',
              title: 'saves',
              tests: [{ projectName: 'chromium', results: [{ status: 'passed' }] }],
            },
          ],
        },
      ],
    };
    expect(
      summarizeTestReporter({
        kind: 'playwright',
        mode: 'execution',
        sourceRoot: '/producer/repo',
        report,
      }).files
    ).toEqual(['e2e/clinical.spec.ts']);
  });

  it('records hook failures even when every assertion passed', () => {
    const evidence = completeEvidence();
    evidence.report.testResults[0].status = 'failed';
    const summary = summarizeTestReporter(evidence);
    expect(summary.counts.passed).toBe(1);
    expect(summary.suiteErrors).toHaveLength(1);
    expect(() =>
      validateTestEvidence(evidence, identity, { runId: '123', runAttempt: '1' })
    ).toThrow('hook or global errors');
  });

  it('preserves serial tests that never ran and retries without inflating execution counts', () => {
    const summary = summarizeTestReporter({
      kind: 'playwright',
      mode: 'execution',
      report: {
        suites: [
          {
            title: 'admission',
            specs: [
              {
                file: 'e2e/clinical.spec.ts',
                title: 'saves',
                tests: [
                  {
                    projectName: 'chromium',
                    results: [{ status: 'failed' }, { status: 'passed' }],
                  },
                  { projectName: 'webkit', results: [] },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(summary.counts).toMatchObject({
      executed: 1,
      passed: 1,
      notRun: 1,
      attempts: 2,
      retryAttempts: 1,
      flaky: 1,
    });
    expect(summary.globalErrors).toBe(1);
    expect(summary.cases.map(item => item.title)).toEqual([
      'chromium: admission > saves',
      'webkit: admission > saves',
    ]);
  });

  it('accepts older passing attempts only in the current CI run and exact tested source', () => {
    const evidence = completeEvidence();
    const ci = { runId: '123', runAttempt: '2' };
    expect(validateTestEvidence(evidence, identity, ci).counts.executed).toBe(1);
    expect(() =>
      validateTestEvidence({ ...evidence, ci: { ...evidence.ci, runId: '122' } }, identity, ci)
    ).toThrow('CI run or attempt');
    expect(() =>
      validateTestEvidence({ ...evidence, ci: { ...evidence.ci, runAttempt: '3' } }, identity, ci)
    ).toThrow('CI run or attempt');
    expect(() => validateTestEvidence({ ...evidence, exitCode: 1 }, identity, ci)).toThrow(
      'exitCode'
    );
    expect(() => validateTestEvidence({ ...evidence, mode: 'collection' }, identity, ci)).toThrow(
      'must be execution'
    );
    expect(() =>
      validateTestEvidence(
        { ...evidence, report: { ...evidence.report, success: false } },
        identity,
        ci
      )
    ).toThrow('errors');
    expect(() =>
      validateTestEvidence(
        { ...evidence, identity: { ...identity, sourceFingerprint: 'other' } },
        identity,
        ci
      )
    ).toThrow('source differs');
    expect(() =>
      validateTestEvidence({ ...evidence, captureError: 'missing RAW', report: null }, identity, ci)
    ).toThrow('capture failed: missing RAW');
  });

  it('rejects promoting a manual or unrelated E2E spec to an automated script that never selects it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-manifest-selection-'));
    roots.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { 'test:critical': 'playwright test e2e/clinical.spec.ts' } })
    );
    fs.writeFileSync(path.join(root, 'ci.yml'), 'run: npm run test:critical\n');
    for (const file of ['e2e/dicom-viewer.spec.ts', 'e2e/audit-trail.spec.ts']) {
      const entry = {
        file,
        lane: 'ci',
        reason: 'Claimed automation',
        command: 'npm run test:critical',
        workflow: 'ci.yml',
      };
      expect(collectE2eOwnershipIssues([file], { specs: [entry] }, root)).toContain(
        `E2E spec selection is unverified for declared script: ${file}`
      );
    }
  });
});
