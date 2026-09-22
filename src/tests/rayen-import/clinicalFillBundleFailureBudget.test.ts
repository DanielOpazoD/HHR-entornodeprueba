import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { RayenPatientClinicalBundle } from '@/features/rayen-import/contracts/patientClinicalBundle';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { createEmptyPatient } from '@/services/factories/patientFactory';

const DAY = '2026-09-21';
const READ_MS = 25;
const FAILED_EPISODE = 'synthetic-episode-0';

const census = (count: number) => ({
  ...buildInitializedDayRecord(DAY, null),
  beds: Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const bedId = `SYNTHETIC-${index}`;
      return [
        bedId,
        {
          ...createEmptyPatient(bedId),
          patientName: `Paciente sintético ${index}`,
          clinicalEpisodeId: `synthetic-episode-${index}`,
        },
      ];
    })
  ),
});

const expectedEpisodes = (count: number) =>
  Array.from({ length: count }, (_, index) => `synthetic-episode-${index}`).sort();

const makeDependencies = (persistentFailure: boolean) => {
  let activeBundles = 0;
  let activeReads = 0;
  let bundlePeak = 0;
  let totalPeak = 0;
  const wait = async (source: 'bundle' | 'devices'): Promise<void> => {
    activeReads += 1;
    if (source === 'bundle') activeBundles += 1;
    bundlePeak = Math.max(bundlePeak, activeBundles);
    totalPeak = Math.max(totalPeak, activeReads);
    await new Promise<void>(resolve => setTimeout(resolve, READ_MS));
    activeReads -= 1;
    if (source === 'bundle') activeBundles -= 1;
  };
  const completeBundle = (): RayenPatientClinicalBundle => ({
    devices: { base64: '', source: 'json', entries: [] },
    history: { events: [], nursingActivity: [] },
    forms: { forms: [] },
  });
  const fetchPatientClinicalBundle = vi.fn(async (episodeId: string) => {
    await wait('bundle');
    const result = completeBundle();
    return episodeId === FAILED_EPISODE
      ? { ...result, devices: { ...result.devices, error: 'timeout sintético de dispositivos' } }
      : result;
  });
  const fetchDeviceReport = vi.fn(async (episodeId: string) => {
    await wait('devices');
    return persistentFailure && episodeId === FAILED_EPISODE
      ? { base64: '', error: 'timeout sintético persistente de dispositivos' }
      : { base64: '', source: 'json' as const, entries: [] };
  });
  const deps: ClinicalFillDeps = {
    fetchPatientClinicalBundle,
    fetchDeviceReport,
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn().mockResolvedValue({ events: [], nursingActivity: [] }),
    fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
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
  return {
    deps,
    observedConcurrency: () => ({ activeBundles, activeReads, bundlePeak, totalPeak }),
  };
};

const expectIsolatedReads = (deps: ClinicalFillDeps, count: number) => {
  expect(deps.fetchPatientClinicalBundle).toHaveBeenCalledTimes(count);
  expect(
    vi
      .mocked(deps.fetchPatientClinicalBundle!)
      .mock.calls.map(([episodeId]) => episodeId)
      .sort()
  ).toEqual(expectedEpisodes(count));
  expect(deps.fetchDeviceReport).toHaveBeenCalledTimes(1);
  expect(deps.fetchDeviceReport).toHaveBeenCalledWith(FAILED_EPISODE, DAY);
  expect(deps.fetchHistoryScales).not.toHaveBeenCalled();
  expect(deps.fetchScalesForms).not.toHaveBeenCalled();
  expect(deps.fetchCudyrCategories).toHaveBeenCalledTimes(1);
};

const expectSettledConcurrency = (
  observedConcurrency: () => {
    activeBundles: number;
    activeReads: number;
    bundlePeak: number;
    totalPeak: number;
  }
) => {
  const observed = observedConcurrency();
  expect(observed.bundlePeak).toBeGreaterThan(1);
  expect(observed.bundlePeak).toBeLessThanOrEqual(4);
  expect(observed.totalPeak).toBeLessThanOrEqual(5);
  expect(observed.activeBundles).toBe(0);
  expect(observed.activeReads).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
};

describe('clinical bundle section failure budgets', () => {
  afterEach(() => vi.useRealTimers());

  it.each([13, 30])(
    'retries only the failed device section once across %i bundled patients',
    async count => {
      vi.useFakeTimers({ loopLimit: 200 });
      const { deps, observedConcurrency } = makeDependencies(false);
      const onProgress = vi.fn();

      const pending = runClinicalFill(census(count), DAY, deps, onProgress);
      await vi.runAllTimersAsync();
      const summary = await pending;

      expect(summary).toMatchObject({ total: count, errors: [] });
      expect(summary.performance?.counters).toMatchObject({ requests: count + 2, retries: 1 });
      expect(onProgress).toHaveBeenCalledTimes(count);
      expect(onProgress).toHaveBeenLastCalledWith({ done: count, total: count });
      expectIsolatedReads(deps, count);
      expectSettledConcurrency(observedConcurrency);
    }
  );

  it.each([13, 30])(
    'reports only the affected patient and source after a persistent failure in %i bundles',
    async count => {
      vi.useFakeTimers({ loopLimit: 200 });
      const { deps, observedConcurrency } = makeDependencies(true);
      const onProgress = vi.fn();

      const pending = runClinicalFill(census(count), DAY, deps, onProgress);
      await vi.runAllTimersAsync();
      const summary = await pending;

      expect(summary.total).toBe(count);
      expect(summary.errors).toEqual([
        expect.objectContaining({
          bedId: 'SYNTHETIC-0',
          clinicalEpisodeId: FAILED_EPISODE,
          source: 'devices',
          message: 'timeout sintético persistente de dispositivos',
        }),
      ]);
      expect(summary.performance?.counters).toMatchObject({ requests: count + 2, retries: 1 });
      expect(onProgress).toHaveBeenCalledTimes(count);
      expect(onProgress).toHaveBeenLastCalledWith({ done: count, total: count });
      expectIsolatedReads(deps, count);
      expectSettledConcurrency(observedConcurrency);
    }
  );
});
