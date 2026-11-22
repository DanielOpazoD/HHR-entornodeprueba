import type { ClinicalDocumentDraftLoadResolution } from '@/features/clinical-documents/use-cases/clinicalDocumentEditorUseCases';
import type {
  ClinicalDocumentDraftAction,
  ClinicalDocumentDraftBaseState,
} from '@/features/clinical-documents/hooks/clinicalDocumentDraftReducer';

type ClinicalDocumentDraftRemoteSyncAction =
  | { kind: 'noop' }
  | { kind: 'dispatch'; action: ClinicalDocumentDraftAction };

type ClinicalDocumentPendingRemoteSnapshot = Pick<
  ClinicalDocumentDraftBaseState,
  'document' | 'snapshot'
> & {
  updatedAt?: string;
};

const hasPendingRemoteSnapshot = (
  pendingRemoteState: ClinicalDocumentPendingRemoteSnapshot
): boolean => Boolean(pendingRemoteState.document && pendingRemoteState.snapshot);

export const resolveClinicalDocumentDraftLoadAction = (
  resolution: ClinicalDocumentDraftLoadResolution
): ClinicalDocumentDraftRemoteSyncAction => {
  if (resolution.kind === 'clear') {
    return {
      kind: 'dispatch',
      action: { type: 'LOAD_DOCUMENT', document: null, snapshot: '' },
    };
  }

  if (resolution.kind === 'preserve') {
    return { kind: 'noop' };
  }

  if (resolution.kind === 'stage_remote') {
    return {
      kind: 'dispatch',
      action: {
        type: 'REMOTE_UPDATE_RECEIVED',
        document: resolution.document,
        snapshot: resolution.snapshot,
      },
    };
  }

  return {
    kind: 'dispatch',
    action: {
      type: 'LOAD_DOCUMENT',
      document: resolution.document,
      snapshot: resolution.snapshot,
    },
  };
};

interface ResolveApplyPendingRemoteUpdateInput {
  hasPendingRemoteUpdate: boolean;
  hasLocalDraftChanges: boolean;
  pendingRemoteState: ClinicalDocumentPendingRemoteSnapshot;
}

export const shouldApplyClinicalDocumentPendingRemoteUpdate = ({
  hasPendingRemoteUpdate,
  hasLocalDraftChanges,
  pendingRemoteState,
}: ResolveApplyPendingRemoteUpdateInput): boolean =>
  hasPendingRemoteUpdate && !hasLocalDraftChanges && hasPendingRemoteSnapshot(pendingRemoteState);
