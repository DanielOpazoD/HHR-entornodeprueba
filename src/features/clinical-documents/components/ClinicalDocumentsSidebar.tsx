import React, { useRef, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  FileText,
  FilePlus2,
  FlaskConical,
  Image,
  ListPlus,
  MoreHorizontal,
  PenLine,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';

import { getClinicalDocumentTypeLabel } from '@/features/clinical-documents/controllers/clinicalDocumentTemplateController';
import {
  formatClinicalDocumentAuthorName,
  formatClinicalDocumentDateTime,
} from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import { withCurrentClinicalDocumentVersionSnapshotFallback } from '@/domain/clinical-documents/versionHistory';
import type { ClinicalDocumentsSidebarProps } from '@/features/clinical-documents/contracts/clinicalDocumentsSidebarContracts';
import { ClinicalDocumentVersionBadge } from '@/features/clinical-documents/components/ClinicalDocumentVersionBadge';

const secondaryActionClass =
  'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';

export const ClinicalDocumentsSidebar: React.FC<ClinicalDocumentsSidebarProps> = ({
  canEdit,
  canDelete,
  readOnlyMessage,
  patientName,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onCreateDocument,
  documents,
  selectedDocumentId,
  onSelectDocument,
  onDuplicateDocument,
  onDeleteDocument,
  canDeleteDocument,
  onExportJson,
  onImportJson,
  onImportWithAi,
  isImportingWithAi = false,
  onAddClinicalUpdate,
  onToggleAnnex,
  hasAnnex,
  onRestoreVersionSection,
  patientRut,
  onOpenLabDialog,
  onOpenMMRADDialog,
}) => {
  const importInputRef = useRef<HTMLInputElement>(null);
  const aiImportInputRef = useRef<HTMLInputElement>(null);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [showInsertTray, setShowInsertTray] = useState(false);
  const selectedDocument = documents.find(document => document.id === selectedDocumentId) || null;
  const hasInsertActions = Boolean(onOpenLabDialog || onOpenMMRADDialog);

  return (
    <aside className="space-y-3 border-r border-slate-200 bg-slate-50/70 p-3">
      {/* Patient context + quick shortcuts */}
      {patientName && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-slate-800 leading-snug truncate">
              {patientName}
            </p>
            {patientRut && (
              <p className="text-[11px] font-mono text-slate-500 mt-0.5">{patientRut}</p>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {readOnlyMessage && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {readOnlyMessage}
          </div>
        )}
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">Tipo de documento</span>
            <select
              value={selectedTemplateId}
              onChange={event => onSelectTemplate(event.target.value)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] text-slate-800 focus:border-medical-500 focus:outline-none focus:ring-2 focus:ring-medical-200"
            >
              {templates.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onCreateDocument}
            disabled={!canEdit || !patientName}
            className={clsx(
              'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border px-2 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500 focus-visible:ring-offset-1',
              canEdit && patientName
                ? 'border-medical-300 bg-medical-50 text-medical-800 hover:bg-medical-100'
                : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
            )}
          >
            <FilePlus2 size={14} aria-hidden="true" />
            Crear documento
          </button>
          {hasInsertActions && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowInsertTray(current => !current)}
                aria-expanded={showInsertTray}
                className={`${secondaryActionClass} w-full`}
              >
                <ListPlus size={14} aria-hidden="true" />
                Insertar contenido
                <ChevronDown
                  size={13}
                  aria-hidden="true"
                  className={clsx('transition-transform', showInsertTray && 'rotate-180')}
                />
              </button>
              {showInsertTray && (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 space-y-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                  {onOpenLabDialog && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowInsertTray(false);
                        onOpenLabDialog();
                      }}
                      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500"
                    >
                      <FlaskConical size={14} className="text-slate-500" aria-hidden="true" />
                      Laboratorio
                    </button>
                  )}
                  {onOpenMMRADDialog && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowInsertTray(false);
                        onOpenMMRADDialog();
                      }}
                      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500"
                    >
                      <Image size={14} className="text-slate-500" aria-hidden="true" />
                      Imagenología MMRAD
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {selectedDocumentId && canEdit && (
            <div className="flex gap-1.5 mt-1">
              {onAddClinicalUpdate && (
                <button
                  type="button"
                  onClick={onAddClinicalUpdate}
                  className={`${secondaryActionClass} flex-1`}
                >
                  <PenLine size={14} className="shrink-0" aria-hidden="true" />
                  Actualización
                </button>
              )}
              {onToggleAnnex && (
                <button
                  type="button"
                  onClick={onToggleAnnex}
                  aria-pressed={Boolean(hasAnnex)}
                  className={clsx(
                    'inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500 focus-visible:ring-offset-1',
                    hasAnnex
                      ? 'border-medical-300 bg-medical-50 text-medical-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <FileText size={14} className="shrink-0" aria-hidden="true" />
                  Agregar Anexos
                </button>
              )}
            </div>
          )}
          {(onExportJson || onImportJson || onImportWithAi) && (
            <div className="space-y-1.5 border-t border-slate-100 pt-1.5">
              <button
                type="button"
                onClick={() => setShowAdvancedTools(current => !current)}
                aria-expanded={showAdvancedTools}
                className={`${secondaryActionClass} w-full`}
              >
                <MoreHorizontal size={14} aria-hidden="true" />
                Herramientas avanzadas
              </button>
              {showAdvancedTools && (
                <div className="space-y-1.5">
                  {(selectedDocument || onImportJson) && (
                    <div className="flex gap-1.5">
                      {selectedDocument && onExportJson && (
                        <button
                          type="button"
                          onClick={() => onExportJson(selectedDocument)}
                          className={`${secondaryActionClass} flex-1`}
                          title="Exportar JSON"
                        >
                          <Download size={14} className="shrink-0" aria-hidden="true" />
                          Exportar JSON
                        </button>
                      )}
                      {onImportJson && (
                        <>
                          <input
                            ref={importInputRef}
                            type="file"
                            accept=".json,application/json"
                            aria-label="Archivo JSON de documento clínico"
                            className="hidden"
                            onChange={event => {
                              const file = event.target.files?.[0];
                              if (file) {
                                onImportJson(file);
                              }
                              event.target.value = '';
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => importInputRef.current?.click()}
                            disabled={!canEdit}
                            className={`${secondaryActionClass} flex-1`}
                            title="Importar JSON"
                          >
                            <Upload size={14} className="shrink-0" aria-hidden="true" />
                            Importar JSON
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {onImportWithAi && (
                    <>
                      <input
                        ref={aiImportInputRef}
                        type="file"
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        aria-label="Archivo PDF o DOCX para importar con IA"
                        className="hidden"
                        onChange={event => {
                          const file = event.target.files?.[0];
                          if (file && !isImportingWithAi) {
                            onImportWithAi(file);
                          }
                          event.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => aiImportInputRef.current?.click()}
                        disabled={!canEdit || isImportingWithAi}
                        className={`${secondaryActionClass} w-full`}
                        title="Importar informe de traslado con IA"
                      >
                        <Sparkles size={14} aria-hidden="true" />
                        {isImportingWithAi ? 'Importando con IA' : 'Importar con IA'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-slate-500">Episodio actual</p>
        {documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-500">
            No hay documentos clínicos para este episodio.
          </div>
        ) : (
          <div className="space-y-1.5">
            {documents.map(document => {
              const canDeleteThisDocument = canDelete || Boolean(canDeleteDocument?.(document));

              return (
                <div
                  key={document.id}
                  className={clsx(
                    'group/doc rounded-lg border px-2.5 py-2 transition-colors',
                    selectedDocumentId === document.id
                      ? 'border-medical-300 bg-medical-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectDocument(document.id)}
                      aria-pressed={selectedDocumentId === document.id}
                      className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500 focus-visible:ring-offset-2"
                    >
                      <span className="block text-[12px] font-semibold leading-snug text-slate-800">
                        {document.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {getClinicalDocumentTypeLabel(document.documentType)}
                      </span>
                    </button>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onDuplicateDocument(document)}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-medical-100 hover:text-medical-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical-500"
                          aria-label="Duplicar documento"
                          title="Duplicar documento"
                        >
                          <Copy size={14} aria-hidden="true" />
                        </button>
                      )}
                      {canDeleteThisDocument && (
                        <button
                          type="button"
                          onClick={() => onDeleteDocument(document)}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                          aria-label="Eliminar documento"
                          title="Eliminar documento"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
                    <p className="text-[10px] leading-snug text-slate-500">
                      {formatClinicalDocumentAuthorName(document.audit.updatedBy.displayName)} ·{' '}
                      {formatClinicalDocumentDateTime(document.audit.updatedAt)}
                    </p>
                    {document.versionHistory && document.versionHistory.length > 0 && (
                      <ClinicalDocumentVersionBadge
                        currentVersion={document.currentVersion}
                        versionHistory={withCurrentClinicalDocumentVersionSnapshotFallback(
                          document
                        )}
                        canRestoreSection={canEdit && selectedDocumentId === document.id}
                        onRestoreSection={onRestoreVersionSection}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
