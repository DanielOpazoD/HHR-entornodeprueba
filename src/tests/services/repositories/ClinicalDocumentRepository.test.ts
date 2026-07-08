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

const buildDoc = (
  id: string,
  episodeKey: string,
  updatedAt: string,
  status: ClinicalDocumentRecord['status'] = 'draft'
): ClinicalDocumentRecord =>
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
    status,
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

describe('ClinicalDocumentRepository.listByEpisodeKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('returns empty and avoids querying when no episode keys are provided', async () => {
    const result = await ClinicalDocumentRepository.listByEpisodeKeys([], 'hhr');
    expect(result).toEqual([]);
    expect(firestoreDb.getDocs).not.toHaveBeenCalled();
  });

  it('persists and serves local-only draft documents without querying Firestore when disabled', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    const document = buildDoc('doc-local', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z');

    await expect(
      ClinicalDocumentRepository.listByEpisode('rut-1__2026-03-01', 'hhr')
    ).resolves.toEqual([]);

    const callback = vi.fn();
    const unsubscribe = ClinicalDocumentRepository.subscribeByEpisode(
      'rut-1__2026-03-01',
      callback,
      'hhr'
    );

    expect(callback).toHaveBeenCalledWith([]);
    await expect(ClinicalDocumentRepository.createDraft(document, 'hhr')).resolves.toMatchObject({
      id: 'doc-local',
    });
    await expect(
      ClinicalDocumentRepository.listByEpisode('rut-1__2026-03-01', 'hhr')
    ).resolves.toEqual([expect.objectContaining({ id: 'doc-local' })]);
    await expect(
      ClinicalDocumentRepository.listByEpisodeKeys(['rut-1__2026-03-01'], 'hhr')
    ).resolves.toEqual([expect.objectContaining({ id: 'doc-local' })]);
    await expect(ClinicalDocumentRepository.get('doc-local', 'hhr')).resolves.toMatchObject({
      id: 'doc-local',
    });
    expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'doc-local' })]);
    expect(typeof unsubscribe).toBe('function');
    expect(firestoreDb.getDocs).not.toHaveBeenCalled();
    expect(firestoreDb.getDoc).not.toHaveBeenCalled();
    expect(firestoreDb.subscribeQuery).not.toHaveBeenCalled();
  });

  it('trims, deduplicates and ignores blank episode keys before querying', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
      buildDoc('d-1', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z'),
    ]);

    await ClinicalDocumentRepository.listByEpisodeKeys(
      ['  ', 'rut-1__2026-03-01', ' rut-1__2026-03-01 ', '\n'],
      'hhr'
    );

    expect(firestoreDb.getDocs).toHaveBeenCalledTimes(1);
    expect(firestoreDb.getDocs).toHaveBeenCalledWith(
      'hospitals/hhr/clinicalDocuments',
      expect.objectContaining({
        where: [
          expect.objectContaining({
            field: 'episodeKey',
            operator: 'in',
            value: ['rut-1__2026-03-01'],
          }),
        ],
      })
    );
  });

  it('chunks by 10, queries each chunk, and deduplicates by document id', async () => {
    vi.mocked(firestoreDb.getDocs)
      .mockResolvedValueOnce([
        buildDoc('d-1', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z'),
        buildDoc('d-2', 'rut-2__2026-03-01', '2026-03-05T11:00:00.000Z'),
      ])
      .mockResolvedValueOnce([
        buildDoc('d-2', 'rut-2__2026-03-01', '2026-03-05T11:00:00.000Z'),
        buildDoc('d-3', 'rut-11__2026-03-01', '2026-03-05T12:00:00.000Z'),
      ]);

    const result = await ClinicalDocumentRepository.listByEpisodeKeys(
      [
        'rut-1__2026-03-01',
        'rut-2__2026-03-01',
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
      'hhr'
    );

    expect(firestoreDb.getDocs).toHaveBeenCalledTimes(2);
    expect(firestoreDb.getDocs).toHaveBeenNthCalledWith(
      1,
      'hospitals/hhr/clinicalDocuments',
      expect.objectContaining({
        where: [expect.objectContaining({ field: 'episodeKey', operator: 'in' })],
      })
    );
    expect(firestoreDb.getDocs).toHaveBeenNthCalledWith(
      2,
      'hospitals/hhr/clinicalDocuments',
      expect.objectContaining({
        where: [expect.objectContaining({ field: 'episodeKey', operator: 'in' })],
      })
    );

    const firstChunk = (
      vi.mocked(firestoreDb.getDocs).mock.calls[0][1] as { where: Array<{ value: string[] }> }
    ).where[0].value;
    const secondChunk = (
      vi.mocked(firestoreDb.getDocs).mock.calls[1][1] as { where: Array<{ value: string[] }> }
    ).where[0].value;
    expect(firstChunk).toHaveLength(10);
    expect(secondChunk).toHaveLength(1);

    expect(result.map(document => document.id)).toEqual(['d-3', 'd-2', 'd-1']);
  });

  it('filters invalid documents returned by the repository query', async () => {
    const invalid: Partial<ClinicalDocumentRecord> = {
      ...buildDoc('broken', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z'),
    };
    delete invalid.id;
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
      buildDoc('d-1', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z'),
      invalid as ClinicalDocumentRecord,
    ]);

    const result = await ClinicalDocumentRepository.listByEpisodeKeys(['rut-1__2026-03-01'], 'hhr');

    expect(result.map(document => document.id)).toEqual(['d-1']);
  });

  it('lists legacy documents with incomplete audit actors after read hydration', async () => {
    const legacyActor = {
      uid: 'legacy-user',
      email: 'legacy@hospital.cl',
    };
    const legacyDocument = {
      ...buildDoc('legacy-audit', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z'),
      audit: {
        createdAt: '2026-03-05T10:00:00.000Z',
        createdBy: legacyActor,
        updatedAt: '2026-03-05T11:00:00.000Z',
        updatedBy: legacyActor,
        signedAt: '2026-03-05T12:00:00.000Z',
        signedBy: legacyActor,
        unsignedAt: '2026-03-05T13:00:00.000Z',
        unsignedBy: legacyActor,
        archivedAt: '2026-03-05T14:00:00.000Z',
        archivedBy: legacyActor,
        signatureRevocations: [
          {
            revokedAt: '2026-03-05T13:00:00.000Z',
            revokedBy: legacyActor,
            previousSignedAt: '2026-03-05T12:00:00.000Z',
            reason: 'Corrección de firma legacy',
          },
        ],
      },
      versionHistory: [
        {
          version: 1,
          savedAt: '2026-03-05T10:30:00.000Z',
          savedBy: legacyActor,
          reason: 'manual',
        },
      ],
    } as unknown as ClinicalDocumentRecord;
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([legacyDocument]);

    const result = await ClinicalDocumentRepository.listByEpisodeKeys(['rut-1__2026-03-01'], 'hhr');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'legacy-audit',
      audit: {
        createdBy: {
          uid: 'legacy-user',
          email: 'legacy@hospital.cl',
          displayName: 'Usuario legado',
          role: 'legacy_unknown',
        },
        updatedBy: {
          displayName: 'Usuario legado',
          role: 'legacy_unknown',
        },
        signedBy: {
          displayName: 'Usuario legado',
          role: 'legacy_unknown',
        },
        unsignedBy: {
          displayName: 'Usuario legado',
          role: 'legacy_unknown',
        },
        archivedBy: {
          displayName: 'Usuario legado',
          role: 'legacy_unknown',
        },
        signatureRevocations: [
          {
            revokedBy: {
              displayName: 'Usuario legado',
              role: 'legacy_unknown',
            },
          },
        ],
      },
      versionHistory: [
        {
          savedBy: {
            displayName: 'Usuario legado',
            role: 'legacy_unknown',
          },
        },
      ],
    });
  });

  it('still rejects structurally broken clinical documents after legacy hydration', async () => {
    const structurallyBroken = {
      ...buildDoc('broken-structure', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z'),
      patientFields: [
        {
          id: 'nombre',
          label: 'Nombre',
          value: 123,
          type: 'text',
        },
      ],
    } as unknown as ClinicalDocumentRecord;
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([structurallyBroken]);

    const result = await ClinicalDocumentRepository.listByEpisodeKeys(['rut-1__2026-03-01'], 'hhr');

    expect(result).toEqual([]);
  });

  it('normalizes legacy signed documents back to editable drafts on read', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
      {
        ...buildDoc('legacy-signed', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z', 'signed'),
        isLocked: true,
      },
    ]);

    const [result] = await ClinicalDocumentRepository.listByEpisodeKeys(
      ['rut-1__2026-03-01'],
      'hhr'
    );

    expect(result.status).toBe('draft');
    expect(result.isLocked).toBe(false);
  });

  it('preserves version section snapshots when creating a draft', async () => {
    const document = {
      ...buildDoc('d-snapshots', 'rut-1__2026-03-01', '2026-03-05T10:00:00.000Z'),
      sections: [
        {
          id: 'evolucion',
          title: 'Evolución clínica',
          content: 'Contenido inicial.',
          order: 1,
        },
      ],
      versionHistory: [
        {
          version: 1,
          savedAt: '2026-03-05T10:00:00.000Z',
          savedBy: {
            uid: 'u1',
            email: 'test@hospital.cl',
            displayName: 'Test',
            role: 'doctor_urgency',
          },
          reason: 'manual' as const,
          changedSectionIds: ['evolucion'],
          sectionSnapshots: [
            {
              sectionId: 'evolucion',
              title: 'Evolución clínica',
              content: 'Contenido inicial.',
              order: 1,
            },
          ],
        },
      ],
    };

    await ClinicalDocumentRepository.createDraft(document, 'hhr');

    const persisted = vi.mocked(firestoreDb.setDoc).mock.calls[0]?.[2] as ClinicalDocumentRecord;
    expect(persisted.versionHistory[0]?.changedSectionIds).toEqual(['evolucion']);
    expect(persisted.versionHistory[0]?.sectionSnapshots).toEqual([
      expect.objectContaining({
        sectionId: 'evolucion',
        title: 'Evolución clínica',
        content: 'Contenido inicial.',
      }),
    ]);
  });
});

describe('ClinicalDocumentRepository.lockDocumentsByEpisodeKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('locks every unlocked document of the episode and reports their ids', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
      buildDoc('doc-a', 'rut-1__2026-04-01', '2026-04-02T08:00:00.000Z'),
      buildDoc('doc-b', 'rut-1__2026-04-01', '2026-04-02T09:00:00.000Z'),
    ]);

    const newlyLocked = await ClinicalDocumentRepository.lockDocumentsByEpisodeKey(
      'rut-1__2026-04-01',
      'hhr',
      { lockedAt: '2026-05-04T13:00:00.000Z' }
    );

    // listByEpisode sorts by audit.updatedAt DESC, so doc-b (newer) is locked first.
    expect(newlyLocked.sort()).toEqual(['doc-a', 'doc-b']);
    expect(firestoreDb.updateDoc).toHaveBeenCalledTimes(2);
    expect(firestoreDb.updateDoc).toHaveBeenCalledWith('hospitals/hhr/clinicalDocuments', 'doc-a', {
      isLocked: true,
      lockedReason: 'episode_closed',
      lockedAt: '2026-05-04T13:00:00.000Z',
    });
    expect(firestoreDb.updateDoc).toHaveBeenCalledWith('hospitals/hhr/clinicalDocuments', 'doc-b', {
      isLocked: true,
      lockedReason: 'episode_closed',
      lockedAt: '2026-05-04T13:00:00.000Z',
    });
  });

  it('skips documents that are already locked (idempotent)', async () => {
    const alreadyLocked = {
      ...buildDoc('doc-a', 'rut-1__2026-04-01', '2026-04-02T08:00:00.000Z'),
      isLocked: true,
      lockedReason: 'episode_closed' as const,
      lockedAt: '2026-04-15T10:00:00.000Z',
    } as ClinicalDocumentRecord;
    const fresh = buildDoc('doc-b', 'rut-1__2026-04-01', '2026-04-02T09:00:00.000Z');

    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([alreadyLocked, fresh]);

    const newlyLocked = await ClinicalDocumentRepository.lockDocumentsByEpisodeKey(
      'rut-1__2026-04-01',
      'hhr'
    );

    expect(newlyLocked).toEqual(['doc-b']);
    expect(firestoreDb.updateDoc).toHaveBeenCalledTimes(1);
    expect(firestoreDb.updateDoc).toHaveBeenCalledWith(
      'hospitals/hhr/clinicalDocuments',
      'doc-b',
      expect.objectContaining({ isLocked: true, lockedReason: 'episode_closed' })
    );
  });

  it('returns an empty list when the episode has no documents', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([]);

    const newlyLocked = await ClinicalDocumentRepository.lockDocumentsByEpisodeKey(
      'rut-empty__2026-04-01',
      'hhr'
    );

    expect(newlyLocked).toEqual([]);
    expect(firestoreDb.updateDoc).not.toHaveBeenCalled();
  });

  it('locks via local store when Firestore is disabled', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);

    const document = buildDoc('doc-local', 'rut-2__2026-04-10', '2026-04-12T08:00:00.000Z');
    await ClinicalDocumentRepository.createDraft(document, 'hhr');

    const newlyLocked = await ClinicalDocumentRepository.lockDocumentsByEpisodeKey(
      'rut-2__2026-04-10',
      'hhr',
      { lockedAt: '2026-05-04T13:00:00.000Z' }
    );

    expect(newlyLocked).toEqual(['doc-local']);
    const after = await ClinicalDocumentRepository.get('doc-local', 'hhr');
    expect(after?.isLocked).toBe(true);
    expect(after?.lockedReason).toBe('episode_closed');
    expect(after?.lockedAt).toBe('2026-05-04T13:00:00.000Z');
  });
});
