import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => false,
}));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const date = '2026-10-24';
const baseVersion = '2026-10-24T10:00:00.000Z';
const patient = (clinicalEpisodeId: string): PatientData =>
  DataFactory.createMockPatient('R1', {
    patientName: 'PACIENTE SINTETICO',
    rut: '11.111.111-1',
    admissionDate: '2026-10-23',
    clinicalEpisodeId,
    pathology: 'DIAGNOSTICO BASE',
  });
const baseRecord = (beds: Record<string, PatientData> = {}): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds,
    lastUpdated: baseVersion,
    nursesDayShift: ['SINTETICA BASE'],
    tensDayShift: ['SINTETICO BASE'],
  });
const localRecord = async (): Promise<DailyRecord> => {
  const record = await hospitalDB.dailyRecords.get(date);
  if (!record) throw new Error('missing synthetic local record');
  return record;
};
const tasks = () => hospitalDB.syncQueue.toArray();
const pendingPayload = async () => (await tasks())[0]?.payload as DailyRecord | undefined;

/** Publishes the queue and returns the record the synthetic remote confirmed. */
const publishQueue = async (): Promise<DailyRecord | undefined> => {
  let confirmed: DailyRecord | undefined;
  const engine = createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => true, getOwnerKey: () => null, onOnline: () => {} },
    transport: {
      run: async task => {
        confirmed = { ...(task.payload as DailyRecord), lastUpdated: '2026-10-24T11:30:00.000Z' };
        return { authoritativeRecord: confirmed };
      },
    },
    batchSize: 8,
    maxPendingTasks: 192,
    maxRetries: 5,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });
  const now = Date.now();
  vi.setSystemTime(new Date(now + 120_000));
  await engine.processQueue();
  vi.setSystemTime(new Date(now));
  return confirmed;
};

describe('a write proves its base by content, never by version time alone', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T11:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects an edit for the previous patient after the replacement was published', async () => {
    const base = baseRecord({ R1: patient('ep-sintetico-a') });
    await hospitalDB.dailyRecords.put(base);
    await updatePartialDetailed(
      date,
      { 'beds.R1': patient('ep-sintetico-b') },
      { baseRecord: base }
    );
    await publishQueue();
    expect(await tasks()).toHaveLength(0);

    await expect(
      updatePartialDetailed(date, { 'beds.R1.pathology': 'DATO VIEJO' }, { baseRecord: base })
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect((await localRecord()).beds.R1).toMatchObject({
      clinicalEpisodeId: 'ep-sintetico-b',
      pathology: 'DIAGNOSTICO BASE',
    });
    expect(await tasks()).toHaveLength(0);
  });

  it('rejects an edit for the previous patient made in the same millisecond as the replacement', async () => {
    vi.setSystemTime(new Date(baseVersion));
    const base = baseRecord({ R1: patient('ep-sintetico-a') });
    await hospitalDB.dailyRecords.put(base);
    await updatePartialDetailed(
      date,
      { 'beds.R1': patient('ep-sintetico-b') },
      { baseRecord: base }
    );
    expect((await localRecord()).lastUpdated).toBe(baseVersion);

    await expect(
      updatePartialDetailed(date, { 'beds.R1.pathology': 'DATO VIEJO' }, { baseRecord: base })
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect((await localRecord()).beds.R1.clinicalEpisodeId).toBe('ep-sintetico-b');
    expect((await pendingPayload())?.beds.R1.clinicalEpisodeId).toBe('ep-sintetico-b');
  });

  it('lands an independent stale edit on the published record instead of reverting it', async () => {
    const base = baseRecord();
    await hospitalDB.dailyRecords.put(base);
    await updatePartialDetailed(date, { nursesDayShift: ['SINTETICA A'] }, { baseRecord: base });
    await publishQueue();

    await updatePartialDetailed(date, { tensDayShift: ['SINTETICO B'] }, { baseRecord: base });

    for (const record of [await localRecord(), await pendingPayload()]) {
      expect(record?.nursesDayShift).toEqual(['SINTETICA A']);
      expect(record?.tensDayShift).toEqual(['SINTETICO B']);
    }
    expect((await tasks())[0].syncContract?.expectedVersion).toBe(baseVersion);
  });

  it('a queued retry merges discharges by id even when every pending path overlaps', async () => {
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

    await queueDailyRecordSyncTaskWithLocalRecord(
      { ...base, lastUpdated: '2026-10-24T11:05:00.000Z', discharges: [dischargeB] },
      { syncContract: { expectedVersion: baseVersion, changedPaths: ['discharges'] } }
    );

    const ids = (record?: DailyRecord) => record?.discharges.map(discharge => discharge.id);
    expect(ids(await localRecord())).toEqual(['alta-sintetica-a', 'alta-sintetica-b']);
    expect(ids(await pendingPayload())).toEqual(['alta-sintetica-a', 'alta-sintetica-b']);
  });

  it('a queued retry for the previous patient is rejected when only that bed is pending', async () => {
    const base = baseRecord({ R1: patient('ep-sintetico-a') });
    await hospitalDB.dailyRecords.put(base);
    await updatePartialDetailed(
      date,
      { 'beds.R1': patient('ep-sintetico-b') },
      { baseRecord: base }
    );

    await expect(
      queueDailyRecordSyncTaskWithLocalRecord(
        {
          ...base,
          lastUpdated: '2026-10-24T11:05:00.000Z',
          beds: { R1: { ...patient('ep-sintetico-a'), pathology: 'DATO VIEJO' } },
        },
        { syncContract: { expectedVersion: baseVersion, changedPaths: ['beds.R1.pathology'] } }
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect((await localRecord()).beds.R1.clinicalEpisodeId).toBe('ep-sintetico-b');
    expect((await pendingPayload())?.beds.R1.clinicalEpisodeId).toBe('ep-sintetico-b');
  });
});
