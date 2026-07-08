import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    subscribeQuery: vi.fn(),
  },
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

import { firestoreDb } from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';

const buildDoc = (id: string, episodeKey: string, updatedAt: string): ClinicalDocumentRecord =>
  ({
    id,
    hospitalId: 'hhr',
    documentType: 'epicrisis',
    templateId: 'epicrisis',
    templateVersion: 1,
    title: 'Epicrisis médica',
    patientInfoTitle: 'Información del Paciente',
    footerMedicoLabel: 'Médico',
    footerEspecialidadLabel: 'Especialidad',
    patientRut: '1-9',
    patientName: 'Paciente Test',
    episodeKey,
    admissionDate: '2026-03-05',
    sourceDailyRecordDate: '2026-03-05',
    sourceBedId: 'R1',
    patientFields: [],
    sections: [],
    medico: 'Dr. Test',
    especialidad: 'Medicina Interna',
    status: 'draft',
    isLocked: false,
    isActiveEpisodeDocument: true,
    currentVersion: 1,
    versionHistory: [],
    audit: {
      createdAt: updatedAt,
      createdBy: {
        uid: 'u1',
        email: 'test@hospital.cl',
        displayName: 'Test',
        role: 'doctor_urgency',
      },
      updatedAt,
      updatedBy: {
        uid: 'u1',
        email: 'test@hospital.cl',
        displayName: 'Test',
        role: 'doctor_urgency',
      },
      signatureRevocations: [],
    },
    renderedText: 'texto',
    integrityHash: 'hash',
  }) as ClinicalDocumentRecord;

describe('ClinicalDocumentRepository subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('subscribes to multiple episode keys and emits deduplicated documents', () => {
    const unsubscribes = [vi.fn(), vi.fn()];
    vi.mocked(firestoreDb.subscribeQuery)
      .mockImplementationOnce((_collection, _query, callback) => {
        callback([buildDoc('legacy-doc', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z')]);
        return unsubscribes[0];
      })
      .mockImplementationOnce((_collection, _query, callback) => {
        callback([
          buildDoc('canonical-doc', 'episode-canonical-1', '2026-03-05T11:00:00.000Z'),
          buildDoc('legacy-doc', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z'),
        ]);
        return unsubscribes[1];
      });

    const callback = vi.fn();
    const unsubscribe = ClinicalDocumentRepository.subscribeByEpisodeKeys(
      [
        'rut-1__2026-03-01',
        'episode-canonical-1',
        'rut-3__2026-03-01',
        'rut-4__2026-03-01',
        'rut-5__2026-03-01',
        'rut-6__2026-03-01',
        'rut-7__2026-03-01',
        'rut-8__2026-03-01',
        'rut-9__2026-03-01',
        'rut-10__2026-03-01',
        'rut-11__2026-03-01',
      ],
      callback,
      'hhr'
    );

    expect(firestoreDb.subscribeQuery).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'canonical-doc' }),
      expect.objectContaining({ id: 'legacy-doc' }),
    ]);

    unsubscribe();
    expect(unsubscribes[0]).toHaveBeenCalled();
    expect(unsubscribes[1]).toHaveBeenCalled();
  });
});
