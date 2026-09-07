import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('counts repeated marks without changing the first timestamp or growing the mark list', async () => {
  vi.useFakeTimers();
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('DEV', true);
  vi.resetModules();
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const { markPerf, flushPerfReport } = await import('@/shared/runtime/perfAudit');
  markPerf('auth-test:start');
  flushPerfReport('first');
  markPerf('auth-test:start');
  flushPerfReport('repeat');
  const report = log.mock.calls.at(-1)?.[0] as string;
  expect(report.match(/auth-test:start/g)).toHaveLength(1);
  expect(report).toContain('0.0 ms · ejecuciones=2');
  vi.clearAllTimers();
});
