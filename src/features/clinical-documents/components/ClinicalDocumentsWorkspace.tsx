import type { ClinicalDocumentsWorkspacePatientContract } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import '@/features/clinical-documents/styles/clinicalDocumentSheet.css';

import { ClinicalDocumentFormattingToolbar } from '@/features/clinical-documents/components/ClinicalDocumentFormattingToolbar';
import { ClinicalDocumentStatusBar } from '@/features/clinical-documents/components/ClinicalDocumentStatusBar';
import { ClinicalDocumentsSidebar } from '@/features/clinical-documents/components/ClinicalDocumentsSidebar';
import { ClinicalDocumentPharmacyForms } from '@/features/clinical-documents/components/ClinicalDocumentPharmacyForms';
import { ClinicalDocumentSheet } from '@/features/clinical-documents/components/ClinicalDocumentSheet';
import { ClinicalDocumentLabInsertDialog } from '@/features/clinical-documents/components/ClinicalDocumentLabInsertDialog';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import { ClinicalDocumentMMRADCopyDialog } from '@/features/clinical-documents/components/ClinicalDocumentMMRADCopyDialog';
import { useClinicalDocumentsWorkspaceModel } from '@/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceModel';
import { useClinicalDocumentSheetState } from '@/features/clinical-documents/hooks/useClinicalDocumentSheetState';
import { escapeHtml } from '@/utils/htmlEscape';

const ZOOM_STEP = 10;
const ZOOM_MIN = 60;
const ZOOM_MAX = 150;
const ZOOM_DEFAULT = 110;
const ZOOM_WITH_SIDEBAR_COLLAPSED = 130;

interface ExternalDialogSelection {
  contextKey: string;
  kind: 'lab' | 'mmrad';
}

interface ResolveClinicalDocumentInsertTargetParams {
  document: ClinicalDocumentRecord | null;
  activeEditorSectionId: string | null;
  text: string;
}

interface ClinicalDocumentInsertTarget {
  sectionId: string;
  content: string;
}

export const resolveClinicalDocumentInsertTarget = ({
  document,
  activeEditorSectionId,
  text,
}: ResolveClinicalDocumentInsertTargetParams): ClinicalDocumentInsertTarget | null => {
  if (!document) {
    return null;
  }

  const visibleSections = document.sections.filter(section => section.visible !== false);
  const targetSection =
    visibleSections.find(section => section.id === activeEditorSectionId) ?? visibleSections[0];

  if (!targetSection) {
    return null;
  }

  const existing = targetSection.content || '';
  const separator = existing.trim() ? '<br>' : '';

  return {
    sectionId: targetSection.id,
    content: `${existing}${separator}${text}`,
  };
};

interface ClinicalDocumentsWorkspaceProps {
  patient: ClinicalDocumentsWorkspacePatientContract;
  currentDateString: string;
  bedId: string;
  isActive?: boolean;
  headerActionsContainerId?: string;
}

export const ClinicalDocumentsWorkspace: React.FC<ClinicalDocumentsWorkspaceProps> = ({
  patient,
  currentDateString,
  bedId,
  isActive = true,
  headerActionsContainerId,
}) => {
  const { canRead, episodeKey, sidebarProps, sheetModel } = useClinicalDocumentsWorkspaceModel({
    patient,
    currentDateString,
    bedId,
    isActive,
  });
  const sheetState = useClinicalDocumentSheetState(sheetModel.selectedDocument);
  const { flushPendingAutosave } = sheetModel.chrome;
  const { handleEditorDeactivate: deactivateEditor } = sheetState;
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const zoomBeforeSidebarCollapseRef = useRef(ZOOM_DEFAULT);
  const [externalDialog, setExternalDialog] = useState<ExternalDialogSelection | null>(null);
  const externalDialogContextKey =
    isActive && canRead && sheetModel.canEdit && patient.rut && sheetModel.selectedDocument
      ? JSON.stringify([patient.rut, episodeKey, sheetModel.selectedDocument.id])
      : null;
  const visibleExternalDialog =
    externalDialog?.contextKey === externalDialogContextKey ? externalDialog : null;
  if (externalDialog && !visibleExternalDialog) {
    setExternalDialog(null);
  }

  const handleInsertLabText = useCallback(
    (text: string) => {
      const insertedAtCursor = sheetState.insertHtml(
        `${escapeHtml(text).replace(/\n/g, '<br>')}<br>`
      );
      if (insertedAtCursor) return;

      const insertTarget = resolveClinicalDocumentInsertTarget({
        document: sheetModel.selectedDocument,
        activeEditorSectionId: sheetState.activeEditorSectionId,
        text,
      });
      if (!insertTarget) return;
      sheetModel.documentActions.patchSection(insertTarget.sectionId, insertTarget.content);
    },
    [sheetModel, sheetState]
  );

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(collapsed => {
      if (collapsed) {
        setZoom(zoomBeforeSidebarCollapseRef.current);
        return false;
      }

      zoomBeforeSidebarCollapseRef.current = zoom;
      setZoom(currentZoom =>
        Math.min(ZOOM_MAX, Math.max(currentZoom, ZOOM_WITH_SIDEBAR_COLLAPSED))
      );
      return true;
    });
  }, [zoom]);

  const handleEditorDeactivate = useCallback(
    (sectionId: string) => {
      deactivateEditor(sectionId);
      flushPendingAutosave();
    },
    [deactivateEditor, flushPendingAutosave]
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const syncCompactViewport = () => setIsCompactViewport(mediaQuery.matches);

    syncCompactViewport();
    mediaQuery.addEventListener('change', syncCompactViewport);
    return () => mediaQuery.removeEventListener('change', syncCompactViewport);
  }, []);

  if (!canRead) {
    return (
      <p className="p-4 text-sm text-slate-600">No tienes permisos para acceder a este módulo.</p>
    );
  }

  const toolbarNode = sheetModel.selectedDocument ? (
    <ClinicalDocumentFormattingToolbar
      selectedDocument={sheetModel.selectedDocument}
      canEdit={sheetModel.canEdit}
      formattingDisabled={sheetState.formattingDisabled || !sheetModel.canEdit}
      isFormattingOpen={sheetState.isFormattingOpen}
      canUndo={sheetState.activeEditorHistoryState.canUndo}
      canRedo={sheetState.activeEditorHistoryState.canRedo}
      onPrint={sheetModel.chrome.onPrint}
      onRestoreTemplate={sheetModel.chrome.onRestoreTemplate}
      onToggleFormatting={() => sheetState.setIsFormattingOpen(prev => !prev)}
      onApplyFormatting={sheetState.applyFormatting}
      onInsertHtml={sheetState.insertHtml}
      zoom={zoom}
      onZoomIn={() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
      onZoomOut={() => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
    />
  ) : null;

  const statusNode = sheetModel.selectedDocument ? (
    <ClinicalDocumentStatusBar
      isSaving={sheetModel.chrome.isSaving}
      lastSavedAt={sheetModel.chrome.lastSavedAt}
      hasLocalDraftChanges={sheetModel.chrome.hasLocalDraftChanges}
    />
  ) : null;

  const headerActionsContainer = headerActionsContainerId
    ? document.getElementById(headerActionsContainerId)
    : null;

  // Toolbar uses fixed centering over the full modal width.
  // Status stays in normal flow (right-aligned in headerActions).
  const headerContent =
    toolbarNode || statusNode ? (
      <>
        {toolbarNode && (
          <div className="relative z-20 flex items-center max-md:pl-10">{toolbarNode}</div>
        )}
        {statusNode && <div className="flex items-center">{statusNode}</div>}
      </>
    ) : null;

  const workspaceGridClass = isSidebarCollapsed
    ? 'relative grid h-[86vh] min-h-[86vh] grid-cols-[minmax(0,1fr)] overflow-hidden'
    : 'relative grid h-[86vh] min-h-[86vh] grid-cols-[260px_minmax(0,1fr)] overflow-hidden max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_minmax(0,1fr)]';
  const effectiveZoom = isCompactViewport ? 100 : zoom;
  const shouldPortalHeaderContent = Boolean(
    headerContent && headerActionsContainer && !isCompactViewport
  );

  return (
    <div
      className={workspaceGridClass}
      data-testid="clinical-documents-workspace"
      data-module="clinical-documents"
    >
      {shouldPortalHeaderContent && headerActionsContainer
        ? createPortal(headerContent, headerActionsContainer)
        : null}
      {!isSidebarCollapsed && (
        <div className="min-w-0 overflow-y-auto overflow-x-hidden">
          <ClinicalDocumentsSidebar
            {...sidebarProps}
            onOpenLabDialog={
              externalDialogContextKey
                ? () => setExternalDialog({ contextKey: externalDialogContextKey, kind: 'lab' })
                : undefined
            }
            onOpenMMRADDialog={
              externalDialogContextKey
                ? () => setExternalDialog({ contextKey: externalDialogContextKey, kind: 'mmrad' })
                : undefined
            }
          />
          <ClinicalDocumentPharmacyForms />
        </div>
      )}

      <section className="relative min-w-0 overflow-y-auto overflow-x-hidden bg-[#f3f4f6] p-3 max-md:p-2">
        <button
          type="button"
          onClick={handleToggleSidebar}
          aria-label={isSidebarCollapsed ? 'Mostrar panel lateral' : 'Ocultar panel lateral'}
          title={isSidebarCollapsed ? 'Mostrar panel lateral' : 'Ocultar panel lateral'}
          className="absolute left-3 top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-500 shadow-sm transition-colors hover:border-medical-300 hover:text-medical-700"
        >
          {isSidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>

        <div
          data-testid="clinical-document-sheet-zoom-layer"
          style={{ transform: `scale(${effectiveZoom / 100})`, transformOrigin: 'top center' }}
        >
          <ClinicalDocumentSheet
            key={sheetModel.selectedDocument?.id ?? 'no-document'}
            selectedDocument={sheetModel.selectedDocument}
            canEdit={sheetModel.canEdit}
            toolbar={
              headerContent && (!headerActionsContainer || isCompactViewport) ? headerContent : null
            }
            documentActions={sheetModel.documentActions}
            editorState={{
              activeTitleTarget: sheetState.activeTitleTarget,
              activeEditorSectionId: sheetState.activeEditorSectionId,
              onSetActiveTitleTarget: sheetState.setActiveTitleTarget,
              draggedSectionId: sheetState.draggedSectionId,
              dragOverSectionId: sheetState.dragOverSectionId,
              dragHandlers: sheetState.sectionDragHandlers,
              activePlanSubsectionId: sheetState.activePlanSubsectionId,
              onSetActivePlanSubsectionId: sheetState.setActivePlanSubsectionId,
              onEditorActivate: sheetState.handleEditorActivate,
              onEditorDeactivate: handleEditorDeactivate,
              onUploadPastedImage: sheetModel.onUploadPastedImage,
              onImagePasteRejected: sheetModel.onImagePasteRejected,
            }}
            indications={{
              ...sheetModel.indicationsCatalog,
              isPanelOpen: sheetState.isIndicationsPanelOpen,
              onTogglePanel: () => sheetState.setIsIndicationsPanelOpen(prev => !prev),
            }}
            attachments={sheetModel.attachments}
            annex={sheetModel.annex}
            ieeh={sheetModel.ieeh}
            signature={sheetModel.signature}
          />
        </div>
      </section>

      {visibleExternalDialog?.kind === 'lab' && patient.rut && (
        <ClinicalDocumentLabInsertDialog
          key={visibleExternalDialog.contextKey}
          patientRut={patient.rut}
          onInsert={handleInsertLabText}
          onClose={() => setExternalDialog(null)}
        />
      )}
      {visibleExternalDialog?.kind === 'mmrad' && patient.rut && (
        <ClinicalDocumentMMRADCopyDialog
          key={visibleExternalDialog.contextKey}
          patientRut={patient.rut}
          onClose={() => setExternalDialog(null)}
        />
      )}
    </div>
  );
};
