import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { createEmptyPatient } from '@/services/factories/patientFactory';

const DAY = '2026-09-20';
const READ_MS = 25;

const census = (count: number) => ({
  ...buildInitializedDayRecord(DAY, null),
  beds: Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const bedId = `TEST-${index}`;
      return [
        bedId,
        {
          ...createEmptyPatient(bedId),
          patientName: `Paciente sintético ${index}`,
          clinicalEpisodeId: `test-episode-${index}`,
        },
      ];
    })
  ),
});

const makeSources = (bundled: boolean, deviceFailure?: 'transient' | 'persistent') => {
  const active = new Map<string, number>();
  const peaks = new Map<string, number>();
  const delayed = async <T>(source: string, result: T): Promise<T> => {
    const count = (active.get(source) ?? 0) + 1;
    active.set(source, count);
    peaks.set(source, Math.max(peaks.get(source) ?? 0, count));
    await new Promise<void>(resolve => setTimeout(resolve, READ_MS));
    active.set(source, (active.get(source) ?? 1) - 1);
    return result;
  };
  let failed = false;
  const devices = { base64: '', source: 'json' as const, entries: [] };
  const history = { events: [], nursingActivity: [] };
  const forms = { forms: [] };
  const deps: ClinicalFillDeps = {
    fetchDeviceReport: vi.fn(async encId => {
      if (
        encId === 'test-episode-0' &&
        deviceFailure &&
        (!failed || deviceFailure === 'persistent')
      ) {
        failed = true;
        return delayed('devices', { base64: '', error: 'Tiempo de espera agotado.' });
      }
      return delayed('devices', devices);
    }),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn(() => delayed('history', history)),
    fetchScalesForms: vi.fn(() => delayed('forms', forms)),
    ...(bundled
      ? {
          fetchPatientClinicalBundle: vi.fn(() => delayed('bundle', { devices, history, forms })),
        }
      : {}),
    fetchCudyrCategories: vi.fn().mockResolvedValue({
      items: [],
      source: 'gestion_camas',
      historyAvailable: true,
    }),
    applyPatch: vi.fn().mockResolvedValue(undefined),
    now: () => new Date(`${DAY}T18:00:00Z`),
    createId: () => 'synthetic-device',
    monotonicNow: () => Date.now(),
  };
  return { deps, peaks, active };
};

describe('clinical census request budgets', () => {
  afterEach(() => vi.useRealTimers());

  it.each([13, 30])(
    'keeps %i patients linear with bounded parallel reads in both protocols',
    async count => {
      vi.useFakeTimers();
      for (const bundled of [false, true]) {
        const { deps, peaks, active } = makeSources(bundled);
        const start = Date.now();
        const pending = runClinicalFill(census(count), DAY, deps);
        await vi.runAllTimersAsync();
        const summary = await pending;

        expect(summary).toMatchObject({ total: count, errors: [] });
        expect(deps.fetchCudyrCategories).toHaveBeenCalledTimes(1);
        expect(summary.performance?.counters.requests).toBe((bundled ? count : 3 * count) + 1);
        const expectedEpisodes = Array.from(
          { length: count },
          (_, index) => `test-episode-${index}`
        ).sort();
        if (bundled) {
          expect(deps.fetchPatientClinicalBundle).toHaveBeenCalledTimes(count);
          expect(
            vi
              .mocked(deps.fetchPatientClinicalBundle!)
              .mock.calls.map(call => call[0])
              .sort()
          ).toEqual(expectedEpisodes);
          expect(deps.fetchDeviceReport).not.toHaveBeenCalled();
          expect(deps.fetchHistoryScales).not.toHaveBeenCalled();
          expect(deps.fetchScalesForms).not.toHaveBeenCalled();
        } else {
          for (const reader of [
            deps.fetchDeviceReport,
            deps.fetchHistoryScales,
            deps.fetchScalesForms,
          ]) {
            expect(reader).toHaveBeenCalledTimes(count);
            expect(
              vi
                .mocked(reader)
                .mock.calls.map(call => call[0])
                .sort()
            ).toEqual(expectedEpisodes);
          }
        }
        for (const peak of peaks.values()) {
          expect(peak).toBeGreaterThan(1);
          expect(peak).toBeLessThanOrEqual(4);
        }
        expect([...active.values()].every(value => value === 0)).toBe(true);
        // Virtual latency detects serialization without depending on the host CPU or live Eloisa.
        expect(Date.now() - start).toBeLessThanOrEqual(Math.ceil(count / 4) * READ_MS);
        expect(vi.getTimerCount()).toBe(0);
      }
    }
  );

  it('retries one failed source without rereading all patients or other sources', async () => {
    vi.useFakeTimers();
    const count = 13;
    const { deps } = makeSources(false, 'transient');
    const pending = runClinicalFill(census(count), DAY, deps);
    await vi.runAllTimersAsync();
    const summary = await pending;
    expect(summary).toMatchObject({ total: count, errors: [] });
    expect(deps.fetchDeviceReport).toHaveBeenCalledTimes(count + 1);
    expect(deps.fetchHistoryScales).toHaveBeenCalledTimes(count);
    expect(deps.fetchScalesForms).toHaveBeenCalledTimes(count);
    expect(deps.fetchCudyrCategories).toHaveBeenCalledTimes(1);
    expect(summary.performance?.counters).toMatchObject({ requests: 3 * count + 2, retries: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops retrying a persistently failing device source and completes the remaining census', async () => {
    vi.useFakeTimers({ loopLimit: 200 });
    const count = 13;
    const { deps, active } = makeSources(false, 'persistent');
    const pending = runClinicalFill(census(count), DAY, deps);
    await vi.runAllTimersAsync();
    const summary = await pending;
    expect(summary.total).toBe(count);
    expect(summary.errors).toEqual([
      expect.objectContaining({ bedId: 'TEST-0', source: 'devices' }),
    ]);
    const deviceEpisodes = vi.mocked(deps.fetchDeviceReport).mock.calls.map(call => call[0]);
    expect(deviceEpisodes.filter(id => id === 'test-episode-0')).toHaveLength(2);
    expect(deviceEpisodes).toHaveLength(count + 1);
    expect(new Set(deviceEpisodes).size).toBe(count);
    expect(deps.fetchHistoryScales).toHaveBeenCalledTimes(count);
    expect(deps.fetchScalesForms).toHaveBeenCalledTimes(count);
    expect(deps.fetchCudyrCategories).toHaveBeenCalledTimes(1);
    expect(summary.performance?.counters).toMatchObject({ requests: 3 * count + 2, retries: 1 });
    expect([...active.values()].every(value => value === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
