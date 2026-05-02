import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import { useClinicalDocumentWorkspaceDocumentActions } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDocumentActions';
import * as clinicalDocumentUseCases from '@/application/clinical-documents/clinicalDocumentUseCases';

const auditContextMocks = vi.hoisted(() => ({
  logClinicalDocumentCreated: vi.fn(),
  logClinicalDocumentDeleted: vi.fn(),
}));

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logClinicalDocumentCreated: auditContextMocks.logClinicalDocumentCreated,
    logClinicalDocumentDeleted: auditContextMocks.logClinicalDocumentDeleted,
  }),
}));

vi.mock('@/application/clinical-documents/clinicalDocumentUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentUseCases')
  >('@/application/clinical-documents/clinicalDocumentUseCases');

  return {
    ...actual,
    executeCreateClinicalDocumentDraft: vi.fn(),
    executeDeleteClinicalDocument: vi.fn(),
  };
});

vi.mock('@/services/observability/operationalTelemetryService', () => ({
  recordOperationalOutcome: vi.fn(),
  recordOperationalTelemetry: vi.fn(),
}));

const buildRecord = () =>
  createClinicalDocumentDraft({
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
      specialty: 'Medicina',
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
    especialidad: 'Medicina',
  });

const patient = {
  patientName: 'Paciente Test',
  rut: '11.111.111-1',
  age: '40a',
  birthDate: '1986-01-01',
  admissionDate: '2026-03-06',
};

const templates = [{ id: 'epicrisis' }];

describe('useClinicalDocumentWorkspaceDocumentActions', () => {
  const notify = {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
  };

  let setSelectedDocumentId: React.Dispatch<React.SetStateAction<string | null>>;
  let setDraft: React.Dispatch<React.SetStateAction<ReturnType<typeof buildRecord> | null>>;
  let lastPersistedSnapshotRef: React.MutableRefObject<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    setSelectedDocumentId = vi.fn();
    setDraft = vi.fn();
    lastPersistedSnapshotRef = { current: '' };
    notify.confirm.mockResolvedValue(true);
  });

  it('warns when trying to create a document without edit permission', async () => {
    const selectedDocument = buildRecord();
    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceDocumentActions({
        patient: patient as never,
        role: 'viewer',
        user: { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' },
        hospitalId: 'hhr',
        episode: selectedDocument,
        selectedTemplateId: 'epicrisis',
        templates,
        selectedDocumentId: selectedDocument.id,
        canEdit: false,
        canDelete: false,
        notify,
        setSelectedDocumentId,
        setDraft,
        lastPersistedSnapshotRef,
      })
    );

    await act(async () => {
      await result.current.createDocument();
    });

    expect(notify.warning).toHaveBeenCalledWith(
      'Permiso insuficiente',
      'No tienes permisos para crear documentos clínicos.'
    );
    expect(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).not.toHaveBeenCalled();
  });

  it('creates a document and updates draft selection on success', async () => {
    const selectedDocument = buildRecord();
    const createdDocument = { ...selectedDocument, id: 'new-document-id' };
    vi.mocked(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).mockResolvedValue({
      status: 'success',
      data: createdDocument,
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceDocumentActions({
        patient: patient as never,
        role: 'doctor_urgency',
        user: { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' },
        hospitalId: 'hhr',
        episode: selectedDocument,
        selectedTemplateId: 'epicrisis',
        templates,
        selectedDocumentId: selectedDocument.id,
        canEdit: true,
        canDelete: true,
        notify,
        setSelectedDocumentId,
        setDraft,
        lastPersistedSnapshotRef,
      })
    );

    await act(async () => {
      await result.current.createDocument();
    });

    expect(setSelectedDocumentId).toHaveBeenCalledWith('new-document-id');
    expect(setDraft).toHaveBeenCalledWith(createdDocument);
    expect(notify.success).toHaveBeenCalledWith(
      `${createdDocument.title} creada`,
      'Se generó el borrador inicial del documento.'
    );
    expect(lastPersistedSnapshotRef.current).not.toBe('');
    expect(auditContextMocks.logClinicalDocumentCreated).toHaveBeenCalledWith(
      'new-document-id',
      'epicrisis',
      createdDocument.title,
      patient.rut,
      selectedDocument.sourceDailyRecordDate
    );
  });

  it('duplicates a document and selects the copied draft on success', async () => {
    const selectedDocument = buildRecord();
    const duplicatedDocument = { ...selectedDocument, id: 'duplicated-document-id' };
    vi.mocked(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).mockResolvedValue({
      status: 'success',
      data: duplicatedDocument,
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceDocumentActions({
        patient: patient as never,
        role: 'doctor_urgency',
        user: { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' },
        hospitalId: 'hhr',
        episode: selectedDocument,
        selectedTemplateId: 'epicrisis',
        templates,
        selectedDocumentId: selectedDocument.id,
        canEdit: true,
        canDelete: true,
        notify,
        setSelectedDocumentId,
        setDraft,
        lastPersistedSnapshotRef,
      })
    );

    await act(async () => {
      await result.current.handleDuplicateDocument(selectedDocument);
    });

    expect(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        title: `${selectedDocument.title} (copia)`,
        status: 'draft',
        isLocked: false,
        currentVersion: 1,
      }),
      'hhr'
    );
    expect(setSelectedDocumentId).toHaveBeenCalledWith('duplicated-document-id');
    expect(setDraft).toHaveBeenCalledWith(duplicatedDocument);
    expect(notify.success).toHaveBeenCalledWith(
      'Documento duplicado',
      `${selectedDocument.title} se copió como ${duplicatedDocument.title}.`
    );
    expect(auditContextMocks.logClinicalDocumentCreated).toHaveBeenCalledWith(
      'duplicated-document-id',
      duplicatedDocument.templateId,
      duplicatedDocument.title,
      patient.rut,
      duplicatedDocument.sourceDailyRecordDate
    );
  });

  it('clears selected state after deleting the active document', async () => {
    const selectedDocument = buildRecord();
    vi.mocked(clinicalDocumentUseCases.executeDeleteClinicalDocument).mockResolvedValue({
      status: 'success',
      data: null,
      issues: [],
    });

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceDocumentActions({
        patient: patient as never,
        role: 'doctor_urgency',
        user: { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' },
        hospitalId: 'hhr',
        episode: selectedDocument,
        selectedTemplateId: 'epicrisis',
        templates,
        selectedDocumentId: selectedDocument.id,
        canEdit: true,
        canDelete: true,
        notify,
        setSelectedDocumentId,
        setDraft,
        lastPersistedSnapshotRef,
      })
    );

    await act(async () => {
      await result.current.handleDeleteDocument(selectedDocument);
    });

    expect(setSelectedDocumentId).toHaveBeenCalledWith(null);
    expect(setDraft).toHaveBeenCalledWith(null);
    expect(notify.success).toHaveBeenCalledWith(
      'Documento eliminado',
      `${selectedDocument.title} fue eliminado correctamente.`
    );
    expect(auditContextMocks.logClinicalDocumentDeleted).toHaveBeenCalledWith(
      selectedDocument.id,
      selectedDocument.templateId,
      selectedDocument.title,
      patient.rut,
      selectedDocument.sourceDailyRecordDate
    );
  });

  it('surfaces failed delete outcome messages without relying on thrown exceptions', async () => {
    const selectedDocument = buildRecord();
    vi.mocked(clinicalDocumentUseCases.executeDeleteClinicalDocument).mockResolvedValue({
      status: 'failed',
      data: null,
      issues: [
        {
          kind: 'remote_blocked',
          message: 'El documento está protegido',
          userSafeMessage: 'El documento no se pudo eliminar por consistencia remota.',
        },
      ],
      userSafeMessage: 'El documento no se pudo eliminar por consistencia remota.',
    });

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceDocumentActions({
        patient: patient as never,
        role: 'doctor_urgency',
        user: { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' },
        hospitalId: 'hhr',
        episode: selectedDocument,
        selectedTemplateId: 'epicrisis',
        templates,
        selectedDocumentId: selectedDocument.id,
        canEdit: true,
        canDelete: true,
        notify,
        setSelectedDocumentId,
        setDraft,
        lastPersistedSnapshotRef,
      })
    );

    await act(async () => {
      await result.current.handleDeleteDocument(selectedDocument);
    });

    expect(notify.error).toHaveBeenCalledWith(
      'No se pudo eliminar',
      'El documento no se pudo eliminar por consistencia remota.'
    );
  });
});
