import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClinicalAttachments } from '@/features/clinical-documents/hooks/useClinicalAttachments';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';

vi.mock('@/application/clinical-documents/clinicalAttachmentUseCases', () => ({
  executeListClinicalAttachmentsByEpisode: vi.fn(),
  executeListClinicalAttachmentsByPatient: vi.fn(),
  executeUploadClinicalAttachment: vi.fn(),
  executeDeleteClinicalAttachment: vi.fn(),
  executeRenameClinicalAttachment: vi.fn(),
  executeRegenerateClinicalAttachmentAccess: vi.fn(),
  executeSuggestClinicalAttachmentDisplayName: vi.fn(),
}));

import {
  executeDeleteClinicalAttachment,
  executeListClinicalAttachmentsByEpisode,
  executeListClinicalAttachmentsByPatient,
  executeRegenerateClinicalAttachmentAccess,
  executeRenameClinicalAttachment,
  executeSuggestClinicalAttachmentDisplayName,
  executeUploadClinicalAttachment,
} from '@/application/clinical-documents/clinicalAttachmentUseCases';

const user = {
  uid: 'u1',
  email: 'doctor@example.com',
  displayName: 'Doctor Test',
};

const document = {
  id: 'doc_1',
  hospitalId: 'hhr',
  documentType: 'epicrisis',
  patientRut: '13.545.665-9',
  patientName: 'Paciente Test',
  episodeKey: 'episode-1',
  admissionDate: '2026-04-15',
  sourceDailyRecordDate: '2026-04-15',
  sourceBedId: 'R2',
} as ClinicalDocumentRecord;

describe('useClinicalAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeListClinicalAttachmentsByEpisode).mockResolvedValue({
      status: 'success',
      data: [],
      issues: [],
    });
    vi.mocked(executeListClinicalAttachmentsByPatient).mockResolvedValue({
      status: 'success',
      data: [],
      issues: [],
    });
  });

  it('loads attachments for the selected document episode', async () => {
    vi.mocked(executeListClinicalAttachmentsByEpisode).mockResolvedValue({
      status: 'success',
      data: [{ id: 'att_1', displayName: 'Informe.pdf' }] as never,
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalAttachments({
        selectedDocument: document,
        hospitalId: 'hhr',
        canEdit: true,
        user,
        role: 'doctor_urgency',
        notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
      })
    );

    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(executeListClinicalAttachmentsByEpisode).toHaveBeenCalledWith({
      episodeKey: 'episode-1',
      hospitalId: 'hhr',
    });
    expect(executeListClinicalAttachmentsByPatient).toHaveBeenCalledWith({
      patientRut: '13.545.665-9',
      hospitalId: 'hhr',
    });
  });

  it('loads patient-wide attachments and exposes other episode attachments separately', async () => {
    vi.mocked(executeListClinicalAttachmentsByPatient).mockResolvedValue({
      status: 'success',
      data: [
        { id: 'att_current', episodeKey: 'episode-1' },
        { id: 'att_previous', episodeKey: 'episode-previous' },
      ] as never,
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalAttachments({
        selectedDocument: document,
        hospitalId: 'hhr',
        canEdit: true,
        user,
        role: 'doctor_urgency',
        notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
      })
    );

    await waitFor(() => expect(result.current.patientAttachments).toHaveLength(2));
    expect(result.current.otherEpisodeAttachments).toEqual([
      { id: 'att_previous', episodeKey: 'episode-previous' },
    ]);
  });

  it('does not reload attachments when only the notification port identity changes', async () => {
    const { rerender } = renderHook(
      ({ notify }) =>
        useClinicalAttachments({
          selectedDocument: document,
          hospitalId: 'hhr',
          canEdit: true,
          user,
          role: 'doctor_urgency',
          notify,
        }),
      {
        initialProps: {
          notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
      }
    );

    await waitFor(() => expect(executeListClinicalAttachmentsByEpisode).toHaveBeenCalledTimes(1));

    rerender({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } });

    expect(executeListClinicalAttachmentsByEpisode).toHaveBeenCalledTimes(1);
    expect(executeListClinicalAttachmentsByPatient).toHaveBeenCalledTimes(1);
  });

  it('uploads and deletes attachments with selected document context', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    vi.mocked(executeUploadClinicalAttachment).mockResolvedValue({
      status: 'success',
      data: { id: 'att_1', displayName: 'Nuevo.pdf' } as never,
      issues: [],
    });
    vi.mocked(executeDeleteClinicalAttachment).mockResolvedValue({
      status: 'success',
      data: undefined,
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalAttachments({
        selectedDocument: document,
        hospitalId: 'hhr',
        canEdit: true,
        user,
        role: 'doctor_urgency',
        notify,
      })
    );

    await act(async () => {
      await result.current.uploadAttachment(
        new File([new Uint8Array(8)], 'nuevo.pdf', { type: 'application/pdf' })
      );
    });

    expect(executeUploadClinicalAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        hospitalId: 'hhr',
        patientRut: '13.545.665-9',
        episodeKey: 'episode-1',
        documentId: 'doc_1',
        actor: expect.objectContaining({ uid: 'u1', role: 'doctor_urgency' }),
      })
    );
    expect(notify.success).toHaveBeenCalledWith(
      'Archivo guardado',
      'El archivo quedó disponible para todo el episodio clínico.'
    );
    expect(result.current.uploadStatusMessage).toBeNull();

    await act(async () => {
      await result.current.deleteAttachment({
        id: 'att_1',
        hospitalId: 'hhr',
        storagePath: 'clinical-attachments/hhr/rut/episode/att_1/nuevo.pdf',
      } as never);
    });

    expect(executeDeleteClinicalAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'att_1',
        hospitalId: 'hhr',
        storagePath: 'clinical-attachments/hhr/rut/episode/att_1/nuevo.pdf',
      })
    );
  });

  it('renames attachments and updates both episode and patient lists', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    vi.mocked(executeRenameClinicalAttachment).mockResolvedValue({
      status: 'success',
      data: { id: 'att_1', displayName: 'Informe cardiologia.pdf' } as never,
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalAttachments({
        selectedDocument: document,
        hospitalId: 'hhr',
        canEdit: true,
        user,
        role: 'doctor_urgency',
        notify,
      })
    );

    await act(async () => {
      await result.current.renameAttachment(
        {
          id: 'att_1',
          hospitalId: 'hhr',
          displayName: 'Informe externo.pdf',
        } as never,
        'Informe cardiologia.pdf'
      );
    });

    expect(executeRenameClinicalAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'att_1',
        hospitalId: 'hhr',
        displayName: 'Informe cardiologia.pdf',
        actor: expect.objectContaining({ uid: 'u1', role: 'doctor_urgency' }),
      })
    );
    expect(notify.success).toHaveBeenCalledWith(
      'Archivo renombrado',
      'El nombre visible del archivo fue actualizado.'
    );
  });

  it('regenerates attachment access and updates both episode and patient lists', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    vi.mocked(executeListClinicalAttachmentsByEpisode).mockResolvedValue({
      status: 'success',
      data: [
        {
          id: 'att_1',
          hospitalId: 'hhr',
          storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
          displayName: 'Informe migrado.pdf',
          downloadUrl: undefined,
        },
      ] as never,
      issues: [],
    });
    vi.mocked(executeListClinicalAttachmentsByPatient).mockResolvedValue({
      status: 'success',
      data: [
        {
          id: 'att_1',
          hospitalId: 'hhr',
          storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
          displayName: 'Informe migrado.pdf',
          downloadUrl: undefined,
        },
      ] as never,
      issues: [],
    });
    vi.mocked(executeRegenerateClinicalAttachmentAccess).mockResolvedValue({
      status: 'success',
      data: { id: 'att_1', downloadUrl: 'https://storage.test/informe.pdf' },
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalAttachments({
        selectedDocument: document,
        hospitalId: 'hhr',
        canEdit: true,
        user,
        role: 'doctor_urgency',
        notify,
      })
    );

    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(result.current.attachments[0]?.downloadUrl).toBeUndefined();

    await act(async () => {
      await result.current.regenerateAttachmentAccess(result.current.attachments[0]);
    });

    expect(executeRegenerateClinicalAttachmentAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'att_1',
        hospitalId: 'hhr',
        storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
        actor: expect.objectContaining({ uid: 'u1', role: 'doctor_urgency' }),
      })
    );
    expect(result.current.attachments[0]?.downloadUrl).toBe('https://storage.test/informe.pdf');
    expect(result.current.patientAttachments[0]?.downloadUrl).toBe(
      'https://storage.test/informe.pdf'
    );
    expect(notify.success).toHaveBeenCalledWith(
      'Acceso regenerado',
      'El archivo vuelve a estar disponible.'
    );
  });

  it('requests an AI display-name suggestion with document and attachment context', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    vi.mocked(executeSuggestClinicalAttachmentDisplayName).mockResolvedValue({
      status: 'success',
      data: 'Eco abdomen ingreso.pdf',
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalAttachments({
        selectedDocument: document,
        hospitalId: 'hhr',
        canEdit: true,
        user,
        role: 'doctor_urgency',
        notify,
      })
    );

    let suggestion: string | null = null;
    await act(async () => {
      suggestion = await result.current.suggestAttachmentName({
        id: 'att_1',
        hospitalId: 'hhr',
        originalFileName: 'IMG_4421.jpg',
        displayName: 'IMG_4421.jpg',
        fileKind: 'image',
        contentType: 'image/jpeg',
        documentType: 'epicrisis',
        admissionDate: '2026-04-15',
      } as never);
    });

    expect(suggestion).toBe('Eco abdomen ingreso.pdf');
    expect(executeSuggestClinicalAttachmentDisplayName).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({ originalFileName: 'IMG_4421.jpg' }),
        document: expect.objectContaining({ id: 'doc_1', documentType: 'epicrisis' }),
      })
    );
  });

  it('uploads pasted images and returns Storage image insertion metadata', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    vi.mocked(executeUploadClinicalAttachment).mockResolvedValue({
      status: 'success',
      data: {
        id: 'att_img',
        displayName: 'captura.png',
        downloadUrl: 'https://storage.test/captura.png',
        storagePath: 'clinical-attachments/hhr/rut/episode/att_img/captura.png',
      } as never,
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalAttachments({
        selectedDocument: document,
        hospitalId: 'hhr',
        canEdit: true,
        user,
        role: 'doctor_urgency',
        notify,
      })
    );

    const pastedImage = new File([new Uint8Array(700 * 1024)], 'captura.png', {
      type: 'image/png',
    });
    let uploadResult: Awaited<ReturnType<typeof result.current.uploadPastedImage>> = null;
    await act(async () => {
      uploadResult = await result.current.uploadPastedImage(pastedImage);
    });

    expect(executeUploadClinicalAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        file: pastedImage,
        displayName: 'captura.png',
        image: { compressed: false },
      })
    );
    expect(uploadResult).toEqual({
      attachmentId: 'att_img',
      imageUrl: 'https://storage.test/captura.png',
      storagePath: 'clinical-attachments/hhr/rut/episode/att_img/captura.png',
    });
  });

  it('announces compression before uploading large images', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    let resolveUpload: (
      value: Awaited<ReturnType<typeof executeUploadClinicalAttachment>>
    ) => void = () => undefined;
    vi.mocked(executeUploadClinicalAttachment).mockReturnValue(
      new Promise(resolve => {
        resolveUpload = resolve;
      }) as ReturnType<typeof executeUploadClinicalAttachment>
    );

    const { result } = renderHook(() =>
      useClinicalAttachments({
        selectedDocument: document,
        hospitalId: 'hhr',
        canEdit: true,
        user,
        role: 'doctor_urgency',
        notify,
      })
    );

    const largeImage = new File([new Uint8Array(3 * 1024 * 1024)], 'grande.jpg', {
      type: 'image/jpeg',
    });

    await act(async () => {
      void result.current.uploadAttachment(largeImage);
    });

    expect(result.current.uploadStatusMessage).toMatch(/comprimiendo imagen/i);

    await act(async () => {
      resolveUpload({
        status: 'success',
        data: { id: 'att_large', displayName: 'grande.jpg' } as never,
        issues: [],
      });
    });

    await waitFor(() => expect(result.current.uploadStatusMessage).toBeNull());
  });
});
