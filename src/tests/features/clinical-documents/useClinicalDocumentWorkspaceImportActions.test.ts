import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

import { buildClinicalDocumentJsonExport } from '@/application/clinical-documents/clinicalDocumentJsonUseCases';
import * as clinicalDocumentUseCases from '@/application/clinical-documents/clinicalDocumentUseCases';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import { useClinicalDocumentWorkspaceImportActions } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceImportActions';
import * as clinicalDocumentAiFileTextService from '@/features/clinical-documents/services/clinicalDocumentAiFileTextService';
import * as clinicalDocumentAiImportService from '@/features/clinical-documents/services/clinicalDocumentAiImportService';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

const auditContextMocks = vi.hoisted(() => ({
  logClinicalDocumentCreated: vi.fn(),
}));

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logClinicalDocumentCreated: auditContextMocks.logClinicalDocumentCreated,
  }),
}));

vi.mock('@/application/clinical-documents/clinicalDocumentUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentUseCases')
  >('@/application/clinical-documents/clinicalDocumentUseCases');

  return {
    ...actual,
    executeCreateClinicalDocumentDraft: vi.fn(),
  };
});

vi.mock('@/features/clinical-documents/services/clinicalDocumentAiFileTextService', () => ({
  extractClinicalDocumentAiImportFileText: vi.fn(),
}));

vi.mock('@/features/clinical-documents/services/clinicalDocumentAiImportService', () => ({
  transformClinicalDocumentAiImportText: vi.fn(),
}));

vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalOutcome: vi.fn(),
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
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

describe('useClinicalDocumentWorkspaceImportActions', () => {
  const notify = {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
  };

  let setSelectedDocumentId: React.Dispatch<React.SetStateAction<string | null>>;
  let setDraft: React.Dispatch<React.SetStateAction<ReturnType<typeof buildRecord> | null>>;
  let lastPersistedSnapshotRef: React.MutableRefObject<string>;

  const renderImportActions = (selectedDocument = buildRecord()) =>
    renderHook(() =>
      useClinicalDocumentWorkspaceImportActions({
        patient: patient as never,
        role: 'doctor_urgency',
        user: { uid: 'u1', email: 'doctor@test.com', displayName: 'Doctor Test' },
        hospitalId: 'hhr',
        episode: selectedDocument,
        canEdit: true,
        notify,
        setSelectedDocumentId,
        setDraft,
        lastPersistedSnapshotRef,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    setSelectedDocumentId = vi.fn();
    setDraft = vi.fn();
    lastPersistedSnapshotRef = { current: '' };
    notify.confirm.mockResolvedValue(true);
  });

  it('imports a clinical document json as a new draft through the create use case', async () => {
    const selectedDocument = buildRecord();
    vi.mocked(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).mockImplementation(
      async record => ({
        status: 'success',
        data: { ...record, id: 'imported-document-id' },
        issues: [],
      })
    );

    const { result } = renderImportActions(selectedDocument);

    await act(async () => {
      await result.current.handleImportJson(
        new File([JSON.stringify(buildClinicalDocumentJsonExport(selectedDocument))], 'doc.json', {
          type: 'application/json',
        })
      );
    });

    expect(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.not.stringMatching(selectedDocument.id),
        title: `${selectedDocument.title} (importado)`,
        status: 'draft',
        isLocked: false,
        currentVersion: 1,
      }),
      'hhr'
    );
    expect(setSelectedDocumentId).toHaveBeenCalledWith('imported-document-id');
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'imported-document-id' }));
    expect(notify.success).toHaveBeenCalledWith(
      'Documento importado',
      `${selectedDocument.title} (importado) quedó guardado como un nuevo borrador.`
    );
    expect(auditContextMocks.logClinicalDocumentCreated).toHaveBeenCalledWith(
      'imported-document-id',
      selectedDocument.templateId,
      `${selectedDocument.title} (importado)`,
      selectedDocument.patientRut,
      selectedDocument.sourceDailyRecordDate
    );
  });

  it('imports a transfer report with AI and opens the generated epicrisis traslado draft', async () => {
    const selectedDocument = buildRecord();
    vi.mocked(
      clinicalDocumentAiFileTextService.extractClinicalDocumentAiImportFileText
    ).mockResolvedValue({
      status: 'success',
      data: 'Informe de traslado. '.repeat(10),
      issues: [],
    });
    vi.mocked(
      clinicalDocumentAiImportService.transformClinicalDocumentAiImportText
    ).mockResolvedValue({
      status: 'success',
      data: {
        antecedentes: 'HTA.',
        historiaEvolucionClinica: 'Traslado por neumonia.',
        examenesComplementarios: '',
        diagnosticosEgreso: 'Neumonia.',
        planEgreso: 'Continuar manejo en centro receptor.',
      },
      issues: [],
    });
    vi.mocked(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).mockImplementation(
      async record => ({
        status: 'success',
        data: { ...record, id: 'ai-imported-document-id' },
        issues: [],
      })
    );

    const { result } = renderImportActions(selectedDocument);

    await act(async () => {
      await result.current.handleImportWithAi(
        new File(['contenido'], 'informe-traslado.pdf', { type: 'application/pdf' })
      );
    });

    expect(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: 'epicrisis_traslado',
        templateId: 'epicrisis_traslado',
        title: 'Epicrisis traslado',
        status: 'draft',
        isLocked: false,
        versionHistory: expect.arrayContaining([
          expect.objectContaining({ version: 1, reason: 'ai_import' }),
        ]),
        sections: expect.arrayContaining([
          expect.objectContaining({
            id: 'plan',
            title: 'Plan de egreso',
            content: '<p>Continuar manejo en centro receptor.</p>',
          }),
        ]),
      }),
      'hhr'
    );
    expect(setSelectedDocumentId).toHaveBeenCalledWith('ai-imported-document-id');
    expect(setDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ai-imported-document-id' })
    );
    expect(notify.success).toHaveBeenCalledWith(
      'Epicrisis traslado creada',
      'Se generó y guardó un borrador editable desde informe-traslado.pdf. Revísalo antes de firmar o exportar.'
    );
    expect(recordOperationalOutcome).toHaveBeenCalledWith(
      'clinical_document',
      'import_clinical_document_ai',
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({
        context: expect.objectContaining({
          importedDocumentId: expect.any(String),
          fileName: 'informe-traslado.pdf',
          sourceTextLength: 210,
        }),
      })
    );
    expect(auditContextMocks.logClinicalDocumentCreated).toHaveBeenCalledWith(
      'ai-imported-document-id',
      'epicrisis_traslado',
      'Epicrisis traslado',
      patient.rut,
      selectedDocument.sourceDailyRecordDate
    );
  });

  it('shows a recoverable error when AI import cannot transform the extracted text', async () => {
    vi.mocked(
      clinicalDocumentAiFileTextService.extractClinicalDocumentAiImportFileText
    ).mockResolvedValue({
      status: 'success',
      data: 'Informe de traslado. '.repeat(10),
      issues: [],
    });
    vi.mocked(
      clinicalDocumentAiImportService.transformClinicalDocumentAiImportText
    ).mockResolvedValue({
      status: 'failed',
      data: null,
      issues: [{ kind: 'remote_blocked', message: 'AI not configured' }],
      userSafeMessage: 'La IA no está configurada para importar documentos.',
    });

    const { result } = renderImportActions();

    await act(async () => {
      await result.current.handleImportWithAi(
        new File(['contenido'], 'informe-traslado.pdf', { type: 'application/pdf' })
      );
    });

    expect(clinicalDocumentUseCases.executeCreateClinicalDocumentDraft).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(
      'No se pudo importar con IA',
      'La importación se detuvo antes de guardar: La IA no está configurada para importar documentos.'
    );
    expect(recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'clinical_document',
        status: 'failed',
        operation: 'import_clinical_document_ai',
        context: expect.objectContaining({
          fileName: 'informe-traslado.pdf',
          stage: 'ai_transform',
          sourceTextLength: 210,
        }),
      })
    );
  });
});
