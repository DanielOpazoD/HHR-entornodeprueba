// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { foldWriteIntoOutbox } from '@/services/storage/sync/dexieDailyRecordOutbox';
import { buildPatchRebase } from '@/services/storage/sync/pendingProjectionRebase';
import { applyPatches } from '@/utils/patchUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

/**
 * W12-CW10. A write folded into the day's task that empties a bed (a discharge or transfer) keeps
 * the unsent diagnosis written for the patient who leaves as a held edit for that patient; a write
 * that keeps the patient in the bed, such as a RUT correction, keeps it in the day's task.
 */
const date = '2026-11-16';
const stored = (): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-11-16T12:00:00.000Z',
    beds: {
      R4: DataFactory.createMockPatient('R4', {
        patientName: 'PACIENTE SINTETICO A',
        rut: '11111111-1',
        clinicalEpisodeId: 'episode-a',
        pathology: 'B4',
      }),
    },
  });
const heldDiagnosis = (record: DailyRecord): SyncTask =>
  ({
    id: 7,
    opId: `UPDATE_DAILY_RECORD:daily:${date}`,
    type: 'UPDATE_DAILY_RECORD',
    key: `daily:${date}`,
    ownerKey: 'user:synthetic-B',
    status: 'PENDING',
    payload: record,
    patchBaseValues: { 'beds.R4.pathology': '' },
    syncContract: {
      mutationId: 'm-diagnosis',
      expectedVersion: '2026-11-16T11:00:00.000Z',
      changedPaths: ['beds.R4.pathology'],
    },
  }) as unknown as SyncTask;

const fold = (patch: DailyRecordPatch) => {
  const day = stored();
  const existing = heldDiagnosis(day);
  const patchWrite = { baseRecord: day, patch, prepare: applyPatches };
  return foldWriteIntoOutbox({
    task: {
      ...existing,
      id: undefined,
      payload: applyPatches(day, patch),
      syncContract: { mutationId: 'm-write', changedPaths: Object.keys(patch) },
    } as SyncTask,
    existing,
    stored: day,
    unresolved: [existing],
    rebase: buildPatchRebase(patchWrite),
    patchWrite,
  });
};

describe('a write folded into the day task holding an unsent diagnosis', () => {
  it('that empties the bed holds the diagnosis for the patient who leaves', () => {
    const empty = DataFactory.createMockPatient('R4', {
      patientName: '',
      rut: '',
      clinicalEpisodeId: '',
    });
    const { task, heldConflicts } = fold({ 'beds.R4': empty, discharges: [] } as DailyRecordPatch);

    expect(heldConflicts).toHaveLength(1);
    const held = heldConflicts[0];
    expect(held.status).toBe('CONFLICT');
    expect(held.syncContract?.changedPaths).toEqual(['beds.R4.pathology']);
    expect((held.payload as DailyRecord).beds.R4).toMatchObject({
      rut: '11111111-1',
      clinicalEpisodeId: 'episode-a',
      pathology: 'B4',
    });
    expect(task.syncContract?.changedPaths).not.toContain('beds.R4.pathology');
    // Its version stays the held write's; its base for the bed is not the unsent text.
    expect(task.syncContract?.expectedVersion).toBe('2026-11-16T11:00:00.000Z');
    expect((task.patchBaseValues?.['beds.R4'] as { pathology?: string }).pathology).toBe('');
  });

  it('that corrects the RUT of the same patient keeps the diagnosis in the day task', () => {
    const { task, heldConflicts } = fold({ 'beds.R4.rut': '12345678-5' } as DailyRecordPatch);

    expect(heldConflicts).toEqual([]);
    expect(task.syncContract?.changedPaths).toEqual(
      expect.arrayContaining(['beds.R4.pathology', 'beds.R4.rut'])
    );
  });
});
