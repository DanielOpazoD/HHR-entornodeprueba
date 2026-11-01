import { useCallback } from 'react';

import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import {
  buildClinicalDocumentJsonFileName,
  stringifyClinicalDocumentJsonExport,
} from '@/application/clinical-documents/clinicalDocumentJsonUseCases';
import type { ClinicalDocumentAnnexPrintMode } from '@/features/clinical-documents/services/clinicalDocumentPrintSupport';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { recordCriticalClinicalAction } from '@/services/observability/criticalClinicalActionRecorder';
import type { OperationalTelemetryStatus } from '@/services/observability/operationalTelemetryTypes';
import { useAuditContext } from '@/context/AuditContext';
import { resolveClinicalDocumentExceptionMessage } from './clinicalDocumentWorkspaceActionSupport';

interface NotificationPort {
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

interface UseClinicalDocumentWorkspaceExportActionsParams {
  selectedDocument: ClinicalDocumentRecord | null;
  notify: NotificationPort;
}

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
  notify,
}: UseClinicalDocumentWorkspaceExportActionsParams) => {
  const { logEvent } = useAuditContext();

  const logClinicalDocumentExportAudit = useCallback(
    (
      document: ClinicalDocumentRecord,
      action: 'CLINICAL_DOCUMENT_EXPORTED' | 'CLINICAL_DOCUMENT_PRINTED',
      exportType: 'json' | 'print',
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
  }, [logClinicalDocumentExportAudit, notify, selectedDocument]);

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
  };
};
