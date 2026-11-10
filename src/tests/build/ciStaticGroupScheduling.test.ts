// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { selectQualitySteps } from '../../../scripts/qualityAggregateSupport.mjs';
import { jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

const source = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci-cd.yml'), 'utf8');
const assertScheduling = (workflow: string) => {
  const { jobs } = parseWorkflow(workflow);
  const independent = jobs['quality-static-groups'];
  const dependent = jobs['quality-static-dependent-groups'];
  expect(jobNeeds(independent)).toEqual(['ci-scope']);
  expect(independent.if).toBe("needs.ci-scope.outputs.scope == 'full'");
  expect(independent.strategy?.matrix.group).toEqual(['boundaries', 'security', 'size', 'tests']);
  expect(jobNeeds(dependent)).toEqual(['quality-static-governance-snapshots']);
  expect(dependent.strategy?.matrix.group).toEqual(['governance', 'reports']);
  expect(jobNeeds(jobs['quality-static']).sort()).toEqual(
    [
      'quality-static-governance-snapshots',
      'quality-static-groups',
      'quality-static-dependent-groups',
    ].sort()
  );
  for (const job of [independent, dependent]) {
    expect(job.name).toBe('quality-static-${{ matrix.group }}');
    expect(
      job.steps.some(step => step.run === 'npm run check:quality:group -- ${{ matrix.group }}')
    ).toBe(true);
  }
  const download = dependent.steps.findIndex(step => step.name === 'Download governance snapshots');
  const check = dependent.steps.findIndex(
    step => step.run === 'npm run check:quality:group -- ${{ matrix.group }}'
  );
  expect(download).toBeGreaterThanOrEqual(0);
  expect(download).toBeLessThan(check);
  expect(dependent.steps[download].if).toBeUndefined();
};

describe('CI static group scheduling', () => {
  it('runs lint and typecheck independently and waits for both before producing evidence', () => {
    const { jobs } = parseWorkflow(source);
    const base = jobs['quality-static-base'];
    expect(base.strategy?.matrix.check).toEqual(['lint', 'typecheck']);
    expect(base.strategy?.['fail-fast']).toBe(false);
    expect(
      base.steps.some(
        step =>
          step.run ===
          "npm run ${{ matrix.check }} ${{ matrix.check == 'lint' && '-- --max-warnings 0 --concurrency 2' || '' }}"
      )
    ).toBe(true);
    expect(jobNeeds(jobs['quality-static-governance-snapshots'])).toContain('quality-static-base');
    expect(jobNeeds(jobs.build)).toEqual(['quality-static-governance-snapshots']);
  });
  it('runs the unchecked-index gate through the quality aggregate, locally and in CI', () => {
    // `npm run check:quality` must catch what CI rejects: the gate lives in the aggregate only.
    const governance = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'scripts/config/guardrail-governance.json'), 'utf8')
    ) as { qualityAggregate: { checks: Array<{ id: string; group: string }> } };
    expect(governance.qualityAggregate.checks).toContainEqual({
      id: 'check:unchecked-index',
      group: 'type-safety',
    });
  });
  it('checks the installed extension source as a blocking step after dependency setup', () => {
    const readJson = (file: string) =>
      JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
    const checks = readJson('scripts/config/guardrail-governance.json').qualityAggregate.checks;
    const selected = selectQualitySteps(checks, { group: 'security' });
    expect(selected.filter(step => step.id === 'check:extension-source')).toEqual([
      { id: 'check:extension-source', group: 'hygiene' },
    ]);
    expect(readJson('package.json').scripts['check:extension-source']).toBe(
      'node scripts/check-extension-source.mjs'
    );
    const job = parseWorkflow(source).jobs['quality-static-groups'];
    expect(job.strategy?.matrix.group).toContain('security');
    const setup = job.steps.findIndex(
      step => step.uses === './.github/actions/setup-ci-dependencies'
    );
    const run = job.steps.findIndex(
      step => step.run === 'npm run check:quality:group -- ${{ matrix.group }}'
    );
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(run).toBeGreaterThan(setup);
  });
  it('generates API docs alongside the full test gates', () => {
    const docs = parseWorkflow(source).jobs.docs;
    expect(jobNeeds(docs)).toEqual(['ci-scope']);
    expect(docs.if).toBe("needs.ci-scope.outputs.scope == 'full'");
    expect(docs.steps.some(step => step.run === 'npm run docs:generate')).toBe(true);
  });
  it('preserves governed groups and their aggregate check', () => {
    assertScheduling(source);
  });
  it('accepts equivalent YAML block sequences and quoting', () => {
    assertScheduling(
      stringify(parseWorkflow(source), {
        collectionStyle: 'block',
        defaultStringType: 'QUOTE_DOUBLE',
      })
    );
  });
  it('rejects a removed scheduling dependency', () => {
    const workflow = parseWorkflow(source);
    workflow.jobs['quality-static'].needs = ['quality-static-groups'];
    expect(() => assertScheduling(stringify(workflow))).toThrow();
  });
});
