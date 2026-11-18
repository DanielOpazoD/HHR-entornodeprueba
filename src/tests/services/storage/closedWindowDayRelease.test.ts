/* Synthetic only: stopped day writes released past the nurse window, against the real local stores. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
import { releaseClosedWindowRefusals } from '@/services/storage/sync/closedWindowDayRelease';
import { isClosedNurseWindowRefusal } from '@/services/storage/sync/dailyRecordBaseReview';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const date = '2026-11-15';
const owner = 'user:synthetic-nurse';
const closesAt = clinicalWallClockToDate(date, '00:00').getTime() + 48 * 3_600_000;
const after = closesAt + 60_000;
const night = 'handoffNovedadesNightShift';
const dx = 'beds.R1.pathology';
const day = (overrides: Partial<DailyRecord> = {}, pathology = 'DX BASE'): DailyRecord =>
  ({
    ...DataFactory.createMockDailyRecord(date, {
      handoffNovedadesDayShift: 'DIA BASE',
      handoffNovedadesNightShift: 'NOCHE BASE',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'ANA SINTETICA',
          rut: '12.345.678-5',
          clinicalEpisodeId: 'synthetic-episode-R1',
          pathology,
        }),
      },
    }),
    ...overrides,
  }) as DailyRecord;
/** A note and a diagnosis this computer wrote over the base and the server refused. */
const edited = day({ [night]: 'NOTA RECHAZADA' }, 'DX RECHAZADO');
const refused = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'synthetic-refused',
  ownerKey: owner,
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  payload: edited,
  timestamp: 1,
  retryCount: 0,
  status: 'FAILED',
  lastErrorCode: 'permission-denied',
  syncContract: { changedPaths: [night, dx] },
  patchBaseValues: { [night]: 'NOCHE BASE', [dx]: 'DX BASE' },
  ...overrides,
});
const release = (mayRelease = vi.fn(async () => true), now = after) =>
  releaseClosedWindowRefusals(owner, now, mayRelease);

let notices: unknown[] = [];
const onStoreChanged = (event: Event) => notices.push((event as CustomEvent).detail);
beforeEach(async () => {
  notices = [];
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, onStoreChanged);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});
afterEach(() => {
  window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, onStoreChanged);
  vi.restoreAllMocks();
});

describe('a send refused after the nurse window closed', () => {
  it('gives its fields back to the stored day and keeps the task, its payload and the rest of the day', async () => {
    await hospitalDB.dailyRecords.put({ ...edited, handoffNovedadesDayShift: 'OTRO EQUIPO' });
    const id = (await hospitalDB.syncQueue.add(refused())) as number;

    expect(await release()).toEqual([date]);

    const stored = await hospitalDB.dailyRecords.get(date);
    expect(stored?.[night]).toBe('NOCHE BASE');
    expect(stored?.beds.R1.pathology).toBe('DX BASE');
    expect(stored?.handoffNovedadesDayShift).toBe('OTRO EQUIPO');
    expect(stored?.lastUpdated).toBe(edited.lastUpdated);
    expect(await hospitalDB.syncQueue.get(id)).toEqual({
      ...refused(),
      id,
      projectionReleased: true,
    });
    expect(notices).toEqual([{ operation: 'release', dates: [date], paths: [night, dx] }]);
  });

  it('leaves a field another pending write also changed, and gives back the others', async () => {
    await hospitalDB.dailyRecords.put(edited);
    await hospitalDB.syncQueue.add(refused());
    await hospitalDB.syncQueue.add(
      refused({
        opId: 'synthetic-pending',
        ownerKey: 'user:synthetic-other',
        status: 'PENDING',
        lastErrorCode: undefined,
        syncContract: { changedPaths: [dx] },
      })
    );

    await release();

    const stored = await hospitalDB.dailyRecords.get(date);
    expect(stored?.[night]).toBe('NOCHE BASE');
    expect(stored?.beds.R1.pathology).toBe('DX RECHAZADO');
    expect(notices).toEqual([{ operation: 'release', dates: [date], paths: [night] }]);
  });

  it('keeps a stored day that never showed its values (a send queued without writing the day)', async () => {
    const server = day({ [night]: 'NOCHE DEL SERVIDOR' });
    await hospitalDB.dailyRecords.put(server);
    await hospitalDB.syncQueue.add(refused());

    await release();

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(server);
  });

  it('keeps a field whose base it did not keep, and a bed that now holds another episode (ID-01)', async () => {
    const otherEpisode = {
      ...edited,
      beds: {
        R1: {
          ...edited.beds.R1,
          patientName: 'BETO SINTETICO',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'synthetic-episode-other',
        },
      },
    };
    await hospitalDB.dailyRecords.put(otherEpisode);
    await hospitalDB.syncQueue.add(refused({ patchBaseValues: { [dx]: 'DX BASE' } }));

    await release();

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(otherEpisode);
  });

  it('changes nothing, and asks for no role, when no send of this owner is refused past its window', async () => {
    await hospitalDB.dailyRecords.put(edited);
    await hospitalDB.syncQueue.bulkAdd([
      refused({ ownerKey: 'user:synthetic-other' }),
      refused({ opId: 'synthetic-open', lastErrorCode: 'failed-precondition' }),
      refused({ opId: 'synthetic-released', projectionReleased: true }),
    ]);
    const mayRelease = vi.fn(async () => true);

    expect(await release(mayRelease)).toEqual([]);
    expect(await release(mayRelease, closesAt - 1)).toEqual([]);

    expect(mayRelease).not.toHaveBeenCalled();
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(edited);
    expect(notices).toEqual([]);
  });

  it('changes nothing for a role without a window (the administrator) or an unknown one', async () => {
    await hospitalDB.dailyRecords.put(edited);
    const id = (await hospitalDB.syncQueue.add(refused())) as number;

    expect(await release(vi.fn(async () => false))).toEqual([]);

    expect((await hospitalDB.syncQueue.get(id))?.projectionReleased).toBeUndefined();
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(edited);
  });

  it('keeps both stores as they were when the release cannot commit, and releases on the next pass', async () => {
    await hospitalDB.dailyRecords.put(edited);
    const id = (await hospitalDB.syncQueue.add(refused())) as number;
    vi.spyOn(hospitalDB.dailyRecords, 'put').mockRejectedValueOnce(new Error('synthetic abort'));

    await expect(release()).rejects.toThrow('synthetic abort');
    expect((await hospitalDB.syncQueue.get(id))?.projectionReleased).toBeUndefined();
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(edited);
    expect(notices).toEqual([]);

    expect(await release()).toEqual([date]);
    expect((await hospitalDB.dailyRecords.get(date))?.[night]).toBe('NOCHE BASE');
  });
});

describe('which stopped sends the closed window releases', () => {
  const task = {
    type: 'UPDATE_DAILY_RECORD' as const,
    key: `daily:${date}`,
    status: 'FAILED' as const,
    lastErrorCode: 'permission-denied',
  };

  it('releases a refused census day once its window closed, on either server path', () => {
    expect(isClosedNurseWindowRefusal(task, closesAt)).toBe(true);
    expect(
      isClosedNurseWindowRefusal(
        { ...task, lastErrorCode: 'functions/permission-denied' },
        closesAt
      )
    ).toBe(true);
  });

  it.each([
    ['inside the window (a role change)', task, closesAt - 1],
    ['another stop reason', { ...task, lastErrorCode: 'failed-precondition' }, closesAt],
    ['a send that may still retry', { ...task, status: 'PENDING' as const }, closesAt],
    ['a detached part of the day', { ...task, key: `daily:${date}:detached:R1` }, closesAt],
    ['a future day', { ...task, key: 'daily:2026-11-30' }, closesAt],
    ['an impossible day', { ...task, key: 'daily:2026-02-30' }, closesAt],
    ['another kind of send', { ...task, type: 'UPDATE_PATIENT' as const }, closesAt],
  ])('keeps %s as before', (_case, candidate, now) => {
    expect(isClosedNurseWindowRefusal(candidate, now)).toBe(false);
  });
});
