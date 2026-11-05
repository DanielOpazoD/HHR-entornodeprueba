import React from 'react';
import clsx from 'clsx';
import { PatientStatus } from '@/types/domain/patientClassification';

/** Areas of the explorer. The combined view shows every area at once. */
export type ClinicalExplorerTab = 'all' | 'lab' | 'evolutions' | 'indications';

export const EXPLORER_TABS: ReadonlyArray<{ key: ClinicalExplorerTab; label: string }> = [
  { key: 'all', label: 'Vista conjunta' },
  { key: 'lab', label: 'Laboratorio' },
  { key: 'evolutions', label: 'Evoluciones' },
  { key: 'indications', label: 'Indicaciones' },
];

const STATUS_DOT: Record<string, string> = {
  [PatientStatus.GRAVE]: 'bg-red-500',
  [PatientStatus.DE_CUIDADO]: 'bg-amber-400',
  [PatientStatus.ESTABLE]: 'bg-emerald-500',
};

export const StatusDot: React.FC<{ status: string; className?: string }> = ({
  status,
  className,
}) => (
  <span
    aria-hidden="true"
    className={clsx(
      'inline-block size-2.5 shrink-0 rounded-full',
      STATUS_DOT[status] ?? 'bg-slate-300',
      className
    )}
  />
);

interface AreaCardProps {
  icon: React.ReactNode;
  iconClassName: string;
  title: string;
  subtitle?: string;
  source: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const AreaCard: React.FC<AreaCardProps> = ({
  icon,
  iconClassName,
  title,
  subtitle,
  source,
  actions,
  className,
  children,
}) => (
  <section
    aria-label={title}
    className={clsx('flex min-w-0 flex-col rounded-[10px] border border-slate-200 bg-white', className)}
  >
    <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
      <span
        aria-hidden="true"
        className={clsx(
          'inline-flex size-[26px] items-center justify-center rounded-lg [&>svg]:size-3.5',
          iconClassName
        )}
      >
        {icon}
      </span>
      <h3 className="flex items-baseline gap-1.5 text-[13px] font-semibold text-slate-800">
        {title}
        {subtitle && <span className="text-[10.5px] font-medium text-slate-400">{subtitle}</span>}
      </h3>
      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 text-[9.5px] font-semibold text-slate-500">
        {source}
      </span>
      {actions && <span className="ml-auto flex items-center gap-2">{actions}</span>}
    </header>
    <div className="flex flex-col gap-2.5 p-3">{children}</div>
  </section>
);

export const SkeletonLines: React.FC<{ label: string }> = ({ label }) => (
  <div role="status" aria-label={label} className="space-y-2">
    {[0, 1, 2].map(index => (
      <div key={index} className="h-3 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
    ))}
  </div>
);

export const ReadFailure: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <p role="alert" className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
    <span>{message}</span>
    <button
      type="button"
      onClick={onRetry}
      className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
    >
      Reintentar
    </button>
  </p>
);

export const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[12px] italic text-slate-400">{children}</p>
);

export const LinkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => (
  <button
    type="button"
    {...props}
    className={clsx(
      'self-start text-[11px] font-semibold text-medical-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700',
      className
    )}
  />
);
