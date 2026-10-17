import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { SpecialtyManualIntent } from '@/types/domain/specialtyDecision';
import type { DailyRecordPartialWriteOptions } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import type { adoptAuthoritativeDailyRecordAtomically } from '@/services/storage/sync';
import { Specialty } from '@/types/domain/patientClassification';
import { buildPatient, buildRecord } from './dailyRecordRepositoryWriteServiceFixtures';

const storage = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  localRead: vi.fn(),
  localSave: vi.fn(),
  queue: vi.fn(),
  adopt: vi.fn(),
  enabled: vi.fn(() => true),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: storage.localRead,
  saveRecord: storage.localSave,
  saveRecordStrict: storage.localSave,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: storage.read,
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
  updateRecordPartial: storage.write,
}));
vi.mock('@/services/storage/sync', () => ({
  ackDailyRecordSyncTask: vi.fn(),
  adoptAuthoritativeDailyRecordAtomically: storage.adopt,
  queueDailyRecordSyncTaskWithLocalRecord: storage.queue,
  releaseDailyRecordPreOutboxHold: vi.fn(),
  renewDailyRecordPreOutboxHold: vi.fn(),
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: storage.enabled,
}));
vi.mock('@/utils/recordInvariants', () => ({
  normalizeDailyRecordInvariants: (record: DailyRecord) => ({ record, patches: {} }),
}));
vi.mock('@/services/repositories/helpers/validationHelper', () => ({
  validateAndSalvageRecord: (record: DailyRecord) => record,
}));
vi.mock('@/services/utils/fhirMappers', () => ({ mapPatientToFhir: () => ({}) }));

import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { normalizeDailyRecordAuthorityError } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

const date = '2026-02-18';
type RevisionRecord = DailyRecord & { meta: { revision: number } };
const makeBase = (target: 'bed' | 'clinicalCrib' = 'bed') => {
  const record: RevisionRecord = { ...buildRecord(date), meta: { revision: 1 } };
  record.lastUpdated = `${date}T09:00:00.000Z`;
  record.meta = { revision: 1 };
  const patient = { ...buildPatient('R1', 'Paciente sintético'), clinicalEpisodeId: 'ep_target' };
  record.beds = {
    R1:
      target === 'bed'
        ? patient
        : {
            ...buildPatient('R1', 'Madre sintética'),
            clinicalEpisodeId: 'ep_parent',
            clinicalCrib: patient,
          },
  };
  return record;
};
const makeIntent = (target: 'bed' | 'clinicalCrib' = 'bed'): SpecialtyManualIntent => ({
  kind: 'manual',
  bedId: 'R1',
  target,
  episodeId: 'ep_target',
  value: Specialty.CIRUGIA,
  expectedDecisionId: null,
});
const targetPatient = (record: DailyRecord, intent: SpecialtyManualIntent) =>
  intent.target === 'bed' ? record.beds[intent.bedId] : record.beds[intent.bedId].clinicalCrib!;
const patchFor = (intent: SpecialtyManualIntent): DailyRecordPatch =>
  ({
    [`beds.${intent.bedId}${intent.target === 'clinicalCrib' ? '.clinicalCrib' : ''}.specialty`]:
      intent.value,
  }) as DailyRecordPatch;
const commit = (base: RevisionRecord, intent: SpecialtyManualIntent, mutationId: string) => {
  const record = structuredClone(base);
  record.meta = { revision: (base.meta?.revision ?? 0) + 1 };
  record.lastUpdated = `${date}T10:00:${String(record.meta.revision).padStart(2, '0')}.000Z`;
  const patient = targetPatient(record, intent);
  patient.specialty = intent.value;
  patient.specialtyAssignment = {
    schemaVersion: 3,
    episodeId: intent.episodeId,
    decisionId: mutationId,
    recordDate: date,
    source: 'manual',
    actorUid: 'synthetic-user',
    decidedAt: record.lastUpdated,
  };
  return record;
};
const receipt = (record: RevisionRecord) => ({
  recordState: { record, lastUpdated: record.lastUpdated, meta: record.meta },
});
const save = (base: DailyRecord, intent = makeIntent()) =>
  updatePartialDetailed(date, patchFor(intent), {
    baseRecord: base,
    specialtyIntent: intent,
    requireAtomicCas: true,
  });

beforeEach(() => {
  vi.resetAllMocks();
  storage.enabled.mockReturnValue(true);
  storage.adopt.mockImplementation(async (record: DailyRecord) => ({ status: 'adopted', record }));
});

describe('manual specialty authority and recovery', () => {
  it('reads its fresh baseline after acquiring the date turn and preserves ten rapid bed edits', async () => {
    const base = makeBase();
    for (let i = 1; i <= 10; i++)
      base.beds[`R${i}`] = {
        ...buildPatient(`R${i}`, `Paciente sintético ${i}`),
        clinicalEpisodeId: `ep_${i}`,
      };
    let remote = structuredClone(base);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const hold = runExclusiveDailyRecordWrite(date, async () => {
      entered();
      await new Promise<void>(resolve => {
        release = resolve;
      });
      remote.meta = { revision: 2 };
      remote.lastUpdated = `${date}T09:30:00.000Z`;
      remote.beds.R1.pathology = 'Actualización clínica sintética';
    });
    await started;
    storage.read.mockImplementation(async () => structuredClone(remote));
    storage.write.mockImplementation(
      async (_date, _patch, expected, options: DailyRecordPartialWriteOptions) => {
        expect(expected).toBe(remote.lastUpdated);
        expect(options.syncContract?.baseRevision).toBe(remote.meta?.revision);
        remote = commit(remote, options.specialtyIntent!, options.syncContract!.mutationId!);
        return receipt(remote);
      }
    );
    const saves = Array.from({ length: 10 }, (_, index) =>
      save(base, {
        ...makeIntent(),
        bedId: `R${index + 1}`,
        episodeId: `ep_${index + 1}`,
      })
    );
    await Promise.resolve();
    expect(storage.read).not.toHaveBeenCalled();
    release();
    await hold;
    const results = await Promise.all(saves);
    expect(results.every(result => result.updatedRemotely)).toBe(true);
    expect(storage.write).toHaveBeenCalledTimes(10);
    expect(
      Object.values(remote.beds).every(patient => patient.specialty === Specialty.CIRUGIA)
    ).toBe(true);
    expect(remote.beds.R1.pathology).toBe('Actualización clínica sintética');
    expect(storage.queue).not.toHaveBeenCalled();
  });

  it.each(['bed', 'clinicalCrib'] as const)(
    'rebases one technical revision conflict with the same mutation ID for %s',
    async target => {
      const base = makeBase(target);
      const intent = makeIntent(target);
      const fresher = {
        ...structuredClone(base),
        meta: { revision: 3 },
        lastUpdated: `${date}T09:40:00.000Z`,
      };
      storage.read.mockResolvedValueOnce(base).mockResolvedValue(fresher);
      storage.write
        .mockRejectedValueOnce(new ConcurrencyError('revision changed', 'version_mismatch'))
        .mockImplementationOnce(
          async (_date, _patch, _expected, options: DailyRecordPartialWriteOptions) =>
            receipt(commit(fresher, intent, options.syncContract!.mutationId!))
        );
      const result = await save(base, intent);
      expect(result.updatedRemotely).toBe(true);
      const firstOptions = storage.write.mock.calls[0][3];
      expect(storage.write.mock.calls[1][2]).toBe(fresher.lastUpdated);
      expect(storage.write.mock.calls[1][3].syncContract).toMatchObject({
        mutationId: firstOptions.syncContract.mutationId,
        baseRevision: 3,
      });
      expect(storage.queue).not.toHaveBeenCalled();
    }
  );

  it.each(['episode', 'decision', 'scalar', 'date', 'missing'] as const)(
    'rejects a changed %s before sending or saving locally',
    async change => {
      const base = makeBase();
      const remote = structuredClone(base);
      if (change === 'episode') remote.beds.R1.clinicalEpisodeId = 'ep_replacement';
      if (change === 'decision')
        remote.beds.R1 = targetPatient(
          commit(base, { ...makeIntent(), value: Specialty.MEDICINA }, 'competitor'),
          makeIntent()
        );
      if (change === 'scalar') remote.beds.R1.specialty = Specialty.PEDIATRIA;
      if (change === 'date') remote.date = '2026-02-19';
      storage.read.mockResolvedValue(change === 'missing' ? null : remote);
      await expect(save(base)).rejects.toThrow();
      expect(storage.write).not.toHaveBeenCalled();
      expect(storage.localSave).not.toHaveBeenCalled();
      expect(storage.adopt).not.toHaveBeenCalled();
      expect(storage.queue).not.toHaveBeenCalled();
    }
  );

  it.each(['decision changed', 'episode changed'])(
    'does not retry the semantic rejection %s',
    async reason => {
      const base = makeBase();
      storage.read.mockResolvedValue(base);
      const error = normalizeDailyRecordAuthorityError({
        code: 'functions/aborted',
        message: `Specialty ${reason}.`,
      });
      storage.write.mockRejectedValue(error);
      await expect(save(base)).rejects.toBe(error);
      expect(storage.write).toHaveBeenCalledTimes(1);
      expect(storage.queue).not.toHaveBeenCalled();
    }
  );

  it('stops after one technical retry and never queues a rejected decision', async () => {
    const base = makeBase();
    storage.read.mockResolvedValue(base);
    const error = new ConcurrencyError('revision changed again', 'version_mismatch');
    storage.write.mockRejectedValue(error);
    await expect(save(base)).rejects.toBe(error);
    expect(storage.write).toHaveBeenCalledTimes(2);
    expect(storage.adopt).not.toHaveBeenCalled();
    expect(storage.queue).not.toHaveBeenCalled();
  });

  it.each(['bed', 'clinicalCrib'] as const)(
    'preserves a concurrent manual decision with the same scalar for %s',
    async target => {
      const base = makeBase(target);
      const intent = makeIntent(target);
      const competing = commit(base, { ...intent, value: Specialty.MEDICINA }, 'other-user');
      storage.read.mockResolvedValueOnce(base).mockResolvedValue(competing);
      const conflict = new ConcurrencyError('revision changed', 'version_mismatch');
      storage.write.mockRejectedValue(conflict);
      await expect(save(base, intent)).rejects.toBe(conflict);
      expect(storage.write).toHaveBeenCalledTimes(1);
      expect(storage.adopt).not.toHaveBeenCalled();
      expect(storage.queue).not.toHaveBeenCalled();
    }
  );

  it.each(['bed', 'clinicalCrib'] as const)(
    'recovers a lost response only from the original decision receipt for %s',
    async target => {
      const base = makeBase(target);
      const intent = makeIntent(target);
      let remote = base;
      storage.read.mockImplementation(async () => remote);
      storage.write.mockImplementation(
        async (_date, _patch, _expected, options: DailyRecordPartialWriteOptions) => {
          remote = commit(base, intent, options.syncContract!.mutationId!);
          throw new Error('network response lost');
        }
      );
      const result = await save(base, intent);
      expect(result.updatedRemotely).toBe(true);
      expect(result.confirmedRecord).toEqual(remote);
      expect(storage.write).toHaveBeenCalledTimes(1);
      expect(storage.adopt).toHaveBeenCalledWith(remote, expect.any(Function));
      expect(storage.queue).not.toHaveBeenCalled();
    }
  );

  it.each(['decision', 'episode', 'date', 'source', 'scalar'] as const)(
    'does not claim a lost response succeeded with a different receipt %s',
    async change => {
      const base = makeBase();
      let remote = base;
      storage.read.mockImplementation(async () => remote);
      storage.write.mockImplementation(
        async (_date, _patch, _expected, options: DailyRecordPartialWriteOptions) => {
          remote = commit(base, makeIntent(), options.syncContract!.mutationId!);
          const metadata = remote.beds.R1.specialtyAssignment!;
          if (change === 'decision') metadata.decisionId = 'competing-same-value';
          if (change === 'episode') remote.beds.R1.clinicalEpisodeId = 'ep_replacement';
          if (change === 'date') metadata.recordDate = '2026-02-19';
          if (change === 'source') metadata.source = 'rule';
          if (change === 'scalar') remote.beds.R1.specialty = Specialty.PEDIATRIA;
          throw new Error('network response lost');
        }
      );
      await expect(save(base)).rejects.toThrow('network response lost');
      expect(storage.write).toHaveBeenCalledTimes(1);
      expect(storage.adopt).not.toHaveBeenCalled();
      expect(storage.queue).not.toHaveBeenCalled();
    }
  );

  it('preserves an unrelated pending local note when adopting a lost-response receipt', async () => {
    const base = makeBase();
    const pending = structuredClone(base);
    pending.beds.R1.pathology = 'Diagnóstico sintético pendiente';
    let remote = base;
    storage.read.mockImplementation(async () => remote);
    storage.write.mockImplementation(
      async (_date, _patch, _expected, options: DailyRecordPartialWriteOptions) => {
        remote = commit(base, makeIntent(), options.syncContract!.mutationId!);
        throw new Error('network response lost');
      }
    );
    storage.adopt.mockImplementation(
      async (
        _record: DailyRecord,
        reconcile: Parameters<typeof adoptAuthoritativeDailyRecordAtomically>[1]
      ) => {
        const rebased = reconcile!(pending, {
          id: 10,
          opId: 'pending-note',
          type: 'UPDATE_DAILY_RECORD',
          payload: pending,
          timestamp: 1,
          retryCount: 0,
          status: 'PENDING',
          syncContract: { changedPaths: ['beds.R1.pathology'], mutationId: 'pending-note' },
        });
        expect(rebased?.task?.syncContract?.changedPaths).toEqual(['beds.R1.pathology']);
        return { status: 'adopted', record: rebased?.record };
      }
    );
    const result = await save(base);
    expect(result.updatedRemotely).toBe(true);
    expect(result.confirmedRecord?.beds.R1.specialty).toBe(Specialty.CIRUGIA);
    expect(result.localProjectionRecord?.beds.R1.pathology).toBe('Diagnóstico sintético pendiente');
    expect(result.localProjectionRecord?.beds.R1.specialtyAssignment?.decisionId).toBe(
      remote.beds.R1.specialtyAssignment?.decisionId
    );
  });

  it('fails closed offline, then accepts an explicit new attempt after reconnecting', async () => {
    const base = makeBase();
    storage.read.mockRejectedValueOnce(new Error('offline'));
    await expect(save(base)).rejects.toThrow('offline');
    expect(storage.write).not.toHaveBeenCalled();
    storage.read.mockResolvedValue(base);
    storage.write.mockImplementation(
      async (_date, _patch, _expected, options: DailyRecordPartialWriteOptions) =>
        receipt(commit(base, makeIntent(), options.syncContract!.mutationId!))
    );
    expect((await save(base)).updatedRemotely).toBe(true);
    expect(storage.queue).not.toHaveBeenCalled();
  });
});
