import React from 'react';
import { CircleHelp, Loader2, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import type { MovementProvenance } from '@/types/domain/movements';
import { resolveMovementProvenancePresentation } from '@/features/census/controllers/movementProvenancePresentationController';

interface MovementProvenanceBadgeProps {
  provenance?: MovementProvenance;
  onClick?: () => void;
  isBusy?: boolean;
}

const TONE_CLASS = {
  teal: 'border-teal-200 bg-teal-50 text-teal-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-500',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
} as const;

const ICONS = {
  verified: ShieldCheck,
  manual: UserRound,
  reclassified: RefreshCw,
  unknown: CircleHelp,
} as const;

export const MovementProvenanceBadge: React.FC<MovementProvenanceBadgeProps> = ({
  provenance,
  onClick,
  isBusy = false,
}) => {
  const presentation = resolveMovementProvenancePresentation(provenance);
  const Icon = isBusy ? Loader2 : ICONS[presentation.icon];
  const label = isBusy ? 'Descargando…' : presentation.label;
  const content = (
    <>
      <Icon
        size={10}
        className={isBusy ? 'motion-safe:animate-spin' : undefined}
        aria-hidden="true"
      />
      {label ? <span className="truncate">{label}</span> : null}
    </>
  );
  const className = `mt-1 inline-flex h-5 max-w-full items-center gap-1 rounded border px-1.5 text-[9px] font-semibold leading-none print:hidden ${TONE_CLASS[presentation.tone]}`;
  if (onClick) {
    const title = isBusy
      ? 'Descargando informe de egreso…'
      : `${presentation.title}. Descargar PDF del egreso.`;
    return (
      <button
        type="button"
        className={`${className} transition-colors hover:border-teal-400 hover:bg-teal-100 disabled:cursor-progress`}
        title={provenance?.source === 'gestion_camas' ? undefined : title}
        aria-label={title}
        aria-busy={isBusy}
        data-testid="movement-provenance"
        disabled={isBusy}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <span
      className={className}
      title={provenance?.source === 'gestion_camas' ? undefined : presentation.title}
      aria-label={presentation.title}
      data-testid="movement-provenance"
    >
      {content}
    </span>
  );
};
