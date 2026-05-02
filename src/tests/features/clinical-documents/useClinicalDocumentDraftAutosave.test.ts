import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { serializeClinicalDocument } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import { useClinicalDocumentDraftAutosave } from '@/features/clinical-documents/hooks/useClinicalDocumentDraftAutosave';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';

const executePersistClinicalDocumentEditorDraft = vi.fn();
const resolveClinicalDocumentAutosaveCommit = vi.fn();
const recordOperationalOutcome = vi.fn();
const recordOperationalTelemetry = vi.fn();
const auditContextMocks = vi.hoisted(() => ({
  logClinicalDocumentEdited: vi.fn(),
  recordCriticalClinicalAction: vi.fn(),
}));

vi.mock('@/application/clinical-documents/clinicalDocumentEditorUseCases', () => ({
  executePersistClinicalDocumentEditorDraft: (...args: unknown[]) =>
    executePersistClinicalDocumentEditorDraft(...args),
  resolveClinicalDocumentAutosaveCommit: (...args: unknown[]) =>
    resolveClinicalDocumentAutosaveCommit(...args),
}));

vi.mock('@/services/observability/operationalTelemetryService', () => ({
  recordOperationalOutcome: (...args: unknown[]) => recordOperationalOutcome(...args),
  recordOperationalTelemetry: (...args: unknown[]) => recordOperationalTelemetry(...args),
}));

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logClinicalDocumentEdited: auditContextMocks.logClinicalDocumentEdited,
  }),
}));

vi.mock('@/services/observability/criticalClinicalActionRecorder', () => ({
  recordCriticalClinicalAction: auditContextMocks.recordCriticalClinicalAction,
}));

const buildDraft = (content: string): ClinicalDocumentRecord => {
  const draft = createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor: {
      uid: 'u1',
      email: 'doctor@test.com',
      displayName: 'Doctor Test',
      role: 'doctor_urgency',
    },
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: '11.111.111-1__2026-03-06',
      admissionDate: '2026-03-06',
      sourceDailyRecordDate: '2026-03-06',
      sourceBedId: 'R1',
      specialty: 'Cirugía',
    },
    patientFieldValues: {
      nombre: 'Paciente Test',
      rut: '11.111.111-1',
      edad: '40a',
      fecnac: '1986-01-01',
      fing: '2026-03-06',
      finf: '2026-03-06',
      hinf: '10:30',
    },
    medico: 'Doctor Test',
    especialidad: 'Cirugía',
  });

  draft.sections = draft.sections.map(section =>
    section.id === 'antecedentes' ? { ...section, content } : section
  );

  return draft;
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useClinicalDocumentDraftAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resolveClinicalDocumentAutosaveCommit.mockReturnValue('mark_clean');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores stale autosave responses when a newer save is already in flight', async () => {
    const firstDeferred = createDeferred<{
      status: 'success';
      data: ClinicalDocumentRecord;
      issues: [];
    }>();
    const secondDeferred = createDeferred<{
      status: 'success';
      data: ClinicalDocumentRecord;
      issues: [];
    }>();

    const firstDraft = buildDraft('<p>Primera versión</p>');
    const secondDraft = buildDraft('<p>Segunda versión</p>');
    const dispatch = vi.fn();
    const draftRef = { current: firstDraft };
    const lastPersistedSnapshotRef = { current: '' };

    executePersistClinicalDocumentEditorDraft
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);

    const { rerender } = renderHook(
      ({ draft }) =>
        useClinicalDocumentDraftAutosave({
          draft,
          canEdit: true,
          isActive: true,
          hospitalId: 'hhr',
          role: 'doctor_urgency',
          persistReason: 'autosave',
          user: {
            uid: 'u1',
            email: 'doctor@test.com',
            displayName: 'Doctor Test',
          },
          dispatch,
          draftRef,
          lastPersistedSnapshotRef,
        }),
      { initialProps: { draft: firstDraft } }
    );

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    draftRef.current = secondDraft;
    rerender({ draft: secondDraft });

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    await act(async () => {
      secondDeferred.resolve({
        status: 'success',
        data: secondDraft,
        issues: [],
      });
      await secondDeferred.promise;
    });

    await act(async () => {
      firstDeferred.resolve({
        status: 'success',
        data: firstDraft,
        issues: [],
      });
      await firstDeferred.promise;
    });

    expect(dispatch).toHaveBeenCalledWith({ type: 'AUTOSAVE_REQUESTED' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'AUTOSAVE_MARK_CLEAN',
      document: secondDraft,
      snapshot: expect.any(String),
    });

    expect(dispatch).not.toHaveBeenCalledWith({
      type: 'AUTOSAVE_MARK_CLEAN',
      document: firstDraft,
      snapshot: expect.any(String),
    });
  });

  it('flushes a pending autosave immediately when the workspace becomes inactive', async () => {
    const draft = buildDraft('<p style="margin-left: 24px;">Texto con sangría</p>');
    const dispatch = vi.fn();
    const draftRef = { current: draft };
    const lastPersistedSnapshotRef = { current: '' };

    executePersistClinicalDocumentEditorDraft.mockResolvedValue({
      status: 'success',
      data: draft,
      issues: [],
    });

    const { rerender } = renderHook(
      ({ isActive }) =>
        useClinicalDocumentDraftAutosave({
          draft,
          canEdit: true,
          isActive,
          hospitalId: 'hhr',
          role: 'doctor_urgency',
          persistReason: 'autosave',
          user: {
            uid: 'u1',
            email: 'doctor@test.com',
            displayName: 'Doctor Test',
          },
          dispatch,
          draftRef,
          lastPersistedSnapshotRef,
        }),
      { initialProps: { isActive: true } }
    );

    expect(executePersistClinicalDocumentEditorDraft).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ isActive: false });
      await Promise.resolve();
    });

    expect(executePersistClinicalDocumentEditorDraft).toHaveBeenCalledTimes(1);
    expect(executePersistClinicalDocumentEditorDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        record: draft,
        reason: 'autosave',
      })
    );
  });

  it('logs successful autosaves through the audit context when the save is not an admin fix', async () => {
    const draft = buildDraft('<p>Texto clínico actualizado</p>');
    const dispatch = vi.fn();
    const draftRef = { current: draft };
    const lastPersistedSnapshotRef = { current: '' };

    executePersistClinicalDocumentEditorDraft.mockResolvedValue({
      status: 'success',
      data: draft,
      issues: [],
    });

    renderHook(() =>
      useClinicalDocumentDraftAutosave({
        draft,
        canEdit: true,
        isActive: true,
        hospitalId: 'hhr',
        role: 'doctor_urgency',
        persistReason: 'autosave',
        user: {
          uid: 'u1',
          email: 'doctor@test.com',
          displayName: 'Doctor Test',
        },
        dispatch,
        draftRef,
        lastPersistedSnapshotRef,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });

    expect(auditContextMocks.logClinicalDocumentEdited).toHaveBeenCalledWith(
      draft.id,
      draft.templateId,
      draft.title,
      undefined,
      draft.sourceDailyRecordDate
    );
    expect(auditContextMocks.recordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'clinical_document',
        action: 'clinical_document_saved',
        outcome: 'success',
        clinicalDate: draft.sourceDailyRecordDate,
        documentId: draft.id,
        documentType: draft.templateId,
        patientRut: '11.111.111-1',
        userId: 'u1',
        userRole: 'doctor_urgency',
      })
    );
  });

  it('does not flush on deactivation when the draft already matches the last persisted snapshot', async () => {
    const draft = buildDraft('<p>Sin cambios pendientes</p>');
    const dispatch = vi.fn();
    const draftRef = { current: draft };
    const lastPersistedSnapshotRef = { current: serializeClinicalDocument(draft) };

    renderHook(() =>
      useClinicalDocumentDraftAutosave({
        draft,
        canEdit: true,
        isActive: false,
        hospitalId: 'hhr',
        role: 'doctor_urgency',
        persistReason: 'autosave',
        user: {
          uid: 'u1',
          email: 'doctor@test.com',
          displayName: 'Doctor Test',
        },
        dispatch,
        draftRef,
        lastPersistedSnapshotRef,
      })
    );

    expect(executePersistClinicalDocumentEditorDraft).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'AUTOSAVE_REQUESTED' });
  });

  it('flushes a pending autosave when switching to another document before the debounce fires', async () => {
    const firstDraft = buildDraft('<p style="margin-left: 24px;">Primer documento</p>');
    const secondDraft = {
      ...buildDraft('<p>Segundo documento</p>'),
      id: 'doc-2',
    };
    const dispatch = vi.fn();
    const draftRef = { current: firstDraft };
    const lastPersistedSnapshotRef = { current: '' };

    executePersistClinicalDocumentEditorDraft.mockResolvedValue({
      status: 'success',
      data: firstDraft,
      issues: [],
    });

    const { rerender } = renderHook(
      ({ draft }) =>
        useClinicalDocumentDraftAutosave({
          draft,
          canEdit: true,
          isActive: true,
          hospitalId: 'hhr',
          role: 'doctor_urgency',
          persistReason: 'autosave',
          user: {
            uid: 'u1',
            email: 'doctor@test.com',
            displayName: 'Doctor Test',
          },
          dispatch,
          draftRef,
          lastPersistedSnapshotRef,
        }),
      { initialProps: { draft: firstDraft } }
    );

    draftRef.current = secondDraft;

    await act(async () => {
      rerender({ draft: secondDraft });
      await Promise.resolve();
    });

    expect(executePersistClinicalDocumentEditorDraft).toHaveBeenCalledTimes(1);
    expect(executePersistClinicalDocumentEditorDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        record: firstDraft,
      })
    );
  });
});
