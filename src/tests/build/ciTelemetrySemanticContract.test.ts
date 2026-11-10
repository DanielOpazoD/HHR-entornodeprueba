// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import governance from '../../../scripts/config/guardrail-governance.json';
import { assertTelemetryAccess, jobNeeds, parseWorkflow } from './workflowYamlTestSupport';
const assertCurrentRunTelemetry = (workflow: ReturnType<typeof parseWorkflow>) => {
  const job = workflow.jobs['ci-runtime-telemetry'];
  const commands = [
    'npm run collect:ci-runtime-observed-input',
    'npm run report:ci-runtime-observed-profile',
    'npm run check:ci-runtime-telemetry',
  ];
  const steps = job.steps.filter(step => commands.includes(step.run ?? ''));
  expect(steps.map(step => step.run)).toEqual(commands);
  for (const step of steps) {
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
  }
  expect(jobNeeds(workflow.jobs['ci-strict-summary'])).toContain('ci-runtime-telemetry');
};

const readText = (file: string) => fs.readFileSync(file, 'utf8');
describe('CI telemetry semantic contract', () => {
  it('validates current-run telemetry outside the historical-snapshot aggregate', () => {
    expect(governance.qualityAggregate.checks.map(check => check.id)).not.toContain(
      'check:ci-runtime-telemetry'
    );
    assertCurrentRunTelemetry(parseWorkflow(readText('.github/workflows/ci-cd.yml')));
  });

  it.each(['check step', 'summary dependency'])('rejects removal of the %s', mutation => {
    const workflow = parseWorkflow(readText('.github/workflows/ci-cd.yml'));
    if (mutation === 'check step') {
      const job = workflow.jobs['ci-runtime-telemetry'];
      job.steps = job.steps.filter(step => step.run !== 'npm run check:ci-runtime-telemetry');
    } else {
      workflow.jobs['ci-strict-summary'].needs = jobNeeds(
        workflow.jobs['ci-strict-summary']
      ).filter(name => name !== 'ci-runtime-telemetry');
    }
    expect(() => assertCurrentRunTelemetry(workflow)).toThrow();
  });

  it('accepts reformatted telemetry YAML while enforcing dependencies and permissions', () => {
    const reformatted = stringify(parseWorkflow(readText('.github/workflows/ci-cd.yml')), {
      collectionStyle: 'block',
      defaultStringType: 'QUOTE_DOUBLE',
    });
    const job = parseWorkflow(reformatted).jobs['ci-runtime-telemetry'];
    assertTelemetryAccess(job);
    const withoutDependency = structuredClone(job);
    withoutDependency.needs = jobNeeds(job).filter(name => name !== 'rules-emulator');
    expect(() => assertTelemetryAccess(withoutDependency)).toThrow();
    const withoutPermission = structuredClone(job);
    delete withoutPermission.permissions?.actions;
    expect(() => assertTelemetryAccess(withoutPermission)).toThrow();
  });
});
