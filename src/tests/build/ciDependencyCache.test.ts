// @vitest-environment node
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

const workflow = fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8');
const actionPath = '.github/actions/setup-ci-dependencies/action.yml';
const action = parse(fs.readFileSync(actionPath, 'utf8'));

type Step = {
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, string>;
};
const steps: Step[] = action.runs.steps;

it('only skips a clean install after an exact, successful dependency restore', () => {
  const restore = steps.find(step => step.id === 'dependencies')!;
  const install = steps.find(step => step.run === 'npm ci')!;
  const image = steps.find(step => step.id === 'image')!;
  expect(image.run).toContain('${ImageOS:?}');
  expect(image.run).toContain('${ImageVersion:?}');
  expect(steps.indexOf(image)).toBeLessThan(steps.indexOf(restore));
  expect(restore.uses).toMatch(/^actions\/cache\/restore@/);
  expect(restore.with?.path).toBe('node_modules');
  expect(restore.with).not.toHaveProperty('restore-keys');
  for (const input of [
    'steps.image.outputs.version',
    'runner.os',
    'runner.arch',
    'steps.node.outputs.node-version',
    'package.json',
    'package-lock.json',
    '.npmrc',
    actionPath,
  ]) {
    expect(restore.with?.key).toContain(input);
  }
  expect(install.if).toBe(
    "steps.dependencies.outputs.cache-hit != 'true' || steps.dependencies.outcome != 'success'"
  );
  expect(install['continue-on-error']).not.toBe(true);
  // Cache outages may fall back, but installation errors must still fail the job.
  expect(restore['continue-on-error']).toBe(true);
  expect(steps.indexOf(restore)).toBeLessThan(steps.indexOf(install));
});

it('publishes only the pristine installation, before the calling job runs checks', () => {
  const save = steps.find(step => step.uses?.startsWith('actions/cache/save@'))!;
  expect(save.if).toBe(
    "inputs.save-cache == 'true' && steps.dependencies.outputs.cache-hit != 'true'"
  );
  expect(action.inputs['save-cache'].default).toBe('false');
  expect(save.with).toEqual({
    path: 'node_modules',
    key: '${{ steps.dependencies.outputs.cache-primary-key }}',
  });
  expect(save['continue-on-error']).toBe(true);
  expect(steps.indexOf(save)).toBeGreaterThan(steps.findIndex(step => step.run === 'npm ci'));
});

it('reuses exact dependencies across compatible jobs with only one pristine-cache writer', () => {
  const { jobs } = parseWorkflow(workflow);
  const reusable = Object.entries(jobs).filter(([, job]) =>
    job.steps.some(step => step.uses === './.github/actions/setup-ci-dependencies')
  );
  expect(reusable.map(([name]) => name).sort()).toEqual([
    'build',
    'census-startup-performance',
    'clinical-sync-release-gate',
    'critical-coverage-report',
    'docs-scope-gate',
    'e2e-critical-emulator',
    'final-confidence-and-readiness',
    'lighthouse-ci',
    'postmerge-evidence',
    'quality-static-base',
    'quality-static-dependent-groups',
    'quality-static-governance-snapshots',
    'quality-static-groups',
    'rules-emulator',
    'unit-risk-shards',
  ]);
  const writers = reusable.filter(([, job]) =>
    job.steps.some(step => step.with?.['save-cache'] === 'true')
  );
  expect(writers.map(([name]) => name)).toEqual(['quality-static-base']);
  for (const [, job] of reusable) {
    const setupIndex = job.steps.findIndex(
      step => step.uses === './.github/actions/setup-ci-dependencies'
    );
    const checkoutIndex = job.steps.findIndex(step => step.uses?.startsWith('actions/checkout@'));
    const firstCommandIndex = job.steps.findIndex(
      step =>
        /\b(?:npm|npx)\b/.test(step.run ?? '') ||
        step.uses?.startsWith('treosh/lighthouse-ci-action@')
    );
    expect(checkoutIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeGreaterThan(checkoutIndex);
    expect(firstCommandIndex).toBeGreaterThan(setupIndex);
    expect(job.steps.some(step => step.run === 'npm ci')).toBe(false);
  }
});

it('preserves docs-only conditions and parallel cold-miss fallbacks without a producer barrier', () => {
  const { jobs } = parseWorkflow(workflow);
  const docsSetup = jobs['docs-scope-gate'].steps.find(
    step => step.uses === './.github/actions/setup-ci-dependencies'
  );
  expect(docsSetup?.if).toBe("needs.ci-scope.outputs.scope == 'docs-only'");
  const independent = [
    'docs-scope-gate',
    'critical-coverage-report',
    'quality-static-groups',
    'clinical-sync-release-gate',
    'unit-risk-shards',
    'rules-emulator',
    'e2e-critical-emulator',
    'census-startup-performance',
  ];
  for (const name of independent) {
    expect(jobNeeds(jobs[name])).toEqual(['ci-scope']);
  }
  // Dedicated roots/toolchains must retain their own clean install contracts.
  const functions = jobs['functions-scope-gate'].steps;
  expect(functions.some(step => step.uses === './.github/actions/setup-ci-dependencies')).toBe(
    false
  );
  expect(functions.find(step => step.uses?.startsWith('actions/setup-node@'))?.with).toMatchObject({
    'node-version': '22',
    'cache-dependency-path': 'package-lock.json\nfunctions/package-lock.json\n',
  });
  expect(functions.some(step => step.run === 'npm ci')).toBe(true);
  expect(functions.some(step => step.run === 'npm ci --prefix functions')).toBe(true);
  const apiDocs = jobs.docs.steps;
  expect(
    apiDocs.find(step => step.uses?.startsWith('actions/setup-node@'))?.with?.['node-version']
  ).toBe('20');
  expect(apiDocs.some(step => step.run === 'npm ci')).toBe(true);
});
