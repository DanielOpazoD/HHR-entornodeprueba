import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus } from '@/types/domain/patientClassification';
import {
  buildPatient,
  buildRecord,
} from '@/tests/services/repositories/dailyRecordRepositoryWriteServiceFixtures';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  saveRecord: vi.fn(),
  saveRecordStrict: vi.fn(record =>
    Promise.resolve({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: [record.date],
    })
  ),
}));

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
  updateRecordPartial: vi.fn(),
}));

vi.mock('@/services/storage/sync', () => ({
  ackDailyRecordSyncTask: vi.fn().mockResolvedValue(true),
  isRetryableSyncError: vi.fn(),
  queueSyncTask: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
  queueDailyRecordSyncTaskWithLocalRecord: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
  releaseDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
  renewDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

vi.mock('@/utils/recordInvariants', () => ({
  normalizeDailyRecordInvariants: vi.fn((record: DailyRecord) => ({ record, patches: {} })),
}));

vi.mock('@/services/repositories/helpers/validationHelper', () => ({
  validateAndSalvageRecord: vi.fn((record: DailyRecord) => record),
}));

vi.mock('@/services/utils/fhirMappers', () => ({
  mapPatientToFhir: vi.fn(() => ({})),
}));

vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  PatientMasterRepository: {
    upsertPatient: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/repositories/ports/repositoryAuditPort', () => ({
  logRepositoryConflictAutoMerged: vi.fn().mockResolvedValue(undefined),
}));

import { updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { queueDailyRecordSyncTaskWithLocalRecord as queueSyncTask } from '@/services/storage/sync';
import { logRepositoryConflictAutoMerged } from '@/services/repositories/ports/repositoryAuditPort';

const buildConcurrencyError = (): Error => {
  const error = new Error('Concurrency conflict');
  error.name = 'ConcurrencyError';
  return error;
};

describe('dailyRecordRepositoryWriteService · retry re-basado por versión vieja', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queueSyncTask).mockResolvedValue({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });
  });

  it('reintenta una vez con la versión fresca cuando el remoto no tocó los campos del patch', async () => {
    // Ráfaga típica: la edición anterior del mismo usuario avanzó la versión
    // remota, pero el campo que edita AHORA sigue igual que en la base local.
    const current = buildRecord('2026-02-15');
    current.beds = { R1: buildPatient('R1', 'Paciente uno') };

    const remote = buildRecord('2026-02-15');
    remote.beds = { R1: buildPatient('R1', 'Paciente uno') };
    remote.lastUpdated = '2026-02-15T12:34:56.000Z';

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(buildConcurrencyError());
    vi.mocked(getRecordFromFirestore).mockResolvedValue(remote);

    await expect(
      updatePartial('2026-02-15', { 'beds.R1.status': 'Grave' })
    ).resolves.toBeUndefined();

    expect(updateRecordPartialToFirestore).toHaveBeenCalledTimes(2);
    const retryCall = vi.mocked(updateRecordPartialToFirestore).mock.calls[1];
    expect(retryCall[0]).toBe('2026-02-15');
    expect(retryCall[2]).toBe(remote.lastUpdated);
    expect(logRepositoryConflictAutoMerged).not.toHaveBeenCalled();
    expect(queueSyncTask).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: 'conflict_auto_merge' })
    );
  });

  it('no reintenta cuando el remoto sí cambió el campo del patch (conflicto real)', async () => {
    const current = buildRecord('2026-02-15');
    current.beds = { R1: buildPatient('R1', 'Paciente uno') };

    const remote = buildRecord('2026-02-15');
    remote.beds = {
      R1: { ...buildPatient('R1', 'Paciente uno'), status: PatientStatus.DE_CUIDADO },
    };
    remote.lastUpdated = '2026-02-15T12:34:56.000Z';

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(buildConcurrencyError());
    vi.mocked(getRecordFromFirestore).mockResolvedValue(remote);

    await expect(
      updatePartial('2026-02-15', { 'beds.R1.status': 'Grave' })
    ).resolves.toBeUndefined();

    // Una sola escritura: el conflicto real sigue el camino de recuperación
    // existente (auto-merge), no un reintento ciego que pisaría al otro cliente.
    expect(updateRecordPartialToFirestore).toHaveBeenCalledTimes(1);
    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: 'conflict_auto_merge' })
    );
  });
});
