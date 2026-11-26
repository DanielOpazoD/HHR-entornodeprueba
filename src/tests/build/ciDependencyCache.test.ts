// @vitest-environment node
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  collectTransitiveNeeds,
  parseWorkflowJobs,
} from '../../../scripts/ciArtifactContractSupport.mjs';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

const workflow = fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8');
const nightlyWorkflowFiles = [
  '.github/workflows/nightly-test-runtime.yml',
  '.github/workflows/nightly-census-visual.yml',
];
const actionPath = '.github/actions/setup-ci-dependencies/action.yml';
const action = parse(fs.readFileSync(actionPath, 'utf8'));

type Step = {
  name?: string;
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

it('reuses exact dependencies across compatible jobs with one PR-phase writer per image and post-merge main publication', () => {
  const { jobs } = parseWorkflow(workflow);
  const reusable = Object.entries(jobs).filter(([, job]) =>
    job.steps.some(step => step.uses === './.github/actions/setup-ci-dependencies')
  );
  expect(reusable.length).toBeGreaterThan(0);
  const isWriter = (job: (typeof reusable)[number][1]) =>
    job.steps.some(step => {
      const saveCache = String(step.with?.['save-cache'] ?? '');
      return saveCache === 'true' || saveCache.includes("'true'");
    });
  const isMainPushOnly = (job: (typeof reusable)[number][1]) =>
    Boolean(
      job.if?.includes("github.event_name == 'push'") &&
      job.if?.includes("github.ref == 'refs/heads/main'")
    );
  const writers = reusable.filter(([, job]) => isWriter(job));
  const prPhaseWriters = writers.filter(([, job]) => !isMainPushOnly(job));
  const mainOnlyWriters = writers.filter(([, job]) => isMainPushOnly(job));
  // The restore key includes the runner image: every image used by a consumer
  // needs exactly one PR-phase writer so parallel jobs never race on cache saves.
  const imageOf = (job: (typeof reusable)[number][1]) => String(job['runs-on']);
  const consumerImages = new Set(reusable.map(([, job]) => imageOf(job)));
  expect([...consumerImages].sort()).toEqual(['ubuntu-24.04', 'ubuntu-latest']);
  for (const image of consumerImages) {
    expect(
      prPhaseWriters.filter(([, job]) => imageOf(job) === image).map(([name]) => name),
      `PR-phase pristine writers for ${image}`
    ).toHaveLength(1);
  }
  expect(prPhaseWriters.map(([name]) => name).sort()).toEqual([
    'quality-static-base',
    'rules-emulator',
  ]);
  expect(jobs['quality-static-base'].steps.find(step => step.with?.['save-cache'])?.with).toEqual({
    'save-cache': "${{ matrix.check == 'lint' && 'true' || 'false' }}",
  });
  expect(jobs['rules-emulator'].steps.find(step => step.with?.['save-cache'])?.with).toEqual({
    'save-cache': 'true',
  });
  // Reused-evidence main pushes skip quality-static-base (lint), so postmerge-evidence
  // publishes main's ubuntu-latest cache strictly after ci-strict-summary (never racing lint).
  expect(mainOnlyWriters.map(([name]) => name)).toEqual(['postmerge-evidence']);
  expect(imageOf(jobs['postmerge-evidence'])).toBe('ubuntu-latest');
  expect(jobs['postmerge-evidence'].steps.find(step => step.with?.['save-cache'])?.with).toEqual({
    'save-cache': 'true',
  });
  expect(collectTransitiveNeeds(parseWorkflowJobs(workflow), 'postmerge-evidence')).toContain(
    'quality-static-base'
  );
  for (const [, job] of reusable) {
    const setupIndex = job.steps.findIndex(
      step => step.uses === './.github/actions/setup-ci-dependencies'
    );
    const checkoutIndex = job.steps.findIndex(step => step.uses?.startsWith('actions/checkout@'));
    const firstCommandIndex = job.steps.findIndex(
      step =>
        /\b(?:npm|npx|node)\b/.test(step.run ?? '') ||
        step.uses?.startsWith('treosh/lighthouse-ci-action@')
    );
    expect(checkoutIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeGreaterThan(checkoutIndex);
    expect(firstCommandIndex).toBeGreaterThan(setupIndex);
    expect(job.steps.some(step => step.run === 'npm ci')).toBe(false);
  }
});

it('publishes and reuses the exact ubuntu-24.04 dependency cache across nightly main workflows', () => {
  const nightlyJobs = nightlyWorkflowFiles.flatMap(file => {
    const text = fs.readFileSync(file, 'utf8');
    const raw = parse(text);
    expect(raw.on?.schedule, `${file} schedule trigger`).toBeTruthy();
    return Object.entries(parseWorkflow(text).jobs).map(([jobName, job]) => ({
      file,
      jobName,
      job,
    }));
  });

  expect(nightlyJobs.map(entry => entry.jobName).sort()).toEqual([
    'nightly-census-visual',
    'nightly-runtime-governance',
    'nightly-sync-model',
  ]);

  const writers = nightlyJobs.filter(({ job }) =>
    job.steps.some(step => {
      const saveCache = String(step.with?.['save-cache'] ?? '');
      return saveCache === 'true' || saveCache.includes("'true'");
    })
  );
  expect(writers.map(entry => entry.jobName)).toEqual(['nightly-sync-model']);
  expect(
    writers[0].job.steps.find(step => step.uses === './.github/actions/setup-ci-dependencies')?.with
  ).toEqual({
    'save-cache': 'true',
  });

  for (const { file, jobName, job } of nightlyJobs) {
    const label = `${file}#${jobName}`;
    expect(String(job['runs-on']), label).toBe('ubuntu-24.04');
    const setupIndex = job.steps.findIndex(
      step => step.uses === './.github/actions/setup-ci-dependencies'
    );
    expect(setupIndex, label).toBeGreaterThanOrEqual(0);
    expect(job.steps[setupIndex].if, label).toBeUndefined();
    const checkoutIndex = job.steps.findIndex(step => step.uses?.startsWith('actions/checkout@'));
    expect(checkoutIndex, label).toBeGreaterThanOrEqual(0);
    expect(setupIndex, label).toBeGreaterThan(checkoutIndex);
    const firstDependentIndex = job.steps.findIndex(
      step =>
        /\b(?:npm|npx|node)\b/.test(step.run ?? '') ||
        step.uses === './.github/actions/setup-ci-chromium' ||
        step.uses === './.github/actions/setup-ci-firestore-emulator'
    );
    expect(firstDependentIndex, label).toBeGreaterThan(setupIndex);
    expect(
      job.steps.some(step => step.run === 'npm ci'),
      label
    ).toBe(false);
    expect(
      job.steps.some(step => step.uses?.startsWith('actions/setup-node@')),
      label
    ).toBe(false);
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
    'critical-coverage-shards',
    'quality-static-groups',
    'clinical-sync-release-gate',
    'unit-risk-shards',
    'rules-emulator',
    'e2e-critical-lanes',
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
  expect(steps.find(step => step.id === 'node')?.with?.['node-version']).toBe('22');
});

it('restores npm downloads only when an exact installed dependency restore cannot be used', () => {
  const activate = steps.find(step => step.id === 'node')!;
  const restore = steps.find(step => step.id === 'dependencies')!;
  const downloads = steps.find(
    step => step.name === 'Restore npm downloads for a clean installation'
  )!;
  const install = steps.find(step => step.run === 'npm ci')!;
  expect(activate.with).not.toHaveProperty('cache');
  expect(activate['continue-on-error']).not.toBe(true);
  expect(downloads.if).toBe(install.if);
  expect(downloads.with).toEqual({
    'node-version': '${{ steps.node.outputs.node-version }}',
    cache: 'npm',
  });
  expect(downloads['continue-on-error']).toBe(true);
  expect(steps.indexOf(downloads)).toBeGreaterThan(steps.indexOf(restore));
  expect(steps.indexOf(downloads)).toBeLessThan(steps.indexOf(install));
  expect(install['continue-on-error']).not.toBe(true);
});
