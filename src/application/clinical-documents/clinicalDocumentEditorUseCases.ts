import {
  buildClinicalDocumentActor,
  serializeClinicalDocument,
  type ClinicalDocumentDraftBaseState,
  type ClinicalDocumentRecord,
} from '@/features/clinical-documents/internal';
import { executePersistClinicalDocumentDraft } from '@/application/clinical-documents/clinicalDocumentUseCases';
import { hydrateClinicalDocumentRecord } from '@/application/ports/clinicalDocumentCompatibilityPort';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

export type ClinicalDocumentDraftLoadResolution =
  | { kind: 'clear' }
  | { kind: 'preserve' }
  | {
      kind: 'load';
      document: ClinicalDocumentRecord | null;
      snapshot: string;
    }
  | {
      kind: 'stage_remote';
      document: ClinicalDocumentRecord;
      snapshot: string;
    };

interface ResolveClinicalDocumentDraftLoadInput {
  documents: ClinicalDocumentRecord[];
  selectedDocumentId: string | null;
  currentDraft: ClinicalDocumentRecord | null;
  baseState: ClinicalDocumentDraftBaseState;
  hasLocalDraftChanges: boolean;
}

export const resolveClinicalDocumentDraftLoad = ({
  documents,
  selectedDocumentId,
  currentDraft,
  baseState,
  hasLocalDraftChanges,
}: ResolveClinicalDocumentDraftLoadInput): ClinicalDocumentDraftLoadResolution => {
  if (!selectedDocumentId) {
    return { kind: 'clear' };
  }

  const selected = documents.find(document => document.id === selectedDocumentId) || null;
  if (!selected && currentDraft?.id === selectedDocumentId) {
    return { kind: 'preserve' };
  }

  const hydrated = selected ? hydrateClinicalDocumentRecord(structuredClone(selected)) : null;
  const snapshot = serializeClinicalDocument(hydrated);
  const isSameSelectedDocument = Boolean(currentDraft) && currentDraft?.id === selectedDocumentId;

  if (isSameSelectedDocument && hasLocalDraftChanges) {
    const isNewRemoteVersion =
      hydrated?.audit.updatedAt &&
      hydrated.audit.updatedAt !== baseState.updatedAt &&
      snapshot !== baseState.snapshot;

    if (isNewRemoteVersion && hydrated) {
      return {
        kind: 'stage_remote',
        document: hydrated,
        snapshot,
      };
    }

    return { kind: 'preserve' };
  }

  return {
    kind: 'load',
    document: hydrated,
    snapshot,
  };
};

interface ResolveClinicalDocumentAutosaveCommitInput {
  requestedSnapshot: string;
  currentDraftSnapshot: string;
}

export const resolveClinicalDocumentAutosaveCommit = ({
  requestedSnapshot,
  currentDraftSnapshot,
}: ResolveClinicalDocumentAutosaveCommitInput): 'mark_clean' | 'commit_base' =>
  currentDraftSnapshot === requestedSnapshot ? 'mark_clean' : 'commit_base';

interface PersistClinicalDocumentEditorDraftInput {
  record: ClinicalDocumentRecord;
  hospitalId: string;
  role: string;
  user: {
    uid?: string;
    email?: string | null;
    displayName?: string | null;
  };
  reason: 'autosave' | 'manual' | 'admin_fix';
}

export const executePersistClinicalDocumentEditorDraft = (
  input: PersistClinicalDocumentEditorDraftInput
): Promise<ApplicationOutcome<ClinicalDocumentRecord | null>> =>
  executePersistClinicalDocumentDraft(
    input.record,
    input.hospitalId,
    buildClinicalDocumentActor(input.user, input.role),
    input.reason
  );
