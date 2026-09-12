import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CensusPerfSnapshot } from '@/shared/runtime/censusPerfModel';
const read = () =>
  (window as Window & { __HHR_CENSUS_PERF__?: CensusPerfSnapshot }).__HHR_CENSUS_PERF__;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('DEV', false);
  localStorage.removeItem('hhr_perf_audit');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.removeItem('hhr_perf_audit');
  Reflect.deleteProperty(window, '__HHR_CENSUS_PERF__');
});
it('does not initialize diagnostics in production without opt-in', async () => {
  const p = await import('@/shared/runtime/censusStartupPerf');
  expect(p.beginAuthPerfAttempt('app_button')).toBeUndefined();
  expect(read()).toBeUndefined();
});
it('records Firebase authentication separately from authorization, without private context keys', async () => {
  localStorage.setItem('hhr_perf_audit', '1');
  const p = await import('@/shared/runtime/censusStartupPerf');
  const id = p.beginAuthPerfAttempt('app_button');
  p.recordAuthPerfEvent(id, 'authenticated');
  expect(read()?.authAttempts[0].events.authenticated).toBeTypeOf('number');
  expect(read()?.authAttempts[0].events.authorized).toBeUndefined();
  p.recordAuthPerfEvent(id, 'authorized');
  p.recordCensusAvailability('private-date-and-user', true, true);
  expect(JSON.stringify(read())).not.toContain('private-date-and-user');
  expect(read()?.authAttempts[0].events.authorized).toBeTypeOf('number');
  localStorage.removeItem('hhr_perf_audit');
  expect(read()).toBeUndefined();
});
it('records verified table availability before commit even when its child effect runs first', async () => {
  localStorage.setItem('hhr_perf_audit', '1');
  const p = await import('@/shared/runtime/censusStartupPerf');
  const id = p.beginCensusTableObservation('private-day')!;
  p.recordCensusTableMilestone(id, 'table_commit');
  const e = read()!.visits[0].events;
  expect(e.record_available).toBeLessThanOrEqual(e.table_commit!);
});
it('fails harmlessly if browser storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('unavailable');
  });
  const p = await import('@/shared/runtime/censusStartupPerf');
  expect(() => p.beginAuthPerfAttempt('app_button')).not.toThrow();
  expect(read()).toBeUndefined();
});
