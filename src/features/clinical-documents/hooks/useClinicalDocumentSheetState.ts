/**
 * useClinicalDocumentSheetState
 *
 * Local UI state for the clinical document sheet: active title editing,
 * formatting panel, section drag-and-drop, indications panel, plan
 * sub-section focus, and active rich-text editor tracking (including
 * undo/redo history state and raw HTML insertion).
 *
 * State is scoped per-document via a signature key so switching
 * documents resets transient UI without unmounting.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, DragEvent, SetStateAction } from 'react';

import type { ClinicalDocumentIndicationSpecialtyId } from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsController';
import { resolveClinicalDocumentIndicationSpecialty } from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsController';
import type { ClinicalDocumentPlanSubsectionId } from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController';
import type {
  ClinicalDocumentFormattingCommand,
  ClinicalDocumentSheetEditorApi,
} from '@/features/clinical-documents/components/clinicalDocumentSheetShared';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default specialty for the indications panel when no document context. */
const DEFAULT_ACTIVE_SPECIALTY_ID: ClinicalDocumentIndicationSpecialtyId = 'tmt';

/** Default plan sub-section focus when opening a new document. */
const DEFAULT_PLAN_SUBSECTION_ID: ClinicalDocumentPlanSubsectionId = 'generales';
const FORMATTING_KEEP_OPEN_SELECTOR = [
  '.clinical-document-rich-text-editor',
  '.clinical-document-input',
  '.clinical-document-textarea',
  '.clinical-document-global-toolbar-modal',
  '.clinical-document-toolbar-cluster',
  '[role="dialog"]',
].join(', ');

// ---------------------------------------------------------------------------
// Document-scoped state
// ---------------------------------------------------------------------------

/** Transient UI state that resets when switching to a different document. */
interface DocumentScopedSheetState {
  /** Unique key combining document id + specialty to detect switches. */
  documentSignature: string;
  /** Whether the indications side-panel is visible. */
  isIndicationsPanelOpen: boolean;
  /** Active specialty tab inside the indications panel. */
  activeIndicationsSpecialtyId: ClinicalDocumentIndicationSpecialtyId;
  /** Active sub-section inside the plan section. */
  activePlanSubsectionId: ClinicalDocumentPlanSubsectionId;
}

/** Builds a unique signature for a document to detect selection changes. */
const getDocumentSignature = (selectedDocument: ClinicalDocumentRecord | null) =>
  selectedDocument ? `${selectedDocument.id}:${selectedDocument.especialidad}` : 'none';

/** Creates a fresh document-scoped state for the given document. */
const createDocumentScopedSheetState = (
  selectedDocument: ClinicalDocumentRecord | null
): DocumentScopedSheetState => ({
  documentSignature: getDocumentSignature(selectedDocument),
  isIndicationsPanelOpen: false,
  activeIndicationsSpecialtyId: selectedDocument
    ? resolveClinicalDocumentIndicationSpecialty(selectedDocument.especialidad)
    : DEFAULT_ACTIVE_SPECIALTY_ID,
  activePlanSubsectionId: DEFAULT_PLAN_SUBSECTION_ID,
});

interface DocumentEditorOwner {
  documentId: string | null;
  isEditable: boolean;
}

interface DocumentEditorSession {
  owner: DocumentEditorOwner;
  activeEditor: { sectionId: string; api: ClinicalDocumentSheetEditorApi } | null;
  lastActiveEditorApi: ClinicalDocumentSheetEditorApi | null;
}

interface DocumentEditorState {
  owner: DocumentEditorOwner;
  activeEditorSectionId: string | null;
  activeEditorHistoryState: Pick<ClinicalDocumentSheetEditorApi, 'canUndo' | 'canRedo'>;
}

const createEditorState = (owner: DocumentEditorOwner): DocumentEditorState => ({
  owner,
  activeEditorSectionId: null,
  activeEditorHistoryState: { canUndo: false, canRedo: false },
});

/**
 * Manages the local UI state of the clinical document sheet.
 *
 * @param selectedDocument - The currently selected document (null when none).
 * @returns Sheet state values and mutation callbacks for the workspace.
 */
export const useClinicalDocumentSheetState = (selectedDocument: ClinicalDocumentRecord | null) => {
  const [activeTitleTarget, setActiveTitleTarget] = useState<string | null>(null);
  const [isFormattingOpen, setIsFormattingOpen] = useState(false);
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [documentScopedState, setDocumentScopedState] = useState<DocumentScopedSheetState>(() =>
    createDocumentScopedSheetState(selectedDocument)
  );
  const documentId = selectedDocument?.id ?? null;
  const isEditable = Boolean(selectedDocument && !selectedDocument.isLocked);
  // A new selection owns a fresh session, including when returning to an earlier document.
  const editorOwner = useMemo(() => ({ documentId, isEditable }), [documentId, isEditable]);
  const editorSessionRef = useRef<DocumentEditorSession | null>(null);
  const [editorState, setEditorState] = useState(() => createEditorState(editorOwner));
  const { activeEditorSectionId, activeEditorHistoryState } =
    editorState.owner === editorOwner ? editorState : createEditorState(editorOwner);

  useLayoutEffect(() => {
    editorSessionRef.current = {
      owner: editorOwner,
      activeEditor: null,
      lastActiveEditorApi: null,
    };
    return () => {
      editorSessionRef.current = null;
    };
  }, [editorOwner]);
  const currentDocumentScopedState = useMemo(() => {
    const expectedSignature = getDocumentSignature(selectedDocument);
    return documentScopedState.documentSignature === expectedSignature
      ? documentScopedState
      : createDocumentScopedSheetState(selectedDocument);
  }, [documentScopedState, selectedDocument]);

  const updateDocumentScopedState = useCallback(
    (updater: SetStateAction<DocumentScopedSheetState>) => {
      setDocumentScopedState(previous => {
        const baseState =
          previous.documentSignature === getDocumentSignature(selectedDocument)
            ? previous
            : createDocumentScopedSheetState(selectedDocument);

        return typeof updater === 'function' ? updater(baseState) : updater;
      });
    },
    [selectedDocument]
  );

  /** Keeps history and the last editor available within this document after blur. */
  const clearActiveEditor = useCallback(
    (sectionId: string) => {
      const session = editorSessionRef.current;
      if (session?.owner !== editorOwner || session.activeEditor?.sectionId !== sectionId) {
        return;
      }
      session.activeEditor = null;
      setEditorState(current =>
        current.owner === editorOwner ? { ...current, activeEditorSectionId: null } : current
      );
    },
    [editorOwner]
  );

  const handleEditorActivate = useCallback(
    (activeSectionId: string, editorApi: ClinicalDocumentSheetEditorApi) => {
      const session = editorSessionRef.current;
      if (session?.owner !== editorOwner || !editorOwner.isEditable) return;
      session.activeEditor = { sectionId: activeSectionId, api: editorApi };
      session.lastActiveEditorApi = editorApi;
      setEditorState(current =>
        current.owner === editorOwner &&
        current.activeEditorSectionId === activeSectionId &&
        current.activeEditorHistoryState.canUndo === editorApi.canUndo &&
        current.activeEditorHistoryState.canRedo === editorApi.canRedo
          ? current
          : {
              owner: editorOwner,
              activeEditorSectionId: activeSectionId,
              activeEditorHistoryState: {
                canUndo: editorApi.canUndo,
                canRedo: editorApi.canRedo,
              },
            }
      );
    },
    [editorOwner]
  );

  const handleEditorDeactivate = useCallback(
    (sectionId: string) => {
      clearActiveEditor(sectionId);
    },
    [clearActiveEditor]
  );

  const setIsIndicationsPanelOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    nextValueOrUpdater => {
      updateDocumentScopedState(current => ({
        ...current,
        isIndicationsPanelOpen:
          typeof nextValueOrUpdater === 'function'
            ? nextValueOrUpdater(current.isIndicationsPanelOpen)
            : nextValueOrUpdater,
      }));
    },
    [updateDocumentScopedState]
  );

  const setActiveIndicationsSpecialtyId = useCallback(
    (specialtyId: ClinicalDocumentIndicationSpecialtyId) => {
      updateDocumentScopedState(current => ({
        ...current,
        activeIndicationsSpecialtyId: specialtyId,
      }));
    },
    [updateDocumentScopedState]
  );

  const setActivePlanSubsectionId = useCallback(
    (subsectionId: ClinicalDocumentPlanSubsectionId) => {
      updateDocumentScopedState(current => ({
        ...current,
        activePlanSubsectionId: subsectionId,
      }));
    },
    [updateDocumentScopedState]
  );

  const formattingDisabled = !isEditable || !activeEditorSectionId;

  const applyFormatting = useCallback(
    (command: ClinicalDocumentFormattingCommand, value?: string) => {
      const session = editorSessionRef.current;
      if (session?.owner !== editorOwner || !editorOwner.isEditable) return;
      const isHistoryCommand = command === 'undo' || command === 'redo';
      const targetApi = isHistoryCommand
        ? session.activeEditor?.api || session.lastActiveEditorApi
        : session.activeEditor?.api;
      targetApi?.element?.focus();
      targetApi?.applyCommand(command, value);
    },
    [editorOwner]
  );

  /** Inserts raw HTML at the cursor of the active (or last-active) editor. */
  const insertHtml = useCallback(
    (html: string) => {
      const session = editorSessionRef.current;
      if (session?.owner !== editorOwner || !editorOwner.isEditable) return false;
      const targetApi = session.activeEditor?.api || session.lastActiveEditorApi;
      if (!targetApi?.element) return false;
      targetApi.element.focus();
      targetApi.insertHtml(html);
      return true;
    },
    [editorOwner]
  );

  const sectionDragHandlers = useMemo(
    () => ({
      onDragStart: (event: DragEvent<HTMLButtonElement>, sectionId: string) => {
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', sectionId);
        }
        setDraggedSectionId(sectionId);
        setDragOverSectionId(null);
      },
      onDragOver: (event: DragEvent<HTMLElement>, sectionId: string, canInteract: boolean) => {
        if (!canInteract || !draggedSectionId) return;
        event.preventDefault();
        setDragOverSectionId(sectionId);
      },
      onDragLeave: (sectionId: string) => {
        if (dragOverSectionId === sectionId) {
          setDragOverSectionId(null);
        }
      },
      onDragEnd: () => {
        setDraggedSectionId(null);
        setDragOverSectionId(null);
      },
    }),
    [dragOverSectionId, draggedSectionId]
  );

  useEffect(() => {
    if (!isFormattingOpen || typeof document === 'undefined') {
      return;
    }

    const handleDocumentDoubleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setIsFormattingOpen(false);
        return;
      }

      if (target.closest(FORMATTING_KEEP_OPEN_SELECTOR)) {
        return;
      }

      setIsFormattingOpen(false);
    };

    document.addEventListener('dblclick', handleDocumentDoubleClick);
    return () => {
      document.removeEventListener('dblclick', handleDocumentDoubleClick);
    };
  }, [isFormattingOpen]);

  return {
    activeTitleTarget,
    setActiveTitleTarget,
    activeEditorSectionId,
    isFormattingOpen,
    setIsFormattingOpen,
    draggedSectionId,
    dragOverSectionId,
    setDragOverSectionId,
    setDraggedSectionId,
    isIndicationsPanelOpen: currentDocumentScopedState.isIndicationsPanelOpen,
    setIsIndicationsPanelOpen,
    activeIndicationsSpecialtyId: currentDocumentScopedState.activeIndicationsSpecialtyId,
    setActiveIndicationsSpecialtyId,
    activePlanSubsectionId: currentDocumentScopedState.activePlanSubsectionId,
    setActivePlanSubsectionId,
    activeEditorHistoryState,
    formattingDisabled,
    applyFormatting,
    insertHtml,
    handleEditorActivate,
    handleEditorDeactivate,
    sectionDragHandlers,
  };
};
