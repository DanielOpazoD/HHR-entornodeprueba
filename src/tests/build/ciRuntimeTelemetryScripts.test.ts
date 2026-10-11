// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const workspaces: string[] = [];
const reportScript = path.resolve('scripts/report-ci-runtime-observed-profile.mjs');

const writeTempInput = (content: string) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-ci-runtime-test-'));
  workspaces.push(workspace);
  const reportDirectory = path.join(workspace, 'reports');
  fs.mkdirSync(reportDirectory);
  fs.copyFileSync(
    path.resolve('reports/unit-shard-runtime-profile.json'),
    path.join(reportDirectory, 'unit-shard-runtime-profile.json')
  );
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
    expect(report.comparison.summary.estimatedTotalDurationMs).toBeGreaterThan(0);
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
