import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const remoteSnapshot = vi.hoisted(() => ({
  emit: null as null | ((record: unknown, hasPendingWrites: boolean, metadata: unknown) => void),
}));

vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => false,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: (
    _date: string,
    callback: (record: unknown, hasPendingWrites: boolean, metadata: unknown) => void
  ) => {
    remoteSnapshot.emit = callback;
    return () => {
      remoteSnapshot.emit = null;
    };
  },
  isServerConfirmedSnapshot: (metadata: { fromCache?: boolean } | undefined) =>
    metadata?.fromCache === false,
}));

import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getLocalForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { computePreviousDayEdits } from '@/features/rayen-import/domain/previousDayCorrections';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

// Synthetic people and days only.
const date = '2026-10-24';
const pendingVersion = '2026-10-24T10:00:00.000Z';
const readFailure = new Error('Synthetic IndexedDB read failure');

const patient = (overrides: Partial<PatientData> = {}): PatientData =>
  DataFactory.createMockPatient('R1', {
    patientName: 'PACIENTE SINTETICO',
    rut: '11.111.111-1',
    clinicalEpisodeId: 'episodio-sintetico',
    firstSeenDate: '2026-10-22',
    admissionDate: '2026-10-22',
    ...overrides,
  });

const dayRecord = (day: string, overrides: Partial<DailyRecord> = {}): DailyRecord =>
  DataFactory.createMockDailyRecord(day, { lastUpdated: pendingVersion, ...overrides });

/** Stores a local day whose edit has not reached the server yet. */
const storePendingDay = async (record: DailyRecord): Promise<number> => {
  await hospitalDB.dailyRecords.put(record);
  const task: SyncTask = {
    opId: `synthetic-pending-${record.date}`,
    key: `daily:${record.date}`,
    type: 'UPDATE_DAILY_RECORD',
    status: 'PENDING',
    payload: record,
    timestamp: 1,
    retryCount: 0,
  };
  return hospitalDB.syncQueue.add(task);
};

/** The device cannot read the next `count` point reads of a day; later reads work again. */
const failNextDayReads = (count: number) => {
  const spy = vi.spyOn(hospitalDB.dailyRecords, 'get');
  for (let index = 0; index < count; index += 1) spy.mockRejectedValueOnce(readFailure);
  return spy;
};

describe('a local day that could not be read is unknown, never absent', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    localStorage.clear();
    remoteSnapshot.emit = null;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });

  describe('saving the day', () => {
    const pending = () => dayRecord(date, { beds: { R1: patient() } });
    const changedAdmission = () =>
      dayRecord(date, {
        beds: { R1: patient({ admissionDate: '2026-10-21' }) },
        lastUpdated: '2026-10-24T10:05:00.000Z',
      });

    it('does not validate an admission-date change against an absent day', async () => {
      const taskId = await storePendingDay(pending());
      const queued = await hospitalDB.syncQueue.get(taskId);
      failNextDayReads(1);

      await expect(
        saveDetailed(changedAdmission(), pendingVersion, { baseRecord: pending() })
      ).rejects.toBe(readFailure);

      // The pending edit stays as it was, and nothing new is queued as if it were saved.
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(pending());
      expect(await hospitalDB.syncQueue.toArray()).toEqual([queued]);
    });

    it('still blocks the same change when the day reads normally', async () => {
      await storePendingDay(pending());

      const result = await saveDetailed(changedAdmission(), pendingVersion, {
        baseRecord: pending(),
      });

      expect(result).toMatchObject({ outcome: 'blocked', savedLocally: false });
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(pending());
    });

    it('keeps validating a day that really is absent by its admission window', async () => {
      const result = await saveDetailed(changedAdmission(), pendingVersion);

      expect(result).toMatchObject({ savedLocally: true });
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.admissionDate).toBe('2026-10-21');
    });
  });

  describe('planning a historical discharge from Eloísa', () => {
    const censusDay = '2026-10-24';
    const historicalDay = '2026-10-23';
    const departed = patient({ firstSeenDate: '2026-10-20', admissionDate: '2026-10-20' });
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [],
      moves: [],
      discharges: [
        {
          bedId: 'R1',
          rut: departed.rut,
          patientName: departed.patientName,
          encounterId: departed.clinicalEpisodeId,
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          correctedDay: historicalDay,
          correctedTime: '15:00',
        },
      ],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 0,
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 1,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    };
    // The server copy has neither the patient nor the discharge the device has not sent yet.
    const authoritative = dayRecord(historicalDay, { beds: {} });
    const pendingDischarge = dayRecord(historicalDay, {
      beds: {},
      discharges: [
        {
          id: 'alta-sintetica',
          bedName: 'R1',
          bedId: 'R1',
          bedType: 'UTI',
          patientName: departed.patientName,
          rut: departed.rut,
          diagnosis: 'DIAGNOSTICO SINTETICO',
          time: '15:00',
          status: 'Vivo',
          clinicalEpisodeId: departed.clinicalEpisodeId,
        } as DailyRecord['discharges'][number],
      ],
    });
    const port = {
      getAuthoritativeForDate: async () => authoritative,
      getLocalForDateWithMeta,
    } as unknown as DailyRecordRepositoryPort;

    it('does not plan the discharge again when the pending local day cannot be read', async () => {
      await storePendingDay(pendingDischarge);
      failNextDayReads(2);

      await expect(computePreviousDayEdits(port, diff, censusDay, true)).rejects.toBe(readFailure);
    });

    it('recovers a single failed local read without planning a duplicate discharge', async () => {
      await storePendingDay(pendingDischarge);
      failNextDayReads(1);
      expect((await computePreviousDayEdits(port, diff, censusDay, true)).edits).toEqual([]);
    });

    it('recognises the pending discharge when the day reads normally', async () => {
      await storePendingDay(pendingDischarge);

      const plan = await computePreviousDayEdits(port, diff, censusDay, true);

      expect(plan.edits).toEqual([]);
    });

    it('plans the discharge when the device really has no copy of that day', async () => {
      const plan = await computePreviousDayEdits(port, diff, censusDay, true);

      expect(plan.edits).toMatchObject([
        { day: historicalDay, patientNames: [departed.patientName] },
      ]);
    });
  });

  describe('publishing a live update of the day', () => {
    const local = () => dayRecord(date, { beds: { R1: patient({ pathology: 'EDICION LOCAL' }) } });
    const remote = () =>
      dayRecord(date, {
        beds: { R1: patient({ pathology: 'COPIA REMOTA' }) },
        lastUpdated: '2026-10-24T09:00:00.000Z',
      });

    const listen = () => {
      const delivered: SyncDailyRecordResult[] = [];
      const failed: SyncDailyRecordResult[] = [];
      const stop = subscribeDetailed(
        date,
        result => delivered.push(result),
        result => failed.push(result)
      );
      return { delivered, failed, stop };
    };

    it('does not present the cached remote copy as applied when the local day cannot be read', async () => {
      await storePendingDay(local());
      const { delivered, failed, stop } = listen();
      const reads = failNextDayReads(2);

      remoteSnapshot.emit?.(remote(), false, { fromCache: true });

      await vi.waitFor(() => expect(delivered.length + failed.length).toBe(1));
      stop();
      reads.mockRestore();
      expect(delivered).toEqual([]);
      expect(failed).toMatchObject([{ outcome: 'blocked', record: null }]);
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(local());
    });

    it('keeps the local copy over a cached remote copy when the day reads normally', async () => {
      await storePendingDay(local());
      const { delivered, failed, stop } = listen();

      remoteSnapshot.emit?.(remote(), false, { fromCache: true });

      await vi.waitFor(() => expect(delivered.length + failed.length).toBe(1));
      stop();
      expect(failed).toEqual([]);
      expect(delivered).toHaveLength(1);
      expect(delivered[0].record?.beds.R1.pathology).toBe('EDICION LOCAL');
      expect(delivered[0].sourceOfTruth).toBe('local');
    });

    it('publishes the cached remote copy when the device has no copy of the day', async () => {
      const { delivered, failed, stop } = listen();

      remoteSnapshot.emit?.(remote(), false, { fromCache: true });

      await vi.waitFor(() => expect(delivered.length + failed.length).toBe(1));
      stop();
      expect(failed).toEqual([]);
      expect(delivered).toHaveLength(1);
      expect(delivered[0].record?.beds.R1.pathology).toBe('COPIA REMOTA');
      expect(delivered[0].sourceOfTruth).toBe('remote');
    });
  });
});
