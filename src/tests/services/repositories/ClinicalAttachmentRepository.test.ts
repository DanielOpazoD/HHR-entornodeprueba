import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClinicalAttachmentRepository } from '@/services/repositories/ClinicalAttachmentRepository';
import type { ClinicalAttachmentRecord } from '@/features/clinical-documents/domain/entities';
import type { ClinicalAttachmentStorageRuntime } from '@/services/firebase-runtime/clinicalAttachmentRuntime';

const actor = {
  uid: 'u1',
  email: 'doctor@example.com',
  displayName: 'Doctor',
  role: 'doctor_urgency',
};

const buildFile = (name = 'informe.pdf', type = 'application/pdf'): File =>
  new File([new Uint8Array(1024)], name, { type });

const buildDb = () => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  subscribeDoc: vi.fn(),
  subscribeQuery: vi.fn(),
  runBatch: vi.fn(),
});

const buildRuntime = (): ClinicalAttachmentStorageRuntime =>
  ({
    getStorage: vi.fn(async () => ({ bucket: 'storage' }) as never),
    ref: vi.fn((_storage: unknown, path: string) => ({ path })),
    uploadBytes: vi.fn(async () => undefined),
    getDownloadURL: vi.fn(async (ref: { path: string }) => `https://storage.test/${ref.path}`),
    deleteObject: vi.fn(async () => undefined),
    listAll: vi.fn(async () => ({ items: [], prefixes: [] })),
  }) as unknown as ClinicalAttachmentStorageRuntime;

const buildUploadInput = () => ({
  id: 'att_1',
  hospitalId: 'hhr',
  patientRut: '13.545.665-9',
  patientName: 'Paciente Test',
  episodeKey: '13.545.665-9__2026-04-15',
  documentId: 'doc_1',
  documentType: 'epicrisis' as const,
  sectionId: 'annexes',
  file: buildFile(),
  actor,
  now: '2026-05-21T10:00:00.000Z',
});

describe('ClinicalAttachmentRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads the file to Storage and writes validated Firestore metadata', async () => {
    const db = buildDb();
    const runtime = buildRuntime();
    const repository = createClinicalAttachmentRepository({ db, storageRuntime: runtime });

    const result = await repository.upload(buildUploadInput());

    expect(runtime.uploadBytes).toHaveBeenCalledWith(
      { path: 'clinical-attachments/hhr/13545665-9/13545665-9__2026-04-15/att_1/informe.pdf' },
      expect.any(File),
      expect.objectContaining({
        contentType: 'application/pdf',
        customMetadata: expect.objectContaining({
          hospitalId: 'hhr',
          patientRut: '13.545.665-9',
          episodeKey: '13.545.665-9__2026-04-15',
          module: 'clinical-attachments',
        }),
      })
    );
    expect(db.setDoc).toHaveBeenCalledWith(
      'hospitals/hhr/clinicalAttachments',
      'att_1',
      expect.objectContaining({
        id: 'att_1',
        patientRutKey: '13545665-9',
        fileKind: 'pdf',
        status: 'active',
      })
    );
    expect(result.downloadUrl).toContain('https://storage.test/clinical-attachments/hhr');
  });

  it('does not create metadata when Storage upload fails', async () => {
    const db = buildDb();
    const runtime = buildRuntime();
    (
      runtime.uploadBytes as unknown as { mockRejectedValueOnce: (error: Error) => void }
    ).mockRejectedValueOnce(new Error('storage down'));
    const repository = createClinicalAttachmentRepository({ db, storageRuntime: runtime });

    await expect(repository.upload(buildUploadInput())).rejects.toThrow('storage down');

    expect(db.setDoc).not.toHaveBeenCalled();
  });

  it('deletes the uploaded object when metadata write fails', async () => {
    const db = buildDb();
    db.setDoc.mockRejectedValueOnce(new Error('firestore down'));
    const runtime = buildRuntime();
    const repository = createClinicalAttachmentRepository({ db, storageRuntime: runtime });

    await expect(repository.upload(buildUploadInput())).rejects.toThrow('firestore down');

    expect(runtime.deleteObject).toHaveBeenCalledWith({
      path: 'clinical-attachments/hhr/13545665-9/13545665-9__2026-04-15/att_1/informe.pdf',
    });
  });

  it('lists active attachments by episode and by patient', async () => {
    const db = buildDb();
    const activeRecord = {
      ...((await createClinicalAttachmentRepository({
        db,
        storageRuntime: buildRuntime(),
      }).upload(buildUploadInput())) as ClinicalAttachmentRecord),
    };
    const deletedRecord = { ...activeRecord, id: 'deleted', status: 'deleted' as const };
    db.getDocs.mockResolvedValue([deletedRecord, activeRecord]);
    const repository = createClinicalAttachmentRepository({ db, storageRuntime: buildRuntime() });

    await expect(repository.listByEpisode('13.545.665-9__2026-04-15', 'hhr')).resolves.toEqual([
      expect.objectContaining({ id: 'att_1' }),
    ]);
    expect(db.getDocs).toHaveBeenCalledWith('hospitals/hhr/clinicalAttachments', {
      where: [{ field: 'episodeKey', operator: '==', value: '13.545.665-9__2026-04-15' }],
    });

    db.getDocs.mockClear();
    db.getDocs.mockResolvedValue([activeRecord]);
    await expect(repository.listByPatient('13.545.665-9', 'hhr')).resolves.toEqual([
      expect.objectContaining({ id: 'att_1' }),
    ]);
    expect(db.getDocs).toHaveBeenCalledWith('hospitals/hhr/clinicalAttachments', {
      where: [{ field: 'patientRutKey', operator: '==', value: '13545665-9' }],
    });
  });

  it('marks metadata as deleted and attempts Storage deletion', async () => {
    const db = buildDb();
    const runtime = buildRuntime();
    const repository = createClinicalAttachmentRepository({ db, storageRuntime: runtime });

    await repository.delete({
      attachmentId: 'att_1',
      hospitalId: 'hhr',
      storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
      actor,
      now: '2026-05-21T11:00:00.000Z',
    });

    expect(db.updateDoc).toHaveBeenCalledWith(
      'hospitals/hhr/clinicalAttachments',
      'att_1',
      expect.objectContaining({
        status: 'deleted',
        deletedAt: '2026-05-21T11:00:00.000Z',
        deletedBy: actor,
      })
    );
    expect(runtime.deleteObject).toHaveBeenCalledWith({
      path: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
    });
  });

  it('updates only attachment display metadata when renaming', async () => {
    const db = buildDb();
    const runtime = buildRuntime();
    const repository = createClinicalAttachmentRepository({ db, storageRuntime: runtime });

    await repository.rename({
      attachmentId: 'att_1',
      hospitalId: 'hhr',
      displayName: 'Eco abdomen ingreso.pdf',
      actor,
      now: '2026-05-21T11:30:00.000Z',
    });

    expect(db.updateDoc).toHaveBeenCalledWith('hospitals/hhr/clinicalAttachments', 'att_1', {
      displayName: 'Eco abdomen ingreso.pdf',
      updatedAt: '2026-05-21T11:30:00.000Z',
      updatedBy: actor,
    });
    expect(runtime.uploadBytes).not.toHaveBeenCalled();
    expect(runtime.deleteObject).not.toHaveBeenCalled();
  });

  it('regenerates a download URL from Storage and persists access metadata', async () => {
    const db = buildDb();
    const runtime = buildRuntime();
    const repository = createClinicalAttachmentRepository({ db, storageRuntime: runtime });

    const downloadUrl = await repository.regenerateAccess({
      attachmentId: 'att_1',
      hospitalId: 'hhr',
      storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
      actor,
      now: '2026-05-21T12:00:00.000Z',
    });

    expect(downloadUrl).toBe(
      'https://storage.test/clinical-attachments/hhr/rut/episode/att_1/informe.pdf'
    );
    expect(runtime.getDownloadURL).toHaveBeenCalledWith({
      path: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
    });
    expect(db.updateDoc).toHaveBeenCalledWith('hospitals/hhr/clinicalAttachments', 'att_1', {
      downloadUrl,
      updatedAt: '2026-05-21T12:00:00.000Z',
      updatedBy: actor,
    });
    expect(runtime.uploadBytes).not.toHaveBeenCalled();
    expect(runtime.deleteObject).not.toHaveBeenCalled();
  });

  it('lists Storage object paths by patient rut recursively for integrity audits', async () => {
    const db = buildDb();
    const runtime = buildRuntime();
    const listAll = vi.mocked(runtime.listAll);
    listAll
      .mockResolvedValueOnce({
        items: [],
        prefixes: [
          { fullPath: 'clinical-attachments/hhr/13545665-9/episode-1' },
          { fullPath: 'clinical-attachments/hhr/13545665-9/episode-2' },
        ],
      } as never)
      .mockResolvedValueOnce({
        items: [{ fullPath: 'clinical-attachments/hhr/13545665-9/episode-1/att_1/a.pdf' }],
        prefixes: [],
      } as never)
      .mockResolvedValueOnce({
        items: [{ fullPath: 'clinical-attachments/hhr/13545665-9/episode-2/att_2/b.pdf' }],
        prefixes: [],
      } as never);
    const repository = createClinicalAttachmentRepository({ db, storageRuntime: runtime });

    await expect(repository.listStoragePathsByPatient('13.545.665-9', 'hhr')).resolves.toEqual([
      'clinical-attachments/hhr/13545665-9/episode-1/att_1/a.pdf',
      'clinical-attachments/hhr/13545665-9/episode-2/att_2/b.pdf',
    ]);
    expect(runtime.ref).toHaveBeenCalledWith(
      { bucket: 'storage' },
      'clinical-attachments/hhr/13545665-9'
    );
  });
});
