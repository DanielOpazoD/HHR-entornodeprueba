// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import { createClinicalWriteCoordinator } from '@/features/rayen-import/domain/clinicalWriteCoordinator';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = (count = 1) =>
  ({
    date: '2026-07-10',
    beds: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `R${index + 1}`,
        {
          bedId: `R${index + 1}`,
          patientName: 'Paciente sintético',
          clinicalEpisodeId: `E${index + 1}`,
          devices: [],
        },
      ])
    ),
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;
const delay = <T>(ms: number, value: T) =>
  new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
const deps = (): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn(() => delay(30, { base64: '' })),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn(() => delay(60, { events: [] })),
  fetchScalesForms: vi.fn(() => delay(40, { forms: [] })),
  fetchCudyrCategories: vi.fn(() =>
    delay(80, { items: [], source: 'gestion_camas' as const, historyAvailable: true })
  ),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new Date('2026-07-10T12:00:00Z'),
  createId: () => 'synthetic-id',
  monotonicNow: () => Date.now(),
});
const scale = {
  publishDatetime: '2026-07-10T10:00:00',
  evaluationInstrumentsResume: [
    { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17' },
  ],
};

afterEach(() => vi.useRealTimers());

describe('overlapping clinical reads', () => {
  it('finishes in the maximum source latency instead of adding CUDYR and patient waits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const readers = deps();
    const done = vi.fn();
    const pending = runClinicalFill(record(), '2026-07-10', readers).then(result => {
      done();
      return result;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(readers.fetchDeviceReport).toHaveBeenCalledTimes(1);
    expect(readers.fetchHistoryScales).toHaveBeenCalledTimes(1);
    expect(readers.fetchScalesForms).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(79);
    expect(done).not.toHaveBeenCalled();
    expect(readers.applyPatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({
      errors: [],
      performance: { counters: { requests: 4 } },
    });
    expect(done).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(80); // Previously 80 + 60 = 140 ms for the same evidence.
  });

  it('keeps the four-read limit per patient source during a slow shared capture', async () => {
    vi.useFakeTimers();
    const readers = deps();
    const active = { devices: 0, history: 0, forms: 0 };
    const peak = { ...active };
    const bounded = async <T>(key: keyof typeof active, value: T) => {
      active[key] += 1;
      peak[key] = Math.max(peak[key], active[key]);
      await delay(10, undefined);
      active[key] -= 1;
      return value;
    };
    vi.mocked(readers.fetchDeviceReport).mockImplementation(() =>
      bounded('devices', { base64: '' })
    );
    vi.mocked(readers.fetchHistoryScales).mockImplementation(() =>
      bounded('history', { events: [] })
    );
    vi.mocked(readers.fetchScalesForms).mockImplementation(() => bounded('forms', { forms: [] }));
    const pending = runClinicalFill(record(6), '2026-07-10', readers);
    await vi.advanceTimersByTimeAsync(80);
    const result = await pending;
    expect(peak).toEqual({ devices: 4, history: 4, forms: 4 });
    expect(result.performance?.counters.requests).toBe(19);
    expect(readers.fetchCudyrCategories).toHaveBeenCalledTimes(1);
  });

  it('preserves successful clinical enrichment when the concurrent CUDYR capture fails', async () => {
    vi.useFakeTimers();
    const readers = deps();
    vi.mocked(readers.fetchHistoryScales).mockImplementation(() => delay(60, { events: [scale] }));
    vi.mocked(readers.fetchCudyrCategories).mockImplementation(async () => {
      await delay(80, undefined);
      throw new Error('source timeout');
    });
    const pending = runClinicalFill(record(), '2026-07-10', readers);
    await vi.advanceTimersByTimeAsync(80);
    const result = await pending;
    expect(result.errors).toEqual([expect.objectContaining({ bedId: '*', source: 'cudyr' })]);
    expect(
      vi.mocked(readers.applyPatch).mock.calls[0][0]['beds.R1.evaluationScores']
    ).toMatchObject({ braden: { total: 17 } });
  });

  it('does not start historical or deferred writes after cancellation while CUDYR was pending', async () => {
    vi.useFakeTimers();
    const readers = deps();
    const controller = new AbortController();
    readers.signal = controller.signal;
    readers.applyHistoricalCudyrBatch = vi.fn().mockResolvedValue([]);
    const persist = vi.fn().mockResolvedValue({ patientWrites: 1, historySnapshots: 1 });
    readers.persistenceStrategy = { disposition: 'deferred', persist };
    vi.mocked(readers.fetchHistoryScales).mockImplementation(() => delay(60, { events: [scale] }));
    vi.mocked(readers.fetchCudyrCategories).mockImplementation(() =>
      delay(80, {
        items: [{ encId: 'E1', crdValue: 'C2', crdDateTime: '2026-07-10T07:00:00Z' }],
        source: 'gestion_camas',
        historyAvailable: true,
      })
    );
    const pending = runClinicalFill(record(), '2026-07-10', readers);
    await vi.advanceTimersByTimeAsync(20);
    controller.abort(new Error('Clinical stage timeout'));
    await vi.advanceTimersByTimeAsync(60);
    const result = await pending;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(readers.applyPatch).not.toHaveBeenCalled();
    expect(readers.applyHistoricalCudyrBatch).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('serialized clinical writes after cancellation', () => {
  it.each(['patient', 'batch', 'historical'] as const)(
    'rejects a queued %s write without disrupting an already started write',
    async kind => {
      const controller = new AbortController();
      const metrics = { patientWrites: 0, historySnapshots: 0 };
      const coordinator = createClinicalWriteCoordinator(metrics, undefined, controller.signal);
      let release: () => void = () => undefined;
      const first = coordinator.enqueue(
        () =>
          new Promise<void>(resolve => {
            release = resolve;
          })
      );
      await Promise.resolve();
      const write = vi.fn().mockResolvedValue({ patientWrites: 1, historySnapshots: 1 });
      const queued =
        kind === 'patient'
          ? coordinator.applyPatientPatch(write)
          : kind === 'batch'
            ? coordinator.applyBatch(write)
            : coordinator.enqueue(write, { scope: 'historical' });
      const rejected = expect(queued).rejects.toThrow('cancelled');
      controller.abort(new Error('cancelled'));
      release();
      await first;
      await rejected;
      expect(write).not.toHaveBeenCalled();
      expect(metrics.patientWrites).toBe(0);
    }
  );
});
