/**
 * ClinicalDocumentAnnexPage
 *
 * Annexes section rendered inside the clinical document sheet.
 * Uses CSS page-break-before so it prints as a separate page.
 * Supports images, tables, and rich text via the standard editor.
 *
 * Double-click on the title to reveal a delete button that removes
 * the entire annex section from the document.
 */

import React, { useCallback, useState } from 'react';
import { FileText, Printer, Trash2, X } from 'lucide-react';
import { ClinicalDocumentRichTextEditor } from '@/features/clinical-documents/components/ClinicalDocumentRichTextEditor';
import type { ClinicalDocumentRichTextEditorActivationApi } from '@/features/clinical-documents/hooks/clinicalDocumentRichTextEditorTypes';
import { formatDateForDisplay } from '@/utils/dateDisplayUtils';

interface ClinicalDocumentAnnexPageProps {
  content: string;
  canEdit: boolean;
  isLocked: boolean;
  patientName: string;
  currentDateLabel?: string;
  includedInGlobalPrint: boolean;
  isEditorActive?: boolean;
  onChange: (content: string) => void;
  onToggleIncludedInGlobalPrint: (included: boolean) => void;
  onPrintAnnex: () => void;
  onClear: () => void;
  onEditorActivate?: (
    sectionId: string,
    editor: ClinicalDocumentRichTextEditorActivationApi
  ) => void;
  onEditorDeactivate?: (sectionId: string) => void;
  onUploadPastedImage?: (file: File) => Promise<{
    attachmentId: string;
    imageUrl: string;
    storagePath: string;
  } | null>;
  onImagePasteRejected?: (message: string) => void;
}

export const ClinicalDocumentAnnexPage: React.FC<ClinicalDocumentAnnexPageProps> = ({
  content,
  canEdit,
  isLocked,
  patientName,
  currentDateLabel,
  includedInGlobalPrint,
  isEditorActive = false,
  onChange,
  onToggleIncludedInGlobalPrint,
  onPrintAnnex,
  onClear,
  onEditorActivate,
  onEditorDeactivate,
  onUploadPastedImage,
  onImagePasteRejected,
}) => {
  const [showDelete, setShowDelete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleTitleDoubleClick = useCallback(() => {
    if (canEdit && !isLocked) {
      setShowDelete(true);
      setConfirmDelete(false);
    }
  }, [canEdit, isLocked]);

  const handleDeleteClick = useCallback(() => {
    setConfirmDelete(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    onClear();
    setShowDelete(false);
    setConfirmDelete(false);
  }, [onClear]);

  const handleCancelDelete = useCallback(() => {
    setShowDelete(false);
    setConfirmDelete(false);
  }, []);

  const resolvedCurrentDateLabel =
    currentDateLabel?.trim() ||
    formatDateForDisplay(new Date()).replace(/^\w/, char => char.toUpperCase());

  return (
    <div
      className={`clinical-document-annex-page${isEditorActive ? ' is-editor-active' : ''}`}
      data-clinical-section-id="annexes"
      style={{
        pageBreakBefore: 'always',
        marginTop: '24px',
        paddingTop: '16px',
      }}
    >
      <div className="clinical-document-annex-header print:!block">
        <div
          className="clinical-document-annex-heading cursor-default select-none"
          onDoubleClick={handleTitleDoubleClick}
          title={canEdit && !isLocked ? 'Doble clic para opciones' : undefined}
        >
          <div className="clinical-document-annex-title-row">
            <FileText size={16} className="text-slate-500 print:hidden" />
            <h2 className="clinical-document-annex-title">Anexo del documento</h2>
            <span className="clinical-document-annex-badge">Pertenece solo a este documento</span>
          </div>
          <div className="clinical-document-annex-meta">
            <span className="clinical-document-annex-meta-item">
              Paciente: <strong>{patientName || 'Paciente'}</strong>
            </span>
            <span className="clinical-document-annex-meta-item">
              Fecha: <strong>{resolvedCurrentDateLabel}</strong>
            </span>
          </div>
        </div>

        <div className="clinical-document-annex-actions print:hidden">
          <label className="clinical-document-annex-print-toggle">
            <input
              type="checkbox"
              checked={includedInGlobalPrint}
              onChange={event => onToggleIncludedInGlobalPrint(event.target.checked)}
              disabled={!canEdit || isLocked}
            />
            <span className="clinical-document-annex-print-toggle-copy">
              Incluir al imprimir global
            </span>
          </label>
          <button
            type="button"
            onClick={onPrintAnnex}
            className="clinical-document-annex-print-button"
            aria-label="Imprimir solo anexo"
            title="Imprimir solo anexo"
          >
            <Printer size={14} />
          </button>
        </div>

        {/* Delete controls (shown on double-click, hidden on print) */}
        {showDelete && canEdit && !isLocked && (
          <div className="flex items-center gap-1.5 ml-2 print:hidden animate-in fade-in duration-150">
            {!confirmDelete ? (
              <>
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                  title="Eliminar anexo del documento"
                >
                  <Trash2 size={12} />
                  Eliminar
                </button>
                <button
                  type="button"
                  onClick={handleCancelDelete}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-50 transition-colors"
                  title="Cancelar"
                >
                  <X size={12} />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1">
                <span className="text-xs text-red-700">¿Eliminar anexo del documento?</span>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Sí, eliminar
                </button>
                <button
                  type="button"
                  onClick={handleCancelDelete}
                  className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
                >
                  No
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="clinical-document-annex-editor-shell">
        <ClinicalDocumentRichTextEditor
          sectionId="annexes"
          sectionTitle="Anexo del documento"
          value={content}
          disabled={!canEdit || isLocked}
          onChange={onChange}
          onActivate={onEditorActivate}
          onDeactivate={onEditorDeactivate}
          onUploadPastedImage={onUploadPastedImage}
          onImagePasteRejected={onImagePasteRejected}
        />
      </div>
    </div>
  );
};
