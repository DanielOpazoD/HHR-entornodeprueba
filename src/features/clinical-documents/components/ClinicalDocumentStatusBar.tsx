/**
 * ClinicalDocumentStatusBar
 *
 * Renders autosave status and Drive sync state in the modal header.
 * The autosave indicator occupies a fixed slot (always rendered) so the
 * surrounding header layout never shifts when the sync phase changes.
 */

import React, { useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  ExternalLink,
  Loader2,
  UploadCloud,
} from 'lucide-react';
import { resolveAutosaveIndicatorState } from '@/features/clinical-documents/controllers/clinicalDocumentAutosaveIndicatorController';
import type { AutosaveIndicatorPhase } from '@/features/clinical-documents/controllers/clinicalDocumentAutosaveIndicatorController';
import type { ClinicalDocumentPdfMeta } from '@/features/clinical-documents/domain/entities';

interface ClinicalDocumentStatusBarProps {
  isSaving: boolean;
  lastSavedAt?: string;
  hasLocalDraftChanges: boolean;
  isUploadingPdf: boolean;
  pdf?: ClinicalDocumentPdfMeta;
  onUploadPdf: () => void;
}

const btnBase =
  'inline-flex h-7 items-center rounded-md border px-2 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300';

interface AutosaveBadgeVariant {
  Icon: typeof CheckCircle2;
  iconClass: string;
  containerClass: string;
  label: (savedAtLabel: string | null) => string;
  ariaLabel: (savedAtLabel: string | null) => string;
}

const AUTOSAVE_BADGE_VARIANTS: Record<AutosaveIndicatorPhase, AutosaveBadgeVariant> = {
  idle: {
    Icon: Cloud,
    iconClass: 'text-slate-400',
    containerClass: 'border-slate-200 bg-white text-slate-500',
    label: () => 'Sin cambios',
    ariaLabel: () => 'Documento sin cambios pendientes',
  },
  dirty: {
    Icon: CloudUpload,
    iconClass: 'text-amber-600',
    containerClass: 'border-amber-200 bg-amber-50 text-amber-700',
    label: () => 'Sin guardar',
    ariaLabel: () => 'Cambios locales sin guardar',
  },
  saving: {
    Icon: Loader2,
    iconClass: 'text-sky-600 animate-spin',
    containerClass: 'border-sky-200 bg-sky-50 text-sky-700',
    label: () => 'Guardando',
    ariaLabel: () => 'Guardando cambios',
  },
  saved: {
    Icon: CheckCircle2,
    iconClass: 'text-emerald-600',
    containerClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    label: savedAtLabel => (savedAtLabel ? `Guardado · ${savedAtLabel}` : 'Guardado'),
    ariaLabel: savedAtLabel =>
      savedAtLabel ? `Cambios guardados a las ${savedAtLabel}` : 'Cambios guardados',
  },
};

export const ClinicalDocumentStatusBar: React.FC<ClinicalDocumentStatusBarProps> = ({
  isSaving,
  lastSavedAt,
  hasLocalDraftChanges,
  isUploadingPdf,
  pdf,
  onUploadPdf,
}) => {
  const autosaveState = useMemo(
    () => resolveAutosaveIndicatorState(isSaving, hasLocalDraftChanges, lastSavedAt),
    [hasLocalDraftChanges, isSaving, lastSavedAt]
  );

  const variant = AUTOSAVE_BADGE_VARIANTS[autosaveState.phase];
  const VariantIcon = variant.Icon;
  const visibleLabel = variant.label(autosaveState.savedAtLabel);
  const accessibleLabel = variant.ariaLabel(autosaveState.savedAtLabel);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span
        role="status"
        aria-live="polite"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        data-autosave-phase={autosaveState.phase}
        className={`inline-flex h-7 min-w-[148px] items-center justify-center gap-1.5 rounded-md border px-2 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors ${variant.containerClass}`}
      >
        <VariantIcon size={12} className={variant.iconClass} />
        <span className="whitespace-nowrap">{visibleLabel}</span>
      </span>

      <div className="flex items-center gap-1.5">
        {pdf?.exportStatus === 'exported' ? (
          <>
            <span className="group relative inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700">
              <CheckCircle2 size={11} />
              Drive exportado
            </span>
            {pdf.webViewLink && (
              <a
                href={pdf.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center rounded-md border border-slate-200 px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
              >
                <ExternalLink size={11} className="mr-1" />
                Abrir Drive
              </a>
            )}
          </>
        ) : (
          <>
            {pdf?.exportStatus === 'failed' && (
              <span
                className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-md border border-red-200 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-red-700"
                title={pdf.exportError || 'Error al exportar a Drive'}
              >
                <AlertCircle size={11} />
                Drive falló
                {pdf.exportError ? `: ${pdf.exportError}` : ''}
              </span>
            )}
            <button
              type="button"
              onClick={onUploadPdf}
              disabled={isUploadingPdf}
              aria-label={pdf?.exportStatus === 'failed' ? 'Reintentar Drive' : 'Exportar a Drive'}
              className={`${btnBase} border-blue-200 text-blue-700 hover:bg-blue-50`}
            >
              {isUploadingPdf ? (
                <Loader2 size={11} className="mr-1 inline animate-spin" />
              ) : (
                <UploadCloud size={11} className="mr-1 inline" />
              )}
              {pdf?.exportStatus === 'failed' ? 'Reintentar' : 'Drive pendiente'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
