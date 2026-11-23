// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import governance from '../../../scripts/config/guardrail-governance.json';
import { assertTelemetryAccess, jobNeeds, parseWorkflow } from './workflowYamlTestSupport';

const workspaces: string[] = [];
const reportScript = path.resolve('scripts/report-ci-runtime-observed-profile.mjs');

const writeTempInput = (content: string) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-ci-runtime-test-'));
  workspaces.push(workspace);
  const reportDirectory = path.join(workspace, 'reports');
  fs.mkdirSync(reportDirectory);
  fs.mkdirSync(path.join(workspace, 'scripts/config'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'src/tests'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'scripts/config/unit-shard-balance.json'),
    JSON.stringify({
      shardCount: 4,
      durationSource: 'hints',
      perFileOverheadMs: 100,
      durationHints: [{ globs: ['src/tests/**'], estimatedDurationMs: 20 }],
    })
  );
  for (const name of ['a', 'b', 'c', 'd']) {
    fs.writeFileSync(path.join(workspace, `src/tests/${name}.test.ts`), '// synthetic');
  }
  const filePath = path.join(workspace, 'ci-runtime-observed-input.json');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
};

const runReportScript = (inputPath: string) =>
  execFileSync(process.execPath, [reportScript, '--input', inputPath], {
    cwd: path.dirname(inputPath),
    encoding: 'utf8',
    stdio: 'pipe',
  });

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

describe('CI runtime telemetry scripts', () => {
  it('fails with an actionable message when the observed input JSON is malformed', () => {
    const inputPath = writeTempInput('{bad json');

    expect(() => runReportScript(inputPath)).toThrow(
      /Could not parse .*ci-runtime-observed.* JSON/
    );
  });

  it('fails with an actionable message when the observed input does not contain a jobs array', () => {
    const inputPath = writeTempInput('{"jobs":{"not":"an-array"}}\n');

    expect(() => runReportScript(inputPath)).toThrow(
      /must be an array of jobs or an object with a jobs array/
    );
  });

  it('preserves collector source metadata in the generated report', () => {
    const inputPath = writeTempInput(
      JSON.stringify({
        source: {
          provider: 'github-actions',
          repository: 'DanielOpazoD/HHR-ServicioHospitalizados',
          runId: '28767128242',
          status: 'collected',
        },
        jobs: [
          {
            name: 'unit-risk-shard-1',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            startedAt: '2026-07-06T01:43:33Z',
            completedAt: '2026-07-06T01:47:27Z',
          },
          {
            name: 'unit-risk-shard-2',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            startedAt: '2026-07-06T01:43:32Z',
            completedAt: '2026-07-06T01:46:53Z',
          },
          {
            name: 'unit-risk-shard-3',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            startedAt: '2026-07-06T01:43:32Z',
            completedAt: '2026-07-06T01:47:05Z',
          },
          {
            name: 'unit-risk-shard-4',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            startedAt: '2026-07-06T01:43:31Z',
            completedAt: '2026-07-06T01:46:54Z',
          },
        ],
      })
    );

    runReportScript(inputPath);

    const reportDirectory = path.join(path.dirname(inputPath), 'reports');
    const report = JSON.parse(
      fs.readFileSync(path.join(reportDirectory, 'ci-runtime-observed-profile.json'), 'utf8')
    );
    expect(
      fs.readFileSync(path.join(reportDirectory, 'ci-runtime-observed-profile.md'), 'utf8')
    ).toContain('CI Runtime Observed Profile');
    expect(report.source).toMatchObject({
      inputPath,
      provider: 'github-actions',
      repository: 'DanielOpazoD/HHR-ServicioHospitalizados',
      runId: '28767128242',
      status: 'collected',
    });
    expect(report.comparison.summary.observedTotalDurationMs).toBeGreaterThan(0);
    // The historical snapshot copied above must not supply the active estimate.
    expect(report.comparison.summary.estimatedTotalDurationMs).toBe(480);
    expect(report.comparison.shards).toHaveLength(4);
    expect(
      fs.readFileSync(path.join(reportDirectory, 'ci-runtime-observed-profile.md'), 'utf8')
    ).toContain('- Estimated total:');
  });

  it('keeps reports from separate invocations in their own workspaces', () => {
    const firstInput = writeTempInput(JSON.stringify({ source: { runId: 'first' }, jobs: [] }));
    const secondInput = writeTempInput(JSON.stringify({ source: { runId: 'second' }, jobs: [] }));
    runReportScript(firstInput);
    const firstOutput = path.join(
      path.dirname(firstInput),
      'reports/ci-runtime-observed-profile.json'
    );
    const originalReport = fs.readFileSync(firstOutput, 'utf8');
    runReportScript(secondInput);
    const secondOutput = path.join(
      path.dirname(secondInput),
      'reports/ci-runtime-observed-profile.json'
    );

    expect(path.dirname(firstInput)).not.toBe(path.dirname(secondInput));
    expect(fs.readFileSync(firstOutput, 'utf8')).toBe(originalReport);
    expect(JSON.parse(originalReport).source.runId).toBe('first');
    expect(JSON.parse(fs.readFileSync(secondOutput, 'utf8')).source.runId).toBe('second');
  });
});

describe('CI telemetry semantic contract', () => {
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

  const readWorkflowText = () => fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8');

  it('validates current-run telemetry outside the historical-snapshot aggregate', () => {
    expect(governance.qualityAggregate.checks.map(check => check.id)).not.toContain(
      'check:ci-runtime-telemetry'
    );
    assertCurrentRunTelemetry(parseWorkflow(readWorkflowText()));
  });

  it.each(['check step', 'summary dependency'])('rejects removal of the %s', mutation => {
    const workflow = parseWorkflow(readWorkflowText());
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
    const reformatted = stringify(parseWorkflow(readWorkflowText()), {
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
