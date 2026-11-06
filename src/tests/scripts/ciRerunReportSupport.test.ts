import { describe, expect, it } from 'vitest';

import {
  describeJobFailure,
  findRecoveredFailures,
  formatRerunReport,
  groupRecoveredFailures,
  normalizeTestTitle,
} from '../../../scripts/ciRerunReportSupport.mjs';

const attempt = (
  runId: number,
  attemptNumber: number,
  conclusion: string | null,
  startedAt: string,
  headSha = 'sha-a'
) => ({
  runId,
  attempt: attemptNumber,
  headSha,
  conclusion,
  startedAt,
});

describe('ciRerunReportSupport', () => {
  it('keeps only failed attempts that a later attempt of the same commit turned green', () => {
    const recovered = findRecoveredFailures([
      attempt(10, 2, 'success', '2026-11-01T10:30:00Z'),
      attempt(10, 1, 'failure', '2026-11-01T10:00:00Z'),
      // Failed and never recovered: a real failure, not a rerun recovery.
      attempt(20, 1, 'failure', '2026-11-01T11:00:00Z', 'sha-b'),
      // Green first, failure afterwards: the failure was not recovered.
      attempt(30, 1, 'success', '2026-11-01T12:00:00Z', 'sha-c'),
      attempt(30, 2, 'failure', '2026-11-01T12:30:00Z', 'sha-c'),
      // Cancelled attempts are not failures.
      attempt(40, 1, 'cancelled', '2026-11-01T13:00:00Z', 'sha-d'),
      attempt(40, 2, 'success', '2026-11-01T13:30:00Z', 'sha-d'),
      // A timed-out attempt recovered by a new run of the same commit.
      attempt(50, 1, 'timed_out', '2026-11-01T14:00:00Z', 'sha-e'),
      attempt(51, 1, 'success', '2026-11-01T15:00:00Z', 'sha-e'),
    ]);

    expect(
      recovered.map(({ runId, attempt: number, recoveredBy }) => ({ runId, number, recoveredBy }))
    ).toEqual([
      { runId: 10, number: 1, recoveredBy: { runId: 10, attempt: 2 } },
      { runId: 50, number: 1, recoveredBy: { runId: 51, attempt: 1 } },
    ]);
  });

  it('drops the browser project and line numbers so the same test groups across commits', () => {
    expect(
      normalizeTestTitle('[chromium] › e2e/login.spec.ts:422:3 › Login matrix › reload keeps work')
    ).toBe('e2e/login.spec.ts › Login matrix › reload keeps work');
    expect(normalizeTestTitle('src/tests/sync.test.ts > Sync > keeps the record')).toBe(
      'src/tests/sync.test.ts > Sync > keeps the record'
    );
  });

  it('labels a job by its failing tests, else by its first failed step', () => {
    const testAnnotation = {
      annotation_level: 'failure',
      title: '[chromium] › e2e/login.spec.ts:82:3 › Login matrix › shows progress',
    };
    const exitAnnotation = { annotation_level: 'failure', title: '', message: 'exit code 1' };

    expect(
      describeJobFailure({
        conclusion: 'failure',
        failedSteps: ['Run suite', 'Upload evidence'],
        annotations: [exitAnnotation, testAnnotation, testAnnotation],
      })
    ).toEqual([{ kind: 'test', label: 'e2e/login.spec.ts › Login matrix › shows progress' }]);
    expect(
      describeJobFailure({
        conclusion: 'failure',
        failedSteps: ['Install browser', 'Upload evidence'],
        annotations: [exitAnnotation],
      })
    ).toEqual([{ kind: 'step', label: 'Install browser' }]);
    expect(describeJobFailure({ conclusion: null })).toEqual([
      { kind: 'step', label: '(job never finished)' },
    ]);
  });

  it('counts each attempt once per job and per failure, skipping aggregator jobs', () => {
    const flakyTest = {
      annotation_level: 'failure',
      title: '[chromium] › e2e/viewer.spec.ts:871:3 › Viewer › recovers failed cuts',
    };
    const sameTestAfterEdit = { ...flakyTest, title: flakyTest.title.replace(':871:3', ':1214:3') };
    const grouped = groupRecoveredFailures(
      [
        {
          runId: 1,
          attempt: 1,
          jobs: [
            {
              name: 'lane-dicom',
              conclusion: 'failure',
              failedSteps: ['Run lane'],
              annotations: [flakyTest],
            },
            {
              name: 'ci-summary',
              conclusion: 'failure',
              failedSteps: ['Enforce'],
              annotations: [],
            },
          ],
        },
        {
          runId: 2,
          attempt: 1,
          jobs: [
            {
              name: 'lane-dicom',
              conclusion: 'failure',
              failedSteps: ['Run lane'],
              annotations: [sameTestAfterEdit],
            },
            {
              name: 'e2e',
              conclusion: 'failure',
              failedSteps: ['Install browser'],
              annotations: [],
            },
          ],
        },
      ],
      { ignoreJobs: ['ci-summary'] }
    );

    expect(grouped.byJob).toEqual([
      { job: 'lane-dicom', count: 2, runs: ['1#1', '2#1'] },
      { job: 'e2e', count: 1, runs: ['2#1'] },
    ]);
    expect(grouped.byFailure).toEqual([
      {
        job: 'lane-dicom',
        kind: 'test',
        label: 'e2e/viewer.spec.ts › Viewer › recovers failed cuts',
        count: 2,
        runs: ['1#1', '2#1'],
      },
      { job: 'e2e', kind: 'step', label: 'Install browser', count: 1, runs: ['2#1'] },
    ]);

    const text = formatRerunReport({
      days: 7,
      totalRuns: 12,
      ignoreJobs: ['ci-summary'],
      recovered: [{}, {}],
      grouped,
    });
    expect(text).toContain('2 recovered failed attempt(s). Not counted: ci-summary.');
    expect(text).toContain('  2  lane-dicom :: e2e/viewer.spec.ts › Viewer › recovers failed cuts');
    expect(text).toContain('  1  e2e :: step: Install browser');
  });
});
