import { useEffect } from 'react';
import type { Dispatch, MutableRefObject } from 'react';

import {
  resolveClinicalDocumentDraftLoad,
  type ClinicalDocumentDraftLoadResolution,
} from '@/features/clinical-documents/use-cases/clinicalDocumentEditorUseCases';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import {
  resolveClinicalDocumentDraftLoadAction,
  shouldApplyClinicalDocumentPendingRemoteUpdate,
} from '@/features/clinical-documents/controllers/clinicalDocumentDraftRemoteSyncController';
import type {
  ClinicalDocumentDraftAction,
  ClinicalDocumentDraftBaseState,
} from '@/features/clinical-documents/hooks/clinicalDocumentDraftReducer';

interface UseClinicalDocumentDraftRemoteSyncParams {
  documents: ClinicalDocumentRecord[];
  selectedDocumentId: string | null;
  hasPendingRemoteUpdate: boolean;
  pendingRemoteState: ClinicalDocumentDraftBaseState;
  dispatch: Dispatch<ClinicalDocumentDraftAction>;
  draftRef: MutableRefObject<ClinicalDocumentRecord | null>;
  draftDirtyRef: MutableRefObject<boolean>;
  baseStateRef: MutableRefObject<ClinicalDocumentDraftBaseState>;
}

const applyDraftLoadResolution = (
  resolution: ClinicalDocumentDraftLoadResolution,
  dispatch: Dispatch<ClinicalDocumentDraftAction>
) => {
  const syncAction = resolveClinicalDocumentDraftLoadAction(resolution);
  if (syncAction.kind === 'noop') {
    return;
  }
  dispatch(syncAction.action);
};

export const useClinicalDocumentDraftRemoteSync = ({
  documents,
  selectedDocumentId,
  hasPendingRemoteUpdate,
  pendingRemoteState,
  dispatch,
  draftRef,
  draftDirtyRef,
  baseStateRef,
}: UseClinicalDocumentDraftRemoteSyncParams) => {
  useEffect(() => {
    const resolution = resolveClinicalDocumentDraftLoad({
      documents,
      selectedDocumentId,
      currentDraft: draftRef.current,
      baseState: baseStateRef.current,
      hasLocalDraftChanges: draftDirtyRef.current,
    });

    applyDraftLoadResolution(resolution, dispatch);
  }, [baseStateRef, dispatch, documents, draftDirtyRef, draftRef, selectedDocumentId]);

  const { document: pendingRemoteDocument, snapshot: pendingRemoteSnapshot } = pendingRemoteState;

  useEffect(() => {
    if (
      !shouldApplyClinicalDocumentPendingRemoteUpdate({
        hasPendingRemoteUpdate,
        hasLocalDraftChanges: draftDirtyRef.current,
        pendingRemoteState: {
          document: pendingRemoteDocument,
          snapshot: pendingRemoteSnapshot,
        },
      })
    ) {
      return;
    }

    dispatch({ type: 'APPLY_REMOTE_UPDATE' });
  }, [
    dispatch,
    draftDirtyRef,
    hasPendingRemoteUpdate,
    pendingRemoteDocument,
    pendingRemoteSnapshot,
  ]);
};
