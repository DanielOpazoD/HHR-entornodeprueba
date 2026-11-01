import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { normalizeClinicalDocumentContentForStorage } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';
import { normalizeClinicalDocumentSectionTitle } from '@/features/clinical-documents/controllers/clinicalDocumentSectionTitleController';
import { restoreClinicalDocumentDraftTemplate } from '@/features/clinical-documents/domain/factories';
import { createClinicalUpdateSection } from '@/features/clinical-documents/controllers/clinicalDocumentUpdateController';
import {
  insertClinicalDocumentSection,
  moveClinicalDocumentVisibleSection,
  reorderClinicalDocumentVisibleSections,
} from '@/features/clinical-documents/controllers/clinicalDocumentSectionOrderController';

export interface ClinicalDocumentDraftBaseState {
  document: ClinicalDocumentRecord | null;
  snapshot: string;
  updatedAt: string;
}

export interface ClinicalDocumentDraftReducerState {
  draft: ClinicalDocumentRecord | null;
  isSaving: boolean;
  hasPendingRemoteUpdate: boolean;
  baseState: ClinicalDocumentDraftBaseState;
  pendingRemoteState: ClinicalDocumentDraftBaseState;
}

export type ClinicalDocumentDraftAction =
  | {
      type: 'LOAD_DOCUMENT';
      document: ClinicalDocumentRecord | null;
      snapshot: string;
      commitAsBase?: boolean;
    }
  | { type: 'REMOTE_UPDATE_RECEIVED'; document: ClinicalDocumentRecord; snapshot: string }
  | { type: 'APPLY_REMOTE_UPDATE' }
  | { type: 'PATCH_FIELD'; fieldId: string; value: string }
  | { type: 'PATCH_FIELD_LABEL'; fieldId: string; label: string }
  | { type: 'SET_FIELD_VISIBILITY'; fieldId: string; visible: boolean }
  | { type: 'PATCH_SECTION'; sectionId: string; content: string }
  | { type: 'PATCH_SECTION_TITLE'; sectionId: string; title: string }
  | {
      type: 'PATCH_SECTION_LAYOUT';
      sectionId: string;
      layout: import('@/features/clinical-documents/domain/entities').ClinicalDocumentSectionLayout;
    }
  | { type: 'SET_SECTION_VISIBILITY'; sectionId: string; visible: boolean }
  | { type: 'MOVE_SECTION'; sectionId: string; direction: 'up' | 'down' }
  | { type: 'REORDER_SECTION'; sourceSectionId: string; targetSectionId: string }
  | { type: 'INSERT_SECTION'; referenceSectionId: string; position: 'above' | 'below' }
  | { type: 'PATCH_DOCUMENT_TITLE'; title: string }
  | { type: 'PATCH_PATIENT_INFO_TITLE'; title: string }
  | { type: 'PATCH_FOOTER_LABEL'; kind: 'medico' | 'especialidad'; title: string }
  | {
      type: 'PATCH_DOCUMENT_META';
      patch: Partial<
        Pick<ClinicalDocumentRecord, 'medico' | 'especialidad' | 'includePatientSignature'>
      >;
    }
  | { type: 'ADD_CLINICAL_UPDATE' }
  | { type: 'PATCH_ANNEX_CONTENT'; content: string }
  | { type: 'PATCH_ANNEX_INCLUDED_IN_PRINT'; included: boolean }
  | { type: 'CLEAR_ANNEX_CONTENT' }
  | {
      type: 'PATCH_IEEH_DRAFT';
      draft: import('@/features/clinical-documents/domain/entities').ClinicalDocumentIeehDraft;
    }
  | { type: 'CLEAR_IEEH_DRAFT' }
  | { type: 'PATCH_UPDATE_DATE'; sectionId: string; date: string }
  | { type: 'PATCH_UPDATE_TIME'; sectionId: string; time: string }
  | { type: 'APPLY_TEMPLATE'; templateId: string }
  | { type: 'RESTORE_TEMPLATE_CONTENT' }
  | { type: 'AUTOSAVE_REQUESTED' }
  | { type: 'AUTOSAVE_MARK_CLEAN'; document: ClinicalDocumentRecord; snapshot: string }
  | { type: 'AUTOSAVE_COMMIT_BASE'; document: ClinicalDocumentRecord; snapshot: string }
  | { type: 'AUTOSAVE_SUCCEEDED'; document: ClinicalDocumentRecord; snapshot: string }
  | { type: 'AUTOSAVE_FAILED' }
  | { type: 'SET_IS_SAVING'; value: boolean };

const emptyBaseState = (): ClinicalDocumentDraftBaseState => ({
  document: null,
  snapshot: '',
  updatedAt: '',
});

export const buildClinicalDocumentDraftBaseState = (
  document: ClinicalDocumentRecord | null,
  snapshot: string
): ClinicalDocumentDraftBaseState => ({
  document: document ? structuredClone(document) : null,
  snapshot,
  updatedAt: document?.audit.updatedAt || '',
});

export const createClinicalDocumentDraftReducerInitialState =
  (): ClinicalDocumentDraftReducerState => ({
    draft: null,
    isSaving: false,
    hasPendingRemoteUpdate: false,
    baseState: emptyBaseState(),
    pendingRemoteState: emptyBaseState(),
  });

const patchDraft = (
  state: ClinicalDocumentDraftReducerState,
  patcher: (draft: ClinicalDocumentRecord) => ClinicalDocumentRecord
): ClinicalDocumentDraftReducerState => ({
  ...state,
  draft: state.draft ? patcher(state.draft) : state.draft,
});

const commitDocumentAsBase = (
  state: ClinicalDocumentDraftReducerState,
  document: ClinicalDocumentRecord | null,
  snapshot: string
): ClinicalDocumentDraftReducerState => ({
  ...state,
  draft: document ? structuredClone(document) : null,
  hasPendingRemoteUpdate: false,
  baseState: buildClinicalDocumentDraftBaseState(document, snapshot),
  pendingRemoteState: emptyBaseState(),
});

const commitAutosaveBaseState = (
  state: ClinicalDocumentDraftReducerState,
  document: ClinicalDocumentRecord,
  snapshot: string
): ClinicalDocumentDraftReducerState => ({
  ...state,
  isSaving: false,
  hasPendingRemoteUpdate:
    state.pendingRemoteState.snapshot !== actionSnapshotKey(snapshot) &&
    state.hasPendingRemoteUpdate,
  baseState: buildClinicalDocumentDraftBaseState(document, snapshot),
  pendingRemoteState:
    state.pendingRemoteState.snapshot === actionSnapshotKey(snapshot)
      ? emptyBaseState()
      : state.pendingRemoteState,
});

const markAutosaveClean = (
  state: ClinicalDocumentDraftReducerState,
  document: ClinicalDocumentRecord,
  snapshot: string
): ClinicalDocumentDraftReducerState => ({
  ...state,
  isSaving: false,
  hasPendingRemoteUpdate:
    state.pendingRemoteState.snapshot !== actionSnapshotKey(snapshot) &&
    state.hasPendingRemoteUpdate,
  baseState: {
    document: structuredClone(document),
    snapshot: state.draft ? JSON.stringify(state.draft) : snapshot,
    updatedAt: document.audit.updatedAt || '',
  },
  pendingRemoteState:
    state.pendingRemoteState.snapshot === actionSnapshotKey(snapshot)
      ? emptyBaseState()
      : state.pendingRemoteState,
});

const actionSnapshotKey = (snapshot: string): string => snapshot;

export const clinicalDocumentDraftReducer = (
  state: ClinicalDocumentDraftReducerState,
  action: ClinicalDocumentDraftAction
): ClinicalDocumentDraftReducerState => {
  switch (action.type) {
    case 'LOAD_DOCUMENT':
      return action.commitAsBase === false
        ? {
            ...state,
            draft: action.document ? structuredClone(action.document) : null,
          }
        : commitDocumentAsBase(state, action.document, action.snapshot);
    case 'REMOTE_UPDATE_RECEIVED':
      return {
        ...state,
        hasPendingRemoteUpdate: true,
        pendingRemoteState: buildClinicalDocumentDraftBaseState(action.document, action.snapshot),
      };
    case 'APPLY_REMOTE_UPDATE':
      if (!state.pendingRemoteState.document || !state.pendingRemoteState.snapshot) {
        return state;
      }
      return commitDocumentAsBase(
        state,
        state.pendingRemoteState.document,
        state.pendingRemoteState.snapshot
      );
    case 'PATCH_FIELD':
      return patchDraft(state, draft => ({
        ...draft,
        patientFields: draft.patientFields.map(field =>
          field.id === action.fieldId ? { ...field, value: action.value } : field
        ),
      }));
    case 'PATCH_FIELD_LABEL':
      return patchDraft(state, draft => ({
        ...draft,
        patientFields: draft.patientFields.map(field =>
          field.id === action.fieldId ? { ...field, label: action.label } : field
        ),
      }));
    case 'SET_FIELD_VISIBILITY':
      return patchDraft(state, draft => ({
        ...draft,
        patientFields: draft.patientFields.map(field =>
          field.id === action.fieldId ? { ...field, visible: action.visible } : field
        ),
      }));
    case 'PATCH_SECTION':
      return patchDraft(state, draft => ({
        ...draft,
        sections: draft.sections.map(section =>
          section.id === action.sectionId
            ? {
                ...section,
                content: normalizeClinicalDocumentContentForStorage(action.content),
              }
            : section
        ),
      }));
    case 'PATCH_SECTION_TITLE':
      return patchDraft(state, draft => ({
        ...draft,
        sections: draft.sections.map(section =>
          section.id === action.sectionId
            ? {
                ...section,
                title: normalizeClinicalDocumentSectionTitle(action.title, section.title),
              }
            : section
        ),
      }));
    case 'PATCH_SECTION_LAYOUT':
      return patchDraft(state, draft => ({
        ...draft,
        sections: draft.sections.map(section =>
          section.id === action.sectionId ? { ...section, layout: action.layout } : section
        ),
      }));
    case 'SET_SECTION_VISIBILITY':
      return patchDraft(state, draft => ({
        ...draft,
        sections: draft.sections.map(section =>
          section.id === action.sectionId ? { ...section, visible: action.visible } : section
        ),
      }));
    case 'REORDER_SECTION':
      return patchDraft(state, draft => ({
        ...draft,
        sections: reorderClinicalDocumentVisibleSections(
          draft.sections,
          action.sourceSectionId,
          action.targetSectionId
        ),
      }));
    case 'MOVE_SECTION':
      return patchDraft(state, draft => ({
        ...draft,
        sections: moveClinicalDocumentVisibleSection(
          draft.sections,
          action.sectionId,
          action.direction
        ),
      }));
    case 'INSERT_SECTION':
      return patchDraft(state, draft => ({
        ...draft,
        sections: insertClinicalDocumentSection(
          draft.sections,
          action.referenceSectionId,
          action.position
        ),
      }));
    case 'PATCH_DOCUMENT_TITLE':
      return patchDraft(state, draft => ({
        ...draft,
        title: action.title,
      }));
    case 'PATCH_PATIENT_INFO_TITLE':
      return patchDraft(state, draft => ({
        ...draft,
        patientInfoTitle: action.title,
      }));
    case 'PATCH_FOOTER_LABEL':
      return patchDraft(state, draft =>
        action.kind === 'medico'
          ? { ...draft, footerMedicoLabel: action.title }
          : { ...draft, footerEspecialidadLabel: action.title }
      );
    case 'PATCH_DOCUMENT_META':
      return patchDraft(state, draft => ({
        ...draft,
        ...action.patch,
      }));
    case 'ADD_CLINICAL_UPDATE':
      return patchDraft(state, draft => ({
        ...draft,
        sections: [...draft.sections, createClinicalUpdateSection(draft.sections)],
      }));
    case 'PATCH_ANNEX_CONTENT':
      return patchDraft(state, draft => ({
        ...draft,
        annexContent: action.content,
      }));
    case 'PATCH_ANNEX_INCLUDED_IN_PRINT':
      return patchDraft(state, draft => ({
        ...draft,
        annexIncludedInPrint: action.included,
      }));
    case 'CLEAR_ANNEX_CONTENT':
      return patchDraft(state, draft => {
        const { annexContent: _, annexIncludedInPrint: __, ...rest } = draft;
        return rest as typeof draft;
      });
    case 'PATCH_IEEH_DRAFT':
      return patchDraft(state, draft => ({
        ...draft,
        ieehDraft: action.draft,
      }));
    case 'CLEAR_IEEH_DRAFT':
      return patchDraft(state, draft => {
        const { ieehDraft: _, ...rest } = draft;
        return rest as typeof draft;
      });
    case 'PATCH_UPDATE_DATE':
      return patchDraft(state, draft => ({
        ...draft,
        sections: draft.sections.map(s =>
          s.id === action.sectionId ? { ...s, updateDate: action.date } : s
        ),
      }));
    case 'PATCH_UPDATE_TIME':
      return patchDraft(state, draft => ({
        ...draft,
        sections: draft.sections.map(s =>
          s.id === action.sectionId ? { ...s, updateTime: action.time } : s
        ),
      }));
    case 'APPLY_TEMPLATE':
      return patchDraft(state, draft =>
        restoreClinicalDocumentDraftTemplate(draft, action.templateId, true)
      );
    case 'RESTORE_TEMPLATE_CONTENT':
      return patchDraft(state, draft => restoreClinicalDocumentDraftTemplate(draft));
    case 'AUTOSAVE_REQUESTED':
      return {
        ...state,
        isSaving: true,
      };
    case 'AUTOSAVE_MARK_CLEAN':
      return markAutosaveClean(state, action.document, action.snapshot);
    case 'AUTOSAVE_COMMIT_BASE':
      return commitAutosaveBaseState(state, action.document, action.snapshot);
    case 'AUTOSAVE_SUCCEEDED':
      return {
        ...commitDocumentAsBase(state, action.document, action.snapshot),
        isSaving: false,
      };
    case 'AUTOSAVE_FAILED':
      return {
        ...state,
        isSaving: false,
      };
    case 'SET_IS_SAVING':
      return {
        ...state,
        isSaving: action.value,
      };
    default:
      return state;
  }
};
