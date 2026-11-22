/* Synthetic only: stopped day writes released past the nurse window, against the real local stores. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
import { releaseClosedWindowRefusals } from '@/services/storage/sync/closedWindowDayRelease';
import { isClosedNurseWindowRefusal } from '@/services/storage/sync/dailyRecordBaseReview';
import { admitRemoteDailyRecords } from '@/services/repositories/dailyRecordLocalCachePersistence';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { SESSION_OWNER_KEY } from '@/services/session/sessionOwnerKey';
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
const day = (
  overrides: Partial<DailyRecord> = {},
  pathology = 'DX BASE',
  lastUpdated = '2026-11-15T12:00:00.000Z'
): DailyRecord =>
  ({
    ...DataFactory.createMockDailyRecord(date, {
      lastUpdated,
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
/** This computer's copy: a diagnosis the server refused (A) and a note still pending (B). */
const local = day({ [night]: 'NOTA PENDIENTE' }, 'DX RECHAZADO', '2026-11-15T13:00:00.000Z');
const refused = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'synthetic-refused',
  ownerKey: owner,
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  payload: day({}, 'DX RECHAZADO', '2026-11-15T12:30:00.000Z'),
  timestamp: 1,
  retryCount: 0,
  status: 'FAILED',
  lastErrorCode: 'permission-denied',
  syncContract: { changedPaths: [dx] },
  patchBaseValues: { [dx]: 'DX BASE' },
  ...overrides,
});
const pending = (overrides: Partial<SyncTask> = {}): SyncTask =>
  refused({
    opId: 'synthetic-pending',
    status: 'PENDING',
    lastErrorCode: undefined,
    payload: local,
    syncContract: { changedPaths: [night] },
    patchBaseValues: { [night]: 'NOCHE BASE' },
    ...overrides,
  });
/** The server already has another computer's correction of the refused diagnosis. */
const server = day({}, 'CORRECCION DE OTRO EQUIPO', '2026-11-15T14:00:00.000Z');
const release = (mayRelease = vi.fn(async () => true), now = after) =>
  releaseClosedWindowRefusals(owner, now, mayRelease);
const confirmedRead = async (record: DailyRecord = server) =>
  (await admitRemoteDailyRecords([{ record, remoteRecord: record, serverConfirmed: true }]))[0];

let notices: unknown[] = [];
const onStoreChanged = (event: Event) => notices.push((event as CustomEvent).detail);
beforeEach(async () => {
  notices = [];
  localStorage.setItem(SESSION_OWNER_KEY, owner);
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, onStoreChanged);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});
afterEach(() => {
  window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, onStoreChanged);
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('releasing a send refused after the nurse window closed', () => {
  it('only marks the task, writes nothing on the stored day, and asks for the day to be read', async () => {
    await hospitalDB.dailyRecords.put(local);
    const id = (await hospitalDB.syncQueue.add(refused())) as number;

    expect(await release()).toEqual([date]);

    expect(await hospitalDB.syncQueue.get(id)).toEqual({
      ...refused(),
      id,
      projectionReleased: true,
    });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(local);
    expect(notices).toEqual([{ operation: 'release', dates: [date], paths: [dx] }]);
  });

  it('changes nothing, and asks for no role, when no send of this owner is refused past its window', async () => {
    await hospitalDB.syncQueue.bulkAdd([
      refused({ ownerKey: 'user:synthetic-other' }),
      refused({ opId: 'synthetic-open', lastErrorCode: 'failed-precondition' }),
      refused({ opId: 'synthetic-released', projectionReleased: true }),
    ]);
    const before = await hospitalDB.syncQueue.toArray();
    const mayRelease = vi.fn(async () => true);

    expect(await release(mayRelease)).toEqual([]);
    expect(await release(mayRelease, closesAt - 1)).toEqual([]);

    expect(mayRelease).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
    expect(notices).toEqual([]);
  });

  it('changes nothing when the session may not release (a role without a window, another tab)', async () => {
    const id = (await hospitalDB.syncQueue.add(refused())) as number;

    expect(await release(vi.fn(async () => false))).toEqual([]);

    expect((await hospitalDB.syncQueue.get(id))?.projectionReleased).toBeUndefined();
    expect(notices).toEqual([]);
  });
});

describe('a confirmed server read of a day that pending writes hold', () => {
  it('shows the server’s version with the pending note, never the refused diagnosis', async () => {
    await hospitalDB.dailyRecords.put(local);
    await hospitalDB.syncQueue.bulkAdd([refused({ projectionReleased: true }), pending()]);

    const read = await confirmedRead();

    expect(read).toMatchObject({ status: 'retained_pending', serverComposed: true });
    expect(read.record?.beds.R1.pathology).toBe('CORRECCION DE OTRO EQUIPO');
    expect(read.record?.[night]).toBe('NOTA PENDIENTE');
    // The stored copy is that same day, under the version its pending write was written on.
    const stored = await hospitalDB.dailyRecords.get(date);
    expect(stored?.beds.R1.pathology).toBe('CORRECCION DE OTRO EQUIPO');
    expect(stored?.[night]).toBe('NOTA PENDIENTE');
    expect(stored?.lastUpdated).toBe(local.lastUpdated);
    // No task changed.
    expect((await hospitalDB.syncQueue.toArray()).map(task => task.payload)).toEqual([
      refused().payload,
      local,
    ]);
  });

  it('shows another computer’s correction with this computer’s pending edit, with no refusal at all', async () => {
    const edited = day({ [night]: 'NOTA PENDIENTE' }, 'DX BASE', '2026-11-15T13:00:00.000Z');
    await hospitalDB.dailyRecords.put(edited);
    await hospitalDB.syncQueue.add(pending({ payload: edited }));

    const read = await confirmedRead();

    expect(read).toMatchObject({ status: 'retained_pending', serverComposed: true });
    expect(read.record?.beds.R1.pathology).toBe('CORRECCION DE OTRO EQUIPO');
    expect(read.record?.[night]).toBe('NOTA PENDIENTE');
  });

  it('adds nothing from a retired send (its edits were discarded with a backup)', async () => {
    await hospitalDB.dailyRecords.put(local);
    await hospitalDB.syncQueue.bulkAdd([
      refused({
        status: 'RETIRED',
        retirement: {
          reason: 'empty_capture_without_census_context',
          retiredAt: 'x',
          authorityDate: date,
          verifiedRunId: 'r',
        },
      }),
      pending(),
    ]);

    const read = await confirmedRead();

    expect(read).toMatchObject({ status: 'retained_pending', serverComposed: true });
    expect(read.record?.beds.R1.pathology).toBe('CORRECCION DE OTRO EQUIPO');
  });

  it.each([
    ['a pending write without its paths', pending({ syncContract: { changedPaths: ['*'] } })],
    [
      'a pending write whose bed now holds another patient (ID-01)',
      pending({ syncContract: { changedPaths: ['beds.R1.diagnosisComments'] } }),
    ],
  ])('keeps the stored copy, unconfirmed, for %s', async (_case, holder) => {
    await hospitalDB.dailyRecords.put(local);
    await hospitalDB.syncQueue.bulkAdd([refused({ projectionReleased: true }), holder]);
    const otherPatient = day({}, 'DX OTRO');
    otherPatient.beds.R1 = {
      ...otherPatient.beds.R1,
      patientName: 'BETO SINTETICO',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'synthetic-episode-other',
    };
    const remote = holder.syncContract?.changedPaths?.includes('*') ? server : otherPatient;

    const read = await confirmedRead(remote);

    expect(read).toMatchObject({ status: 'retained_pending', serverComposed: false });
    expect(read.record).toEqual(local);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(local);
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
    [
      'the day-handover base review',
      { ...task, lastErrorCode: 'sync_daily_record_base_review' },
      closesAt,
    ],
    ['a send that may still retry', { ...task, status: 'PENDING' as const }, closesAt],
    ['a detached part of the day', { ...task, key: `daily:${date}:detached:R1` }, closesAt],
    ['a future day', { ...task, key: 'daily:2026-11-30' }, closesAt],
    ['an impossible day', { ...task, key: 'daily:2026-02-30' }, closesAt],
    ['another kind of send', { ...task, type: 'UPDATE_PATIENT' as const }, closesAt],
  ])('keeps %s as before', (_case, candidate, now) => {
    expect(isClosedNurseWindowRefusal(candidate, now)).toBe(false);
  });
});
