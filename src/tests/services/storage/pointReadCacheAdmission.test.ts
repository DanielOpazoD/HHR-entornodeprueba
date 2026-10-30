import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import * as indexedDbCore from '@/services/storage/indexeddb/indexedDbCore';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import {
  captureLocalRecordBase,
  inspectLocalRecordAdmission,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const date = '2026-10-29';
const record = (staff: string) =>
  DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-10-29T12:00:00.000Z',
    nursesDayShift: [staff],
  });

describe('atomic point read cache admission', () => {
  const changed = vi.fn();
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    changed.mockClear();
    localStorage.clear();
    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, changed);
  });
  afterEach(async () => {
    window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, changed);
    vi.restoreAllMocks();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });

  it('retains an intervening row and does not announce a discarded write', async () => {
    await hospitalDB.dailyRecords.put(record('BASE'));
    const base = await captureLocalRecordBase(date);
    const intervening = record('OTRO EQUIPO');
    await hospitalDB.dailyRecords.put(intervening);
    const outcome = await saveRecordStrict(record('LECTURA ANTIGUA'), {
      preserveUnresolvedWrites: true,
      expectedBase: base,
    });
    expect(outcome).toMatchObject({ ok: true, superseded: { stored: intervening } });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(intervening);
    expect(changed).not.toHaveBeenCalled();
  });

  it('admits a subsequent read against the actual row, without ordering its clock', async () => {
    await hospitalDB.dailyRecords.put(record('BASE'));
    const base = await captureLocalRecordBase(date);
    const fresh = { ...record('LECTURA NUEVA'), lastUpdated: '2026-10-29T11:00:00.000Z' };
    expect(
      await saveRecordStrict(fresh, { preserveUnresolvedWrites: true, expectedBase: base })
    ).not.toHaveProperty('superseded');
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(fresh);
    expect(changed).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'admits an unknown base only on an absent row: existing %s',
    async existing => {
      if (existing) await hospitalDB.dailyRecords.put(record('YA GUARDADO'));
      const outcome = await saveRecordStrict(record('REMOTO'), {
        preserveUnresolvedWrites: true,
        expectedBase: { kind: 'unknown' },
      });
      expect(Boolean(outcome.superseded)).toBe(existing);
      expect((await hospitalDB.dailyRecords.get(date))?.nursesDayShift).toEqual([
        existing ? 'YA GUARDADO' : 'REMOTO',
      ]);
      expect(changed).toHaveBeenCalledTimes(existing ? 0 : 1);
    }
  );

  it.each(['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT'] satisfies SyncTask['status'][])(
    'retains unresolved %s work before checking the read base',
    async status => {
      const pending = record('EDICION PENDIENTE');
      const task: SyncTask = {
        opId: `synthetic-${status}`,
        key: `daily:${date}`,
        type: 'UPDATE_DAILY_RECORD',
        status,
        payload: pending,
        timestamp: 1,
        retryCount: 0,
      };
      await hospitalDB.dailyRecords.put(pending);
      const id = await hospitalDB.syncQueue.add(task);
      const outcome = await saveRecordStrict(record('REMOTO'), {
        preserveUnresolvedWrites: true,
        expectedBase: { kind: 'stored', record: null },
      });
      expect(outcome.retainedRecord).toEqual(pending);
      expect(outcome.superseded).toBeUndefined();
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(pending);
      expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...task, id });
      expect(changed).not.toHaveBeenCalled();
    }
  );

  it('compares raw rows without treating key order or absent undefined as a change', async () => {
    const original = record('BASE');
    delete original.rayenSyncHistory;
    await hospitalDB.dailyRecords.put(original);
    const base = await captureLocalRecordBase(date);
    await hospitalDB.dailyRecords.put({ rayenSyncHistory: undefined, ...original });
    const fresh = record('LECTURA NUEVA');
    const outcome = await saveRecordStrict(fresh, {
      preserveUnresolvedWrites: true,
      expectedBase: base,
    });
    expect(outcome.superseded).toBeUndefined();
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(fresh);
  });

  it('does not turn a storage read failure into a verified absent base', async () => {
    vi.spyOn(hospitalDB.dailyRecords, 'get').mockRejectedValueOnce(
      new Error('Synthetic IDB failure')
    );
    expect(await captureLocalRecordBase(date)).toEqual({ kind: 'unknown' });
  });

  it('checks and preserves the synchronous fallback row when it changes during a read', async () => {
    vi.spyOn(indexedDbCore, 'isDatabaseInFallbackMode').mockReturnValue(true);
    localPersistence.records.save(record('BASE'));
    const base = await captureLocalRecordBase(date);
    const latest = record('OTRA COPIA');
    localPersistence.records.save(latest);
    const storedLatest = localPersistence.records.getForDate(date);
    expect(
      await saveRecordStrict(record('REMOTO VIEJO'), {
        preserveUnresolvedWrites: true,
        expectedBase: base,
      })
    ).toMatchObject({ ok: true, store: 'fallback', superseded: { stored: storedLatest } });
    expect(localPersistence.records.getForDate(date)).toEqual(storedLatest);
    expect(changed).not.toHaveBeenCalled();
    const freshBase = await captureLocalRecordBase(date);
    expect(
      await saveRecordStrict(record('REMOTO NUEVO'), {
        preserveUnresolvedWrites: true,
        expectedBase: freshBase,
      })
    ).not.toHaveProperty('superseded');
    expect(localPersistence.records.getForDate(date)?.nursesDayShift).toEqual(['REMOTO NUEVO']);
  });

  it('rejects a stale result that needs no hydration, without changing the row', async () => {
    await hospitalDB.dailyRecords.put(record('BASE'));
    const base = await captureLocalRecordBase(date);
    const latest = record('ULTIMA COPIA');
    await hospitalDB.dailyRecords.put(latest);
    expect(await inspectLocalRecordAdmission(date, base, null)).toEqual({
      status: 'superseded',
      stored: latest,
    });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(latest);
    expect(changed).not.toHaveBeenCalled();
  });
});
