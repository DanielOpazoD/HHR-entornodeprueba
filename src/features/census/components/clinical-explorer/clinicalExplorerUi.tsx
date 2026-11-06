import React from 'react';
import clsx from 'clsx';
import { PatientStatus } from '@/types/domain/patientClassification';

export const EXPLORER_ACTION_BUTTON =
  'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-50';

export const EXPLORER_ICON_BUTTON = `${EXPLORER_ACTION_BUTTON} size-8 justify-center px-0`;

/** Areas of the explorer. The combined view shows every area at once. */
export type ClinicalExplorerTab = 'all' | 'evolutions' | 'vitals' | 'lab' | 'img' | 'indications';

export const EXPLORER_TABS: ReadonlyArray<{ key: ClinicalExplorerTab; label: string }> = [
  { key: 'all', label: 'Vista conjunta' },
  { key: 'evolutions', label: 'Evoluciones' },
  { key: 'vitals', label: 'Signos vitales' },
  { key: 'lab', label: 'Laboratorio' },
  { key: 'img', label: 'Imágenes' },
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
  title: string;
  subtitle?: string;
  source: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const AreaCard: React.FC<AreaCardProps> = ({
  icon,
  title,
  subtitle,
  source,
  actions,
  className,
  children,
}) => (
  <section
    aria-label={title}
    className={clsx(
      'flex min-w-0 flex-col rounded-[10px] border border-slate-200 bg-white',
      className
    )}
  >
    <header className="flex min-h-10 items-center gap-2 border-b border-slate-100 px-3 py-1.5">
      <span aria-hidden="true" className="inline-flex text-slate-500 [&>svg]:size-3.5">
        {icon}
      </span>
      <h3 className="flex items-baseline gap-1.5 text-[14px] font-semibold text-slate-800">
        {title}
        {subtitle && <span className="text-[12px] font-normal text-slate-500">{subtitle}</span>}
      </h3>
      <span className="text-[11px] text-slate-500">· {source}</span>
      {actions && <span className="ml-auto flex items-center gap-2">{actions}</span>}
    </header>
    <div className="flex flex-col gap-2.5 p-3">{children}</div>
  </section>
);

export const SkeletonLines: React.FC<{ label: string }> = ({ label }) => (
  <div role="status" aria-label={label} className="space-y-2">
    <p className="text-[12px] text-slate-500">{label}…</p>
    {[0, 1, 2].map(index => (
      <div
        key={index}
        className="h-3 animate-pulse rounded bg-slate-100 motion-reduce:animate-none"
      />
    ))}
  </div>
);

export const ReadFailure: React.FC<{ message: string; summary?: string; onRetry: () => void }> = ({
  message,
  summary,
  onRetry,
}) => (
  <div role="alert" className="text-[12px] text-slate-600">
    <div className="flex flex-wrap items-center gap-2">
      <span>{summary ?? message}</span>
      <button type="button" onClick={onRetry} className={EXPLORER_ACTION_BUTTON}>
        Reintentar
      </button>
    </div>
    {summary && summary !== message && (
      <details className="mt-1 text-[11px] text-slate-500">
        <summary className="w-fit cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
          Detalle de la consulta
        </summary>
        <p className="mt-1 break-words">{message}</p>
      </details>
    )}
  </div>
);

export const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[12px] text-slate-600">{children}</p>
);

export const LinkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => (
  <button
    type="button"
    {...props}
    className={clsx(
      'min-h-7 self-start rounded text-[12px] font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700',
      className
    )}
  />
);
