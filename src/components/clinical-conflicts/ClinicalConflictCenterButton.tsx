import clsx from 'clsx';
import { History } from 'lucide-react';

export type ClinicalConflictCenterButtonVariant = 'default' | 'operations' | 'quick-action';

interface ClinicalConflictCenterButtonProps {
  onClick: () => void;
  scopeLabel: string;
  snapshotCount: number;
  requiresAttention: boolean;
  testId: string;
  className?: string;
  hideLabel: boolean;
  label: string;
  variant: ClinicalConflictCenterButtonVariant;
}

export function ClinicalConflictCenterButton({
  onClick,
  scopeLabel,
  snapshotCount,
  requiresAttention,
  testId,
  className,
  hideLabel,
  label,
  variant,
}: ClinicalConflictCenterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Centro de conflictos clínicos · ${scopeLabel}`}
      aria-label={`Centro de conflictos clínicos de ${scopeLabel}${requiresAttention ? ' · revisión requerida' : ''}`}
      data-testid={testId}
      className={clsx(
        'relative inline-flex items-center justify-center gap-1.5 border font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        variant === 'quick-action'
          ? clsx(
              'h-[30px] shrink-0 rounded-lg py-0 text-[10px]',
              hideLabel ? 'w-[30px] px-0' : 'min-w-[96px] px-2.5',
              requiresAttention
                ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 focus-visible:outline-amber-500'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-slate-400'
            )
          : 'border-slate-200 bg-white text-xs shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-slate-400',
        variant === 'operations' && 'min-h-9 rounded-lg px-2.5 py-2 text-slate-600',
        variant === 'default' && 'rounded-md px-2 py-1.5 text-slate-500',
        className
      )}
    >
      <History size={14} />
      {!hideLabel && <span className="hidden sm:inline">{label}</span>}
      {snapshotCount > 0 && !hideLabel && (
        <span
          className={clsx(
            'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px]',
            variant === 'quick-action' && !requiresAttention
              ? 'bg-slate-200 text-slate-600'
              : 'bg-amber-100 text-amber-700'
          )}
        >
          {snapshotCount}
        </span>
      )}
      {snapshotCount > 0 && hideLabel && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-white"
        />
      )}
    </button>
  );
}
