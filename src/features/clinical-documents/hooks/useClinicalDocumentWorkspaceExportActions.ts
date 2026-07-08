import { useCallback, useState } from 'react';

import type { ConfirmOptions } from '@/context/uiContracts';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { buildClinicalDocumentPdfFileName } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import type { ExportClinicalDocumentPdfOutput } from '@/application/clinical-documents/clinicalDocumentPdfExportUseCase';
import {
  buildClinicalDocumentJsonFileName,
  stringifyClinicalDocumentJsonExport,
} from '@/application/clinical-documents/clinicalDocumentJsonUseCases';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { resolveFailedApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import type { ClinicalDocumentAnnexPrintMode } from '@/features/clinical-documents/services/clinicalDocumentPrintSupport';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { recordCriticalClinicalAction } from '@/services/observability/criticalClinicalActionRecorder';
import type { OperationalTelemetryStatus } from '@/services/observability/operationalTelemetryTypes';
import { useAuditContext } from '@/context/AuditContext';
import {
  resolveClinicalDocumentExceptionMessage,
  updateClinicalDocumentPdfFailure,
  updateClinicalDocumentPdfSuccess,
} from './clinicalDocumentWorkspaceActionSupport';

interface NotificationPort {
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  confirm?: (options: ConfirmOptions) => Promise<boolean>;
}

interface UseClinicalDocumentWorkspaceExportActionsParams {
  selectedDocument: ClinicalDocumentRecord | null;
  hospitalId: string;
  notify: NotificationPort;
  setDraft: React.Dispatch<React.SetStateAction<ClinicalDocumentRecord | null>>;
}

interface UploadPdfOptions {
  notifySuccess?: boolean;
  successTitle?: string;
  successMessage?: string;
  recordOverride?: ClinicalDocumentRecord;
  annexMode?: ClinicalDocumentAnnexPrintMode;
}

const loadClinicalDocumentPdfExportUseCase = async () =>
  import('@/application/clinical-documents/clinicalDocumentPdfExportUseCase').then(
    module => module.executeExportClinicalDocumentPdf
  );

const loadClinicalDocumentPrintUseCase = async () =>
  import('@/application/clinical-documents/clinicalDocumentPrintOpenUseCase').then(
    module => module.executeOpenClinicalDocumentPrint
  );

const downloadClinicalDocumentJson = (document: ClinicalDocumentRecord) => {
  const blob = new Blob([stringifyClinicalDocumentJsonExport(document)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = buildClinicalDocumentJsonFileName(document);
  anchor.click();
  URL.revokeObjectURL(url);
};

const recordClinicalDocumentExportCriticalAction = ({
  document,
  action,
  outcome,
  exportType,
  issues,
  context,
}: {
  document: ClinicalDocumentRecord;
  action: string;
  outcome: OperationalTelemetryStatus;
  exportType: string;
  issues?: string[];
  context?: Record<string, unknown>;
}) => {
  recordCriticalClinicalAction({
    category: 'export',
    action,
    outcome,
    clinicalDate: document.sourceDailyRecordDate,
    bedId: document.sourceBedId,
    patientRut: document.patientRut,
    documentId: document.id,
    documentType: document.templateId,
    exportType,
    issues,
    context,
  });
};

export const useClinicalDocumentWorkspaceExportActions = ({
  selectedDocument,
  hospitalId,
  notify,
  setDraft,
}: UseClinicalDocumentWorkspaceExportActionsParams) => {
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const { logEvent } = useAuditContext();

  const logClinicalDocumentExportAudit = useCallback(
    (
      document: ClinicalDocumentRecord,
      action: 'CLINICAL_DOCUMENT_EXPORTED' | 'CLINICAL_DOCUMENT_PRINTED',
      exportType: 'json' | 'pdf' | 'print',
      context?: Record<string, unknown>
    ) => {
      logEvent(
        action,
        'clinicalDocument',
        document.id,
        {
          documentId: document.id,
          templateId: document.templateId,
          documentTitle: document.title,
          patientName: document.patientName,
          exportType,
          ...context,
        },
        document.patientRut,
        document.sourceDailyRecordDate
      );
    },
    [logEvent]
  );

  const handleExportJson = useCallback(
    (document: ClinicalDocumentRecord) => {
      try {
        downloadClinicalDocumentJson(document);
        recordOperationalTelemetry(
          {
            category: 'export',
            status: 'success',
            operation: 'export_clinical_document_json',
            date: document.sourceDailyRecordDate,
            context: { documentId: document.id },
          },
          { allowSuccess: true }
        );
        recordClinicalDocumentExportCriticalAction({
          document,
          action: 'clinical_document_json_exported',
          outcome: 'success',
          exportType: 'json',
        });
        logClinicalDocumentExportAudit(document, 'CLINICAL_DOCUMENT_EXPORTED', 'json');
        notify.success('JSON exportado', 'El documento clínico se descargó como respaldo JSON.');
      } catch (error) {
        const errorMessage = resolveClinicalDocumentExceptionMessage(
          error,
          'No se pudo exportar el JSON clínico.'
        );
        recordOperationalTelemetry({
          category: 'export',
          status: 'failed',
          operation: 'export_clinical_document_json',
          date: document.sourceDailyRecordDate,
          issues: [errorMessage],
          context: { documentId: document.id },
        });
        recordClinicalDocumentExportCriticalAction({
          document,
          action: 'clinical_document_json_exported',
          outcome: 'failed',
          exportType: 'json',
          issues: [errorMessage],
        });
        notify.error('Falló la exportación JSON', errorMessage);
      }
    },
    [logClinicalDocumentExportAudit, notify]
  );

  const handleUploadPdf = useCallback(
    async (options: UploadPdfOptions = {}) => {
      if (!selectedDocument) {
        return;
      }

      const recordToExport = options.recordOverride || selectedDocument;
      setIsUploadingPdf(true);
      try {
        const executeExportClinicalDocumentPdf = await loadClinicalDocumentPdfExportUseCase();
        const result: ApplicationOutcome<ExportClinicalDocumentPdfOutput | null> =
          await executeExportClinicalDocumentPdf({
            record: recordToExport,
            hospitalId,
            fileName: buildClinicalDocumentPdfFileName(recordToExport),
            annexMode: options.annexMode,
          });
        recordOperationalOutcome('export', 'export_clinical_document_pdf', result, {
          date: recordToExport.sourceDailyRecordDate,
          context: { documentId: recordToExport.id },
          allowSuccess: true,
        });
        const outcomeError = resolveFailedApplicationOutcomeMessage(
          result,
          'No se pudo exportar el PDF clínico.'
        );
        if (outcomeError || !result.data) {
          recordOperationalTelemetry({
            category: 'export',
            status: 'failed',
            operation: 'export_clinical_document_pdf',
            date: recordToExport.sourceDailyRecordDate,
            issues: [outcomeError || 'No se pudo exportar el PDF clínico.'],
            context: { documentId: recordToExport.id },
          });
          recordClinicalDocumentExportCriticalAction({
            document: recordToExport,
            action: 'clinical_document_pdf_exported',
            outcome: 'failed',
            exportType: 'pdf',
            issues: [outcomeError || 'No se pudo exportar el PDF clínico.'],
          });
          setDraft(prev =>
            updateClinicalDocumentPdfFailure(
              prev,
              outcomeError || 'No se pudo exportar el PDF clínico.'
            )
          );
          notify.error('Falló la exportación', outcomeError || 'El PDF no se pudo subir.');
          return;
        }
        const exportedPdf = result.data.pdf;
        recordClinicalDocumentExportCriticalAction({
          document: recordToExport,
          action: 'clinical_document_pdf_exported',
          outcome: 'success',
          exportType: 'pdf',
          context: {
            fileId: exportedPdf.fileId,
            annexMode: options.annexMode,
          },
        });
        logClinicalDocumentExportAudit(recordToExport, 'CLINICAL_DOCUMENT_EXPORTED', 'pdf', {
          fileId: exportedPdf.fileId,
          annexMode: options.annexMode,
        });
        setDraft(prev => updateClinicalDocumentPdfSuccess(prev, exportedPdf));
        if (options.notifySuccess !== false) {
          notify.success(
            options.successTitle || 'PDF exportado',
            options.successMessage ||
              'El documento quedó respaldado en el Google Drive institucional.'
          );
        }
      } catch (error) {
        const errorMessage = resolveClinicalDocumentExceptionMessage(
          error,
          'El documento quedó guardado, pero el PDF no se pudo subir.'
        );
        recordOperationalTelemetry({
          category: 'export',
          status: 'failed',
          operation: 'export_clinical_document_pdf',
          date: recordToExport.sourceDailyRecordDate,
          issues: [errorMessage],
          context: { documentId: recordToExport.id },
        });
        recordClinicalDocumentExportCriticalAction({
          document: recordToExport,
          action: 'clinical_document_pdf_exported',
          outcome: 'failed',
          exportType: 'pdf',
          issues: [errorMessage],
        });
        setDraft(prev => updateClinicalDocumentPdfFailure(prev, errorMessage));
        notify.error('Falló la exportación', errorMessage);
      } finally {
        setIsUploadingPdf(false);
      }
    },
    [hospitalId, logClinicalDocumentExportAudit, notify, selectedDocument, setDraft]
  );

  const handlePrint = useCallback(async () => {
    if (!selectedDocument) return;
    const executeOpenClinicalDocumentPrint = await loadClinicalDocumentPrintUseCase();
    const annexMode: ClinicalDocumentAnnexPrintMode =
      selectedDocument.annexContent?.trim() && selectedDocument.annexIncludedInPrint === false
        ? 'exclude'
        : 'include';
    const opened = await executeOpenClinicalDocumentPrint(selectedDocument, { annexMode });
    if (!opened) {
      recordOperationalTelemetry({
        category: 'export',
        status: 'failed',
        operation: 'open_clinical_document_print_preview',
        date: selectedDocument.sourceDailyRecordDate,
        context: { documentId: selectedDocument.id },
        issues: ['No se pudo preparar la impresión del documento clínico.'],
      });
      recordClinicalDocumentExportCriticalAction({
        document: selectedDocument,
        action: 'clinical_document_print_preview_opened',
        outcome: 'failed',
        exportType: 'print',
        issues: ['No se pudo preparar la impresión del documento clínico.'],
        context: { annexMode },
      });
      notify.warning(
        'No se pudo imprimir el documento',
        'Recarga la página e inténtalo nuevamente.'
      );
      return;
    }
    recordOperationalTelemetry(
      {
        category: 'export',
        status: 'success',
        operation: 'open_clinical_document_print_preview',
        date: selectedDocument.sourceDailyRecordDate,
        context: { documentId: selectedDocument.id },
      },
      { allowSuccess: true }
    );
    recordClinicalDocumentExportCriticalAction({
      document: selectedDocument,
      action: 'clinical_document_print_preview_opened',
      outcome: 'success',
      exportType: 'print',
      context: { annexMode },
    });
    logClinicalDocumentExportAudit(selectedDocument, 'CLINICAL_DOCUMENT_PRINTED', 'print', {
      annexMode,
    });
    await handleUploadPdf({ notifySuccess: false, annexMode });
  }, [handleUploadPdf, logClinicalDocumentExportAudit, notify, selectedDocument]);

  const handlePrintAnnex = useCallback(async () => {
    if (!selectedDocument?.annexContent?.trim()) {
      notify.info('Sin anexo para imprimir', 'Agrega contenido al anexo del documento primero.');
      return;
    }

    const executeOpenClinicalDocumentPrint = await loadClinicalDocumentPrintUseCase();
    const pageTitle = `Anexo del documento - ${selectedDocument.patientName || selectedDocument.title}`;
    const opened = await executeOpenClinicalDocumentPrint(
      {
        ...selectedDocument,
        title: pageTitle,
      },
      { annexMode: 'annex_only' }
    );
    if (!opened) {
      notify.warning('No se pudo imprimir el anexo', 'Recarga la página e inténtalo nuevamente.');
    }
  }, [notify, selectedDocument]);

  return {
    handleExportJson,
    handlePrint,
    handlePrintAnnex,
    handleUploadPdf,
    isUploadingPdf,
  };
};
