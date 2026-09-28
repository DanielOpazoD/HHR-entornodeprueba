import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
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
  expect(dependent.steps.some(step => step.if === "matrix.group == 'governance'")).toBe(true);
};

describe('CI static group scheduling', () => {
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
