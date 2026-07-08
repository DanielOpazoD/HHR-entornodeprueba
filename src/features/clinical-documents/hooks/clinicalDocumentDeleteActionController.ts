import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ConfirmOptions } from '@/context/uiContracts';
import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { executeDeleteClinicalDocument } from '@/application/clinical-documents/clinicalDocumentUseCases';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

import {
  resolveClinicalDocumentExceptionMessage,
  resolveClinicalDocumentOutcomeError,
  shouldClearSelectedClinicalDocument,
} from './clinicalDocumentWorkspaceActionSupport';

interface NotificationPort {
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface DeleteClinicalDocumentFromWorkspaceParams {
  document: ClinicalDocumentRecord;
  canDelete: boolean;
  hospitalId: string;
  /** Verified actor email; threaded into the fail-closed delete use-case (no synthesized identity). */
  deletedBy: string;
  notify: NotificationPort;
  patient: PatientData;
  selectedDocumentId: string | null;
  setSelectedDocumentId: (documentId: string | null) => void;
  setDraft: Dispatch<SetStateAction<ClinicalDocumentRecord | null>>;
  lastPersistedSnapshotRef: MutableRefObject<string>;
}

export const deleteClinicalDocumentFromWorkspace = async ({
  document,
  canDelete,
  hospitalId,
  deletedBy,
  notify,
  patient,
  selectedDocumentId,
  setSelectedDocumentId,
  setDraft,
  lastPersistedSnapshotRef,
}: DeleteClinicalDocumentFromWorkspaceParams): Promise<void> => {
  if (!canDelete) {
    notify.warning('Permiso insuficiente', 'No tienes permisos para eliminar documentos clínicos.');
    return;
  }

  const confirmed = await notify.confirm({
    title: 'Eliminar documento clínico',
    message: 'Esta acción eliminará el documento de forma permanente.',
    confirmText: 'Eliminar',
    cancelText: 'Cancelar',
    variant: 'danger',
    requireInputConfirm: 'X',
    inputConfirmCaseSensitive: false,
  });

  if (!confirmed) return;

  try {
    const result = await executeDeleteClinicalDocument(document.id, hospitalId, {
      deletedBy,
      templateId: document.templateId,
      documentTitle: document.title,
      patientRut: patient.rut,
      recordDate: document.sourceDailyRecordDate,
    });
    recordOperationalOutcome('clinical_document', 'delete_clinical_document', result, {
      date: document.sourceDailyRecordDate,
      context: { documentId: document.id },
      allowSuccess: true,
    });
    const outcomeError = resolveClinicalDocumentOutcomeError(
      result,
      'No se pudo eliminar el documento.'
    );
    if (outcomeError) {
      recordOperationalTelemetry({
        category: 'clinical_document',
        status: 'failed',
        operation: 'delete_clinical_document',
        date: document.sourceDailyRecordDate,
        issues: [outcomeError],
        context: { documentId: document.id },
      });
      notify.error('No se pudo eliminar', outcomeError);
      return;
    }

    if (shouldClearSelectedClinicalDocument(selectedDocumentId, document.id)) {
      setSelectedDocumentId(null);
      setDraft(null);
      lastPersistedSnapshotRef.current = '';
    }
    notify.success('Documento eliminado', `${document.title} fue eliminado correctamente.`);
  } catch (error) {
    const errorMessage = resolveClinicalDocumentExceptionMessage(
      error,
      'No se pudo eliminar el documento.'
    );
    recordOperationalTelemetry({
      category: 'clinical_document',
      status: 'failed',
      operation: 'delete_clinical_document',
      date: document.sourceDailyRecordDate,
      issues: [errorMessage],
      context: { documentId: document.id },
    });
    notify.error('No se pudo eliminar', errorMessage);
  }
};
