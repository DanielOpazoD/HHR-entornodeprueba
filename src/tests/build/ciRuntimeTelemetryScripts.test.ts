import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempFiles: string[] = [];

const writeTempInput = (content: string) => {
  const filePath = path.join(os.tmpdir(), `ci-runtime-observed-${randomUUID()}.json`);
  fs.writeFileSync(filePath, content, 'utf8');
  tempFiles.push(filePath);
  return filePath;
};

const runReportScript = (inputPath: string) =>
  execFileSync(
    process.execPath,
    ['scripts/report-ci-runtime-observed-profile.mjs', '--input', inputPath],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
    }
  );

afterEach(() => {
  for (const filePath of tempFiles.splice(0)) {
    fs.rmSync(filePath, { force: true });
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

    const report = JSON.parse(fs.readFileSync('reports/ci-runtime-observed-profile.json', 'utf8'));
    expect(report.source).toMatchObject({
      inputPath,
      provider: 'github-actions',
      repository: 'DanielOpazoD/HHR-ServicioHospitalizados',
      runId: '28767128242',
      status: 'collected',
    });
    expect(report.comparison.summary.observedTotalDurationMs).toBeGreaterThan(0);
  });
});
