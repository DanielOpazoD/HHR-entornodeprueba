// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

type Scope = 'full' | 'docs-only' | 'functions-only' | 'tooling-only' | 'reused';
type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped' | '';
type Prerequisite = 'ci-scope' | 'docs-scope-gate' | 'functions-scope-gate' | 'tooling-scope-gate';
type Gate =
  | 'quality-static'
  | 'unit-risk'
  | 'clinical-sync-release-gate'
  | 'rules-emulator'
  | 'emulator-ui'
  | 'e2e-critical-lanes'
  | 'build'
  | 'preview-smoke-lanes'
  | 'final-confidence-and-readiness'
  | 'ci-runtime-telemetry'
  | 'census-startup-performance';
type InvalidOutcome = { job: Prerequisite | Gate; result: JobResult };

const prerequisites: readonly Prerequisite[] = [
  'ci-scope',
  'docs-scope-gate',
  'functions-scope-gate',
  'tooling-scope-gate',
];
const gates: readonly Gate[] = [
  'quality-static',
  'unit-risk',
  'clinical-sync-release-gate',
  'rules-emulator',
  'emulator-ui',
  'e2e-critical-lanes',
  'build',
  'preview-smoke-lanes',
  'final-confidence-and-readiness',
  'ci-runtime-telemetry',
  'census-startup-performance',
];
const expectedEnvironment = {
  CI_SCOPE_RESULT: "${{ needs['ci-scope'].result }}",
  CI_SCOPE: "${{ needs['ci-scope'].outputs.scope }}",
  DOCS_SCOPE_GATE_RESULT: "${{ needs['docs-scope-gate'].result }}",
  FUNCTIONS_SCOPE_GATE_RESULT: "${{ needs['functions-scope-gate'].result }}",
  TOOLING_SCOPE_GATE_RESULT: "${{ needs['tooling-scope-gate'].result }}",
  QUALITY_STATIC_RESULT: "${{ needs['quality-static'].result }}",
  UNIT_RISK_RESULT: "${{ needs['unit-risk'].result }}",
  CLINICAL_SYNC_RESULT: "${{ needs['clinical-sync-release-gate'].result }}",
  RULES_EMULATOR_RESULT: "${{ needs['rules-emulator'].result }}",
  EMULATOR_UI_RESULT: "${{ needs['emulator-ui'].result }}",
  E2E_CRITICAL_RESULT: "${{ needs['e2e-critical-lanes'].result }}",
  BUILD_RESULT: '${{ needs.build.result }}',
  PREVIEW_SMOKE_RESULT: "${{ needs['preview-smoke-lanes'].result }}",
  FINAL_CONFIDENCE_RESULT: "${{ needs['final-confidence-and-readiness'].result }}",
  CI_RUNTIME_TELEMETRY_RESULT: "${{ needs['ci-runtime-telemetry'].result }}",
  CENSUS_PERFORMANCE_RESULT: "${{ needs['census-startup-performance'].result }}",
  CI_EVIDENCE_RUN_ID: "${{ needs['ci-scope'].outputs.evidence-run-id }}",
  CI_EVIDENCE_RUN_ATTEMPT: "${{ needs['ci-scope'].outputs.evidence-run-attempt }}",
  CI_EVIDENCE_COMMIT: "${{ needs['ci-scope'].outputs.evidence-commit }}",
  CI_EVIDENCE_TREE: "${{ needs['ci-scope'].outputs.evidence-tree }}",
};
// What ci-scope declares for a main push that reuses a pull request run.
const reusedEvidence: Record<string, string> = {
  'evidence-run-id': '100',
  'evidence-run-attempt': '2',
  'evidence-commit': 'e'.repeat(40),
  'evidence-tree': 'c'.repeat(40),
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
  evidence = scope === 'reused' ? reusedEvidence : {},
}: {
  scope: Scope | 'unexpected';
  gateResult: 'success' | 'skipped';
  override?: InvalidOutcome;
  evidence?: Record<string, string>;
}) => {
  const results = new Map<string, JobResult>();
  for (const job of prerequisites) results.set(job, 'success');
  for (const job of gates) results.set(job, gateResult);
  if (override) results.set(override.job, override.result);
  const env = Object.fromEntries(
    Object.entries(summaryJob.env ?? {}).map(([variable, expression]) => {
      if (expression === "${{ needs['ci-scope'].outputs.scope }}") return [variable, scope];
      const output = expression.match(
        /^\$\{\{ needs\['ci-scope'\]\.outputs\.(evidence-[\w-]+) \}\}$/
      );
      if (output) return [variable, evidence[output[1]] ?? ''];
      const match = expression.match(/^\$\{\{\s*needs(?:\['([^']+)'\]|\.([\w-]+))\.result\s*\}\}$/);
      const job = match?.[1] ?? match?.[2];
      const result = job === undefined ? undefined : results.get(job);
      if (result === undefined) throw new Error(`Unsupported CI summary expression: ${expression}`);
      return [variable, result];
    })
  );
  const script = executableSteps[0]?.run;
  if (typeof script !== 'string') throw new Error('CI summary has no executable step');
  const summaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-summary-'));
  const summaryFile = path.join(summaryDir, 'summary.md');
  const execution = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'owner/hhr',
        GITHUB_SHA: 'a'.repeat(40),
        ...env,
      },
      timeout: 5000,
    }
  );
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
  fs.rmSync(summaryDir, { recursive: true, force: true });
  expect(execution.error).toBeUndefined();
  expect(execution.signal).toBeNull();
  expect(execution.stderr).toBe('');
  return { ...execution, summary };
};

describe('CI summary governance', () => {
  it('rejects an unknown scope even when all jobs succeed', () => {
    expect(runSummary({ scope: 'unexpected', gateResult: 'success' }).status).toBe(1);
  });

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

  describe.each<Exclude<Scope, 'full'>>(['docs-only', 'functions-only', 'tooling-only', 'reused'])(
    '%s scope',
    scope => {
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
    }
  );

  it('names the reused run, commit and tree in the summary of a reused main push', () => {
    const execution = runSummary({ scope: 'reused', gateResult: 'skipped' });
    expect(execution.status).toBe(0);
    expect(execution.summary).toContain('https://github.com/owner/hhr/actions/runs/100');
    expect(execution.summary).toContain('intento 2');
    expect(execution.summary).toContain('e'.repeat(40));
    expect(execution.summary).toContain('c'.repeat(40));
    expect(runSummary({ scope: 'full', gateResult: 'success' }).summary).toBe('');
  });

  it.each(Object.keys(reusedEvidence))('rejects a reused main push without its %s', output => {
    const execution = runSummary({
      scope: 'reused',
      gateResult: 'skipped',
      evidence: { ...reusedEvidence, [output]: '' },
    });
    expect(execution.status).toBe(1);
    expect(execution.stdout).toContain(
      'Reused CI evidence does not name its run, attempt, commit and tree.'
    );
  });
});
