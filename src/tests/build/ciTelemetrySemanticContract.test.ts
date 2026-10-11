// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { assertTelemetryAccess, jobNeeds, parseWorkflow } from './workflowYamlTestSupport';
const readText = (file: string) => fs.readFileSync(file, 'utf8');
describe('CI telemetry semantic contract', () => {
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
