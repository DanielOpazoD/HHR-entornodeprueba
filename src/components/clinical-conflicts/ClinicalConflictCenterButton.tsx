import clsx from 'clsx';

interface ClinicalConflictCenterButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  snapshotCount: number;
  requiresAttention: boolean;
  testId: string;
  className?: string;
  label: string;
}

/** Entry of the census options menu: plain text, no icon and no alarm colour. */
export function ClinicalConflictCenterButton({
  onClick,
  disabled,
  snapshotCount,
  requiresAttention,
  testId,
  className,
  label,
}: ClinicalConflictCenterButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-census-menu-action
      data-testid={testId}
      className={clsx('flex items-center gap-2 rounded-md text-slate-600', className)}
    >
      {label}
      {snapshotCount > 0 ? ` · ${snapshotCount}` : ''}
      {requiresAttention ? ' · revisión requerida' : ''}
    </button>
  );
}
