import { describe, expect, it, vi } from 'vitest';

import {
  executeAuditClinicalAttachmentPatientStorage,
  executeDeleteClinicalAttachment,
  executeListClinicalAttachmentsByEpisode,
  executeListClinicalAttachmentsByPatient,
  executeRegenerateClinicalAttachmentAccess,
  executeRenameClinicalAttachment,
  executeUploadClinicalAttachment,
} from '@/application/clinical-documents/clinicalAttachmentUseCases';

const actor = {
  uid: 'u1',
  email: 'doctor@example.com',
  displayName: 'Doctor',
  role: 'doctor_urgency',
};

const buildRepository = () => ({
  upload: vi.fn(),
  listByEpisode: vi.fn(),
  listByPatient: vi.fn(),
  listStoragePathsByPatient: vi.fn(),
  rename: vi.fn(),
  regenerateAccess: vi.fn(),
  delete: vi.fn(),
});

describe('clinicalAttachmentUseCases', () => {
  it('returns a success outcome for uploaded clinical attachments', async () => {
    const repository = buildRepository();
    repository.upload.mockResolvedValue({ id: 'att_1', status: 'active' });

    const outcome = await executeUploadClinicalAttachment(
      {
        hospitalId: 'hhr',
        patientRut: '13.545.665-9',
        episodeKey: 'episode-1',
        file: new File([new Uint8Array(8)], 'informe.pdf', { type: 'application/pdf' }),
        actor,
      },
      { repository, createId: () => 'att_1', getNow: () => '2026-05-21T10:00:00.000Z' }
    );

    expect(outcome.status).toBe('success');
    expect(outcome.data).toMatchObject({ id: 'att_1' });
    expect(repository.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'att_1',
        now: '2026-05-21T10:00:00.000Z',
      })
    );
  });

  it('returns failed outcome with user-safe message when upload fails', async () => {
    const repository = buildRepository();
    repository.upload.mockRejectedValue(new Error('permission-denied'));

    const outcome = await executeUploadClinicalAttachment(
      {
        hospitalId: 'hhr',
        patientRut: '13.545.665-9',
        episodeKey: 'episode-1',
        file: new File([new Uint8Array(8)], 'informe.pdf', { type: 'application/pdf' }),
        actor,
      },
      { repository, createId: () => 'att_1', getNow: () => '2026-05-21T10:00:00.000Z' }
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.userSafeMessage).toContain('No se pudo subir');
  });

  it('compresses large images before uploading them to Storage', async () => {
    const repository = buildRepository();
    repository.upload.mockResolvedValue({ id: 'att_1', status: 'active' });
    const originalFile = new File([new Uint8Array(3 * 1024 * 1024)], 'foto.jpg', {
      type: 'image/jpeg',
    });
    const compressedFile = new File([new Uint8Array(1024)], 'foto.jpg', { type: 'image/jpeg' });
    const compressImage = vi.fn(async () => ({
      status: 'compressed' as const,
      file: compressedFile,
      originalSizeBytes: originalFile.size,
      compressedSizeBytes: compressedFile.size,
      quality: 0.82,
    }));

    const outcome = await executeUploadClinicalAttachment(
      {
        hospitalId: 'hhr',
        patientRut: '13.545.665-9',
        episodeKey: 'episode-1',
        file: originalFile,
        actor,
        image: { compressed: false },
      },
      {
        repository,
        createId: () => 'att_1',
        getNow: () => '2026-05-21T10:00:00.000Z',
        compressImage,
      }
    );

    expect(outcome.status).toBe('success');
    expect(compressImage).toHaveBeenCalledWith(originalFile);
    expect(repository.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        file: compressedFile,
        image: expect.objectContaining({
          compressed: true,
          originalSizeBytes: originalFile.size,
          compressionQuality: 0.82,
        }),
      })
    );
  });

  it('returns a validation failure when large image compression fails', async () => {
    const repository = buildRepository();
    const originalFile = new File([new Uint8Array(3 * 1024 * 1024)], 'foto.jpg', {
      type: 'image/jpeg',
    });

    const outcome = await executeUploadClinicalAttachment(
      {
        hospitalId: 'hhr',
        patientRut: '13.545.665-9',
        episodeKey: 'episode-1',
        file: originalFile,
        actor,
      },
      {
        repository,
        compressImage: vi.fn(async () => ({
          status: 'failed' as const,
          reason: 'No se pudo comprimir la imagen a un tamano seguro.',
        })),
      }
    );

    expect(outcome.status).toBe('failed');
    expect(repository.upload).not.toHaveBeenCalled();
    expect(outcome.userSafeMessage).toContain('comprimir');
  });

  it('wraps list and delete repository operations in outcomes', async () => {
    const repository = buildRepository();
    repository.listByEpisode.mockResolvedValue([{ id: 'att_1' }]);
    repository.listByPatient.mockResolvedValue([{ id: 'att_1' }, { id: 'att_2' }]);
    repository.delete.mockResolvedValue(undefined);

    await expect(
      executeListClinicalAttachmentsByEpisode(
        { episodeKey: 'episode-1', hospitalId: 'hhr' },
        { repository }
      )
    ).resolves.toMatchObject({ status: 'success', data: [{ id: 'att_1' }] });
    await expect(
      executeListClinicalAttachmentsByPatient(
        { patientRut: '13.545.665-9', hospitalId: 'hhr' },
        { repository }
      )
    ).resolves.toMatchObject({ status: 'success', data: [{ id: 'att_1' }, { id: 'att_2' }] });
    await expect(
      executeDeleteClinicalAttachment(
        {
          attachmentId: 'att_1',
          hospitalId: 'hhr',
          storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
          actor,
        },
        { repository, getNow: () => '2026-05-21T11:00:00.000Z' }
      )
    ).resolves.toMatchObject({ status: 'success' });
  });

  it('renames attachment metadata with audit actor and normalized display name', async () => {
    const repository = buildRepository();
    repository.rename.mockResolvedValue({
      id: 'att_1',
      displayName: 'Informe cardiologia.pdf',
    });

    const outcome = await executeRenameClinicalAttachment(
      {
        attachmentId: 'att_1',
        hospitalId: 'hhr',
        displayName: '  Informe cardiologia.pdf  ',
        actor,
      },
      { repository, getNow: () => '2026-05-21T11:30:00.000Z' }
    );

    expect(outcome).toMatchObject({
      status: 'success',
      data: {
        id: 'att_1',
        displayName: 'Informe cardiologia.pdf',
      },
    });
    expect(repository.rename).toHaveBeenCalledWith({
      attachmentId: 'att_1',
      hospitalId: 'hhr',
      displayName: 'Informe cardiologia.pdf',
      actor,
      now: '2026-05-21T11:30:00.000Z',
    });
  });

  it('rejects empty attachment display names before persisting', async () => {
    const repository = buildRepository();

    const outcome = await executeRenameClinicalAttachment(
      {
        attachmentId: 'att_1',
        hospitalId: 'hhr',
        displayName: '   ',
        actor,
      },
      { repository }
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.userSafeMessage).toContain('nombre');
    expect(repository.rename).not.toHaveBeenCalled();
  });

  it('regenerates missing attachment access with audit metadata', async () => {
    const repository = buildRepository();
    repository.regenerateAccess.mockResolvedValue('https://storage.test/informe.pdf');

    const outcome = await executeRegenerateClinicalAttachmentAccess(
      {
        attachmentId: 'att_1',
        hospitalId: 'hhr',
        storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
        actor,
      },
      { repository, getNow: () => '2026-05-21T12:00:00.000Z' }
    );

    expect(outcome).toMatchObject({
      status: 'success',
      data: {
        id: 'att_1',
        downloadUrl: 'https://storage.test/informe.pdf',
      },
    });
    expect(repository.regenerateAccess).toHaveBeenCalledWith({
      attachmentId: 'att_1',
      hospitalId: 'hhr',
      storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
      actor,
      now: '2026-05-21T12:00:00.000Z',
    });
  });

  it('audits mismatches between active metadata and Storage objects for a patient', async () => {
    const repository = buildRepository();
    repository.listByPatient.mockResolvedValue([
      {
        id: 'att_active',
        storagePath: 'clinical-attachments/hhr/rut/episode/att_active/a.pdf',
      },
      {
        id: 'att_missing',
        storagePath: 'clinical-attachments/hhr/rut/episode/att_missing/missing.pdf',
      },
    ]);
    repository.listStoragePathsByPatient.mockResolvedValue([
      'clinical-attachments/hhr/rut/episode/att_active/a.pdf',
      'clinical-attachments/hhr/rut/episode/orphan/orphan.pdf',
    ]);

    const outcome = await executeAuditClinicalAttachmentPatientStorage(
      { patientRut: '13.545.665-9', hospitalId: 'hhr' },
      { repository }
    );

    expect(outcome).toMatchObject({
      status: 'success',
      data: {
        activeMetadataCount: 2,
        storageObjectCount: 2,
        orphanStoragePaths: ['clinical-attachments/hhr/rut/episode/orphan/orphan.pdf'],
        missingStorageRecords: [
          {
            id: 'att_missing',
            storagePath: 'clinical-attachments/hhr/rut/episode/att_missing/missing.pdf',
          },
        ],
      },
    });
  });
});
