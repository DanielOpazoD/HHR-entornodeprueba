import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import {
  buildClinicalDocumentActor,
  serializeClinicalDocument,
} from '../controllers/clinicalDocumentWorkspaceController';
import type { ClinicalDocumentDraftBaseState } from '../hooks/clinicalDocumentDraftReducer';
import { executePersistClinicalDocumentDraft } from '@/application/clinical-documents/clinicalDocumentUseCases';
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

  const incoming = selected ? structuredClone(selected) : null;
  const snapshot = serializeClinicalDocument(incoming);
  const isSameSelectedDocument = Boolean(currentDraft) && currentDraft?.id === selectedDocumentId;

  if (isSameSelectedDocument && hasLocalDraftChanges) {
    const isNewRemoteVersion =
      incoming?.audit.updatedAt &&
      incoming.audit.updatedAt !== baseState.updatedAt &&
      snapshot !== baseState.snapshot;

    if (isNewRemoteVersion && incoming) {
      return {
        kind: 'stage_remote',
        document: incoming,
        snapshot,
      };
    }

    return { kind: 'preserve' };
  }

  return {
    kind: 'load',
    document: incoming,
    snapshot,
  };
};

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
