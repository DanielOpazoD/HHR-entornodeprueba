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
  const aggregate = jobs['e2e-critical-emulator'];
  expect(aggregate.name).toBe('e2e-critical');
  expect(jobNeeds(aggregate)).toEqual(['ci-scope', 'e2e-critical-lanes']);
  expect(aggregate.if).toContain('always()');
  expect(aggregate.steps.some(step => step.run?.includes('test "$LANES_RESULT" = success'))).toBe(
    true
  );
});

import { criticalLaneSpecs, CRITICAL_LANES } from '../../../scripts/criticalE2ELanes.mjs';
import { mergeCriticalLaneReports } from '../../../scripts/criticalE2EMergeSupport.mjs';
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
  if (kind === 'producer') first.ci.job = 'e2e-critical-emulator';
  if (kind === 'attempt') first.ci.runAttempt = '2';
  if (kind === 'run') first.ci.runId = '456';
  if (kind === 'source') first.identity = { ...identity, gitSha: 'b'.repeat(40) };
  if (kind === 'arguments') first.command.push('--grep=some');
  if (kind === 'case-failure') first.exitCode = 1;
  if (kind === 'file-missing') first.report.suites.pop();
  expect(() => mergeCriticalLaneReports({ records: inputs, identity, ci, expected })).toThrow();
});
