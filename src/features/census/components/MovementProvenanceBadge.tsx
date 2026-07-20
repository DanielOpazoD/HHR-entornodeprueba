import React from 'react';
import { CircleHelp, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
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
  const Icon = ICONS[presentation.icon];
  const content = (
    <>
      <Icon size={10} aria-hidden="true" />
      {presentation.label ? <span className="truncate">{presentation.label}</span> : null}
    </>
  );
  const className = `mt-1 inline-flex h-5 max-w-full items-center gap-1 rounded border px-1.5 text-[9px] font-semibold leading-none print:hidden ${TONE_CLASS[presentation.tone]}`;
  if (onClick) {
    const title = `${presentation.title}. Descargar PDF del egreso.`;
    return (
      <button
        type="button"
        className={`${className} transition-colors hover:border-teal-400 hover:bg-teal-100 disabled:cursor-progress disabled:opacity-60`}
        title={title}
        aria-label={title}
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
      title={presentation.title}
      aria-label={presentation.title}
      data-testid="movement-provenance"
    >
      {content}
    </span>
  );
};
