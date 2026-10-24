import { vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { SpecialtyManualIntent } from '@/types/domain/specialtyDecision';
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
export { storage };
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

export const date = '2026-02-18';
export type RevisionRecord = DailyRecord & { meta: { revision: number } };
export const makeBase = (target: 'bed' | 'clinicalCrib' = 'bed') => {
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
export const makeIntent = (target: 'bed' | 'clinicalCrib' = 'bed'): SpecialtyManualIntent => ({
  kind: 'manual',
  bedId: 'R1',
  target,
  episodeId: 'ep_target',
  value: Specialty.CIRUGIA,
  expectedDecisionId: null,
});
export const targetPatient = (record: DailyRecord, intent: SpecialtyManualIntent) =>
  intent.target === 'bed' ? record.beds[intent.bedId] : record.beds[intent.bedId].clinicalCrib!;
export const patchFor = (intent: SpecialtyManualIntent): DailyRecordPatch =>
  ({
    [`beds.${intent.bedId}${intent.target === 'clinicalCrib' ? '.clinicalCrib' : ''}.specialty`]:
      intent.value,
  }) as DailyRecordPatch;
export const commit = (base: RevisionRecord, intent: SpecialtyManualIntent, mutationId: string) => {
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
export const receipt = (record: RevisionRecord) => ({
  recordState: { record, lastUpdated: record.lastUpdated, meta: record.meta },
});
export const save = (base: DailyRecord, intent = makeIntent()) =>
  updatePartialDetailed(date, patchFor(intent), {
    baseRecord: base,
    specialtyIntent: intent,
    requireAtomicCas: true,
  });

export const resetSpecialtyStorage = () => {
  vi.resetAllMocks();
  storage.enabled.mockReturnValue(true);
  storage.localRead.mockResolvedValue(null);
  storage.adopt.mockImplementation(async (record: DailyRecord) => ({ status: 'adopted', record }));
};
