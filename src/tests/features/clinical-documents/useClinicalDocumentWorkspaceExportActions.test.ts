import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { useClinicalDocumentWorkspaceExportActions } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceExportActions';
import * as pdfExportUseCase from '@/application/clinical-documents/clinicalDocumentPdfExportUseCase';
import * as printOpenUseCase from '@/application/clinical-documents/clinicalDocumentPrintOpenUseCase';

const recordCriticalClinicalAction = vi.hoisted(() => vi.fn());
const logEvent = vi.hoisted(() => vi.fn());

vi.mock('@/application/clinical-documents/clinicalDocumentPdfExportUseCase', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentPdfExportUseCase')
  >('@/application/clinical-documents/clinicalDocumentPdfExportUseCase');
  return {
    ...actual,
    executeExportClinicalDocumentPdf: vi.fn(),
  };
});

vi.mock('@/application/clinical-documents/clinicalDocumentPrintOpenUseCase', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/clinical-documents/clinicalDocumentPrintOpenUseCase')
  >('@/application/clinical-documents/clinicalDocumentPrintOpenUseCase');
  return {
    ...actual,
    executeOpenClinicalDocumentPrint: vi.fn(),
  };
});

vi.mock('@/services/observability/operationalTelemetryService', () => ({
  recordOperationalOutcome: vi.fn(),
  recordOperationalTelemetry: vi.fn(),
}));

vi.mock('@/services/observability/criticalClinicalActionRecorder', () => ({
  recordCriticalClinicalAction,
}));

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({ logEvent }),
}));

const buildRecord = (): ClinicalDocumentRecord =>
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

describe('useClinicalDocumentWorkspaceExportActions', () => {
  const notify = {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };

  let setDraft: React.Dispatch<React.SetStateAction<ClinicalDocumentRecord | null>>;

  beforeEach(() => {
    vi.clearAllMocks();
    setDraft = vi.fn();
    vi.mocked(printOpenUseCase.executeOpenClinicalDocumentPrint).mockResolvedValue(true);
    vi.mocked(pdfExportUseCase.executeExportClinicalDocumentPdf).mockResolvedValue({
      status: 'success',
      data: {
        pdf: {
          exportStatus: 'exported',
          fileId: 'pdf-1',
        },
      },
      issues: [],
    });
  });

  it('exports draft documents to Drive without requiring a signature state', async () => {
    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceExportActions({
        selectedDocument: buildRecord(),
        hospitalId: 'hhr',
        notify,
        setDraft,
      })
    );

    await act(async () => {
      await result.current.handleUploadPdf();
    });

    expect(pdfExportUseCase.executeExportClinicalDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({ status: 'draft' }),
        hospitalId: 'hhr',
        fileName: expect.any(String),
      })
    );
    expect(recordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'export',
        action: 'clinical_document_pdf_exported',
        outcome: 'success',
        clinicalDate: '2026-03-06',
        bedId: 'R1',
        patientRut: '11.111.111-1',
        documentType: 'epicrisis',
        exportType: 'pdf',
      })
    );
    expect(logEvent).toHaveBeenCalledWith(
      'CLINICAL_DOCUMENT_EXPORTED',
      'clinicalDocument',
      expect.any(String),
      expect.objectContaining({
        templateId: 'epicrisis',
        patientName: 'Paciente Test',
        exportType: 'pdf',
      }),
      '11.111.111-1',
      '2026-03-06'
    );
  });

  it('marks the draft as failed when the export use case fails', async () => {
    vi.mocked(pdfExportUseCase.executeExportClinicalDocumentPdf).mockResolvedValue({
      status: 'failed',
      data: null,
      issues: [{ kind: 'unknown', message: 'drive down' }],
    });
    const document = buildRecord();

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceExportActions({
        selectedDocument: document,
        hospitalId: 'hhr',
        notify,
        setDraft,
      })
    );

    await act(async () => {
      await result.current.handleUploadPdf();
    });

    expect(notify.error).toHaveBeenCalledWith('Falló la exportación', 'drive down');
    expect(recordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clinical_document_pdf_exported',
        outcome: 'failed',
        exportType: 'pdf',
        issues: ['drive down'],
      })
    );
    expect(setDraft).toHaveBeenCalledWith(expect.any(Function));
  });

  it('prefers userSafeMessage when the export use case fails', async () => {
    vi.mocked(pdfExportUseCase.executeExportClinicalDocumentPdf).mockResolvedValue({
      status: 'failed',
      data: null,
      userSafeMessage: 'El respaldo en Drive no está disponible temporalmente.',
      issues: [{ kind: 'unknown', message: 'drive raw failure' }],
    });
    const document = buildRecord();

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceExportActions({
        selectedDocument: document,
        hospitalId: 'hhr',
        notify,
        setDraft,
      })
    );

    await act(async () => {
      await result.current.handleUploadPdf();
    });

    expect(notify.error).toHaveBeenCalledWith(
      'Falló la exportación',
      'El respaldo en Drive no está disponible temporalmente.'
    );
  });

  it('warns when print preview cannot be prepared', async () => {
    vi.mocked(printOpenUseCase.executeOpenClinicalDocumentPrint).mockResolvedValue(false);
    const document = buildRecord();

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceExportActions({
        selectedDocument: document,
        hospitalId: 'hhr',
        notify,
        setDraft,
      })
    );

    await act(async () => {
      await result.current.handlePrint();
    });

    expect(notify.warning).toHaveBeenCalledWith(
      'No se pudo imprimir el documento',
      'Recarga la página e inténtalo nuevamente.'
    );
    expect(recordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clinical_document_print_preview_opened',
        outcome: 'failed',
        exportType: 'print',
        issues: ['No se pudo preparar la impresión del documento clínico.'],
      })
    );
    expect(pdfExportUseCase.executeExportClinicalDocumentPdf).not.toHaveBeenCalled();
  });

  it('opens print preview and synchronizes the PDF with Drive automatically', async () => {
    const document = buildRecord();

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceExportActions({
        selectedDocument: document,
        hospitalId: 'hhr',
        notify,
        setDraft,
      })
    );

    await act(async () => {
      await result.current.handlePrint();
    });

    expect(printOpenUseCase.executeOpenClinicalDocumentPrint).toHaveBeenCalledWith(document, {
      annexMode: 'include',
    });
    expect(pdfExportUseCase.executeExportClinicalDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({ id: document.id }),
        hospitalId: 'hhr',
        fileName: expect.any(String),
        annexMode: 'include',
      })
    );
    expect(recordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clinical_document_print_preview_opened',
        outcome: 'success',
        exportType: 'print',
      })
    );
    expect(logEvent).toHaveBeenCalledWith(
      'CLINICAL_DOCUMENT_PRINTED',
      'clinicalDocument',
      document.id,
      expect.objectContaining({
        templateId: 'epicrisis',
        patientName: 'Paciente Test',
        exportType: 'print',
        annexMode: 'include',
      }),
      '11.111.111-1',
      '2026-03-06'
    );
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('excludes the annex from global print when the selector is off', async () => {
    const document = buildRecord();
    document.annexContent = '<p>Anexo</p>';
    document.annexIncludedInPrint = false;

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceExportActions({
        selectedDocument: document,
        hospitalId: 'hhr',
        notify,
        setDraft,
      })
    );

    await act(async () => {
      await result.current.handlePrint();
    });

    expect(printOpenUseCase.executeOpenClinicalDocumentPrint).toHaveBeenCalledWith(document, {
      annexMode: 'exclude',
    });
    expect(pdfExportUseCase.executeExportClinicalDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        annexMode: 'exclude',
      })
    );
  });

  it('prints only the annex on demand', async () => {
    const document = buildRecord();
    document.annexContent = '<p>Anexo</p>';

    const { result } = renderHook(() =>
      useClinicalDocumentWorkspaceExportActions({
        selectedDocument: document,
        hospitalId: 'hhr',
        notify,
        setDraft,
      })
    );

    await act(async () => {
      await result.current.handlePrintAnnex();
    });

    expect(printOpenUseCase.executeOpenClinicalDocumentPrint).toHaveBeenCalledWith(
      expect.objectContaining({
        id: document.id,
        title: expect.stringContaining('Anexo del documento'),
      }),
      { annexMode: 'annex_only' }
    );
    expect(pdfExportUseCase.executeExportClinicalDocumentPdf).not.toHaveBeenCalled();
  });
});
