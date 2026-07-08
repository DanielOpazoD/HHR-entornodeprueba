import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { validateClinicalDocument } from '@/features/clinical-documents/controllers/clinicalDocumentValidationController';
import {
  hydrateClinicalDocumentWorkspaceRecord,
  serializeClinicalDocument,
} from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import {
  clinicalDocumentDraftReducer,
  createClinicalDocumentDraftReducerInitialState,
  type ClinicalDocumentDraftBaseState,
} from '@/features/clinical-documents/hooks/clinicalDocumentDraftReducer';
import { useClinicalDocumentDraftAutosave } from '@/features/clinical-documents/hooks/useClinicalDocumentDraftAutosave';
import { useClinicalDocumentDraftRemoteSync } from '@/features/clinical-documents/hooks/useClinicalDocumentDraftRemoteSync';

interface UseClinicalDocumentWorkspaceDraftParams {
  documents: ClinicalDocumentRecord[];
  selectedDocumentId: string | null;
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
}

export interface ClinicalDocumentWorkspaceDraftState {
  draft: ClinicalDocumentRecord | null;
  hasLocalDraftChanges: boolean;
  setDraft: Dispatch<SetStateAction<ClinicalDocumentRecord | null>>;
  isSaving: boolean;
  lastSavedAt: string | undefined;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  validationIssues: Array<{ message: string }>;
  lastPersistedSnapshotRef: MutableRefObject<string>;
  flushPendingAutosave: () => void;
  patchPatientField: (fieldId: string, value: string) => void;
  patchPatientFieldLabel: (fieldId: string, label: string) => void;
  setPatientFieldVisibility: (fieldId: string, visible: boolean) => void;
  patchSection: (sectionId: string, content: string) => void;
  patchSectionTitle: (sectionId: string, title: string) => void;
  setSectionLayout: (
    sectionId: string,
    layout: import('@/features/clinical-documents/domain/entities').ClinicalDocumentSectionLayout
  ) => void;
  setSectionVisibility: (sectionId: string, visible: boolean) => void;
  moveSection: (sectionId: string, direction: 'up' | 'down') => void;
  reorderSection: (sourceSectionId: string, targetSectionId: string) => void;
  addSection: (referenceSectionId: string, position: 'above' | 'below') => void;
  patchDocumentTitle: (title: string) => void;
  patchPatientInfoTitle: (title: string) => void;
  patchFooterLabel: (kind: 'medico' | 'especialidad', title: string) => void;
  patchDocumentMeta: (
    patch: Partial<
      Pick<ClinicalDocumentRecord, 'medico' | 'especialidad' | 'includePatientSignature'>
    >
  ) => void;
  applyTemplate: (templateId: string) => void;
  restoreTemplateContent: () => void;
  addClinicalUpdate: () => void;
  patchAnnexContent: (content: string) => void;
  setAnnexIncludedInPrint: (included: boolean) => void;
  clearAnnexContent: () => void;
  patchIeehDraft: (
    draft: import('@/features/clinical-documents/domain/entities').ClinicalDocumentIeehDraft
  ) => void;
  clearIeehDraft: () => void;
  patchUpdateDate: (sectionId: string, date: string) => void;
  patchUpdateTime: (sectionId: string, time: string) => void;
}

const hydrateIncomingDocument = (
  document: ClinicalDocumentRecord | null
): ClinicalDocumentRecord | null =>
  document ? hydrateClinicalDocumentWorkspaceRecord(structuredClone(document)) : null;

export const useClinicalDocumentWorkspaceDraft = ({
  documents,
  selectedDocumentId,
  canEdit,
  isActive,
  hospitalId,
  role,
  persistReason,
  user,
}: UseClinicalDocumentWorkspaceDraftParams): ClinicalDocumentWorkspaceDraftState => {
  const [state, dispatch] = useReducer(
    clinicalDocumentDraftReducer,
    undefined,
    createClinicalDocumentDraftReducerInitialState
  );
  const lastPersistedSnapshotRef = useRef<string>('');
  const draftRef = useRef<ClinicalDocumentRecord | null>(null);
  const draftDirtyRef = useRef(false);
  const baseStateRef = useRef<ClinicalDocumentDraftBaseState>(state.baseState);

  const hasLocalDraftChanges = useMemo(
    () => serializeClinicalDocument(state.draft) !== state.baseState.snapshot,
    [state.baseState.snapshot, state.draft]
  );

  useEffect(() => {
    draftRef.current = state.draft;
    draftDirtyRef.current = hasLocalDraftChanges;
    baseStateRef.current = state.baseState;
    lastPersistedSnapshotRef.current = state.baseState.snapshot;
  }, [hasLocalDraftChanges, state.baseState, state.draft]);

  useClinicalDocumentDraftRemoteSync({
    documents,
    selectedDocumentId,
    hasPendingRemoteUpdate: state.hasPendingRemoteUpdate,
    pendingRemoteState: state.pendingRemoteState,
    dispatch,
    draftRef,
    draftDirtyRef,
    baseStateRef,
  });

  const flushPendingAutosave = useClinicalDocumentDraftAutosave({
    draft: state.draft,
    canEdit,
    isActive,
    hospitalId,
    role,
    persistReason,
    user,
    dispatch,
    draftRef,
    lastPersistedSnapshotRef,
  });

  const validationIssues = useMemo(
    () => (state.draft ? validateClinicalDocument(state.draft) : []),
    [state.draft]
  );

  const setDraft = useCallback<Dispatch<SetStateAction<ClinicalDocumentRecord | null>>>(
    nextDraftOrUpdater => {
      const nextDraft =
        typeof nextDraftOrUpdater === 'function'
          ? nextDraftOrUpdater(draftRef.current)
          : nextDraftOrUpdater;
      const hydratedDraft = hydrateIncomingDocument(nextDraft);
      const nextSnapshot = serializeClinicalDocument(hydratedDraft);
      const currentDraft = draftRef.current;
      const currentSnapshot = serializeClinicalDocument(currentDraft);

      if (
        (hydratedDraft?.id ?? null) === (currentDraft?.id ?? null) &&
        nextSnapshot === currentSnapshot
      ) {
        return;
      }

      dispatch({
        type: 'LOAD_DOCUMENT',
        document: hydratedDraft,
        snapshot: nextSnapshot,
      });
    },
    []
  );

  const setIsSaving = useCallback<Dispatch<SetStateAction<boolean>>>(
    nextValueOrUpdater => {
      const nextValue =
        typeof nextValueOrUpdater === 'function'
          ? nextValueOrUpdater(state.isSaving)
          : nextValueOrUpdater;
      dispatch({ type: 'SET_IS_SAVING', value: nextValue });
    },
    [state.isSaving]
  );

  return {
    draft: state.draft,
    hasLocalDraftChanges,
    lastSavedAt: state.baseState.updatedAt || undefined,
    setDraft,
    isSaving: state.isSaving,
    setIsSaving,
    validationIssues,
    lastPersistedSnapshotRef,
    flushPendingAutosave,
    patchPatientField: (fieldId, value) => dispatch({ type: 'PATCH_FIELD', fieldId, value }),
    patchPatientFieldLabel: (fieldId, label) =>
      dispatch({ type: 'PATCH_FIELD_LABEL', fieldId, label }),
    setPatientFieldVisibility: (fieldId, visible) =>
      dispatch({ type: 'SET_FIELD_VISIBILITY', fieldId, visible }),
    patchSection: (sectionId, content) => dispatch({ type: 'PATCH_SECTION', sectionId, content }),
    patchSectionTitle: (sectionId, title) =>
      dispatch({ type: 'PATCH_SECTION_TITLE', sectionId, title }),
    setSectionLayout: (sectionId, layout) =>
      dispatch({ type: 'PATCH_SECTION_LAYOUT', sectionId, layout }),
    setSectionVisibility: (sectionId, visible) =>
      dispatch({ type: 'SET_SECTION_VISIBILITY', sectionId, visible }),
    moveSection: (sectionId, direction) => dispatch({ type: 'MOVE_SECTION', sectionId, direction }),
    reorderSection: (sourceSectionId, targetSectionId) =>
      dispatch({ type: 'REORDER_SECTION', sourceSectionId, targetSectionId }),
    addSection: (referenceSectionId, position) =>
      dispatch({ type: 'INSERT_SECTION', referenceSectionId, position }),
    patchDocumentTitle: title => dispatch({ type: 'PATCH_DOCUMENT_TITLE', title }),
    patchPatientInfoTitle: title => dispatch({ type: 'PATCH_PATIENT_INFO_TITLE', title }),
    patchFooterLabel: (kind, title) => dispatch({ type: 'PATCH_FOOTER_LABEL', kind, title }),
    patchDocumentMeta: patch => dispatch({ type: 'PATCH_DOCUMENT_META', patch }),
    applyTemplate: templateId => dispatch({ type: 'APPLY_TEMPLATE', templateId }),
    restoreTemplateContent: () => dispatch({ type: 'RESTORE_TEMPLATE_CONTENT' }),
    addClinicalUpdate: () => dispatch({ type: 'ADD_CLINICAL_UPDATE' }),
    patchAnnexContent: (content: string) => dispatch({ type: 'PATCH_ANNEX_CONTENT', content }),
    setAnnexIncludedInPrint: (included: boolean) =>
      dispatch({ type: 'PATCH_ANNEX_INCLUDED_IN_PRINT', included }),
    clearAnnexContent: () => dispatch({ type: 'CLEAR_ANNEX_CONTENT' }),
    patchIeehDraft: draft => dispatch({ type: 'PATCH_IEEH_DRAFT', draft }),
    clearIeehDraft: () => dispatch({ type: 'CLEAR_IEEH_DRAFT' }),
    patchUpdateDate: (sectionId: string, date: string) =>
      dispatch({ type: 'PATCH_UPDATE_DATE', sectionId, date }),
    patchUpdateTime: (sectionId: string, time: string) =>
      dispatch({ type: 'PATCH_UPDATE_TIME', sectionId, time }),
  };
};
