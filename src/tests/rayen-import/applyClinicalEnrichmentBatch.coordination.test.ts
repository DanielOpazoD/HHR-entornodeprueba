import { describe, expect, it, vi } from 'vitest';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import { rebuildClinicalEnrichmentOperations } from '@/features/rayen-import/domain/rebuildClinicalEnrichmentOperations';
import {
  getDailyRecordWriteState,
  runExclusiveDailyRecordWrite,
  runWithDailyRecordWriteLock,
} from '@/services/repositories/dailyRecordWriteCoordinator';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDependencies, operations, record } from './applyClinicalEnrichmentBatch.fixtures';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(next => {
    resolve = next;
  });
  return { promise, resolve };
};
const baseRecord = (): DailyRecord =>
  ({
    ...record,
    beds: {
      H2C1: DataFactory.createMockPatient('H2C1', { clinicalEpisodeId: 'episode-1' }),
      H2C2: DataFactory.createMockPatient('H2C2', { clinicalEpisodeId: 'episode-2' }),
    },
  }) as DailyRecord;

describe('clinical batches share the census write turn', () => {
  it('refreshes a committed batch with its own reader; the write-turn read stays the rebuild input', async () => {
    const deps = createDependencies();
    const refreshCommittedRecord = vi.fn().mockResolvedValue(undefined);

    await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-committed-refresh',
      operations,
      ...deps,
      refreshCommittedRecord,
    });

    expect(deps.invoke).toHaveBeenCalledOnce();
    expect(deps.refreshRecord).toHaveBeenCalledOnce();
    expect(refreshCommittedRecord).toHaveBeenCalledOnce();
    expect(refreshCommittedRecord.mock.invocationCallOrder[0]).toBeGreaterThan(
      deps.invoke.mock.invocationCallOrder[0]!
    );
  });

  it('revalidates after a preceding manual write and keeps its specialty decision', async () => {
    const base = baseRecord();
    let current = base;
    const manualStarted = deferred();
    const releaseManual = deferred();
    const manual = runExclusiveDailyRecordWrite(base.date, async () => {
      manualStarted.resolve();
      await releaseManual.promise;
      current = {
        ...base,
        lastUpdated: '2026-07-28T10:01:00.000Z',
        meta: { revision: 8 },
        beds: { ...base.beds, H2C1: { ...base.beds.H2C1, specialty: 'Cirugía' } },
      } as DailyRecord;
    });
    await manualStarted.promise;
    const deps = createDependencies();
    deps.refreshRecord.mockImplementation(async () => current);
    const batch = applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record: base,
      runId: 'run-after-manual',
      operations,
      ...deps,
      rebuildOperations: fresh =>
        rebuildClinicalEnrichmentOperations({
          baseRecord: base,
          currentRecord: fresh,
          operations,
        }),
    });
    expect(getDailyRecordWriteState(base.date)).toEqual({
      pendingCount: 2,
      activeKind: 'ordinary',
    });
    expect(deps.refreshRecord).not.toHaveBeenCalled();
    expect(deps.invoke).not.toHaveBeenCalled();
    releaseManual.resolve();
    await Promise.all([manual, batch]);
    expect(deps.invoke).toHaveBeenCalledOnce();
    expect(deps.invoke.mock.calls[0]?.[0]).toMatchObject({
      baseRevision: 8,
      expectedLastUpdated: current.lastUpdated,
    });
    expect(deps.invoke.mock.calls[0]?.[0].patches[0].fields).not.toHaveProperty('specialty');
    expect(current.beds.H2C1.specialty).toBe('Cirugía');
  });

  it('keeps later manual writes behind a clinical commit and its authoritative readback', async () => {
    const deps = createDependencies();
    const readbackStarted = deferred();
    const releaseReadback = deferred();
    deps.refreshRecord
      .mockImplementationOnce(async () => record)
      .mockImplementationOnce(async () => {
        readbackStarted.resolve();
        await releaseReadback.promise;
        return record;
      });
    const batch = applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-before-manual',
      operations,
      ...deps,
    });
    await readbackStarted.promise;
    const manualWrite = vi.fn(async () => undefined);
    const manual = runWithDailyRecordWriteLock(record.date, undefined, manualWrite);
    expect(getDailyRecordWriteState(record.date)).toEqual({
      pendingCount: 2,
      activeKind: 'clinical_sync',
    });
    expect(manualWrite).not.toHaveBeenCalled();
    releaseReadback.resolve();
    await Promise.all([batch, manual]);
    expect(manualWrite).toHaveBeenCalledOnce();
    expect(getDailyRecordWriteState(record.date)).toEqual({ pendingCount: 0, activeKind: null });
  });

  it('locks the written historical date while leaving the authority date independent', async () => {
    const deps = createDependencies();
    const invoked = deferred();
    const release = deferred();
    const respond = deps.invoke.getMockImplementation()!;
    deps.invoke.mockImplementation(async payload => {
      invoked.resolve();
      await release.promise;
      return respond(payload);
    });
    const batch = applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      authorityDate: '2026-07-29',
      runId: 'run-historical',
      operations,
      ...deps,
    });
    await invoked.promise;
    const historicalWrite = vi.fn(async () => undefined);
    const historical = runWithDailyRecordWriteLock(record.date, undefined, historicalWrite);
    const currentWrite = vi.fn(async () => undefined);
    await runWithDailyRecordWriteLock('2026-07-29', undefined, currentWrite);
    expect(currentWrite).toHaveBeenCalledOnce();
    expect(historicalWrite).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([batch, historical]);
    expect(historicalWrite).toHaveBeenCalledOnce();
    expect(deps.invoke.mock.calls[0]?.[0]).toMatchObject({
      date: record.date,
      authorityDate: '2026-07-29',
    });
  });

  it.each(['unavailable', 'wrong_date', 'changed_field', 'changed_episode'] as const)(
    'fails closed before writing when the authority is %s, then releases the turn',
    async reason => {
      const base = baseRecord();
      const deps = createDependencies();
      const current = structuredClone(base);
      if (reason === 'unavailable') deps.refreshRecord.mockRejectedValue(new Error('offline'));
      else {
        if (reason === 'wrong_date') current.date = '2026-07-29';
        if (reason === 'changed_field')
          current.beds.H2C1.evaluationScores = { braden: { total: 20 } } as never;
        if (reason === 'changed_episode')
          current.beds.H2C1.clinicalEpisodeId = 'replacement-episode';
        deps.refreshRecord.mockResolvedValue(current);
      }
      await expect(
        applyClinicalEnrichmentBatch({
          mode: 'enforced',
          record: base,
          runId: 'run-invalid',
          operations,
          ...deps,
          rebuildOperations: fresh =>
            rebuildClinicalEnrichmentOperations({
              baseRecord: base,
              currentRecord: fresh,
              operations,
            }),
        })
      ).rejects.toThrow();
      expect(deps.invoke).not.toHaveBeenCalled();
      const next = vi.fn(async () => undefined);
      await runWithDailyRecordWriteLock(base.date, undefined, next);
      expect(next).toHaveBeenCalledOnce();
      expect(getDailyRecordWriteState(base.date).pendingCount).toBe(0);
    }
  );

  it.each(['off', 'shadow'] as const)(
    'does not nest a lock around the %s repository writer',
    async mode => {
      const deps = createDependencies();
      const persisted: string[] = [];
      deps.applyPatch.mockImplementation(operation =>
        runWithDailyRecordWriteLock(record.date, undefined, async () => {
          persisted.push(operation.target.clinicalEpisodeId);
        })
      );
      await applyClinicalEnrichmentBatch({
        mode,
        record,
        runId: 'compatible-run',
        operations,
        ...deps,
      });
      expect(persisted).toEqual(['episode-1', 'episode-2']);
      expect(getDailyRecordWriteState(record.date).pendingCount).toBe(0);
    }
  );

  it('retains its turn while replaying an ambiguous request with the same mutation identity', async () => {
    const deps = createDependencies();
    const retried = deferred();
    const releaseRetry = deferred();
    const respond = deps.invoke.getMockImplementation()!;
    deps.invoke
      .mockRejectedValueOnce({ code: 'functions/deadline-exceeded' })
      .mockImplementationOnce(async payload => {
        retried.resolve();
        await releaseRetry.promise;
        return {
          ...(await respond(payload)),
          authorityStatus: 'idempotent',
          patientWrites: 0,
          historySnapshots: 0,
        };
      });
    const batch = applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'response-lost',
      operations,
      ...deps,
    });
    await retried.promise;
    const manualWrite = vi.fn(async () => undefined);
    const manual = runWithDailyRecordWriteLock(record.date, undefined, manualWrite);
    expect(manualWrite).not.toHaveBeenCalled();
    expect(deps.invoke.mock.calls[1]?.[0]).toEqual(deps.invoke.mock.calls[0]?.[0]);
    releaseRetry.resolve();
    const [result] = await Promise.all([batch, manual]);
    expect(result).toMatchObject({ patientWrites: 0, historySnapshots: 0, retries: 1 });
    expect(manualWrite).toHaveBeenCalledOnce();
  });
});
