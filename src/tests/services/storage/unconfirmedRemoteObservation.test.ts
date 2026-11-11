import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { A, day, clone, harnessState } from './specialistHandoffOutboxHarness';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import {
  subscribeDetailed,
  syncWithFirestoreDetailed,
} from '@/services/repositories/dailyRecordRepositorySyncService';
import { syncRecordsRange } from '@/services/records/recordQueryService';
import { hydrateRangeRecords } from '@/services/admin/dataMaintenanceSupport';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import * as sdk from 'firebase/firestore';
import * as shared from '@/services/storage/firestore/firestoreShared';
import type { DailyRecord } from '@/types/domain/dailyRecord';
const wire = vi.hoisted(() => ({
  emit: undefined as
    | undefined
    | ((
        r: DailyRecord | null,
        p: boolean,
        m: { fromCache: boolean; hasPendingWrites: boolean }
      ) => void),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: (_: string, cb: typeof wire.emit) => {
    wire.emit = cb;
    return () => {
      wire.emit = undefined;
    };
  },
}));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
}));
const DATE = '2026-10-24';
const local = day(DATE, { R4: A() });
const remote = {
  ...clone(local),
  lastUpdated: '2026-10-24T18:00:00.000Z',
  nursesDayShift: ['SDK cache'],
};
const event = vi.fn();
beforeEach(async () => {
  vi.spyOn(sdk, 'getDocs').mockResolvedValue({ docs: [] } as never);
  vi.spyOn(sdk, 'getDocsFromServer').mockResolvedValue({ docs: [] } as never);
  vi.spyOn(sdk, 'query').mockReturnValue({} as never);
  vi.spyOn(shared, 'getRecordsCollection').mockReturnValue({} as never);
  harnessState().offline = false;
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.put(clone(local));
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
  event.mockClear();
});
afterEach(async () => {
  window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  vi.restoreAllMocks();
});
for (const path of ['S', 'E', 'P', 'R', 'M'] as const)
  for (const pending of path === 'R' || path === 'M' ? [false, true] : [false])
    it(`${path} cached/pending=${pending} keeps durable and returns local`, async () => {
      const metadata = { fromCache: !pending, hasPendingWrites: pending };
      vi.mocked(sdk.getDoc).mockResolvedValue({
        exists: () => true,
        data: () => clone(remote),
        metadata,
      } as never);
      const snapshot = { docs: [{ id: DATE, data: () => clone(remote) }], metadata };
      vi.mocked(sdk.getDocs).mockResolvedValue(snapshot as never);
      vi.mocked(sdk.getDocsFromServer).mockResolvedValue(snapshot as never);
      const put = vi.spyOn(hospitalDB.dailyRecords, 'put'),
        bulk = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
      let record;
      if (path === 'S') {
        const r = await new Promise<Awaited<ReturnType<typeof syncWithFirestoreDetailed>>>(
          resolve => {
            const stop = subscribeDetailed(DATE, r => {
              stop();
              resolve(r);
            });
            wire.emit!(clone(remote), pending, metadata);
          }
        );
        expect.soft(r).toMatchObject({
          serverConfirmed: false,
          sourceOfTruth: 'local',
          consistencyState: 'blocked',
        });
        record = r?.record;
      } else if (path === 'E' || path === 'P') {
        const r = await (path === 'E' ? syncWithFirestoreDetailed(DATE) : getForDateWithMeta(DATE));
        expect.soft(r).toMatchObject({
          serverConfirmed: false,
          sourceOfTruth: 'local',
          consistencyState: path === 'P' ? 'local_authoritative' : 'blocked',
        });
        record = r?.record;
      } else
        record = (await (path === 'R' ? syncRecordsRange : hydrateRangeRecords)(DATE, DATE))[0];
      expect.soft(record).toMatchObject({ nursesDayShift: local.nursesDayShift });
      expect.soft(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
      expect(put).not.toHaveBeenCalled();
      expect(bulk).not.toHaveBeenCalled();
      expect(event).not.toHaveBeenCalled();
    });
for (const path of ['S', 'E', 'P'] as const)
  it(`${path} cached absence without local is unavailable`, async () => {
    await hospitalDB.dailyRecords.clear();
    const metadata = { fromCache: true, hasPendingWrites: false };
    vi.mocked(sdk.getDoc).mockResolvedValue({ exists: () => false, metadata } as never);
    const r =
      path === 'S'
        ? await new Promise<Awaited<ReturnType<typeof syncWithFirestoreDetailed>>>(resolve => {
            const stop = subscribeDetailed(DATE, r => {
              stop();
              resolve(r);
            });
            wire.emit!(null, false, metadata);
          })
        : await (path === 'E' ? syncWithFirestoreDetailed(DATE) : getForDateWithMeta(DATE));
    expect.soft(r).toMatchObject({
      record: null,
      serverConfirmed: false,
      sourceOfTruth: 'none',
      consistencyState: path === 'P' ? 'unavailable' : 'blocked',
    });
    expect(event).not.toHaveBeenCalled();
  });

vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'synthetic@example.invalid',
}));
vi.mock('@/services/exporters/clinicalDerivedBackupSection', () => ({
  buildClinicalDerivedBackupSection: vi.fn(),
  describeIncompleteClinicalDerivedBackup: vi.fn(),
}));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

it('MINSAL can calculate from the retained local range without admitting SDK cache', async () => {
  const { calculateMinsalStats } = await import('@/services/calculations/minsalStatsCalculator');
  vi.mocked(sdk.getDocs).mockResolvedValue({
    docs: [],
    metadata: { fromCache: true, hasPendingWrites: false },
  } as never);
  const records = await syncRecordsRange(DATE, DATE);
  expect(calculateMinsalStats(records, DATE, DATE)).toEqual(
    calculateMinsalStats([local], DATE, DATE)
  );
  expect(records).toEqual([local]);
  expect(event).not.toHaveBeenCalled();
});
it.each(['month', 'year'])(
  '%s backup still downloads the local records for an unconfirmed batch',
  async scope => {
    const { exportMonthRecordsWithOutcome, exportYearToDateRecordsWithOutcome } =
      await import('@/services/admin/dataMaintenanceService');
    const { saveAs } = await import('file-saver');
    vi.mocked(saveAs).mockClear();
    vi.mocked(sdk.getDocs).mockResolvedValue({
      docs: [],
      metadata: { fromCache: true, hasPendingWrites: false },
    } as never);
    const result = await (scope === 'month'
      ? exportMonthRecordsWithOutcome(2026, 10)
      : exportYearToDateRecordsWithOutcome(2026));
    expect(result.status).toBe('success');
    const blob = vi.mocked(saveAs).mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob as Blob);
    });
    expect(JSON.parse(text).records).toEqual([local]);
    expect(event).not.toHaveBeenCalled();
  }
);
it.each([syncRecordsRange, hydrateRangeRecords])(
  'no local copy and unconfirmed range rejects instead of confirming emptiness (%s)',
  async read => {
    await hospitalDB.dailyRecords.clear();
    vi.mocked(sdk.getDocs).mockResolvedValue({
      docs: [],
      metadata: { fromCache: true, hasPendingWrites: false },
    } as never);
    await expect(read(DATE, DATE)).rejects.toThrow('no server confirmation');
    expect(event).not.toHaveBeenCalled();
  }
);

for (const path of ['S', 'E', 'P'] as const)
  it(`${path} adopts cache without local and allows offline edit after logout`, async () => {
    const { clearSessionDailyRecords } =
      await import('@/services/storage/sessionSyncQueuePreservation');
    await clearSessionDailyRecords('user:review3');
    expect(await hospitalDB.dailyRecords.count()).toBe(0);
    event.mockClear();
    const metadata = { fromCache: true, hasPendingWrites: false };
    vi.mocked(sdk.getDoc).mockResolvedValue({
      exists: () => true,
      data: () => clone(remote),
      metadata,
    } as never);
    const r =
      path === 'S'
        ? await new Promise<Awaited<ReturnType<typeof syncWithFirestoreDetailed>>>(resolve => {
            const stop = subscribeDetailed(DATE, r => {
              stop();
              resolve(r);
            });
            wire.emit!(clone(remote), false, metadata);
          })
        : await (path === 'E' ? syncWithFirestoreDetailed(DATE) : getForDateWithMeta(DATE));
    expect(r?.serverConfirmed).toBe(false);
    expect(await hospitalDB.dailyRecords.count()).toBe(1);
    expect(r?.record?.nursesDayShift).toEqual(remote.nursesDayShift);
    expect(event).toHaveBeenCalledOnce();
    if (process.env.CACHE_OUTPUT) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(
        process.env.CACHE_OUTPUT,
        JSON.stringify({
          path,
          result: r,
          row: await hospitalDB.dailyRecords.get(DATE),
          events: event.mock.calls.length,
        }) + '\n'
      );
    }
    harnessState().offline = true;
    const result = await updatePartialDetailed(
      DATE,
      { nursesDayShift: ['Offline after logout'] },
      { baseRecord: r!.record! }
    );
    expect(result.savedLocally).toBe(true);
    expect(await hospitalDB.dailyRecords.count()).toBe(1);
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('PENDING');
  });
for (const path of ['S', 'E', 'P'] as const)
  it(`${path} confirmed document still replaces local after cache was ignored`, async () => {
    const run = async (confirmed: boolean) => {
      const metadata = { fromCache: !confirmed, hasPendingWrites: false };
      vi.mocked(sdk.getDoc).mockResolvedValue({
        exists: () => true,
        data: () => clone(remote),
        metadata,
      } as never);
      if (path !== 'S')
        return path === 'E' ? syncWithFirestoreDetailed(DATE) : getForDateWithMeta(DATE);
      return new Promise<Awaited<ReturnType<typeof syncWithFirestoreDetailed>>>(resolve => {
        const stop = subscribeDetailed(DATE, r => {
          stop();
          resolve(r);
        });
        wire.emit!(clone(remote), false, metadata);
      });
    };
    await run(false);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
    const r = await run(true);
    expect(r?.serverConfirmed).toBe(true);
    expect((await hospitalDB.dailyRecords.get(DATE))?.nursesDayShift).toEqual(
      remote.nursesDayShift
    );
    expect(event).toHaveBeenCalledOnce();
  });
