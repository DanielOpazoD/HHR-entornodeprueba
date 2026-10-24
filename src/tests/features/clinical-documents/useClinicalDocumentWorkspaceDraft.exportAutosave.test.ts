import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { useClinicalDocumentWorkspaceDraft } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDraft';
import { useClinicalDocumentWorkspaceExportActions } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceExportActions';
import { resolveAutosaveIndicatorState } from '@/features/clinical-documents/controllers/clinicalDocumentAutosaveIndicatorController';
import type { executePersistClinicalDocumentEditorDraft } from '@/application/clinical-documents/clinicalDocumentEditorUseCases';
import type { executeExportClinicalDocumentPdf } from '@/application/clinical-documents/clinicalDocumentPdfExportUseCase';

const io = vi.hoisted(() => ({
  persist: vi.fn<typeof executePersistClinicalDocumentEditorDraft>(),
  exportPdf: vi.fn<typeof executeExportClinicalDocumentPdf>(),
  audit: vi.fn(),
}));

vi.mock(
  '@/application/clinical-documents/clinicalDocumentEditorUseCases',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('@/application/clinical-documents/clinicalDocumentEditorUseCases')
    >()),
    executePersistClinicalDocumentEditorDraft: io.persist,
  })
);
vi.mock('@/application/clinical-documents/clinicalDocumentPdfExportUseCase', () => ({
  executeExportClinicalDocumentPdf: io.exportPdf,
}));
vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({ logEvent: io.audit, logClinicalDocumentEdited: io.audit }),
}));
vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalOutcome: vi.fn(),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/services/observability/criticalClinicalActionRecorder', () => ({
  recordCriticalClinicalAction: vi.fn(),
}));

const user = {
  uid: 'synthetic-p4',
  email: 'synthetic-p4@example.invalid',
  displayName: 'SYNTHETIC P4 DOCTOR',
};
const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
const buildRecord = () =>
  createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'synthetic-p4-hospital',
    actor: { ...user, role: 'doctor_urgency' },
    episode: {
      patientRut: 'FAKE-P4',
      patientName: 'SYNTHETIC P4 PATIENT',
      episodeKey: 'FAKE-P4__2026-10-24',
      admissionDate: '2026-10-24',
      sourceDailyRecordDate: '2026-10-24',
      sourceBedId: 'FAKE-BED',
      specialty: 'Medicina',
    },
    patientFieldValues: {},
    medico: user.displayName,
    especialidad: 'Medicina',
  });

const useWorkspace = (documents: ClinicalDocumentRecord[]) => {
  const draft = useClinicalDocumentWorkspaceDraft({
    documents,
    selectedDocumentId: documents[0].id,
    canEdit: true,
    isActive: true,
    hospitalId: 'synthetic-p4-hospital',
    role: 'doctor_urgency',
    persistReason: 'autosave',
    user,
  });
  const actions = useClinicalDocumentWorkspaceExportActions({
    ...draft,
    selectedDocument: draft.draft,
    hospitalId: 'synthetic-p4-hospital',
    notify,
  });
  return {
    ...draft,
    ...actions,
    indicator: resolveAutosaveIndicatorState(
      draft.isSaving,
      draft.hasLocalDraftChanges,
      draft.lastSavedAt
    ).phase,
  };
};

const contentOf = (record: ClinicalDocumentRecord | null) =>
  record?.sections.find(section => section.id === 'antecedentes')?.content;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('PDF export preserves pending clinical autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it.each(['success', 'failure', 'exception'] as const)(
    'persists edits typed during a fast export %s and restores them on reopen',
    async outcome => {
      let persisted = buildRecord();
      const documents = [persisted];
      const exporting = deferred<Awaited<ReturnType<typeof executeExportClinicalDocumentPdf>>>();
      const saving =
        deferred<Awaited<ReturnType<typeof executePersistClinicalDocumentEditorDraft>>>();
      io.exportPdf.mockReturnValue(exporting.promise);
      io.persist.mockReturnValue(saving.promise);
      const { result, unmount } = renderHook(() => useWorkspace(documents));
      act(() => result.current.patchSection('antecedentes', '<p>SYNTHETIC INITIAL EDIT</p>'));
      let upload!: Promise<void>;
      await act(async () => {
        upload = result.current.handleUploadPdf();
        await Promise.resolve();
      });
      expect(contentOf(io.exportPdf.mock.calls[0][0].record)).toContain('INITIAL EDIT');
      const finalContent = '<p>SYNTHETIC FINAL EDIT DURING EXPORT</p>';
      act(() => result.current.patchSection('antecedentes', finalContent));
      await act(async () => {
        if (outcome === 'success') {
          const pdf = { exportStatus: 'exported', fileId: 'synthetic-p4-pdf' } as const;
          persisted = { ...structuredClone(io.exportPdf.mock.calls[0][0].record), pdf };
          exporting.resolve({ status: 'success', data: { pdf }, issues: [] });
        } else if (outcome === 'failure') {
          exporting.resolve({
            status: 'failed',
            data: null,
            issues: [{ kind: 'unknown', message: 'Synthetic export failure' }],
          });
        } else {
          exporting.reject(new Error('Synthetic export exception'));
        }
        await upload;
      });
      expect(contentOf(result.current.draft)).toBe(finalContent);
      expect(result.current.draft?.pdf?.exportStatus).toBe(
        outcome === 'success' ? 'exported' : 'failed'
      );
      expect(result.current.hasLocalDraftChanges).toBe(true);
      expect(result.current.indicator).toBe('dirty');
      await act(async () => vi.advanceTimersByTimeAsync(899));
      expect(io.persist).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(io.persist).toHaveBeenCalledTimes(1);
      expect(contentOf(io.persist.mock.calls[0][0].record)).toBe(finalContent);
      expect(result.current.indicator).toBe('saving');
      await act(async () => {
        persisted = structuredClone(io.persist.mock.calls[0][0].record);
        persisted.audit.updatedAt = '2026-10-24T12:15:00.000Z';
        saving.resolve({ status: 'success', data: persisted, issues: [] });
      });
      expect(result.current.hasLocalDraftChanges).toBe(false);
      expect(result.current.indicator).toBe('saved');
      io.exportPdf.mockResolvedValueOnce({
        status: 'success',
        data: { pdf: { exportStatus: 'exported', fileId: 'synthetic-p4-second-pdf' } },
        issues: [],
      });
      await act(async () => result.current.handleUploadPdf());
      expect(result.current.draft?.pdf?.fileId).toBe('synthetic-p4-second-pdf');
      expect(result.current.hasLocalDraftChanges).toBe(false);
      expect(result.current.indicator).toBe('saved');
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(io.persist).toHaveBeenCalledTimes(1);
      unmount();
      const reopenedDocuments = [persisted];
      const reopened = renderHook(() => useWorkspace(reopenedDocuments));
      expect(contentOf(reopened.result.current.draft)).toBe(finalContent);
      expect(reopened.result.current.hasLocalDraftChanges).toBe(false);
      reopened.unmount();
    }
  );
});
