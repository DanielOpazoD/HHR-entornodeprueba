// @vitest-environment node
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseWorkflow } from './workflowYamlTestSupport';

const actionPath = '.github/actions/setup-ci-chromium/action.yml';
const action = parse(fs.readFileSync(actionPath, 'utf8'));
const workflow = fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8');
const assertBrowserPreparation = (candidate: typeof action) => {
  const steps = candidate.runs.steps;
  const restore = steps.find((step: { id?: string }) => step.id === 'chromium');
  const install = steps.find(
    (step: { run?: string }) => step.run === 'npx playwright install --with-deps chromium'
  );
  const probe = steps.find((step: { name?: string }) => step.name === 'Verify Chromium can launch');
  const save = steps.find((step: { uses?: string }) =>
    step.uses?.startsWith('actions/cache/save@')
  );
  expect(restore.with).not.toHaveProperty('restore-keys');
  for (const fingerprint of [
    'steps.browser.outputs.image',
    'runner.os',
    'runner.arch',
    'steps.browser.outputs.version',
    actionPath,
  ])
    expect(restore.with.key).toContain(fingerprint);
  expect(install).toBeDefined();
  expect(install).not.toHaveProperty('if');
  expect(install['continue-on-error']).not.toBe(true);
  expect(probe).not.toHaveProperty('if');
  expect(probe.run).toContain('await chromium.launch()');
  expect(probe['continue-on-error']).not.toBe(true);
  expect(steps.indexOf(install)).toBeGreaterThan(steps.indexOf(restore));
  expect(steps.indexOf(probe)).toBeGreaterThan(steps.indexOf(install));
  expect(steps.indexOf(save)).toBeGreaterThan(steps.indexOf(probe));
};

it('always installs system dependencies and proves browser readiness before publishing an exact cache', () =>
  assertBrowserPreparation(action));
it('rejects a cache hit that skips mandatory browser preparation', () => {
  const mutated = structuredClone(action);
  mutated.runs.steps.find(
    (step: { run?: string }) => step.run === 'npx playwright install --with-deps chromium'
  ).if = "steps.chromium.outputs.cache-hit != 'true'";
  expect(() => assertBrowserPreparation(mutated)).toThrow();
});
it('shares Chromium preparation without dropping any browser gate', () => {
  const { jobs } = parseWorkflow(workflow);
  for (const name of ['build', 'e2e-critical-emulator', 'census-startup-performance']) {
    const steps = jobs[name].steps;
    const setup = steps.findIndex(step => step.uses === './.github/actions/setup-ci-chromium');
    expect(setup).toBeGreaterThan(
      steps.findIndex(step => step.uses === './.github/actions/setup-ci-dependencies')
    );
    const test = steps.findIndex(step =>
      /npm run (?:ci:preview-smoke:built|test:e2e:rayen-extension-runtime|test:e2e:census-performance)/.test(
        step.run || ''
      )
    );
    expect(test).toBeGreaterThan(setup);
  }
  expect(
    jobs['e2e-critical-emulator'].steps.some(step => step.run === 'npm run test:e2e:critical:ci')
  ).toBe(true);
  expect(
    jobs['e2e-critical-emulator'].steps.some(
      step => step.run === 'npm run test:e2e:census-remote-performance'
    )
  ).toBe(true);
  expect(jobs['census-startup-performance'].strategy?.matrix.environment).toEqual([
    'development',
    'production',
  ]);
});
