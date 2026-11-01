/**
 * ClinicalDocumentStatusBar
 *
 * Renders autosave status in the modal header.
 * The autosave indicator occupies a fixed slot (always rendered) so the
 * surrounding header layout never shifts when the sync phase changes.
 */

import React, { useMemo } from 'react';
import { CheckCircle2, Cloud, CloudUpload, Loader2 } from 'lucide-react';
import { resolveAutosaveIndicatorState } from '@/features/clinical-documents/controllers/clinicalDocumentAutosaveIndicatorController';
import type { AutosaveIndicatorPhase } from '@/features/clinical-documents/controllers/clinicalDocumentAutosaveIndicatorController';

interface ClinicalDocumentStatusBarProps {
  isSaving: boolean;
  lastSavedAt?: string;
  hasLocalDraftChanges: boolean;
}

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
        className={`inline-flex h-8 min-w-[148px] items-center justify-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors ${variant.containerClass}`}
      >
        <VariantIcon size={14} className={variant.iconClass} aria-hidden="true" />
        <span className="whitespace-nowrap">{visibleLabel}</span>
      </span>
    </div>
  );
};
