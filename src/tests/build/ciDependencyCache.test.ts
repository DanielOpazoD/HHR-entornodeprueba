import fs from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  collectTransitiveNeeds,
  parseWorkflowJobs,
} from '../../../scripts/ciArtifactContractSupport.mjs';
import { parseWorkflow } from './workflowYamlTestSupport';

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

it('reuses dependencies only after the existing producer, without changing gate dependencies', () => {
  const { jobs } = parseWorkflow(workflow);
  const reusable = Object.entries(jobs).filter(([, job]) =>
    job.steps.some(step => step.uses === './.github/actions/setup-ci-dependencies')
  );
  expect(reusable.map(([name]) => name).sort()).toEqual([
    'build',
    'lighthouse-ci',
    'quality-static-base',
    'quality-static-governance-snapshots',
  ]);
  const graph = parseWorkflowJobs(workflow);
  for (const [name, job] of reusable) {
    const setup = job.steps.find(step => step.uses === './.github/actions/setup-ci-dependencies')!;
    if (name === 'quality-static-base') {
      expect(setup.with?.['save-cache']).toBe('true');
    } else {
      expect(setup.with?.['save-cache']).not.toBe('true');
      expect(collectTransitiveNeeds(graph, name)).toContain('quality-static-base');
    }
    expect(job.steps.indexOf(setup)).toBeLessThan(
      job.steps.findIndex(step => step.run || step.uses?.startsWith('treosh/lighthouse-ci-action@'))
    );
  }
});
