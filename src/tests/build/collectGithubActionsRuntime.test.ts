// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildGithubActionsJobsUrl,
  collectGithubActionsRuntimeInput,
  normalizeGithubActionsJob,
} from '../../../scripts/collect-github-actions-runtime.mjs';

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ci-runtime-${randomUUID()}-`));
  tempDirs.push(dir);
  return dir;
};

const makeResponse = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Server Error',
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('collect GitHub Actions runtime', () => {
  it('normalizes GitHub Actions jobs into the observed runtime input contract', () => {
    expect(
      normalizeGithubActionsJob({
        name: 'unit-risk-shard-1',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-07-06T01:43:33Z',
        completed_at: '2026-07-06T01:47:27Z',
      })
    ).toEqual({
      name: 'unit-risk-shard-1',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      startedAt: '2026-07-06T01:43:33Z',
      completedAt: '2026-07-06T01:47:27Z',
    });
  });

  it('builds the GitHub jobs endpoint from repository and run id', () => {
    expect(
      buildGithubActionsJobsUrl({
        apiUrl: 'https://api.github.com',
        repository: 'DanielOpazoD/HHR-ServicioHospitalizados',
        runId: '28767128242',
        page: 2,
        perPage: 100,
      })
    ).toBe(
      'https://api.github.com/repos/DanielOpazoD/HHR-ServicioHospitalizados/actions/runs/28767128242/jobs?per_page=100&page=2'
    );
  });

  it('collects paginated jobs and writes ci-runtime-observed-input.json', async () => {
    const root = makeTempDir();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          jobs: [
            {
              name: 'unit-risk-shard-1',
              status: 'completed',
              conclusion: 'success',
              started_at: '2026-07-06T01:43:33Z',
              completed_at: '2026-07-06T01:47:27Z',
            },
          ],
        })
      )
      .mockResolvedValueOnce(makeResponse({ jobs: [] }));

    const result = await collectGithubActionsRuntimeInput({
      env: {
        GITHUB_TOKEN: 'ghs_test',
        GITHUB_REPOSITORY: 'DanielOpazoD/HHR-ServicioHospitalizados',
        GITHUB_RUN_ID: '28767128242',
      },
      fetchImpl,
      root,
      settleDelaysMs: [],
    });

    const outputPath = path.join(root, 'reports/ci-runtime-observed-input.json');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      signal: expect.any(AbortSignal),
    });
    expect(result.jobs).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toMatchObject({
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
        },
      ],
    });
  });

  const env = {
    GITHUB_TOKEN: 'ghs_test',
    GITHUB_REPOSITORY: 'DanielOpazoD/HHR-ServicioHospitalizados',
    GITHUB_RUN_ID: '28767128242',
  };
  const shardJob = (index: number, status: 'queued' | 'in_progress' | 'completed') => ({
    name: `unit-risk-shard-${index}`,
    status,
    conclusion: status === 'completed' ? 'success' : null,
    started_at: '2026-10-22T14:58:00Z',
    completed_at: status === 'completed' ? '2026-10-22T15:01:00Z' : null,
  });
  // One jobs read: a page with the given jobs followed by the empty page that ends pagination.
  const readOf = (jobs: unknown[]) => [makeResponse({ jobs }), makeResponse({ jobs: [] })];
  const staleRead = () =>
    readOf([
      shardJob(1, 'completed'),
      shardJob(2, 'in_progress'),
      shardJob(3, 'queued'),
      shardJob(4, 'in_progress'),
    ]);
  const settledRead = () => readOf([1, 2, 3, 4].map(index => shardJob(index, 'completed')));
  const fetchSequence = (...reads: Response[][]) => {
    const fetchImpl = vi.fn();
    for (const response of reads.flat()) fetchImpl.mockResolvedValueOnce(response);
    return fetchImpl;
  };

  it('re-reads while the jobs API still reports finished unit shards as running', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const result = await collectGithubActionsRuntimeInput({
      env,
      fetchImpl: fetchSequence(staleRead(), settledRead()),
      log,
      root: makeTempDir(),
      settleDelaysMs: [10000, 20000],
      sleep,
    });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10000);
    expect(log).toHaveBeenCalledWith(
      'unit-risk-shard-2, unit-risk-shard-3, unit-risk-shard-4 not reported completed yet; re-reading in 10s'
    );
    expect(result.source.status).toBe('collected');
    expect(result.jobs.map((job: { status: string }) => job.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
    ]);
  });

  it('stops re-reading after the bounded wait and keeps the last read for the contract', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await collectGithubActionsRuntimeInput({
      env,
      fetchImpl: fetchSequence(staleRead(), staleRead(), staleRead()),
      root: makeTempDir(),
      settleDelaysMs: [1, 2],
      sleep,
    });

    expect(sleep.mock.calls).toEqual([[1], [2]]);
    expect(
      result.jobs.find((job: { name: string }) => job.name === 'unit-risk-shard-3')?.status
    ).toBe('QUEUED');
  });

  it('does not wait when the run lists no unit shard job', async () => {
    const sleep = vi.fn();
    const result = await collectGithubActionsRuntimeInput({
      env,
      fetchImpl: fetchSequence(readOf([{ name: 'build', status: 'in_progress' }])),
      root: makeTempDir(),
      sleep,
    });

    expect(sleep).not.toHaveBeenCalled();
    expect(result.jobs).toHaveLength(1);
  });

  it('writes advisory empty input when local configuration is missing', async () => {
    const root = makeTempDir();

    const result = await collectGithubActionsRuntimeInput({
      env: {},
      fetchImpl: vi.fn(),
      root,
      required: false,
    });

    expect(result.jobs).toEqual([]);
    expect(result.source.status).toBe('missing_configuration');
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'reports/ci-runtime-observed-input.json'), 'utf8'))
    ).toMatchObject({
      jobs: [],
      source: {
        status: 'missing_configuration',
      },
    });
  });

  it('fails with actionable missing configuration when collection is required', async () => {
    await expect(
      collectGithubActionsRuntimeInput({
        env: { GITHUB_REPOSITORY: 'DanielOpazoD/HHR-ServicioHospitalizados' },
        fetchImpl: vi.fn(),
        root: makeTempDir(),
        required: true,
      })
    ).rejects.toThrow(/Missing GitHub Actions runtime configuration: GITHUB_TOKEN, GITHUB_RUN_ID/);
  });

  it('writes degraded advisory input for transient API errors', async () => {
    const root = makeTempDir();

    const result = await collectGithubActionsRuntimeInput({
      env: {
        GITHUB_TOKEN: 'ghs_test',
        GITHUB_REPOSITORY: 'DanielOpazoD/HHR-ServicioHospitalizados',
        GITHUB_RUN_ID: '28767128242',
      },
      fetchImpl: vi.fn().mockResolvedValue(makeResponse({ message: 'bad' }, false)),
      root,
    });

    expect(result.jobs).toEqual([]);
    expect(result.source).toMatchObject({
      status: 'collection_failed',
      error: 'GitHub Actions jobs request failed: 500 Server Error',
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'reports/ci-runtime-observed-input.json'), 'utf8'))
    ).toMatchObject({
      jobs: [],
      source: {
        status: 'collection_failed',
      },
    });
  });

  it('keeps the request timeout active while parsing a stalled response body', async () => {
    vi.useFakeTimers();
    const root = makeTempDir();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          new Promise((_resolve, reject) => {
            requestSignal?.addEventListener('abort', () =>
              reject(new Error('response body timed out'))
            );
          }),
      } as unknown as Response);
    });

    const collection = collectGithubActionsRuntimeInput({
      env: {
        GITHUB_TOKEN: 'ghs_test',
        GITHUB_REPOSITORY: 'DanielOpazoD/HHR-ServicioHospitalizados',
        GITHUB_RUN_ID: '28767128242',
      },
      fetchImpl,
      root,
    });

    await vi.advanceTimersByTimeAsync(15000);
    const result = await collection;

    expect(result.jobs).toEqual([]);
    expect(result.source).toMatchObject({
      status: 'collection_failed',
      error: 'response body timed out',
    });
  });
});
