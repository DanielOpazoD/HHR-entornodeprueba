import { beforeEach, describe, expect, it } from 'vitest';

import {
  getAuthoritativeForDate,
  getForDateWithMeta,
  getLocalForDate,
  getLocalForDateWithMeta,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync/publicSyncQueue';
import type { DailyRecord } from '@/types/domain/dailyRecord';

// Local-only reads against the real Dexie store (fake-indexeddb). Reads that involve Firestore
// run against the real emulator in
// src/tests/emulator-ui/dailyRecordRepositoryReadService.emulator-ui.test.ts.

const date = '2026-03-19';

const buildRecord = (lastUpdated: string, beds: Record<string, unknown> = {}): DailyRecord =>
  ({
    date,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNightReceives: [],
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    schemaVersion: 1,
  }) as unknown as DailyRecord;

/** An unsynced edit as the app stores it: the local copy and its outbox task, never processed. */
const queueLocalEdit = async (record: DailyRecord) => {
  const result = await queueDailyRecordSyncTaskWithLocalRecord(record, undefined, {
    deferProcessing: true,
  });
  expect(result.accepted).toBe(true);
};

describe('dailyRecordRepositoryReadService on the real local store', () => {
  beforeEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    setFirestoreEnabled(true);
    window.localStorage.clear();
    window.__HHR_E2E_OVERRIDE__ = undefined;
  });

  it('rejects invalid e2e seed JSON with its storage key instead of reading it as absent', async () => {
    await hospitalDB.dailyRecords.put(buildRecord('2026-03-19T12:00:00.000Z'));
    window.__HHR_E2E_OVERRIDE__ = {};
    localStorage.setItem('hanga_roa_hospital_data', '{invalid');

    await expect(getLocalForDate(date)).rejects.toThrow('hanga_roa_hospital_data');
  });

  it('rejects an empty e2e seed value while preserving absence of the key', async () => {
    window.__HHR_E2E_OVERRIDE__ = {};
    localStorage.setItem('hanga_roa_hospital_data', '');

    await expect(getLocalForDate(date)).rejects.toThrow('hanga_roa_hospital_data');
  });

  it('keeps an absent e2e seed as no record', async () => {
    window.__HHR_E2E_OVERRIDE__ = {};

    await expect(getLocalForDate(date)).resolves.toBeNull();
  });

  it('ignores invalid e2e storage without the override', async () => {
    const local = buildRecord('2026-03-19T12:00:00.000Z');
    await hospitalDB.dailyRecords.put(local);
    localStorage.setItem('hanga_roa_hospital_data', '{invalid');

    await expect(getLocalForDate(date)).resolves.toEqual(local);
  });

  it('fails closed when structural planning has no remote authority', async () => {
    await hospitalDB.dailyRecords.put(buildRecord('2026-03-19T12:00:00.000Z'));
    setFirestoreEnabled(false);

    await expect(getAuthoritativeForDate(date)).rejects.toThrow(
      'requiere una versión autoritativa remota'
    );
  });

  it('reports active outbox proof for the exact local record version', async () => {
    const local = buildRecord('2026-03-19T12:00:05.000Z');
    await queueLocalEdit(local);

    await expect(getLocalForDateWithMeta(date)).resolves.toEqual({
      record: local,
      hasPendingWrites: true,
      hasPendingWritesForDate: true,
      writeState: 'active',
    });
  });

  it('reports a pending write for the date even when the local revision does not match it', async () => {
    await queueLocalEdit(buildRecord('2026-03-19T12:00:05.000Z'));
    const newer = buildRecord('2026-03-19T12:00:09.000Z');
    await hospitalDB.dailyRecords.put(newer);

    await expect(getLocalForDateWithMeta(date)).resolves.toEqual({
      record: newer,
      hasPendingWrites: false,
      hasPendingWritesForDate: true,
      writeState: 'none',
    });
  });

  it('keeps a failed write for the exact version visible without calling it in flight', async () => {
    const local = buildRecord('2026-03-19T12:00:05.000Z');
    await queueLocalEdit(local);
    const [task] = await hospitalDB.syncQueue.toArray();
    await hospitalDB.syncQueue.update(task.id!, { status: 'FAILED' });

    await expect(getLocalForDateWithMeta(date)).resolves.toEqual({
      record: local,
      hasPendingWrites: false,
      hasPendingWritesForDate: true,
      writeState: 'failed',
    });
    expect(await hospitalDB.syncQueue.count()).toBe(1);
  });

  it('uses the E2E runtime override as the remote record over a stale local copy', async () => {
    await hospitalDB.dailyRecords.put(
      buildRecord('2026-03-19T08:00:00.000Z', {
        R1: { bedId: 'R1', patientName: 'INDEXEDDB STALE', handoffNote: '' },
      })
    );
    const localSeed = buildRecord('2026-03-19T12:00:00.000Z', {
      R1: {
        bedId: 'R1',
        patientName: 'LOCAL SEEDED',
        rut: '11.111.111-1',
        admissionDate: date,
        pathology: 'LOCAL DX',
        handoffNote: 'LOCAL NOTE',
      },
    });
    const remoteOverride = buildRecord('2026-03-19T09:00:00.000Z', {
      R1: {
        bedId: 'R1',
        patientName: 'REMOTE CANONICAL',
        rut: '11.111.111-1',
        admissionDate: date,
        pathology: 'REMOTE DX',
        handoffNote: '',
      },
    });
    window.localStorage.setItem('hanga_roa_hospital_data', JSON.stringify({ [date]: localSeed }));
    window.__HHR_E2E_OVERRIDE__ = { [date]: remoteOverride };

    const result = await getForDateWithMeta(date);

    expect(result.record?.beds.R1.patientName).toBe('REMOTE CANONICAL');
    expect(result.record?.beds.R1.pathology).toBe('REMOTE DX');
    expect(result.record?.beds.R1.handoffNote).toBe('');
  });
});
