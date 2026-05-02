import { useCallback } from 'react';
import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import type { UserRole } from '@/types/authRoleTypes';
import type { ConfirmOptions } from '@/context/uiContracts';
import type {
  ClinicalDocumentEpisodeContext,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/domain/entities';
import { buildClinicalDocumentPatientFieldValues } from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { buildClinicalDocumentAiImportedRecord } from '@/features/clinical-documents/controllers/clinicalDocumentAiImportController';
import {
  buildClinicalDocumentActor,
  serializeClinicalDocument,
} from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import { executeCreateClinicalDocumentDraft } from '@/application/clinical-documents/clinicalDocumentUseCases';
import { prepareClinicalDocumentJsonImportDraft } from '@/application/clinical-documents/clinicalDocumentJsonUseCases';
import { extractClinicalDocumentAiImportFileText } from '@/features/clinical-documents/services/clinicalDocumentAiFileTextService';
import { transformClinicalDocumentAiImportText } from '@/features/clinical-documents/services/clinicalDocumentAiImportService';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { useAuditContext } from '@/context/AuditContext';
import {
  resolveClinicalDocumentExceptionMessage,
  resolveClinicalDocumentOutcomeError,
} from './clinicalDocumentWorkspaceActionSupport';

interface NotificationPort {
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface UseClinicalDocumentWorkspaceImportActionsParams {
  patient: PatientData;
  role: UserRole | undefined;
  user: {
    uid?: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
  hospitalId: string;
  episode: ClinicalDocumentEpisodeContext;
  canEdit: boolean;
  notify: NotificationPort;
  setSelectedDocumentId: (documentId: string | null) => void;
  setDraft: React.Dispatch<React.SetStateAction<ClinicalDocumentRecord | null>>;
  lastPersistedSnapshotRef: React.MutableRefObject<string>;
}

const readClinicalDocumentJsonFileText = (file: File): Promise<string> => {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo JSON.'));
    reader.readAsText(file);
  });
};

interface ClinicalDocumentAiImportFailureReportParams {
  episode: ClinicalDocumentEpisodeContext;
  fileName: string;
  notify: NotificationPort;
  message: string;
  userMessage?: string;
  stage: 'extract_text' | 'ai_transform' | 'save_draft' | 'unexpected';
  context?: Record<string, unknown>;
}

const reportClinicalDocumentAiImportFailure = ({
  episode,
  fileName,
  notify,
  message,
  userMessage = message,
  stage,
  context = {},
}: ClinicalDocumentAiImportFailureReportParams) => {
  recordOperationalTelemetry({
    category: 'clinical_document',
    status: 'failed',
    operation: 'import_clinical_document_ai',
    date: episode.sourceDailyRecordDate,
    issues: [message],
    context: { ...context, fileName, stage },
  });
  notify.error('No se pudo importar con IA', userMessage);
};

const buildClinicalDocumentAiImportStoppedMessage = (message: string): string =>
  `La importación se detuvo antes de guardar: ${message}`;

export const useClinicalDocumentWorkspaceImportActions = ({
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
}: UseClinicalDocumentWorkspaceImportActionsParams) => {
  const { logClinicalDocumentCreated } = useAuditContext();

  const handleImportJson = useCallback(
    async (file: File) => {
      if (!canEdit || !user) {
        notify.warning(
          'Permiso insuficiente',
          'No tienes permisos para importar documentos clínicos.'
        );
        return;
      }

      try {
        const actor = buildClinicalDocumentActor(user, role);
        const importDraftOutcome = prepareClinicalDocumentJsonImportDraft(
          await readClinicalDocumentJsonFileText(file),
          actor
        );
        const importError = resolveClinicalDocumentOutcomeError(
          importDraftOutcome,
          'El archivo JSON no corresponde a un documento clínico válido.'
        );
        if (importError || !importDraftOutcome.data) {
          recordOperationalTelemetry({
            category: 'clinical_document',
            status: 'failed',
            operation: 'import_clinical_document_json',
            date: episode.sourceDailyRecordDate,
            issues: [
              importError || 'El archivo JSON no corresponde a un documento clínico válido.',
            ],
            context: { fileName: file.name },
          });
          notify.error(
            'No se pudo importar el documento',
            importError || 'El archivo JSON no corresponde a un documento clínico válido.'
          );
          return;
        }

        const result = await executeCreateClinicalDocumentDraft(
          importDraftOutcome.data,
          hospitalId
        );
        recordOperationalOutcome('clinical_document', 'import_clinical_document_json', result, {
          date: importDraftOutcome.data.sourceDailyRecordDate,
          context: { importedDocumentId: importDraftOutcome.data.id, fileName: file.name },
          allowSuccess: true,
        });
        const outcomeError = resolveClinicalDocumentOutcomeError(
          result,
          'No se pudo guardar el documento importado.'
        );
        if (outcomeError || !result.data) {
          recordOperationalTelemetry({
            category: 'clinical_document',
            status: 'failed',
            operation: 'import_clinical_document_json',
            date: importDraftOutcome.data.sourceDailyRecordDate,
            issues: [outcomeError || 'No se pudo guardar el documento importado.'],
            context: { importedDocumentId: importDraftOutcome.data.id, fileName: file.name },
          });
          notify.error(
            'No se pudo importar el documento',
            outcomeError || 'Ocurrió un error al guardar el documento importado.'
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
          result.data.patientRut,
          result.data.sourceDailyRecordDate
        );
        notify.success(
          'Documento importado',
          `${result.data.title} quedó guardado como un nuevo borrador.`
        );
      } catch (error) {
        const errorMessage = resolveClinicalDocumentExceptionMessage(
          error,
          'No se pudo importar el documento clínico.'
        );
        recordOperationalTelemetry({
          category: 'clinical_document',
          status: 'failed',
          operation: 'import_clinical_document_json',
          date: episode.sourceDailyRecordDate,
          issues: [errorMessage],
          context: { fileName: file.name },
        });
        notify.error('No se pudo importar el documento', errorMessage);
      }
    },
    [
      canEdit,
      episode,
      hospitalId,
      lastPersistedSnapshotRef,
      notify,
      role,
      setDraft,
      setSelectedDocumentId,
      user,
      logClinicalDocumentCreated,
    ]
  );

  const handleImportWithAi = useCallback(
    async (file: File) => {
      if (!canEdit || !user) {
        notify.warning(
          'Permiso insuficiente',
          'No tienes permisos para importar documentos clínicos con IA.'
        );
        return;
      }

      try {
        const textOutcome = await extractClinicalDocumentAiImportFileText(file);
        const textError = resolveClinicalDocumentOutcomeError(
          textOutcome,
          'No se pudo extraer texto del archivo.'
        );
        if (textError || !textOutcome.data) {
          reportClinicalDocumentAiImportFailure({
            episode,
            fileName: file.name,
            notify,
            message: textError || 'No se pudo extraer texto del archivo.',
            userMessage: buildClinicalDocumentAiImportStoppedMessage(
              textError || 'No se pudo extraer texto del archivo.'
            ),
            stage: 'extract_text',
          });
          return;
        }

        const transformOutcome = await transformClinicalDocumentAiImportText(textOutcome.data);
        const transformError = resolveClinicalDocumentOutcomeError(
          transformOutcome,
          'No se pudo transformar el texto con IA.'
        );
        if (transformError || !transformOutcome.data) {
          reportClinicalDocumentAiImportFailure({
            episode,
            fileName: file.name,
            notify,
            message: transformError || 'No se pudo transformar el texto con IA.',
            userMessage: buildClinicalDocumentAiImportStoppedMessage(
              transformError || 'No se pudo transformar el texto con IA.'
            ),
            stage: 'ai_transform',
            context: { sourceTextLength: textOutcome.data.length },
          });
          return;
        }

        const actor = buildClinicalDocumentActor(user, role);
        const aiImportedRecord = buildClinicalDocumentAiImportedRecord({
          payload: transformOutcome.data,
          hospitalId,
          actor,
          episode,
          patientFieldValues: buildClinicalDocumentPatientFieldValues(patient),
          medico: actor.displayName,
          especialidad: episode.specialty || '',
        });

        const result = await executeCreateClinicalDocumentDraft(aiImportedRecord, hospitalId);
        recordOperationalOutcome('clinical_document', 'import_clinical_document_ai', result, {
          date: episode.sourceDailyRecordDate,
          context: {
            importedDocumentId: aiImportedRecord.id,
            fileName: file.name,
            sourceTextLength: textOutcome.data.length,
          },
          allowSuccess: true,
        });
        const outcomeError = resolveClinicalDocumentOutcomeError(
          result,
          'No se pudo guardar la epicrisis generada con IA.'
        );
        if (outcomeError || !result.data) {
          reportClinicalDocumentAiImportFailure({
            episode,
            fileName: file.name,
            notify,
            message: outcomeError || 'No se pudo guardar la epicrisis generada con IA.',
            userMessage:
              outcomeError || 'Ocurrió un error al guardar la epicrisis generada con IA.',
            stage: 'save_draft',
            context: { importedDocumentId: aiImportedRecord.id },
          });
          return;
        }

        lastPersistedSnapshotRef.current = serializeClinicalDocument(result.data);
        setSelectedDocumentId(result.data.id);
        setDraft(result.data);
        void logClinicalDocumentCreated(
          result.data.id,
          result.data.templateId,
          result.data.title,
          result.data.patientRut,
          result.data.sourceDailyRecordDate
        );
        notify.success(
          'Epicrisis traslado creada',
          `Se generó y guardó un borrador editable desde ${file.name}. Revísalo antes de firmar o exportar.`
        );
      } catch (error) {
        const errorMessage = resolveClinicalDocumentExceptionMessage(
          error,
          'No se pudo importar el documento con IA.'
        );
        reportClinicalDocumentAiImportFailure({
          episode,
          fileName: file.name,
          notify,
          message: errorMessage,
          userMessage: buildClinicalDocumentAiImportStoppedMessage(errorMessage),
          stage: 'unexpected',
        });
      }
    },
    [
      canEdit,
      episode,
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

  return { handleImportJson, handleImportWithAi };
};
