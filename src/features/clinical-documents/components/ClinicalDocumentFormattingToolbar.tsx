/**
 * ClinicalDocumentFormattingToolbar
 *
 * Centered editing tools: Undo/Redo, Print, Format, Restore, Zoom +/-
 * Undo/Redo react to the active editor's history state.
 * LAB moved to sidebar. Status (autosave, Drive) in header right side.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bold,
  Link2,
  Printer,
  Redo2,
  RotateCcw,
  Table2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { ClinicalDocumentLinkDialog } from '@/features/clinical-documents/components/ClinicalDocumentLinkDialog';
import { ClinicalDocumentTableDialog } from '@/features/clinical-documents/components/ClinicalDocumentTableDialog';
import {
  defaultIconBtn,
  FORMATTING_ICON_SIZE,
  FORMATTING_PANEL_OFFSET_PX,
  FORMATTING_PANEL_VIEWPORT_MARGIN_PX,
  FORMATTING_PANEL_Z_INDEX,
  iconBtn,
  listFormattingActions,
  renderToolbarButtons,
  textFormattingActions,
  ToolbarCluster,
  TOOLBAR_ICON_SIZE,
} from '@/features/clinical-documents/components/clinicalDocumentFormattingToolbarShared';

import type {
  ClinicalDocumentFormattingCommand,
  ClinicalDocumentSheetProps,
} from '@/features/clinical-documents/components/clinicalDocumentSheetShared';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClinicalDocumentFormattingToolbarProps {
  selectedDocument: NonNullable<ClinicalDocumentSheetProps['selectedDocument']>;
  canEdit: boolean;
  formattingDisabled: boolean;
  isFormattingOpen: boolean;
  /** Whether the active editor has an undo snapshot available. */
  canUndo: boolean;
  /** Whether the active editor has a redo snapshot available. */
  canRedo: boolean;
  onPrint: () => void;
  onRestoreTemplate: () => void;
  onToggleFormatting: () => void;
  onApplyFormatting: (command: ClinicalDocumentFormattingCommand) => void;
  /** Insert raw HTML at the cursor position of the active editor. */
  onInsertHtml?: (html: string) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ClinicalDocumentFormattingToolbar: React.FC<
  ClinicalDocumentFormattingToolbarProps
> = ({
  selectedDocument,
  canEdit,
  formattingDisabled,
  isFormattingOpen,
  canUndo,
  canRedo,
  onPrint,
  onRestoreTemplate,
  onToggleFormatting,
  onApplyFormatting,
  onInsertHtml,
  zoom,
  onZoomIn,
  onZoomOut,
}) => {
  const formattingReady = canEdit && !selectedDocument.isLocked && !formattingDisabled;
  const editEnabled = canEdit && !selectedDocument.isLocked;
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const formatButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The panel is portaled to <body> and positioned with `fixed` coordinates so
  // it can never be clipped by the toolbar's scroll container (the modal header
  // uses `overflow-x:auto`, which the browser coerces `overflow-y` to `auto`,
  // hiding any absolutely-positioned child that drops below the header box).
  //
  // Placement is applied imperatively (no React state) so that re-renders of the
  // toolbar while the panel is open — e.g. undo/redo state changing as the user
  // types — never cause cascading renders.
  const positionPanel = useCallback(() => {
    const button = formatButtonRef.current;
    const panel = panelRef.current;
    if (!button || !panel || typeof window === 'undefined') {
      return;
    }

    const rect = button.getBoundingClientRect();
    const margin = FORMATTING_PANEL_VIEWPORT_MARGIN_PX;
    const top = rect.bottom + FORMATTING_PANEL_OFFSET_PX;

    // Anchor the panel's right edge to the button, then clamp BOTH horizontal
    // edges so a button near the left edge (narrow viewports) can't push the
    // panel off-screen, and bound the height so it never runs past the bottom.
    const width = panel.offsetWidth;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const left = Math.min(Math.max(margin, rect.right - width), maxLeft);

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.maxHeight = `${Math.max(0, window.innerHeight - top - margin)}px`;
    panel.style.visibility = 'visible';
  }, []);

  // Re-place after every render while open (keeps the anchor correct when the
  // toolbar re-renders) — runs before paint, so the reset-then-place is invisible.
  useLayoutEffect(() => {
    if (isFormattingOpen) {
      positionPanel();
    }
  });

  // Keep the panel anchored to the button on viewport changes while it is open.
  useEffect(() => {
    if (!isFormattingOpen || typeof window === 'undefined') {
      return;
    }

    window.addEventListener('resize', positionPanel);
    // Capture phase so ancestor scrolls (modal body, header) reposition the panel.
    window.addEventListener('scroll', positionPanel, true);
    return () => {
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
    };
  }, [isFormattingOpen, positionPanel]);

  return (
    <div
      data-formatting-open={isFormattingOpen ? 'true' : 'false'}
      className={`flex flex-wrap items-start gap-2 rounded-2xl transition-all ${
        isFormattingOpen
          ? 'bg-white/80 px-1.5 py-1 shadow-[0_8px_24px_rgba(14,165,233,0.08)] ring-1 ring-sky-100/90 backdrop-blur-sm'
          : 'bg-transparent'
      }`}
    >
      <ToolbarCluster label="Historial">
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => onApplyFormatting('undo')}
          disabled={!editEnabled || !canUndo}
          className={defaultIconBtn}
          aria-label="Deshacer"
          title="Deshacer (Ctrl+Z)"
        >
          <Undo2 size={TOOLBAR_ICON_SIZE} />
        </button>
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => onApplyFormatting('redo')}
          disabled={!editEnabled || !canRedo}
          className={defaultIconBtn}
          aria-label="Rehacer"
          title="Rehacer (Ctrl+Shift+Z)"
        >
          <Redo2 size={TOOLBAR_ICON_SIZE} />
        </button>
      </ToolbarCluster>

      <ToolbarCluster label="Formato">
        <button
          ref={formatButtonRef}
          type="button"
          onMouseDown={event => event.preventDefault()}
          onClick={onToggleFormatting}
          disabled={!editEnabled}
          aria-pressed={isFormattingOpen}
          aria-label="Formato"
          title="Formato avanzado"
          className={`relative ${iconBtn} ${
            isFormattingOpen
              ? 'border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-100'
              : formattingReady
                ? 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {formattingReady && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-sky-500"
            />
          )}
          <Bold size={TOOLBAR_ICON_SIZE} />
        </button>
      </ToolbarCluster>

      <ToolbarCluster label="Documento">
        <button
          type="button"
          onClick={onPrint}
          className={defaultIconBtn}
          aria-label="Imprimir PDF"
          title="Imprimir PDF"
        >
          <Printer size={TOOLBAR_ICON_SIZE} />
        </button>
        <button
          type="button"
          onClick={onRestoreTemplate}
          disabled={!editEnabled}
          aria-label="Restablecer plantilla"
          title="Restablecer plantilla"
          className={`${iconBtn} border-amber-200 text-amber-600 hover:bg-amber-50`}
        >
          <RotateCcw size={TOOLBAR_ICON_SIZE} />
        </button>
      </ToolbarCluster>

      <ToolbarCluster label="Vista">
        <button
          type="button"
          onClick={onZoomOut}
          disabled={zoom <= 60}
          className={defaultIconBtn}
          aria-label="Reducir zoom"
          title="Reducir zoom"
        >
          <ZoomOut size={TOOLBAR_ICON_SIZE} />
        </button>
        <span className="text-[9px] font-mono text-slate-400 w-7 text-center shrink-0">
          {zoom}%
        </span>
        <button
          type="button"
          onClick={onZoomIn}
          disabled={zoom >= 150}
          className={defaultIconBtn}
          aria-label="Aumentar zoom"
          title="Aumentar zoom"
        >
          <ZoomIn size={TOOLBAR_ICON_SIZE} />
        </button>
      </ToolbarCluster>

      {/* Formatting panel — portaled to <body> so the modal header's scroll
          container can never clip it (see updatePanelPosition). */}
      {isFormattingOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              className={`clinical-document-global-toolbar-modal clinical-document-global-toolbar-modal--floating ${
                formattingReady ? 'clinical-document-global-toolbar-modal--ready' : ''
              }`}
              style={{
                position: 'fixed',
                top: 0,
                left: FORMATTING_PANEL_VIEWPORT_MARGIN_PX,
                zIndex: FORMATTING_PANEL_Z_INDEX,
                // Hidden until positionPanel() places it (same paint frame).
                visibility: 'hidden',
              }}
            >
              <div className="clinical-document-toolbar-panel">
                <section className="clinical-document-toolbar-panel-section">
                  <p className="clinical-document-toolbar-panel-title">Formato de texto</p>
                  <div
                    className="clinical-document-toolbar"
                    role="toolbar"
                    aria-label="Formato global del documento"
                  >
                    {renderToolbarButtons(
                      textFormattingActions,
                      onApplyFormatting,
                      formattingDisabled
                    )}
                  </div>
                </section>

                <section className="clinical-document-toolbar-panel-section">
                  <p className="clinical-document-toolbar-panel-title">Listas y sangría</p>
                  <div
                    className="clinical-document-toolbar"
                    role="toolbar"
                    aria-label="Listas y sangría del documento"
                  >
                    {renderToolbarButtons(
                      listFormattingActions,
                      onApplyFormatting,
                      formattingDisabled
                    )}
                  </div>
                </section>

                <section className="clinical-document-toolbar-panel-section">
                  <p className="clinical-document-toolbar-panel-title">Tablas y enlaces</p>
                  <div
                    className="clinical-document-toolbar"
                    role="toolbar"
                    aria-label="Tablas y enlaces"
                  >
                    {onInsertHtml && (
                      <>
                        <button
                          type="button"
                          className="clinical-document-toolbar-button"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => setShowTableDialog(true)}
                          disabled={!editEnabled}
                          aria-label="Insertar tabla"
                          title="Insertar tabla"
                        >
                          <Table2 size={FORMATTING_ICON_SIZE} />
                        </button>
                        <button
                          type="button"
                          className="clinical-document-toolbar-button"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => setShowLinkDialog(true)}
                          disabled={!editEnabled}
                          aria-label="Insertar enlace"
                          title="Insertar enlace"
                        >
                          <Link2 size={FORMATTING_ICON_SIZE} />
                        </button>
                      </>
                    )}
                  </div>
                </section>
              </div>

              {showTableDialog && onInsertHtml ? (
                <ClinicalDocumentTableDialog
                  onInsert={html => onInsertHtml(html)}
                  onClose={() => setShowTableDialog(false)}
                />
              ) : null}

              {showLinkDialog && onInsertHtml ? (
                <ClinicalDocumentLinkDialog
                  onInsert={html => onInsertHtml(html)}
                  onClose={() => setShowLinkDialog(false)}
                />
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
};
