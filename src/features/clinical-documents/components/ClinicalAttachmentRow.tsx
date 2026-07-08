import React, { useState } from 'react';
import {
  Check,
  File,
  FileText,
  Image,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import { formatClinicalDocumentDateTime } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import type { ClinicalAttachmentRecord } from '@/features/clinical-documents/domain/entities';

const formatAttachmentSize = (sizeBytes: number): string => {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.ceil(sizeBytes / 1024)} KB`;
};

const resolveAttachmentIcon = (attachment: ClinicalAttachmentRecord) => {
  if (attachment.fileKind === 'image') return <Image size={14} />;
  if (attachment.fileKind === 'pdf' || attachment.fileKind === 'docx')
    return <FileText size={14} />;
  return <File size={14} />;
};

interface ClinicalAttachmentRowProps {
  attachment: ClinicalAttachmentRecord;
  canEdit: boolean;
  scopeLabel?: string;
  onDeleteAttachment: (attachment: ClinicalAttachmentRecord) => Promise<void> | void;
  onRenameAttachment: (
    attachment: ClinicalAttachmentRecord,
    displayName: string
  ) => Promise<void> | void;
  onRegenerateAttachmentAccess: (attachment: ClinicalAttachmentRecord) => Promise<void> | void;
  onSuggestAttachmentName: (attachment: ClinicalAttachmentRecord) => Promise<string | null>;
}

export const ClinicalAttachmentRow: React.FC<ClinicalAttachmentRowProps> = ({
  attachment,
  canEdit,
  scopeLabel,
  onDeleteAttachment,
  onRenameAttachment,
  onRegenerateAttachmentAccess,
  onSuggestAttachmentName,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(attachment.displayName);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRegeneratingAccess, setIsRegeneratingAccess] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);

  const handleStartEditing = () => {
    setDraftName(attachment.displayName);
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    setDraftName(attachment.displayName);
    setIsEditing(false);
  };

  const handleSaveName = async () => {
    const nextName = draftName.trim();
    if (!nextName || nextName === attachment.displayName) {
      setIsEditing(false);
      return;
    }
    setIsRenaming(true);
    try {
      await onRenameAttachment(attachment, nextName);
      setIsEditing(false);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleSuggestName = async () => {
    setIsSuggesting(true);
    try {
      const suggestedName = await onSuggestAttachmentName(attachment);
      if (suggestedName) {
        setDraftName(suggestedName);
      }
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleRegenerateAccess = async () => {
    setIsRegeneratingAccess(true);
    try {
      await onRegenerateAttachmentAccess(attachment);
    } finally {
      setIsRegeneratingAccess(false);
    }
  };

  const metadataLabel = (
    <>
      {scopeLabel ? `${scopeLabel} · ` : ''}
      {formatAttachmentSize(attachment.sizeBytes)} ·{' '}
      {formatClinicalDocumentDateTime(attachment.createdAt)}
    </>
  );

  const displayNameBlock = attachment.downloadUrl ? (
    <a
      href={attachment.downloadUrl}
      target="_blank"
      rel="noreferrer"
      className="min-w-0 flex-1 text-xs font-semibold text-slate-700 hover:text-medical-700"
    >
      <span className="block truncate">{attachment.displayName}</span>
      <span className="block text-[10px] font-normal text-slate-400">{metadataLabel}</span>
    </a>
  ) : (
    <div className="min-w-0 flex-1 text-xs font-semibold text-slate-500">
      <span className="block truncate">{attachment.displayName}</span>
      <span className="block text-[10px] font-normal text-amber-600">Archivo no disponible</span>
      <span className="block text-[10px] font-normal text-slate-400">{metadataLabel}</span>
    </div>
  );

  return (
    <li className="clinical-document-attachment-row flex min-w-0 items-center gap-2 overflow-hidden rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <span className="text-slate-500">{resolveAttachmentIcon(attachment)}</span>
      {isEditing ? (
        <div className="min-w-0 flex-1">
          <input
            type="text"
            aria-label="Nombre visible del archivo"
            value={draftName}
            onChange={event => setDraftName(event.target.value)}
            className="h-7 w-full rounded-md border border-medical-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:border-medical-500"
          />
          <span className="mt-0.5 block text-[10px] text-slate-400">{metadataLabel}</span>
        </div>
      ) : (
        displayNameBlock
      )}
      {canEdit && (
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => void handleSuggestName()}
                disabled={isSuggesting || isRenaming}
                aria-label="Sugerir nombre con IA"
                title="Sugerir nombre con IA"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-violet-500 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSuggesting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveName()}
                disabled={isRenaming || !draftName.trim()}
                aria-label="Guardar nombre"
                title="Guardar nombre"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRenaming ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button
                type="button"
                onClick={handleCancelEditing}
                disabled={isRenaming}
                aria-label="Cancelar renombrar"
                title="Cancelar"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              {!attachment.downloadUrl && (
                <button
                  type="button"
                  onClick={() => void handleRegenerateAccess()}
                  disabled={isRegeneratingAccess}
                  aria-label={`Regenerar acceso de ${attachment.displayName}`}
                  title="Regenerar acceso"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-amber-600 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRegeneratingAccess ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={handleStartEditing}
                aria-label={`Renombrar ${attachment.displayName}`}
                title="Renombrar archivo"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-medical-50 hover:text-medical-700"
              >
                <Pencil size={13} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void onDeleteAttachment(attachment)}
            aria-label={`Eliminar ${attachment.displayName}`}
            title="Eliminar archivo"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </li>
  );
};
