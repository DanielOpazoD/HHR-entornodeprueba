import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClinicalAttachments } from '@/features/clinical-documents/hooks/useClinicalAttachments';
import type {
  ClinicalAttachmentRecord,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/domain/entities';

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
  executeListClinicalAttachmentsByEpisode,
  executeListClinicalAttachmentsByPatient,
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

describe('useClinicalAttachments selection isolation', () => {
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

  const attachment: ClinicalAttachmentRecord = {
    id: 'att_scope',
    hospitalId: 'hhr',
    patientRut: document.patientRut,
    patientRutKey: '135456659',
    episodeKey: document.episodeKey,
    storagePath: 'synthetic/attachment',
    downloadUrl: 'https://storage.test/file.pdf',
    originalFileName: 'file.pdf',
    displayName: 'file.pdf',
    contentType: 'application/pdf',
    fileKind: 'pdf',
    sizeBytes: 8,
    status: 'active',
    createdAt: '2026-04-15T12:00:00Z',
    updatedAt: '2026-04-15T12:00:00Z',
    createdBy: { ...user, role: 'doctor_urgency' },
    updatedBy: { ...user, role: 'doctor_urgency' },
  };

  it.each(['episode', 'patient', 'hospital'] as const)(
    'hides old attachments while a new %s loads',
    async change => {
      const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
      const loaded = { status: 'success' as const, data: [attachment], issues: [] };
      vi.mocked(executeListClinicalAttachmentsByEpisode).mockResolvedValueOnce(loaded);
      vi.mocked(executeListClinicalAttachmentsByPatient).mockResolvedValueOnce(loaded);
      const { result, rerender } = renderHook(
        ({ selectedDocument, hospitalId }) =>
          useClinicalAttachments({
            selectedDocument,
            hospitalId,
            canEdit: true,
            user,
            role: 'doctor_urgency',
            notify,
          }),
        { initialProps: { selectedDocument: document, hospitalId: 'hhr' } }
      );
      await waitFor(() => expect(result.current.attachments).toHaveLength(1));
      let finish!: (value: typeof loaded) => void;
      const pending = new Promise<typeof loaded>(resolve => {
        finish = resolve;
      });
      vi.mocked(executeListClinicalAttachmentsByEpisode).mockReturnValue(pending);
      vi.mocked(executeListClinicalAttachmentsByPatient).mockReturnValue(pending);
      rerender({
        selectedDocument: {
          ...document,
          episodeKey: change === 'episode' ? 'episode-2' : document.episodeKey,
          patientRut: change === 'patient' ? '22222222-2' : document.patientRut,
        },
        hospitalId: change === 'hospital' ? 'other' : 'hhr',
      });
      expect(result.current.attachments).toEqual([]);
      expect(result.current.patientAttachments).toEqual([]);
      expect(result.current.isLoadingAttachments).toBe(true);
      await act(async () => finish({ ...loaded, data: [] }));
      expect(result.current.isLoadingAttachments).toBe(false);
    }
  );

  it.each([
    ['uploadAttachment', 'document'],
    ['uploadPastedImage', 'document'],
    ['uploadAttachment', 'episode'],
    ['uploadPastedImage', 'episode'],
  ] as const)('scopes %s results after changing %s', async (method, change) => {
    const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    let finish!: (value: Awaited<ReturnType<typeof executeUploadClinicalAttachment>>) => void;
    vi.mocked(executeUploadClinicalAttachment).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result, rerender } = renderHook(
      ({ selectedDocument }) =>
        useClinicalAttachments({
          selectedDocument,
          hospitalId: 'hhr',
          canEdit: true,
          user,
          role: 'doctor_urgency',
          notify,
        }),
      { initialProps: { selectedDocument: document } }
    );
    await waitFor(() => expect(result.current.isLoadingAttachments).toBe(false));
    let pending!: ReturnType<typeof result.current.uploadPastedImage> | Promise<void>;
    act(() => {
      pending = result.current[method](new File(['test'], 'file.pdf', { type: 'application/pdf' }));
    });
    expect(result.current.isUploadingAttachment).toBe(true);
    rerender({
      selectedDocument: {
        ...document,
        id: 'doc_2',
        episodeKey: change === 'episode' ? 'episode-2' : document.episodeKey,
      },
    });
    expect(result.current.isUploadingAttachment).toBe(false);
    expect(executeListClinicalAttachmentsByEpisode).toHaveBeenCalledTimes(
      change === 'episode' ? 2 : 1
    );
    expect(executeListClinicalAttachmentsByPatient).toHaveBeenCalledTimes(
      change === 'episode' ? 2 : 1
    );
    let outcome: unknown;
    await act(async () => {
      finish({ status: 'success', data: attachment, issues: [] });
      outcome = await pending;
    });
    expect(result.current.attachments).toEqual(change === 'episode' ? [] : [attachment]);
    expect(result.current.patientAttachments).toEqual(change === 'episode' ? [] : [attachment]);
    expect(notify.success).not.toHaveBeenCalled();
    if (method === 'uploadPastedImage') expect(outcome).toBeNull();
    expect(executeUploadClinicalAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc_1' })
    );
  });

  it('ends loading when selection is removed and ignores the pending result', async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof executeListClinicalAttachmentsByEpisode>>
    ) => void;
    vi.mocked(executeListClinicalAttachmentsByEpisode).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result, rerender } = renderHook(
      ({ selectedDocument }: { selectedDocument: ClinicalDocumentRecord | null }) =>
        useClinicalAttachments({
          selectedDocument,
          hospitalId: 'hhr',
          canEdit: true,
          user,
          role: 'doctor_urgency',
          notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        }),
      { initialProps: { selectedDocument: document as ClinicalDocumentRecord | null } }
    );
    expect(result.current.isLoadingAttachments).toBe(true);
    rerender({ selectedDocument: null });
    expect(result.current.isLoadingAttachments).toBe(false);
    expect(result.current.isLoadingPatientAttachments).toBe(false);
    await act(async () => finish({ status: 'success', data: [attachment], issues: [] }));
    expect(result.current.attachments).toEqual([]);
  });

  it('applies a completed upload after leaving and returning to its episode without inserting into the editor', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    let finish!: (value: Awaited<ReturnType<typeof executeUploadClinicalAttachment>>) => void;
    vi.mocked(executeUploadClinicalAttachment).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result, rerender } = renderHook(
      ({ selectedDocument }) =>
        useClinicalAttachments({
          selectedDocument,
          hospitalId: 'hhr',
          canEdit: true,
          user,
          role: 'doctor_urgency',
          notify,
        }),
      { initialProps: { selectedDocument: document } }
    );
    await waitFor(() => expect(result.current.isLoadingAttachments).toBe(false));
    let pending!: ReturnType<typeof result.current.uploadPastedImage>;
    act(() => {
      pending = result.current.uploadPastedImage(
        new File(['test'], 'file.png', { type: 'image/png' })
      );
    });
    rerender({ selectedDocument: { ...document, id: 'doc_2', episodeKey: 'episode-2' } });
    rerender({ selectedDocument: document });
    await waitFor(() => expect(result.current.isLoadingAttachments).toBe(false));
    await act(async () => {
      finish({ status: 'success', data: attachment, issues: [] });
      expect(await pending).toBeNull();
    });
    expect(result.current.attachments).toEqual([attachment]);
    expect(result.current.patientAttachments).toEqual([attachment]);
    expect(notify.success).not.toHaveBeenCalled();
  });

  it.each(['write-first', 'read-first'] as const)(
    'reconciles a returning episode read and upload in %s order',
    async order => {
      let finishUpload!: (
        value: Awaited<ReturnType<typeof executeUploadClinicalAttachment>>
      ) => void;
      vi.mocked(executeUploadClinicalAttachment).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishUpload = resolve;
          })
      );
      const { result, rerender } = renderHook(
        ({ selectedDocument }) =>
          useClinicalAttachments({
            selectedDocument,
            hospitalId: 'hhr',
            canEdit: true,
            user,
            role: 'doctor_urgency',
            notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
          }),
        { initialProps: { selectedDocument: document } }
      );
      await waitFor(() => expect(result.current.isLoadingAttachments).toBe(false));
      let upload!: Promise<void>;
      act(() => {
        upload = result.current.uploadAttachment(
          new File(['test'], 'file.pdf', { type: 'application/pdf' })
        );
      });
      let finishRead!: (
        value: Awaited<ReturnType<typeof executeListClinicalAttachmentsByEpisode>>
      ) => void;
      const pending = new Promise<
        Awaited<ReturnType<typeof executeListClinicalAttachmentsByEpisode>>
      >(resolve => {
        finishRead = resolve;
      });
      vi.mocked(executeListClinicalAttachmentsByEpisode).mockReturnValue(pending);
      vi.mocked(executeListClinicalAttachmentsByPatient).mockReturnValue(pending);
      rerender({ selectedDocument: { ...document, id: 'doc_2', episodeKey: 'episode-2' } });
      rerender({ selectedDocument: document });
      const other = { ...attachment, id: 'other' };
      const completeRead = () =>
        finishRead({
          status: 'success',
          data: order === 'read-first' ? [attachment, other] : [other],
          issues: [],
        });
      const completeUpload = async () => {
        finishUpload({ status: 'success', data: attachment, issues: [] });
        await upload;
      };
      if (order === 'write-first') {
        await act(completeUpload);
        await act(async () => completeRead());
      } else {
        await act(async () => completeRead());
        await act(completeUpload);
      }
      expect(result.current.attachments).toEqual([attachment, other]);
      expect(result.current.patientAttachments).toEqual([attachment, other]);
      expect(result.current.isLoadingAttachments).toBe(false);
    }
  );
});
