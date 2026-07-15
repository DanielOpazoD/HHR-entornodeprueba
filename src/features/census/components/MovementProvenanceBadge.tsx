import React from 'react';
import { CircleHelp, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import type { MovementProvenance } from '@/types/domain/movements';
import { resolveMovementProvenancePresentation } from '@/features/census/controllers/movementProvenancePresentationController';

interface MovementProvenanceBadgeProps {
  provenance?: MovementProvenance;
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

export const MovementProvenanceBadge: React.FC<MovementProvenanceBadgeProps> = ({ provenance }) => {
  const presentation = resolveMovementProvenancePresentation(provenance);
  const Icon = ICONS[presentation.icon];
  return (
    <span
      className={`mt-1 inline-flex h-5 max-w-full items-center gap-1 rounded border px-1.5 text-[9px] font-semibold leading-none print:hidden ${TONE_CLASS[presentation.tone]}`}
      title={presentation.title}
      aria-label={presentation.title}
      data-testid="movement-provenance"
    >
      <Icon size={10} aria-hidden="true" />
      {presentation.label ? <span className="truncate">{presentation.label}</span> : null}
    </span>
  );
};
