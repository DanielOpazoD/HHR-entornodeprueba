// @vitest-environment node
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { parseWorkflow, jobNeeds } from './workflowYamlTestSupport';

it('runs three isolated lanes and rejects any failed or absent lane before publishing evidence', () => {
  const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
  expect(jobs['e2e-critical-lanes']?.strategy).toEqual({
    'fail-fast': false,
    matrix: { lane: ['1', '2', '3'] },
  });
  const aggregate = jobs['final-confidence-and-readiness'];
  expect(jobNeeds(aggregate)).toContain('e2e-critical-lanes');
  expect(aggregate.if).toContain('!cancelled()');
  const merge = aggregate.steps.find(step =>
    step.run?.includes('node scripts/merge-critical-e2e-lanes.mjs')
  );
  expect(merge?.run).toContain('test "$LANES_RESULT" = success');
  // Merged even when another family already failed, so lane diagnostics are uploaded.
  expect(merge?.if).toBe('${{ !cancelled() }}');
});

import { criticalLaneSpecs, CRITICAL_LANES } from '../../../scripts/criticalE2ELanes.mjs';
import {
  mergeCriticalLaneReports,
  selectLatestLaneArtifacts,
} from '../../../scripts/criticalE2EMergeSupport.mjs';
import { buildRequiredCiSuites } from '../../../scripts/testExecutionManifestSupport.mjs';

const identity = { gitSha: 'a'.repeat(40), sourceFingerprint: 'synthetic', worktreeDirty: false };
const ci = { runId: '123', runAttempt: '1' };
const expected = buildRequiredCiSuites(process.cwd()).filter(suite => suite.kind === 'playwright');
const records = () =>
  expected.map(suite => ({
    schemaVersion: 1,
    suiteId: suite.suiteId,
    kind: 'playwright',
    mode: 'execution',
    identity,
    sourceUnchanged: true,
    ci: { ...ci, job: suite.job },
    command: ['npm', 'run', suite.script, ...('args' in suite ? suite.args : [])],
    exitCode: 0,
    report: {
      suites: suite.files.map((file: string) => ({
        file,
        specs: [
          {
            id: file,
            file,
            title: 'synthetic case',
            tests: [
              {
                projectName: 'chromium',
                status: 'expected',
                results: [{ status: 'passed', duration: 10 }],
              },
            ],
          },
        ],
      })),
      errors: [],
      stats: { expected: suite.files.length, unexpected: 0, flaky: 0, skipped: 0, duration: 10 },
    },
  }));

it('preserves the canonical file selection once and retains original case results in the union', () => {
  const files = CRITICAL_LANES.flatMap(lane => criticalLaneSpecs(lane));
  expect(new Set(files).size).toBe(20);
  expect(files).toHaveLength(20);
  const report = mergeCriticalLaneReports({ records: records(), identity, ci, expected });
  expect(report.suites).toHaveLength(20);
  expect(report.stats.expected).toBe(20);
});

it.each([
  {
    case: 'run 43730132130 after re-running only lane 3',
    names: [
      'e2e-critical-emulator-artifacts',
      'e2e-critical-lane-2-3',
      'e2e-critical-lane-1-1',
      'e2e-critical-lane-1-2',
    ],
    current: '2',
    chosen: ['e2e-critical-lane-1-1', 'e2e-critical-lane-1-2', 'e2e-critical-lane-2-3'],
  },
  {
    case: 'a newer attempt of a lane over an older one, in any order',
    names: [
      'e2e-critical-lane-3-2',
      'e2e-critical-lane-1-2',
      'e2e-critical-lane-1-3',
      'e2e-critical-lane-1-1',
      'e2e-critical-lane-2-3',
      'e2e-critical-lane-10-1',
    ],
    current: '10',
    chosen: ['e2e-critical-lane-10-1', 'e2e-critical-lane-3-2', 'e2e-critical-lane-2-3'],
  },
])('takes each lane from its newest attempt: $case', ({ names, current, chosen }) => {
  expect(
    selectLatestLaneArtifacts(names, CRITICAL_LANES, current).map(artifact => artifact.name)
  ).toEqual(chosen);
});

it.each([
  {
    case: 'a lane with no evidence in any attempt',
    names: ['e2e-critical-lane-1-1', 'e2e-critical-lane-2-3', 'e2e-critical-lane-2-1x'],
    current: '2',
    error: 'Lane 2 has no evidence in this run',
  },
  {
    case: 'an artifact newer than the current attempt',
    names: ['e2e-critical-lane-1-1', 'e2e-critical-lane-1-2', 'e2e-critical-lane-3-3'],
    current: '2',
    error: 'e2e-critical-lane-3-3 is newer than the current attempt',
  },
  {
    case: 'an unknown current attempt',
    names: ['e2e-critical-lane-1-1', 'e2e-critical-lane-1-2', 'e2e-critical-lane-1-3'],
    current: undefined,
    error: 'Invalid current run attempt',
  },
])('rejects $case', ({ names, current, error }) => {
  expect(() => selectLatestLaneArtifacts(names, CRITICAL_LANES, current)).toThrow(error);
});

it.each([
  'missing',
  'duplicate',
  'producer',
  'attempt',
  'run',
  'source',
  'arguments',
  'case-failure',
  'file-missing',
])('rejects invalid original lane evidence: %s', kind => {
  const inputs = records();
  const first = inputs[0];
  if (kind === 'missing') inputs.shift();
  if (kind === 'duplicate') inputs.push(first);
  if (kind === 'producer') first.ci.job = 'final-confidence-and-readiness';
  if (kind === 'attempt') first.ci.runAttempt = '2';
  if (kind === 'run') first.ci.runId = '456';
  if (kind === 'source') first.identity = { ...identity, gitSha: 'b'.repeat(40) };
  if (kind === 'arguments') first.command.push('--grep=some');
  if (kind === 'case-failure') first.exitCode = 1;
  if (kind === 'file-missing') first.report.suites.pop();
  expect(() => mergeCriticalLaneReports({ records: inputs, identity, ci, expected })).toThrow();
});

it('preserves execution and performance artifact names and extraction paths for all consumers', () => {
  const { jobs } = parseWorkflow(fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8'));
  const aggregate = jobs['final-confidence-and-readiness'];
  const at = (match: (step: (typeof aggregate.steps)[number]) => boolean) =>
    aggregate.steps.findIndex(match);
  // The merge writes critical, flow and CUDYR evidence where the manifest reads it, in the
  // same job; the E2E diagnostics artifact keeps those merged files.
  const merge = at(step => Boolean(step.run?.includes('merge-critical-e2e-lanes.mjs')));
  const manifest = at(step =>
    Boolean(step.run?.includes('npm run report:test-execution-manifest'))
  );
  expect(merge).toBeGreaterThan(-1);
  expect(manifest).toBeGreaterThan(merge);
  const diagnostics = aggregate.steps.find(
    step => step.with?.name === 'e2e-critical-emulator-artifacts'
  );
  for (const suite of ['critical', 'flow', 'cudyr'])
    expect(String(diagnostics?.with?.path).split('\n')).toContain(
      `reports/execution/${suite}.evidence.json`
    );
  const evidence = aggregate.steps.find(step => step.with?.pattern === 'test-execution-evidence-*');
  expect(evidence?.with).toEqual({
    pattern: 'test-execution-evidence-*',
    path: 'reports/execution',
    'merge-multiple': true,
  });
  expect(aggregate.steps.indexOf(evidence!)).toBeGreaterThan(merge);
  expect(aggregate.steps.indexOf(evidence!)).toBeLessThan(manifest);
  for (const lane of CRITICAL_LANES) {
    const name = `e2e-critical-lane-\${{ github.run_attempt }}-${lane}`;
    const upload = jobs['e2e-critical-lanes'].steps.find(step => step.with?.name === name);
    expect(String(upload?.with?.path)).toContain('reports/e2e/**');
    expect(String(upload?.with?.path)).toContain('reports/execution/**');
  }
  // One folder per artifact of every attempt, so the merge can pick each lane's newest.
  const laneDownload = aggregate.steps.find(step => step.with?.pattern === 'e2e-critical-lane-*');
  expect(laneDownload?.uses).toContain('actions/download-artifact@');
  expect(laneDownload?.with).toEqual({
    pattern: 'e2e-critical-lane-*',
    path: 'reports/critical-lanes',
  });
  const performance = aggregate.steps.find(step => step.with?.name === 'flow-performance-evidence');
  expect(String(performance?.with?.path).trim().split('\n')).toEqual([
    'reports/e2e/flow-performance-budget.json',
    'reports/e2e/flow-performance-budget-summary.json',
    'reports/e2e/flow-performance-budget.md',
    'reports/e2e/flow-performance-playwright-report.json',
  ]);
  const postmerge = jobs['postmerge-evidence'];
  expect(jobNeeds(postmerge)).toContain('final-confidence-and-readiness');
  const download = postmerge.steps.find(step => step.with?.name === 'flow-performance-evidence');
  expect(download?.with?.path).toBe('reports/e2e');
});
