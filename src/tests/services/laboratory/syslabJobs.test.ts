import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRemoteSyslabDetailsJob } from '@/services/laboratory/syslabJobs';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer synthetic' })),
}));
const jobId = '123e4567-e89b-12d3-a456-426614174000';
const links = Array.from({ length: 32 }, (_, i) => `hhr-syslab-remote://report/synthetic-${i}`);
const json = (value: unknown) =>
  new Response(JSON.stringify({ success: true, ...(value as object) }), {
    headers: { 'Content-Type': 'application/json' },
  });
const job = (completed: number, status = 'running') => ({
  id: jobId,
  kind: 'details',
  status,
  completed,
  total: links.length,
});

describe('remote Syslab durable details', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setSessionGeneration(null);
  });

  it('creates one job for 32 reports and assembles paginated results before publishing', async () => {
    const actions: string[] = [];
    let polls = 0;
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
      const query = new URL(url, 'https://hhr.test').searchParams;
      const action = query.get('action')!;
      actions.push(action);
      if (action === 'job-create') {
        expect(JSON.parse(options.body as string).links).toEqual(links);
        return json({ job: job(0, 'queued') });
      }
      if (action === 'job-status')
        return json({ job: ++polls === 1 ? job(16) : job(32, 'completed') });
      const offset = Number(query.get('offset'));
      return json({
        data: links
          .slice(offset, offset + 16)
          .map((_url, index) => ({ index: offset + index, findings: [] })),
        omittedIndices: [],
        nextOffset: offset === 0 ? 16 : null,
      });
    });
    vi.stubGlobal('fetch', fetch);
    const progress: number[] = [];
    const result = readRemoteSyslabDetailsJob(links, {
      onProgress: value => progress.push(value.completed),
    });
    await vi.runAllTimersAsync();
    expect((await result).data).toHaveLength(32);
    expect(actions).toEqual(['job-create', 'job-status', 'job-status', 'job-result', 'job-result']);
    expect(progress).toEqual([0, 16, 32]);
  });

  it('does not publish or schedule another poll when the session changes', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>(done => {
          resolve = done;
        })
    );
    vi.stubGlobal('fetch', fetch);
    const result = readRemoteSyslabDetailsJob(links, {});
    const rejected = expect(result).rejects.toThrow('cancelada');
    await vi.advanceTimersByTimeAsync(0);
    setSessionGeneration('new-synthetic-session');
    resolve(json({ job: job(32, 'completed') }));
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a completed job that lost a report instead of returning partial clinical data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('job-create')
          ? json({ job: job(32, 'completed') })
          : json({
              data: links.slice(1).map((_url, index) => ({ index: index + 1, findings: [] })),
              omittedIndices: [],
              nextOffset: null,
            })
      )
    );
    await expect(readRemoteSyslabDetailsJob(links, {})).rejects.toThrow('incompleto');
  });
});
