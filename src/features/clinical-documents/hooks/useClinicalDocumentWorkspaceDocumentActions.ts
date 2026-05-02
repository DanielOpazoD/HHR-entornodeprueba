import { useCallback } from 'react';
import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import type { UserRole } from '@/types/authRoleTypes';
import type { ConfirmOptions } from '@/context/uiContracts';
import type {
  ClinicalDocumentEpisodeContext,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/domain/entities';
import {
  createClinicalDocumentDraft,
  duplicateClinicalDocumentDraft,
} from '@/features/clinical-documents/domain/factories';
import { buildClinicalDocumentPatientFieldValues } from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import {
  buildClinicalDocumentActor,
  serializeClinicalDocument,
} from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import { executeCreateClinicalDocumentDraft } from '@/application/clinical-documents/clinicalDocumentUseCases';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { useAuditContext } from '@/context/AuditContext';
import {
  resolveClinicalDocumentExceptionMessage,
  resolveClinicalDocumentOutcomeError,
} from './clinicalDocumentWorkspaceActionSupport';
import { deleteClinicalDocumentFromWorkspace } from './clinicalDocumentDeleteActionController';
import { useClinicalDocumentWorkspaceImportActions } from './useClinicalDocumentWorkspaceImportActions';

interface NotificationPort {
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface UseClinicalDocumentWorkspaceDocumentActionsParams {
  patient: PatientData;
  role: UserRole | undefined;
  user: {
    uid?: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
  hospitalId: string;
  episode: ClinicalDocumentEpisodeContext;
  selectedTemplateId: string;
  templates: Array<{ id: string }>;
  selectedDocumentId: string | null;
  canEdit: boolean;
  canDelete: boolean;
  notify: NotificationPort;
  setSelectedDocumentId: (documentId: string | null) => void;
  setDraft: React.Dispatch<React.SetStateAction<ClinicalDocumentRecord | null>>;
  lastPersistedSnapshotRef: React.MutableRefObject<string>;
}

export const useClinicalDocumentWorkspaceDocumentActions = ({
  patient,
  role,
  user,
  hospitalId,
  episode,
  selectedTemplateId,
  templates,
  selectedDocumentId,
  canEdit,
  canDelete,
  notify,
  setSelectedDocumentId,
  setDraft,
  lastPersistedSnapshotRef,
}: UseClinicalDocumentWorkspaceDocumentActionsParams) => {
  const { logClinicalDocumentCreated, logClinicalDocumentDeleted } = useAuditContext();

  const createDocument = useCallback(async () => {
    if (!canEdit || !user) {
      notify.warning('Permiso insuficiente', 'No tienes permisos para crear documentos clínicos.');
      return;
    }

    try {
      const actor = buildClinicalDocumentActor(user, role);
      const templateId = selectedTemplateId || templates[0]?.id || 'epicrisis';
      const record = createClinicalDocumentDraft({
        templateId,
        hospitalId,
        actor,
        episode,
        patientFieldValues: buildClinicalDocumentPatientFieldValues(patient),
        medico: actor.displayName,
        especialidad: episode.specialty || '',
      });

      const result = await executeCreateClinicalDocumentDraft(record, hospitalId);
      recordOperationalOutcome('clinical_document', 'create_clinical_document', result, {
        date: episode.sourceDailyRecordDate,
        context: { templateId },
        allowSuccess: true,
      });
      const outcomeError = resolveClinicalDocumentOutcomeError(
        result,
        'No se pudo crear el documento clínico.'
      );
      if (outcomeError || !result.data) {
        recordOperationalTelemetry({
          category: 'clinical_document',
          status: 'failed',
          operation: 'create_clinical_document',
          date: episode.sourceDailyRecordDate,
          issues: [outcomeError || 'No se pudo crear el documento clínico.'],
          context: { templateId },
        });
        notify.error(
          'No se pudo crear el documento',
          outcomeError || 'Ocurrió un error al crear el borrador clínico.'
        );
        return;
      }
      lastPersistedSnapshotRef.current = serializeClinicalDocument(result.data);
      setSelectedDocumentId(result.data.id);
      setDraft(result.data);
      void logClinicalDocumentCreated(
        result.data.id,
        templateId,
        result.data.title,
        patient.rut,
        episode.sourceDailyRecordDate
      );
      notify.success(`${result.data.title} creada`, 'Se generó el borrador inicial del documento.');
    } catch (error) {
      const errorMessage = resolveClinicalDocumentExceptionMessage(
        error,
        'No se pudo crear el documento clínico.'
      );
      recordOperationalTelemetry({
        category: 'clinical_document',
        status: 'failed',
        operation: 'create_clinical_document',
        date: episode.sourceDailyRecordDate,
        issues: [errorMessage],
      });
      notify.error('No se pudo crear el documento', errorMessage);
    }
  }, [
    canEdit,
    episode,
    hospitalId,
    lastPersistedSnapshotRef,
    notify,
    patient,
    role,
    selectedTemplateId,
    setDraft,
    setSelectedDocumentId,
    templates,
    user,
    logClinicalDocumentCreated,
  ]);

  const handleDeleteDocument = useCallback(
    (document: ClinicalDocumentRecord) =>
      deleteClinicalDocumentFromWorkspace({
        document,
        canDelete,
        hospitalId,
        notify,
        patient,
        selectedDocumentId,
        setSelectedDocumentId,
        setDraft,
        lastPersistedSnapshotRef,
        logClinicalDocumentDeleted,
      }),
    [
      canDelete,
      hospitalId,
      lastPersistedSnapshotRef,
      notify,
      patient,
      selectedDocumentId,
      setDraft,
      setSelectedDocumentId,
      logClinicalDocumentDeleted,
    ]
  );

  const handleDuplicateDocument = useCallback(
    async (document: ClinicalDocumentRecord) => {
      if (!canEdit || !user) {
        notify.warning(
          'Permiso insuficiente',
          'No tienes permisos para duplicar documentos clínicos.'
        );
        return;
      }

      try {
        const actor = buildClinicalDocumentActor(user, role);
        const duplicatedRecord = duplicateClinicalDocumentDraft(document, actor);
        const result = await executeCreateClinicalDocumentDraft(duplicatedRecord, hospitalId);
        recordOperationalOutcome('clinical_document', 'duplicate_clinical_document', result, {
          date: document.sourceDailyRecordDate,
          context: { sourceDocumentId: document.id, duplicatedDocumentId: duplicatedRecord.id },
          allowSuccess: true,
        });

        const outcomeError = resolveClinicalDocumentOutcomeError(
          result,
          'No se pudo duplicar el documento.'
        );
        if (outcomeError || !result.data) {
          recordOperationalTelemetry({
            category: 'clinical_document',
            status: 'failed',
            operation: 'duplicate_clinical_document',
            date: document.sourceDailyRecordDate,
            issues: [outcomeError || 'No se pudo duplicar el documento clínico.'],
            context: { sourceDocumentId: document.id },
          });
          notify.error(
            'No se pudo duplicar el documento',
            outcomeError || 'Ocurrió un error al duplicar el documento clínico.'
          );
          return;
        }

        lastPersistedSnapshotRef.current = serializeClinicalDocument(result.data);
        setSelectedDocumentId(result.data.id);
        setDraft(result.data);
        void logClinicalDocumentCreated(
          result.data.id,
          result.data.templateId,
          result.data.title,
          patient.rut,
          result.data.sourceDailyRecordDate
        );
        notify.success(
          'Documento duplicado',
          `${document.title} se copió como ${result.data.title}.`
        );
      } catch (error) {
        const errorMessage = resolveClinicalDocumentExceptionMessage(
          error,
          'No se pudo duplicar el documento clínico.'
        );
        recordOperationalTelemetry({
          category: 'clinical_document',
          status: 'failed',
          operation: 'duplicate_clinical_document',
          date: document.sourceDailyRecordDate,
          issues: [errorMessage],
          context: { sourceDocumentId: document.id },
        });
        notify.error('No se pudo duplicar el documento', errorMessage);
      }
    },
    [
      canEdit,
      hospitalId,
      lastPersistedSnapshotRef,
      notify,
      patient,
      role,
      setDraft,
      setSelectedDocumentId,
      user,
      logClinicalDocumentCreated,
    ]
  );

  const { handleImportJson, handleImportWithAi } = useClinicalDocumentWorkspaceImportActions({
    patient,
    role,
    user,
    hospitalId,
    episode,
    canEdit,
    notify,
    setSelectedDocumentId,
    setDraft,
    lastPersistedSnapshotRef,
  });

  return {
    createDocument,
    handleDuplicateDocument,
    handleDeleteDocument,
    handleImportJson,
    handleImportWithAi,
  };
};
