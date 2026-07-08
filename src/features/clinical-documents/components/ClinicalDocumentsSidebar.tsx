import React, { useRef, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  FileText,
  FilePlus2,
  FlaskConical,
  MoreHorizontal,
  PenLine,
  Sparkles,
  Trash2,
  Upload,
  Zap,
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
    <aside className="space-y-2.5 border-r border-slate-200 bg-slate-50/70 p-2.5">
      {/* Patient context + quick shortcuts */}
      {patientName && (
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-slate-800 leading-tight truncate">
              {patientName}
            </p>
            {patientRut && (
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">{patientRut}</p>
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
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              Tipo de documento
            </span>
            <select
              value={selectedTemplateId}
              onChange={event => onSelectTemplate(event.target.value)}
              className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-800"
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
              'w-full rounded-lg border px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition-all',
              canEdit && patientName
                ? 'border-medical-300 bg-medical-50 text-medical-800 hover:bg-medical-100'
                : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
            )}
          >
            <FilePlus2 size={12} className="inline mr-1.5" />
            Crear documento
          </button>
          {hasInsertActions && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowInsertTray(current => !current)}
                aria-expanded={showInsertTray}
                className="inline-flex h-8 w-full items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-2 text-[10px] font-black uppercase tracking-[0.12em] text-sky-700 transition-colors hover:bg-sky-100"
              >
                <Zap size={11} className="mr-1.5" />
                Insertar contenido
                <ChevronDown
                  size={11}
                  className={clsx('ml-1.5 transition-transform', showInsertTray && 'rotate-180')}
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
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-slate-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
                    >
                      <FlaskConical size={12} className="mr-2 text-emerald-600" />
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
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-slate-700 transition-colors hover:bg-violet-50 hover:text-violet-700"
                    >
                      <Zap size={12} className="mr-2 text-violet-600" />
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
                  className="flex-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-violet-700 hover:bg-violet-100 transition-colors"
                >
                  <PenLine size={10} className="inline mr-1" />
                  Actualización
                </button>
              )}
              {onToggleAnnex && (
                <button
                  type="button"
                  onClick={onToggleAnnex}
                  className={clsx(
                    'flex-1 rounded-lg border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors',
                    hasAnnex
                      ? 'border-medical-300 bg-medical-50 text-medical-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <FileText size={10} className="inline mr-1" />
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
                className="inline-flex h-7 w-full items-center justify-center rounded-md border border-slate-200 px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 hover:bg-slate-50 transition-colors"
              >
                <MoreHorizontal size={11} className="mr-1" />
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
                          className="flex-1 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-sky-700 hover:bg-sky-100 transition-colors"
                          title="Exportar JSON"
                        >
                          <Download size={10} className="inline mr-1" />
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
                            className={clsx(
                              'flex-1 rounded-lg border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors',
                              canEdit
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                            )}
                            title="Importar JSON"
                          >
                            <Upload size={10} className="inline mr-1" />
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
                        className={clsx(
                          'w-full rounded-lg border px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors',
                          canEdit && !isImportingWithAi
                            ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100'
                            : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                        )}
                        title="Importar informe de traslado con IA"
                      >
                        <Sparkles size={10} className="inline mr-1" />
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
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
          Episodio actual
        </p>
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
                    'group/doc rounded-lg border bg-white px-2 py-1.5 transition-all',
                    selectedDocumentId === document.id
                      ? 'border-medical-300 bg-medical-50'
                      : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectDocument(document.id)}
                      className="flex-1 text-left"
                    >
                      <span className="text-[11px] font-semibold leading-tight text-slate-700">
                        {document.title}
                      </span>
                      <span className="mt-0.5 block text-[9px] font-medium text-slate-400">
                        {getClinicalDocumentTypeLabel(document.documentType)}
                      </span>
                    </button>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onDuplicateDocument(document)}
                          className="rounded-md p-[3px] text-slate-300 opacity-0 transition-all group-hover/doc:opacity-100 hover:text-medical-600 hover:bg-medical-50"
                          title="Duplicar documento"
                        >
                          <Copy size={11} />
                        </button>
                      )}
                      {canDeleteThisDocument && (
                        <button
                          type="button"
                          onClick={() => onDeleteDocument(document)}
                          className="rounded-md p-[3px] text-slate-300 opacity-0 transition-all group-hover/doc:opacity-100 hover:text-red-500 hover:bg-red-50"
                          title="Eliminar documento"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <p className="text-[9px] text-slate-500">
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
