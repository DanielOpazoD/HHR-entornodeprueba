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
}

export const DateStripActionItem: React.FC<DateStripActionItemProps> = ({
  title,
  subtitle,
  icon: Icon,
  colorClassName,
  iconHoverColorClassName,
  onClick,
  className,
}) => (
  <button
    onClick={onClick}
    className={clsx(
      'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 group transition-colors',
      className
    )}
  >
    <div
      className={clsx(
        'w-8 h-8 rounded-full flex items-center justify-center group-hover:brightness-95',
        colorClassName,
        iconHoverColorClassName
      )}
    >
      <Icon size={16} />
    </div>
    <div>
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      <p className="text-[10px] text-slate-500">{subtitle}</p>
    </div>
  </button>
);
