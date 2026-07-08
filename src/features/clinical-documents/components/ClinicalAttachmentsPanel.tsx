import React, { useRef } from 'react';
import { FolderOpen, Upload } from 'lucide-react';

import type { ClinicalAttachmentRecord } from '@/features/clinical-documents/domain/entities';
import { ClinicalAttachmentRow } from '@/features/clinical-documents/components/ClinicalAttachmentRow';

interface ClinicalAttachmentsPanelProps {
  canEdit: boolean;
  currentDocumentId?: string | null;
  currentEpisodeKey?: string | null;
  attachments: ClinicalAttachmentRecord[];
  patientAttachments: ClinicalAttachmentRecord[];
  isLoading: boolean;
  isLoadingPatientAttachments: boolean;
  isUploading: boolean;
  uploadStatusMessage: string | null;
  onUploadAttachment: (file: File) => Promise<void> | void;
  onDeleteAttachment: (attachment: ClinicalAttachmentRecord) => Promise<void> | void;
  onRenameAttachment: (
    attachment: ClinicalAttachmentRecord,
    displayName: string
  ) => Promise<void> | void;
  onRegenerateAttachmentAccess: (attachment: ClinicalAttachmentRecord) => Promise<void> | void;
  onSuggestAttachmentName: (attachment: ClinicalAttachmentRecord) => Promise<string | null>;
}

const ClinicalAttachmentSection: React.FC<{
  title: string;
  description: string;
  emptyMessage?: string;
  attachments: ClinicalAttachmentRecord[];
  canEdit: boolean;
  scopeLabel: string | ((attachment: ClinicalAttachmentRecord) => string);
  onDeleteAttachment: (attachment: ClinicalAttachmentRecord) => Promise<void> | void;
  onRenameAttachment: (
    attachment: ClinicalAttachmentRecord,
    displayName: string
  ) => Promise<void> | void;
  onRegenerateAttachmentAccess: (attachment: ClinicalAttachmentRecord) => Promise<void> | void;
  onSuggestAttachmentName: (attachment: ClinicalAttachmentRecord) => Promise<string | null>;
}> = ({
  title,
  description,
  emptyMessage,
  attachments,
  canEdit,
  scopeLabel,
  onDeleteAttachment,
  onRenameAttachment,
  onRegenerateAttachmentAccess,
  onSuggestAttachmentName,
}) => (
  <div className="mt-3 first:mt-2">
    <div>
      <h3 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">{title}</h3>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{description}</p>
    </div>
    {attachments.length > 0 ? (
      <ul className="mt-2 space-y-1.5">
        {attachments.map(attachment => (
          <ClinicalAttachmentRow
            key={attachment.id}
            attachment={attachment}
            canEdit={canEdit}
            scopeLabel={typeof scopeLabel === 'function' ? scopeLabel(attachment) : scopeLabel}
            onDeleteAttachment={onDeleteAttachment}
            onRenameAttachment={onRenameAttachment}
            onRegenerateAttachmentAccess={onRegenerateAttachmentAccess}
            onSuggestAttachmentName={onSuggestAttachmentName}
          />
        ))}
      </ul>
    ) : emptyMessage ? (
      <p className="mt-2 text-xs text-slate-500">{emptyMessage}</p>
    ) : null}
  </div>
);

export const ClinicalAttachmentsPanel: React.FC<ClinicalAttachmentsPanelProps> = ({
  canEdit,
  currentDocumentId,
  currentEpisodeKey,
  attachments,
  patientAttachments,
  isLoading,
  isLoadingPatientAttachments,
  isUploading,
  uploadStatusMessage,
  onUploadAttachment,
  onDeleteAttachment,
  onRenameAttachment,
  onRegenerateAttachmentAccess,
  onSuggestAttachmentName,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const otherEpisodeAttachments = patientAttachments.filter(
    attachment => attachment.episodeKey !== currentEpisodeKey
  );
  const resolveEpisodeScopeLabel = (attachment: ClinicalAttachmentRecord): string =>
    currentDocumentId && attachment.documentId === currentDocumentId
      ? 'Vinculado al documento'
      : 'Archivo del episodio';

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void onUploadAttachment(file);
  };

  return (
    <section className="clinical-document-attachments-panel mx-auto w-full max-w-[900px] rounded-lg border border-slate-200 bg-slate-50/80 p-3 print:hidden">
      <div className="clinical-document-attachments-header flex flex-wrap items-center justify-between gap-2">
        <div className="clinical-document-attachments-title flex min-w-0 items-center gap-2">
          <FolderOpen size={15} className="shrink-0 text-slate-500" />
          <h2 className="min-w-0 text-xs font-black uppercase tracking-[0.16em] text-slate-600">
            Archivos globales del episodio
          </h2>
        </div>
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              aria-label="Adjuntar archivo al episodio"
              accept="image/*,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex h-7 shrink-0 items-center rounded-md border border-medical-200 bg-white px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-medical-700 transition-colors hover:bg-medical-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload size={12} className="mr-1" />
              Adjuntar
            </button>
          </>
        )}
      </div>

      {isUploading && (
        <p className="mt-2 text-xs text-medical-700">
          {uploadStatusMessage || 'Subiendo archivo...'}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        No forman parte del documento actual; quedan disponibles para todo el episodio clínico.
      </p>
      {isLoading && (
        <p className="mt-2 text-xs text-slate-500">Cargando archivos del episodio...</p>
      )}

      {!isLoading && (
        <ClinicalAttachmentSection
          title="Archivos disponibles"
          description="Imágenes, PDF, DOCX u otros respaldos clínicos guardados en Storage."
          emptyMessage="Sin archivos del episodio."
          attachments={attachments}
          canEdit={canEdit}
          scopeLabel={resolveEpisodeScopeLabel}
          onDeleteAttachment={onDeleteAttachment}
          onRenameAttachment={onRenameAttachment}
          onRegenerateAttachmentAccess={onRegenerateAttachmentAccess}
          onSuggestAttachmentName={onSuggestAttachmentName}
        />
      )}

      {(isLoadingPatientAttachments || otherEpisodeAttachments.length > 0) && (
        <div className="mt-3 border-t border-slate-200 pt-2">
          {isLoadingPatientAttachments && (
            <p className="mt-1 text-xs text-slate-500">Cargando otros episodios del paciente...</p>
          )}
          {!isLoadingPatientAttachments && otherEpisodeAttachments.length > 0 && (
            <ClinicalAttachmentSection
              title="Otros episodios del paciente"
              description="Archivos de otras hospitalizaciones del mismo RUT."
              attachments={otherEpisodeAttachments}
              canEdit={canEdit}
              scopeLabel="Otro episodio"
              onDeleteAttachment={onDeleteAttachment}
              onRenameAttachment={onRenameAttachment}
              onRegenerateAttachmentAccess={onRegenerateAttachmentAccess}
              onSuggestAttachmentName={onSuggestAttachmentName}
            />
          )}
        </div>
      )}
    </section>
  );
};
