import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import '@/features/clinical-documents/styles/clinicalDocumentSheet.css';
import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import { ClinicalDocumentFormattingToolbar } from '@/features/clinical-documents/components/ClinicalDocumentFormattingToolbar';
import { ClinicalDocumentStatusBar } from '@/features/clinical-documents/components/ClinicalDocumentStatusBar';
import { ClinicalDocumentsSidebar } from '@/features/clinical-documents/components/ClinicalDocumentsSidebar';
import { ClinicalDocumentSheet } from '@/features/clinical-documents/components/ClinicalDocumentSheet';
import { ClinicalDocumentLabInsertDialog } from '@/features/clinical-documents/components/ClinicalDocumentLabInsertDialog';
import { ClinicalDocumentMMRADCopyDialog } from '@/features/clinical-documents/components/ClinicalDocumentMMRADCopyDialog';
import { resolveClinicalDocumentInsertTarget } from '@/features/clinical-documents/controllers/clinicalDocumentExternalInsertController';
import { useClinicalDocumentsWorkspaceModel } from '@/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceModel';
import { useClinicalDocumentSheetState } from '@/features/clinical-documents/hooks/useClinicalDocumentSheetState';

const ZOOM_STEP = 10;
const ZOOM_MIN = 60;
const ZOOM_MAX = 150;
const ZOOM_DEFAULT = 110;
const ZOOM_WITH_SIDEBAR_COLLAPSED = 130;

const escapeClinicalDocumentInlineHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

interface ClinicalDocumentsWorkspaceProps {
  patient: PatientData;
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
  const { canRead, sidebarProps, sheetProps } = useClinicalDocumentsWorkspaceModel({
    patient,
    currentDateString,
    bedId,
    isActive,
  });
  const sheetState = useClinicalDocumentSheetState(sheetProps.selectedDocument);
  const { flushPendingAutosave } = sheetProps;
  const { handleEditorDeactivate: deactivateEditor } = sheetState;
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const zoomBeforeSidebarCollapseRef = useRef(ZOOM_DEFAULT);
  const [showLabDialog, setShowLabDialog] = useState(false);
  const [showMMRADDialog, setShowMMRADDialog] = useState(false);

  const handleInsertLabText = useCallback(
    (text: string) => {
      const insertedAtCursor = sheetState.insertHtml(
        `${escapeClinicalDocumentInlineHtml(text).replace(/\n/g, '<br>')}<br>`
      );
      if (insertedAtCursor) return;

      const insertTarget = resolveClinicalDocumentInsertTarget({
        document: sheetProps.selectedDocument,
        activeEditorSectionId: sheetState.activeEditorSectionId,
        text,
      });
      if (!insertTarget || !sheetProps.patchSection) return;
      sheetProps.patchSection(insertTarget.sectionId, insertTarget.content);
    },
    [sheetProps, sheetState]
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

  const toolbarNode = sheetProps.selectedDocument ? (
    <ClinicalDocumentFormattingToolbar
      selectedDocument={sheetProps.selectedDocument}
      canEdit={sheetProps.canEdit}
      formattingDisabled={sheetState.formattingDisabled || !sheetProps.canEdit}
      isFormattingOpen={sheetState.isFormattingOpen}
      canUndo={sheetState.activeEditorHistoryState.canUndo}
      canRedo={sheetState.activeEditorHistoryState.canRedo}
      onPrint={sheetProps.onPrint}
      onRestoreTemplate={sheetProps.onRestoreTemplate}
      onToggleFormatting={() => sheetState.setIsFormattingOpen(prev => !prev)}
      onApplyFormatting={sheetState.applyFormatting}
      onInsertHtml={sheetState.insertHtml}
      zoom={zoom}
      onZoomIn={() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
      onZoomOut={() => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
    />
  ) : null;

  const statusNode = sheetProps.selectedDocument ? (
    <ClinicalDocumentStatusBar
      isSaving={sheetProps.isSaving}
      lastSavedAt={sheetProps.lastSavedAt}
      hasLocalDraftChanges={sheetProps.hasLocalDraftChanges}
      isUploadingPdf={sheetProps.isUploadingPdf}
      pdf={sheetProps.selectedDocument.pdf}
      onUploadPdf={sheetProps.onUploadPdf}
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
        {toolbarNode && <div className="relative z-20 flex items-center">{toolbarNode}</div>}
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
              patient.rut && sheetProps.canEdit && sheetProps.selectedDocument
                ? () => {
                    setShowMMRADDialog(false);
                    setShowLabDialog(true);
                  }
                : undefined
            }
            onOpenMMRADDialog={
              patient.rut && sheetProps.canEdit && sheetProps.selectedDocument
                ? () => {
                    setShowLabDialog(false);
                    setShowMMRADDialog(true);
                  }
                : undefined
            }
          />
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
            key={sheetProps.selectedDocument?.id ?? 'no-document'}
            {...sheetProps}
            toolbar={
              headerContent && (!headerActionsContainer || isCompactViewport) ? headerContent : null
            }
            activeTitleTarget={sheetState.activeTitleTarget}
            activeEditorSectionId={sheetState.activeEditorSectionId}
            onSetActiveTitleTarget={sheetState.setActiveTitleTarget}
            draggedSectionId={sheetState.draggedSectionId}
            dragOverSectionId={sheetState.dragOverSectionId}
            activePlanSubsectionId={sheetState.activePlanSubsectionId}
            activeIndicationsSpecialtyId={sheetState.activeIndicationsSpecialtyId}
            isIndicationsPanelOpen={sheetState.isIndicationsPanelOpen}
            onSetActivePlanSubsectionId={sheetState.setActivePlanSubsectionId}
            onSetActiveIndicationsSpecialtyId={sheetState.setActiveIndicationsSpecialtyId}
            onToggleIndicationsPanel={() => sheetState.setIsIndicationsPanelOpen(prev => !prev)}
            onEditorActivate={sheetState.handleEditorActivate}
            onEditorDeactivate={handleEditorDeactivate}
            dragHandlers={sheetState.sectionDragHandlers}
          />
        </div>
      </section>

      {showLabDialog && patient.rut && (
        <ClinicalDocumentLabInsertDialog
          patientRut={patient.rut}
          onInsert={handleInsertLabText}
          onClose={() => setShowLabDialog(false)}
        />
      )}
      {showMMRADDialog && patient.rut && (
        <ClinicalDocumentMMRADCopyDialog
          patientRut={patient.rut}
          onClose={() => setShowMMRADDialog(false)}
        />
      )}
    </div>
  );
};
