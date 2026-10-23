// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

type Scope = 'full' | 'docs-only' | 'functions-only';
type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped' | '';
type Prerequisite = 'ci-scope' | 'docs-scope-gate' | 'functions-scope-gate';
type Gate =
  | 'quality-static'
  | 'unit-risk'
  | 'test-execution-manifest'
  | 'clinical-sync-release-gate'
  | 'rules-emulator'
  | 'e2e-critical-emulator'
  | 'build'
  | 'preview-smoke'
  | 'final-confidence-and-readiness'
  | 'ci-runtime-telemetry'
  | 'census-startup-performance';
type InvalidOutcome = { job: Prerequisite | Gate; result: JobResult };

const prerequisites: readonly Prerequisite[] = [
  'ci-scope',
  'docs-scope-gate',
  'functions-scope-gate',
];
const gates: readonly Gate[] = [
  'quality-static',
  'unit-risk',
  'test-execution-manifest',
  'clinical-sync-release-gate',
  'rules-emulator',
  'e2e-critical-emulator',
  'build',
  'preview-smoke',
  'final-confidence-and-readiness',
  'ci-runtime-telemetry',
  'census-startup-performance',
];
const expectedEnvironment = {
  CI_SCOPE_RESULT: "${{ needs['ci-scope'].result }}",
  CI_SCOPE: "${{ needs['ci-scope'].outputs.scope }}",
  DOCS_SCOPE_GATE_RESULT: "${{ needs['docs-scope-gate'].result }}",
  FUNCTIONS_SCOPE_GATE_RESULT: "${{ needs['functions-scope-gate'].result }}",
  QUALITY_STATIC_RESULT: "${{ needs['quality-static'].result }}",
  TEST_EXECUTION_RESULT: "${{ needs['test-execution-manifest'].result }}",
  UNIT_RISK_RESULT: "${{ needs['unit-risk'].result }}",
  CLINICAL_SYNC_RESULT: "${{ needs['clinical-sync-release-gate'].result }}",
  RULES_EMULATOR_RESULT: "${{ needs['rules-emulator'].result }}",
  E2E_CRITICAL_RESULT: "${{ needs['e2e-critical-emulator'].result }}",
  BUILD_RESULT: '${{ needs.build.result }}',
  PREVIEW_SMOKE_RESULT: "${{ needs['preview-smoke'].result }}",
  FINAL_CONFIDENCE_RESULT: "${{ needs['final-confidence-and-readiness'].result }}",
  CI_RUNTIME_TELEMETRY_RESULT: "${{ needs['ci-runtime-telemetry'].result }}",
  CENSUS_PERFORMANCE_RESULT: "${{ needs['census-startup-performance'].result }}",
};
const summaryJob = parseWorkflow(
  fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8')
).jobs['ci-strict-summary'];
const executableSteps = summaryJob.steps.filter(step => typeof step.run === 'string');
const prerequisiteFailures: readonly JobResult[] = ['failure', 'cancelled', 'skipped', ''];
const focusedGateFailures: readonly JobResult[] = ['success', 'failure', 'cancelled', ''];
const fullInvalidOutcomes: InvalidOutcome[] = [...prerequisites, ...gates].flatMap(job =>
  prerequisiteFailures.map(result => ({ job, result }))
);
const focusedInvalidOutcomes: InvalidOutcome[] = [
  ...prerequisites.flatMap(job => prerequisiteFailures.map(result => ({ job, result }))),
  ...gates.flatMap(job => focusedGateFailures.map(result => ({ job, result }))),
];

const runSummary = ({
  scope,
  gateResult,
  override,
}: {
  scope: Scope;
  gateResult: 'success' | 'skipped';
  override?: InvalidOutcome;
}) => {
  const results = new Map<string, JobResult>();
  for (const job of prerequisites) results.set(job, 'success');
  for (const job of gates) results.set(job, gateResult);
  if (override) results.set(override.job, override.result);
  const env = Object.fromEntries(
    Object.entries(summaryJob.env ?? {}).map(([variable, expression]) => {
      if (expression === "${{ needs['ci-scope'].outputs.scope }}") return [variable, scope];
      const match = expression.match(/^\$\{\{\s*needs(?:\['([^']+)'\]|\.([\w-]+))\.result\s*\}\}$/);
      const job = match?.[1] ?? match?.[2];
      const result = job === undefined ? undefined : results.get(job);
      if (result === undefined) throw new Error(`Unsupported CI summary expression: ${expression}`);
      return [variable, result];
    })
  );
  const script = executableSteps[0]?.run;
  if (typeof script !== 'string') throw new Error('CI summary has no executable step');
  const execution = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env },
      timeout: 5000,
    }
  );
  expect(execution.error).toBeUndefined();
  expect(execution.signal).toBeNull();
  expect(execution.stderr).toBe('');
  return execution;
};

describe('CI summary governance', () => {
  it('always observes all prerequisites and gates through their actual needs results', () => {
    expect(summaryJob.if).toBe('${{ always() }}');
    expect([...jobNeeds(summaryJob)].sort()).toEqual([...prerequisites, ...gates].sort());
    expect(summaryJob.env).toEqual(expectedEnvironment);
    expect(summaryJob).not.toHaveProperty('continue-on-error');
    expect(executableSteps).toHaveLength(1);
    expect(executableSteps[0]).toMatchObject({ shell: 'bash' });
    expect(executableSteps[0]).not.toHaveProperty('continue-on-error');
    expect(executableSteps[0]).not.toHaveProperty('if');
  });

  it('accepts full scope only with every required result successful', () => {
    const execution = runSummary({ scope: 'full', gateResult: 'success' });
    expect(execution.status).toBe(0);
    expect(execution.stdout.trim().split('\n').sort()).toEqual(
      gates.map(job => `${job}: success`).sort()
    );
  });

  it.each(fullInvalidOutcomes)('rejects full scope when $job is "$result"', override => {
    const execution = runSummary({ scope: 'full', gateResult: 'success', override });
    expect(execution.status).toBe(1);
    expect(execution.stdout).toMatch(/::error::.+/);
    if (gates.some(job => job === override.job)) {
      expect(execution.stdout.split('\n')).toContain(`${override.job}: ${override.result}`);
    }
  });

  describe.each<Exclude<Scope, 'full'>>(['docs-only', 'functions-only'])('%s scope', scope => {
    it('accepts successful prerequisites and all eleven gates skipped', () => {
      const execution = runSummary({ scope, gateResult: 'skipped' });
      expect(execution.status).toBe(0);
      expect(execution.stdout.trim().split('\n').sort()).toEqual(
        gates.map(job => `${job}: skipped`).sort()
      );
    });

    it.each(focusedInvalidOutcomes)('rejects $job with result "$result"', override => {
      const execution = runSummary({ scope, gateResult: 'skipped', override });
      expect(execution.status).toBe(1);
      expect(execution.stdout).toMatch(/::error::.+/);
      if (gates.some(job => job === override.job)) {
        expect(execution.stdout.split('\n')).toContain(`${override.job}: ${override.result}`);
      }
    });
  });
});
