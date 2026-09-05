import React from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

const tones = {
  clinical: 'hover:bg-medical-50 hover:text-medical-700',
  laboratory: 'hover:bg-emerald-50 hover:text-emerald-700',
  radiology: 'hover:bg-violet-50 hover:text-violet-700',
  documents: 'hover:bg-teal-50 hover:text-teal-700',
};

interface ClinicalActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  title: string;
  tone: keyof typeof tones;
  loading?: boolean;
  muted?: boolean;
  badge?: number;
}

/** Local patient actions only. Callers own identity, permissions and request lifecycles. */
export const ClinicalActionButton: React.FC<ClinicalActionButtonProps> = ({
  label,
  title,
  tone,
  loading = false,
  muted = false,
  badge,
  disabled,
  children,
  className,
  onClick,
  ...props
}) => (
  <button
    {...props}
    type="button"
    title={title}
    aria-label={label}
    aria-busy={loading || undefined}
    disabled={disabled || loading}
    onClick={event => {
      event.stopPropagation();
      onClick?.(event);
    }}
    className={clsx(
      'group relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-700 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-400',
      tones[tone],
      className
    )}
  >
    <span
      aria-hidden="true"
      className={clsx(
        'inline-flex [&>svg]:size-3.5',
        muted && !loading && 'opacity-40 group-hover:opacity-100 group-focus-visible:opacity-100'
      )}
    >
      {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : children}
    </span>
    {!loading && badge !== undefined && badge > 0 && (
      <span
        aria-hidden="true"
        className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-teal-700 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white"
      >
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
);
