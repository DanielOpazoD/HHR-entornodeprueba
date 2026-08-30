import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rebasePendingDailyRecordWrite } from '@/services/repositories/dailyRecordPendingWriteRebase';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { createEmptyPatient } from '@/services/factories/patientFactory';

describe('rebasePendingDailyRecordWrite', () => {
  it('preserves authoritative clinical crib fields under an older pending bed object', () => {
    const date = '2026-08-29';
    const authoritativeCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      clinicalEpisodeId: 'crib-confirmed',
      patientName: 'RN confirmado',
      devices: ['CVC'],
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:01:00.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'parent-episode',
          pathology: 'Diagnóstico remoto',
          devices: ['CVC'],
          clinicalCrib: authoritativeCrib,
        }),
      },
    });
    const pendingRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:00:00.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'parent-episode',
          pathology: 'Diagnóstico local pendiente',
          devices: ['VVP'],
          clinicalCrib: undefined,
        }),
      },
    });

    const result = rebasePendingDailyRecordWrite({
      authoritativeRecord,
      pendingTask: {
        taskId: 1,
        record: pendingRecord,
        recordRevision: pendingRecord.lastUpdated,
        changedPaths: ['beds.R1'],
      },
      alreadyAppliedPatch: {
        'beds.R1.clinicalCrib.patientName': 'RN confirmado',
        'beds.R1.clinicalCrib.clinicalEpisodeId': 'crib-confirmed',
      },
    });

    expect(result.record.beds.R1.pathology).toBe('Diagnóstico local pendiente');
    expect(result.record.beds.R1.devices).toEqual(['CVC']);
    expect(result.record.beds.R1.clinicalCrib).toMatchObject({
      patientName: 'RN confirmado',
      clinicalEpisodeId: 'crib-confirmed',
      devices: ['CVC'],
    });
  });

  it('blocks a pending bed patch when the authoritative bed belongs to another episode', () => {
    const date = '2026-08-29';
    const pendingRecord = DataFactory.createMockDailyRecord(date, {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'patient-a',
          pathology: 'Dato pendiente de A',
        }),
      },
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:01:00.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'patient-b',
          pathology: 'Dato vigente de B',
        }),
        R2: DataFactory.createMockPatient('R2', { clinicalEpisodeId: 'patient-c' }),
      },
    });

    expect(() =>
      rebasePendingDailyRecordWrite({
        authoritativeRecord,
        pendingTask: {
          taskId: 1,
          record: pendingRecord,
          recordRevision: pendingRecord.lastUpdated,
          changedPaths: ['beds.R1'],
        },
        alreadyAppliedPatch: { 'beds.R2.clinicalCrib': null },
      })
    ).toThrow(ConcurrencyError);
    expect(authoritativeRecord.beds.R1.pathology).toBe('Dato vigente de B');
  });

  it('blocks a pending crib field when that crib was replaced', () => {
    const date = '2026-08-29';
    const buildParent = (cribEpisode: string, pathology: string) =>
      DataFactory.createMockPatient('R1', {
        clinicalEpisodeId: 'same-parent',
        clinicalCrib: DataFactory.createMockPatient('R1', {
          bedMode: 'Cuna',
          clinicalEpisodeId: cribEpisode,
          pathology,
        }),
      });
    const pendingRecord = DataFactory.createMockDailyRecord(date, {
      beds: { R1: buildParent('crib-a', 'Dato pendiente de la cuna A') },
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:01:00.000Z',
      beds: {
        R1: buildParent('crib-b', 'Dato vigente de la cuna B'),
        R2: DataFactory.createMockPatient('R2', { clinicalEpisodeId: 'patient-c' }),
      },
    });

    expect(() =>
      rebasePendingDailyRecordWrite({
        authoritativeRecord,
        pendingTask: {
          taskId: 1,
          record: pendingRecord,
          recordRevision: pendingRecord.lastUpdated,
          changedPaths: ['beds.R1.clinicalCrib.pathology'],
        },
        alreadyAppliedPatch: { 'beds.R2.clinicalCrib': null },
      })
    ).toThrow(ConcurrencyError);
  });

  it('drops an old pending bed value when the confirmed clear supersedes that path', () => {
    const date = '2026-08-29';
    const pendingRecord = DataFactory.createMockDailyRecord(date, {
      beds: {
        R1: DataFactory.createMockPatient('R1', { clinicalEpisodeId: 'patient-a' }),
      },
    });
    const clearedBed = createEmptyPatient('R1');
    const authoritativeRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:01:00.000Z',
      beds: { R1: clearedBed },
    });

    const result = rebasePendingDailyRecordWrite({
      authoritativeRecord,
      pendingTask: {
        taskId: 1,
        record: pendingRecord,
        recordRevision: pendingRecord.lastUpdated,
        changedPaths: ['beds.R1'],
      },
      alreadyAppliedPatch: { 'beds.R1': clearedBed },
    });

    expect(result.record.beds.R1.patientName).toBe('');
    expect(result.record.beds.R1.clinicalEpisodeId).toBeUndefined();
  });

  it('keeps structural blocked-bed metadata pending on the same empty slot', () => {
    const date = '2026-08-29';
    const pendingRecord = DataFactory.createMockDailyRecord(date, {
      beds: { R2: { ...createEmptyPatient('R2'), isBlocked: true, blockedReason: 'Aseo' } },
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:01:00.000Z',
      beds: { R2: createEmptyPatient('R2') },
    });

    const result = rebasePendingDailyRecordWrite({
      authoritativeRecord,
      pendingTask: {
        taskId: 1,
        record: pendingRecord,
        recordRevision: pendingRecord.lastUpdated,
        changedPaths: ['beds.R2.isBlocked', 'beds.R2.blockedReason'],
      },
      alreadyAppliedPatch: { activeExtraBeds: [] },
    });

    expect(result.record.beds.R2.isBlocked).toBe(true);
    expect(result.record.beds.R2.blockedReason).toBe('Aseo');
  });
});

describe('atomic authoritative daily-record adoption', () => {
  beforeEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it('blocks when more than one unresolved task could still write the same date', async () => {
    const date = '2026-08-29';
    const localRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:00:00.000Z',
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:01:00.000Z',
    });
    await hospitalDB.dailyRecords.put(localRecord);
    await hospitalDB.syncQueue.bulkAdd([
      {
        opId: 'processing-write',
        type: 'UPDATE_DAILY_RECORD',
        payload: localRecord,
        timestamp: 1,
        retryCount: 0,
        status: 'PROCESSING',
        key: `daily:${date}`,
      },
      {
        opId: 'pending-write',
        type: 'UPDATE_DAILY_RECORD',
        payload: localRecord,
        timestamp: 2,
        retryCount: 0,
        status: 'PENDING',
        key: `daily:${date}`,
      },
    ]);
    const buildReplacement = vi.fn();

    const result = await createDexieSyncQueueStore().adoptAuthoritativeDailyRecord!(
      authoritativeRecord,
      null,
      buildReplacement
    );

    expect(result).toEqual({ status: 'blocked' });
    expect(buildReplacement).not.toHaveBeenCalled();
    await expect(hospitalDB.dailyRecords.get(date)).resolves.toEqual(localRecord);
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(2);
  });

  it('does not let another owner pending task block authoritative adoption', async () => {
    const date = '2026-08-29';
    const localRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:00:00.000Z',
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:01:00.000Z',
    });
    await hospitalDB.dailyRecords.put(localRecord);
    await hospitalDB.syncQueue.add({
      opId: 'previous-session-write',
      type: 'UPDATE_DAILY_RECORD',
      payload: localRecord,
      timestamp: 1,
      retryCount: 0,
      status: 'PENDING',
      key: `daily:${date}`,
      ownerKey: 'previous-user',
    });
    const buildReplacement = vi.fn();

    const result = await createDexieSyncQueueStore().adoptAuthoritativeDailyRecord!(
      authoritativeRecord,
      'current-user',
      buildReplacement
    );

    expect(result).toEqual({ status: 'adopted', record: authoritativeRecord });
    expect(buildReplacement).not.toHaveBeenCalled();
    await expect(hospitalDB.dailyRecords.get(date)).resolves.toEqual(authoritativeRecord);
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(1);
  });
});
