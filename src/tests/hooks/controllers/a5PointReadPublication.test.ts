import 'fake-indexeddb/auto';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createPointReadPublication,
  publishDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordPointReadPublication';
import {
  createDailyRecordQueryResult,
  type DailyRecordQueryRuntime,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { DataFactory } from '@/tests/factories/DataFactory';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import {
  applyPendingExplicitCensusPatch,
  registerPendingDailyRecordPatch,
  clearPendingDailyRecordPatchesForTests,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
const date = '2026-10-24';
const runtime: DailyRecordQueryRuntime = {
  date,
  serverConfirmed: true,
  availabilityState: 'resolved',
  consistencyState: 'remote_authoritative',
  sourceOfTruth: 'remote',
  retryability: 'not_applicable',
  recoveryAction: 'none',
  conflictSummary: null,
  observabilityTags: [],
  repairApplied: false,
};
afterEach(() => {
  clearPendingDailyRecordPatchesForTests();
  localStorage.clear();
});
it.each(['owner', 'epoch'])('cancels publication after a changed session %s', kind => {
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-first');
  setSessionGeneration('synthetic-first');
  const result = createDailyRecordQueryResult(DataFactory.createMockDailyRecord(date), runtime);
  const confirm = vi.fn();
  const incoming = createPointReadPublication(result, undefined, () => undefined, confirm, true);
  if (kind === 'owner') localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-next');
  else setSessionGeneration('synthetic-next');
  expect(() => publishDailyRecordQueryData(undefined, incoming)).toThrow();
  expect(confirm).not.toHaveBeenCalled();
});
it('reapplies a patch only to publication and confirms the pure observation', async () => {
  const record = DataFactory.createMockDailyRecord(date, {
    beds: { R1: DataFactory.createMockPatient('R1', { clinicalEpisodeId: 'ep_synthetic' }) },
  });
  const result = createDailyRecordQueryResult(record, runtime);
  const original = structuredClone(record);
  registerPendingDailyRecordPatch(date, { 'beds.R1.pathology': 'Synthetic pending edit' });
  const confirm = vi.fn();
  const incoming = createPointReadPublication(result, result, () => result, confirm, true);
  const rows = await hospitalDB.dailyRecords.toArray();
  const tasks = await hospitalDB.syncQueue.toArray();
  const published = publishDailyRecordQueryData(result, incoming);
  expect(published).toMatchObject({
    record: { beds: { R1: { pathology: 'Synthetic pending edit' } } },
  });
  expect(await hospitalDB.dailyRecords.toArray()).toEqual(rows);
  expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
  expect(record).toEqual(original);
  expect(confirm).toHaveBeenCalledWith(result);
});
it.each([true, false])(
  'a server-confirmed read that holds a pending edit releases it (confirmed %s)',
  serverConfirmed => {
    const base = DataFactory.createMockDailyRecord(date, {
      beds: { R1: DataFactory.createMockPatient('R1', { clinicalEpisodeId: 'ep_synthetic' }) },
    });
    const server = structuredClone(base);
    server.beds.R1.pathology = 'Synthetic saved edit';
    registerPendingDailyRecordPatch(date, { 'beds.R1.pathology': 'Synthetic saved edit' });
    const previous = createDailyRecordQueryResult(base, { ...runtime, serverConfirmed: false });
    const result = createDailyRecordQueryResult(server, { ...runtime, serverConfirmed });
    const incoming = createPointReadPublication(result, previous, () => previous, vi.fn(), true);
    publishDailyRecordQueryData(previous, incoming);
    // A later copy without the edit only shows it again while the edit is still pending.
    expect(applyPendingExplicitCensusPatch(date, base, server).beds.R1.pathology).toBe(
      serverConfirmed ? base.beds.R1.pathology : 'Synthetic saved edit'
    );
  }
);
