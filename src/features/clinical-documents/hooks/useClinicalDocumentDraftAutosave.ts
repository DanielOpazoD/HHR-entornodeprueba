import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject } from 'react';

import {
  executePersistClinicalDocumentEditorDraft,
  resolveClinicalDocumentAutosaveCommit,
} from '@/application/clinical-documents/clinicalDocumentEditorUseCases';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { useAuditContext } from '@/context/AuditContext';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { recordCriticalClinicalAction } from '@/services/observability/criticalClinicalActionRecorder';
import { serializeClinicalDocument } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import type { ClinicalDocumentDraftAction } from '@/features/clinical-documents/hooks/clinicalDocumentDraftReducer';

interface UseClinicalDocumentDraftAutosaveParams {
  draft: ClinicalDocumentRecord | null;
  canEdit: boolean;
  isActive: boolean;
  hospitalId: string;
  role: string;
  persistReason: 'autosave' | 'admin_fix';
  user: {
    uid?: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
  dispatch: Dispatch<ClinicalDocumentDraftAction>;
  draftRef: MutableRefObject<ClinicalDocumentRecord | null>;
  lastPersistedSnapshotRef: MutableRefObject<string>;
}

const AUTOSAVE_DELAY_MS = 900;

export const useClinicalDocumentDraftAutosave = ({
  draft,
  canEdit,
  isActive,
  hospitalId,
  role,
  persistReason,
  user,
  dispatch,
  draftRef,
  lastPersistedSnapshotRef,
}: UseClinicalDocumentDraftAutosaveParams) => {
  const { logClinicalDocumentEdited } = useAuditContext();
  const autosaveTimerRef = useRef<number | null>(null);
  const latestAutosaveRequestIdRef = useRef(0);
  const scheduledDraftIdRef = useRef<string | null>(null);
  const pendingAutosaveRef = useRef<{
    draft: ClinicalDocumentRecord;
    requestedSnapshot: string;
  } | null>(null);

  const performAutosave = useCallback(
    async ({
      record,
      requestedSnapshot,
    }: {
      record: ClinicalDocumentRecord;
      requestedSnapshot: string;
    }) => {
      if (!user) {
        return;
      }

      latestAutosaveRequestIdRef.current += 1;
      const requestId = latestAutosaveRequestIdRef.current;
      dispatch({ type: 'AUTOSAVE_REQUESTED' });
      const recordCriticalSave = (
        recordToTrack: ClinicalDocumentRecord,
        outcome: 'success' | 'failed',
        issues?: string[]
      ) => {
        recordCriticalClinicalAction({
          category: 'clinical_document',
          action: 'clinical_document_saved',
          outcome,
          clinicalDate: recordToTrack.sourceDailyRecordDate,
          bedId: recordToTrack.sourceBedId,
          patientRut: recordToTrack.patientRut,
          documentId: recordToTrack.id,
          documentType: recordToTrack.templateId,
          userId: user.uid,
          userRole: role,
          issues,
        });
      };

      try {
        const result = await executePersistClinicalDocumentEditorDraft({
          record,
          hospitalId,
          role,
          user,
          reason: persistReason,
        });

        recordOperationalOutcome('clinical_document', 'autosave_clinical_document', result, {
          date: record.sourceDailyRecordDate,
          context: { documentId: record.id },
        });

        if (requestId !== latestAutosaveRequestIdRef.current) {
          return;
        }

        if (result.status === 'success' && result.data) {
          recordCriticalSave(result.data, 'success');
          if (persistReason !== 'admin_fix') {
            void logClinicalDocumentEdited(
              result.data.id,
              result.data.templateId,
              result.data.title,
              undefined,
              result.data.sourceDailyRecordDate
            );
          }
          const savedSnapshot = serializeClinicalDocument(result.data);
          const currentDraftSnapshot = serializeClinicalDocument(draftRef.current);
          const commitMode = resolveClinicalDocumentAutosaveCommit({
            requestedSnapshot,
            currentDraftSnapshot,
          });

          if (commitMode === 'mark_clean') {
            lastPersistedSnapshotRef.current = savedSnapshot;
            dispatch({
              type: 'AUTOSAVE_MARK_CLEAN',
              document: result.data,
              snapshot: savedSnapshot,
            });
          } else {
            dispatch({
              type: 'AUTOSAVE_COMMIT_BASE',
              document: result.data,
              snapshot: savedSnapshot,
            });
          }
          return;
        }

        recordOperationalTelemetry({
          category: 'clinical_document',
          status: 'failed',
          operation: 'autosave_clinical_document_rejected',
          date: record.sourceDailyRecordDate,
          issues: [result.issues[0]?.message || 'Autosave rejected'],
          context: { documentId: record.id },
        });
        recordCriticalSave(record, 'failed', [result.issues[0]?.message || 'Autosave rejected']);
        dispatch({ type: 'AUTOSAVE_FAILED' });
      } catch (error) {
        if (requestId !== latestAutosaveRequestIdRef.current) {
          return;
        }

        recordOperationalTelemetry({
          category: 'clinical_document',
          status: 'failed',
          operation: 'autosave_clinical_document',
          date: record.sourceDailyRecordDate,
          issues: [error instanceof Error ? error.message : 'Autosave failed'],
          context: { documentId: record.id },
        });
        recordCriticalSave(record, 'failed', [
          error instanceof Error ? error.message : 'Autosave failed',
        ]);
        dispatch({ type: 'AUTOSAVE_FAILED' });
      }
    },
    [
      dispatch,
      draftRef,
      hospitalId,
      lastPersistedSnapshotRef,
      logClinicalDocumentEdited,
      persistReason,
      role,
      user,
    ]
  );

  useEffect(() => {
    const pendingAutosave = pendingAutosaveRef.current;
    if (
      pendingAutosave &&
      scheduledDraftIdRef.current &&
      (draft?.id ?? null) !== scheduledDraftIdRef.current
    ) {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      pendingAutosaveRef.current = null;
      scheduledDraftIdRef.current = null;
      void performAutosave({
        record: pendingAutosave.draft,
        requestedSnapshot: pendingAutosave.requestedSnapshot,
      });
    }

    if (!draft || !canEdit || draft.isLocked || !isActive || !user) {
      return;
    }

    const draftSnapshot = serializeClinicalDocument(draft);
    if (draftSnapshot === lastPersistedSnapshotRef.current) {
      pendingAutosaveRef.current = null;
      return;
    }

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    pendingAutosaveRef.current = {
      draft,
      requestedSnapshot: draftSnapshot,
    };
    scheduledDraftIdRef.current = draft.id;

    autosaveTimerRef.current = window.setTimeout(async () => {
      autosaveTimerRef.current = null;
      pendingAutosaveRef.current = null;
      scheduledDraftIdRef.current = null;
      await performAutosave({
        record: draft,
        requestedSnapshot: draftSnapshot,
      });
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    canEdit,
    dispatch,
    draft,
    draftRef,
    hospitalId,
    isActive,
    lastPersistedSnapshotRef,
    performAutosave,
    role,
    persistReason,
    user,
  ]);

  useEffect(() => {
    if (isActive) {
      return;
    }

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    const pendingAutosave = pendingAutosaveRef.current;
    if (!pendingAutosave) {
      return;
    }

    pendingAutosaveRef.current = null;
    scheduledDraftIdRef.current = null;
    void performAutosave({
      record: pendingAutosave.draft,
      requestedSnapshot: pendingAutosave.requestedSnapshot,
    });
  }, [isActive, performAutosave]);
};
