import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => false,
}));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { resolveRemoteWriteRecovery } from '@/services/repositories/dailyRecordRemoteWriteController';
import { applyOptimisticDailyRecordPatch } from '@/hooks/controllers/dailyRecordQueryController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

const date = '2026-10-24';
const baseRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: '2026-10-24T10:00:00.000Z',
    nurses: ['SINTETICA BASE'],
    nursesDayShift: ['SINTETICA BASE'],
    tensDayShift: ['SINTETICO BASE'],
    ...overrides,
  });
const occupiedBase = (): DailyRecord =>
  baseRecord({
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'PACIENTE SINTETICO UNO',
        rut: '11.111.111-1',
        admissionDate: '2026-10-23',
        clinicalEpisodeId: 'ep_sintetico_uno',
        pathology: 'DIAGNOSTICO BASE',
      }),
    },
  });

const projection = () => hospitalDB.dailyRecords.get(date);
const pendingTasks = () => hospitalDB.syncQueue.toArray();
const pendingPayload = async () => (await pendingTasks())[0]?.payload as DailyRecord | undefined;

/** Publishes the pending queue once its pre-outbox hold has expired. */
const publishPendingQueue = async (): Promise<DailyRecord[]> => {
  const published: DailyRecord[] = [];
  const engine = createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => true, getOwnerKey: () => null, onOnline: () => {} },
    transport: {
      run: async task => {
        published.push(task.payload as DailyRecord);
      },
    },
    batchSize: 8,
    maxPendingTasks: 192,
    maxRetries: 5,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });
  const realNow = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(realNow + 60_000);
  await engine.processQueue();
  vi.mocked(Date.now).mockRestore();
  return published;
};

describe('a stale-base patch applies on top of the pending local projection', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both edits in the projection, the pending payload and the published record', async () => {
    const base = baseRecord();
    await hospitalDB.dailyRecords.put(base);

    const tabA = await updatePartialDetailed(
      date,
      { nursesDayShift: ['SINTETICA EDICION A'] },
      { baseRecord: base }
    );
    const tabB = await updatePartialDetailed(
      date,
      { tensDayShift: ['SINTETICO EDICION B'] },
      { baseRecord: base }
    );

    expect(tabA.savedLocally).toBe(true);
    expect(tabB.savedLocally).toBe(true);
    expect((await projection())?.nursesDayShift).toEqual(['SINTETICA EDICION A']);
    expect((await projection())?.tensDayShift).toEqual(['SINTETICO EDICION B']);
    expect(await pendingTasks()).toHaveLength(1);
    expect((await pendingPayload())?.nursesDayShift).toEqual(['SINTETICA EDICION A']);
    expect((await pendingPayload())?.tensDayShift).toEqual(['SINTETICO EDICION B']);
    expect((await pendingTasks())[0].syncContract?.changedPaths).toEqual(
      expect.arrayContaining(['nursesDayShift', 'tensDayShift'])
    );

    const published = await publishPendingQueue();
    expect(published).toHaveLength(1);
    expect(published[0].nursesDayShift).toEqual(['SINTETICA EDICION A']);
    expect(published[0].tensDayShift).toEqual(['SINTETICO EDICION B']);
  });

  it('keeps sequential edits of one tab whose base is its optimistic copy', async () => {
    const base = baseRecord();
    await hospitalDB.dailyRecords.put(base);
    const admitted = DataFactory.createMockPatient('R2', {
      patientName: 'PACIENTE SINTETICO MOVIDO',
      rut: '33.333.333-3',
      admissionDate: '2026-10-24',
    });
    const patches: DailyRecordPatch[] = [
      // Saving drops the empty slot; the optimistic copy keeps it.
      { nursesDayShift: ['SINTETICA ESCRIBE', ''] },
      { nursesDayShift: ['SINTETICA ESCRIBE', 'SINTETICA DOS'] },
      // Saving adds derived fields to a whole bed; the optimistic copy lacks them.
      { 'beds.R2': admitted },
      { 'beds.R3': { ...admitted, bedId: 'R3' }, 'beds.R2': createEmptyPatient('R2') },
      { tensDayShift: ['SINTETICO TURNO'] },
    ];

    // The UI keeps patching its optimistic cache, whose version never equals the projection's.
    let optimistic = base;
    for (const patch of patches) {
      const result = await updatePartialDetailed(date, patch, { baseRecord: optimistic });
      expect(result.savedLocally).toBe(true);
      optimistic = applyOptimisticDailyRecordPatch(optimistic, patch);
    }

    for (const record of [await projection(), await pendingPayload()]) {
      expect(record?.nursesDayShift).toEqual(['SINTETICA ESCRIBE', 'SINTETICA DOS']);
      expect(record?.beds.R3.patientName).toBe('PACIENTE SINTETICO MOVIDO');
      expect(record?.beds.R2.patientName).toBe('');
      expect(record?.tensDayShift).toEqual(['SINTETICO TURNO']);
    }
  });

  it('rejects a stale edit of the same field instead of erasing the accepted one', async () => {
    const base = baseRecord();
    await hospitalDB.dailyRecords.put(base);

    await updatePartialDetailed(
      date,
      { nursesDayShift: ['SINTETICA EDICION A'] },
      { baseRecord: base }
    );
    await expect(
      updatePartialDetailed(date, { nursesDayShift: ['SINTETICA EDICION B'] }, { baseRecord: base })
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect((await projection())?.nursesDayShift).toEqual(['SINTETICA EDICION A']);
    expect((await pendingPayload())?.nursesDayShift).toEqual(['SINTETICA EDICION A']);
  });

  it('never moves a stale edit onto the patient who now occupies the bed', async () => {
    const base = occupiedBase();
    await hospitalDB.dailyRecords.put(base);
    const replacement = DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE SINTETICO DOS',
      rut: '22.222.222-2',
      admissionDate: '2026-10-24',
      clinicalEpisodeId: 'ep_sintetico_dos',
      pathology: 'DIAGNOSTICO BASE',
    });

    await updatePartialDetailed(date, { 'beds.R1': replacement }, { baseRecord: base });
    await expect(
      updatePartialDetailed(
        date,
        { 'beds.R1.pathology': 'DIAGNOSTICO DEL PACIENTE UNO' },
        { baseRecord: base }
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect((await projection())?.beds.R1.patientName).toBe('PACIENTE SINTETICO DOS');
    expect((await projection())?.beds.R1.pathology).toBe('DIAGNOSTICO BASE');
    expect((await pendingPayload())?.beds.R1.pathology).toBe('DIAGNOSTICO BASE');
  });

  it('keeps discharges written from the same stale base in two tabs', async () => {
    const base = baseRecord();
    await hospitalDB.dailyRecords.put(base);
    const dischargeA = DataFactory.createMockDischarge({
      id: 'alta-sintetica-a',
      patientName: 'PACIENTE SINTETICO A',
      bedId: 'R1',
    });
    const dischargeB = DataFactory.createMockDischarge({
      id: 'alta-sintetica-b',
      patientName: 'PACIENTE SINTETICO B',
      bedId: 'R2',
    });

    await updatePartialDetailed(date, { discharges: [dischargeA] }, { baseRecord: base });
    const tabB = await updatePartialDetailed(
      date,
      { discharges: [dischargeB] },
      { baseRecord: base }
    );

    expect(tabB.savedLocally).toBe(true);
    const ids = (record?: DailyRecord) => record?.discharges.map(discharge => discharge.id);
    expect(ids(await projection())).toEqual(['alta-sintetica-a', 'alta-sintetica-b']);
    expect(ids(await pendingPayload())).toEqual(['alta-sintetica-a', 'alta-sintetica-b']);
  });

  it('a retry queued for the stale write keeps the other pending edit', async () => {
    const base = baseRecord();
    await hospitalDB.dailyRecords.put(base);
    await updatePartialDetailed(
      date,
      { nursesDayShift: ['SINTETICA EDICION A'] },
      { baseRecord: base }
    );
    const staleRecord: DailyRecord = {
      ...base,
      lastUpdated: '2026-10-24T10:05:00.000Z',
      tensDayShift: ['SINTETICO EDICION B'],
    };

    const recovery = await resolveRemoteWriteRecovery(
      date,
      staleRecord,
      ['tensDayShift'],
      Object.assign(new Error('synthetic network failure'), { code: 'unavailable' }),
      base.lastUpdated
    );

    expect(recovery.status).toBe('queued_for_retry');
    expect((await projection())?.nursesDayShift).toEqual(['SINTETICA EDICION A']);
    expect((await projection())?.tensDayShift).toEqual(['SINTETICO EDICION B']);
    expect((await pendingPayload())?.nursesDayShift).toEqual(['SINTETICA EDICION A']);
    expect((await pendingPayload())?.tensDayShift).toEqual(['SINTETICO EDICION B']);
  });
});
