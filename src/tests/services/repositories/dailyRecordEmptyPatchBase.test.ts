import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';

vi.mock('@/services/repositories/repositoryConfig', async original => ({
  ...(await original<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => false,
}));

const date = '2026-10-24';
const record = (): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T10:00:00.000Z`,
  nurses: [],
  activeExtraBeds: [],
});
const event = (id: string): RayenSyncEvent => ({
  id,
  startedAt: `${date}T11:00:00.000Z`,
  completedAt: `${date}T11:00:01.000Z`,
  by: 'OPERADOR SINTETICO',
  status: 'failed',
  failureReason: 'snapshot_error',
});
const cases: Array<[string, unknown, DailyRecordPatch]> = [
  ['rayenSyncHistory', [], { rayenSyncHistory: [event('run-a')] }],
  ['rayenSyncHistory', null, { rayenSyncHistory: [event('run-a')] }],
  ['rayenBedCollisionResolutions', [], { rayenBedCollisionResolutions: [] }],
  ['bedTypeOverrides', {}, { bedTypeOverrides: {} }],
  ['handoffDayChecklist', {}, { handoffDayChecklist: {} }],
  ['handoffNightChecklist', {}, { handoffNightChecklist: {} }],
  ['handoffNovedadesDayShift', '', { handoffNovedadesDayShift: 'NOVEDAD SINTETICA' }],
];

describe('patch bases with optional empty cache fields', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(cases)(
    'accepts an empty %s against an absent stored field with no pending work',
    async (field, empty, patch) => {
      const stored = record();
      await hospitalDB.dailyRecords.put(stored);
      expect(await hospitalDB.syncQueue.count()).toBe(0);
      const result = await updatePartialDetailed(date, patch, {
        baseRecord: { ...stored, [field]: empty },
      });
      expect(result.savedLocally).toBe(true);
      expect(await hospitalDB.dailyRecords.get(date)).toMatchObject(patch);
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].payload).toMatchObject(patch);
    }
  );

  it('retains two concurrent Rayen runs that started from the same empty history', async () => {
    const base = { ...record(), rayenSyncHistory: [] };
    await hospitalDB.dailyRecords.put(base);
    const results = await Promise.all([
      updatePartialDetailed(date, { rayenSyncHistory: [event('run-a')] }, { baseRecord: base }),
      updatePartialDetailed(date, { rayenSyncHistory: [event('run-b')] }, { baseRecord: base }),
    ]);
    expect(results.every(result => result.savedLocally)).toBe(true);
    for (const value of [
      await hospitalDB.dailyRecords.get(date),
      (await hospitalDB.syncQueue.toArray())[0]?.payload as DailyRecord,
    ]) {
      expect(value?.rayenSyncHistory?.map(run => run.id).sort()).toEqual(['run-a', 'run-b']);
    }
  });

  it('rejects a stale empty narrative after another accepted write fills it', async () => {
    const base = { ...record(), handoffNovedadesDayShift: '' };
    await hospitalDB.dailyRecords.put(base);
    await updatePartialDetailed(
      date,
      { handoffNovedadesDayShift: 'NOVEDAD A' },
      { baseRecord: base }
    );
    await expect(
      updatePartialDetailed(
        date,
        { handoffNovedadesDayShift: 'NOVEDAD B' },
        {
          baseRecord: base,
        }
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await hospitalDB.dailyRecords.get(date))?.handoffNovedadesDayShift).toBe('NOVEDAD A');
  });

  it('requires an exact proposed value match when the patch base is stale', async () => {
    const stored = record();
    await hospitalDB.dailyRecords.put(stored);
    await expect(
      updatePartialDetailed(
        date,
        { handoffNovedadesDayShift: '' },
        {
          baseRecord: { ...stored, handoffNovedadesDayShift: 'NOVEDAD ANTERIOR' },
        }
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(stored);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });
});
