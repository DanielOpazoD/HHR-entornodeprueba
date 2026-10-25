import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { DataFactory } from '@/tests/factories/DataFactory';
const h = vi.hoisted(() => ({ remote: {} as DailyRecord, written: undefined as unknown }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => h.remote })),
  runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      get: async () => ({ exists: () => true, data: () => h.remote }),
      set: (_ref: unknown, data: unknown) => {
        h.written = data;
      },
    })
  ),
  deleteField: () => '__delete__',
}));
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({}),
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  isServerClinicalWriteFenceActive: async () => false,
  resolveEffectiveDailyRecordAuthorityMode: async () => 'client_only',
}));
vi.mock('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting', () => ({
  updateSpecialistMedicalHandoffViaCallable: vi.fn(),
}));
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { updateSpecialistMedicalHandoffViaCallable } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { buildSpecialistHandoffTargets } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { mergeSyncTaskContracts } from '@/services/storage/sync/syncTaskContractPolicy';
const makeRecord = () =>
  DataFactory.createMockDailyRecord('2026-10-24', {
    lastUpdated: '2026-10-24T10:00:00.000Z',
    beds: {
      R4: DataFactory.createMockPatient('R4', {
        patientName: 'Paciente A Sintético',
        rut: '99.999.999-9',
        clinicalEpisodeId: 'ep-A',
        medicalHandoffNote: 'Nota de A',
      }),
    },
  });
const makeTask = (record: DailyRecord): SyncTask => ({
  opId: 'synthetic-op',
  type: 'UPDATE_DAILY_RECORD',
  payload: record,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  origin: 'direct_queue',
  syncContract: {
    changedPaths: ['beds.R4.medicalHandoffNote'],
    expectedVersion: record.lastUpdated,
    mutationId: 'synthetic-mutation',
  },
});
const transport = () => createFirestoreSyncTransport({ getDb: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks();
  h.remote = makeRecord();
  h.written = undefined;
});

describe('queued handoff preserves the original patient and episode', () => {
  it.each(['turnover', 'readmission', 'passport'])(
    'retains an old-client note for manual conflict resolution on %s instead of silently dropping it',
    async scenario => {
      const local = makeRecord();
      h.remote.lastUpdated = '2026-10-24T11:00:00.000Z';
      if (scenario === 'turnover')
        Object.assign(h.remote.beds.R4, {
          patientName: 'Paciente B Sintético',
          clinicalEpisodeId: 'ep-B',
        });
      if (scenario === 'readmission') h.remote.beds.R4.clinicalEpisodeId = 'ep-A2';
      if (scenario === 'passport') h.remote.beds.R4.documentType = 'Pasaporte';
      const task = makeTask(local);
      await expect(transport().run(task)).rejects.toMatchObject({
        name: 'ConcurrencyError',
        reason: 'semantic_conflict',
      });
      expect(h.written).toBeUndefined();
      expect(task.payload).toEqual(local);
      expect(local.beds.R4.medicalHandoffNote).toBe('Nota de A');
    }
  );
  it('still publishes a legacy task for the unchanged patient', async () => {
    await transport().run(makeTask(makeRecord()));
    expect(h.written).toMatchObject({
      beds: { R4: { patientName: 'Paciente A Sintético', medicalHandoffNote: 'Nota de A' } },
    });
  });
  it('replays a new specialist task through the occupant-bound callable', async () => {
    const local = makeRecord();
    const task = makeTask(local);
    const expected = buildSpecialistHandoffTargets(local, {
      'beds.R4.medicalHandoffNote': 'Nota de A',
    });
    task.syncContract = { ...task.syncContract, specialistHandoffTargets: expected };
    await transport().run(task);
    expect(updateSpecialistMedicalHandoffViaCallable).toHaveBeenCalledWith(
      local.date,
      { 'beds.R4.medicalHandoffNote': 'Nota de A' },
      expected
    );
    expect(h.written).toBeUndefined();
  });
  it('keeps a rejected specialist replay unresolved without a generic write', async () => {
    const local = makeRecord();
    const task = makeTask(local);
    task.syncContract = {
      ...task.syncContract,
      specialistHandoffTargets: buildSpecialistHandoffTargets(local, {
        'beds.R4.medicalHandoffNote': '',
      }),
    };
    vi.mocked(updateSpecialistMedicalHandoffViaCallable).mockRejectedValueOnce(
      new Error('synthetic occupant conflict')
    );
    await expect(transport().run(task)).rejects.toThrow('synthetic occupant conflict');
    expect(h.written).toBeUndefined();
    expect(task.payload).toEqual(local);
  });
  it('cannot replace an unresolved queued note with another occupant’s note', () => {
    const expected = buildSpecialistHandoffTargets(makeRecord(), {
      'beds.R4.medicalHandoffNote': '',
    });
    expect(() =>
      mergeSyncTaskContracts(
        { specialistHandoffTargets: expected },
        {
          specialistHandoffTargets: expected.map(target => ({
            ...target,
            clinicalEpisodeId: 'ep-B',
          })),
        }
      )
    ).toThrow(/otro paciente o episodio/);
  });
});
