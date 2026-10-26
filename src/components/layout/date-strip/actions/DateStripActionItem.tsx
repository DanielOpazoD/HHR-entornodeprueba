import React from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface DateStripActionItemProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  colorClassName: string;
  iconHoverColorClassName: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}

export const DateStripActionItem: React.FC<DateStripActionItemProps> = ({
  title,
  subtitle,
  icon: Icon,
  colorClassName,
  iconHoverColorClassName,
  onClick,
  className,
  disabled = false,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'group flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors enabled:hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-medical-600',
      className,
      disabled && 'cursor-not-allowed opacity-60'
    )}
  >
    <div
      className={clsx(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        colorClassName,
        !disabled && 'group-hover:brightness-95',
        !disabled && iconHoverColorClassName
      )}
    >
      <Icon size={16} aria-hidden="true" />
    </div>
    <div className="min-w-0 break-words">
      <p className="text-xs font-semibold leading-5 text-slate-700">{title}</p>
      <p className="text-[11px] leading-4 text-slate-500">{subtitle}</p>
    </div>
  </button>
);
