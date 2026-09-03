import React from 'react';
import clsx from 'clsx';

interface PatientDocumentManagerButtonProps {
  patientName: string;
  count: number | null;
  onOpen: () => void;
}

export const PatientDocumentManagerButton: React.FC<PatientDocumentManagerButtonProps> = ({
  patientName,
  count,
  onOpen,
}) => {
  const title = count === null
    ? `Abrir Gestor documental de ${patientName}; cantidad no disponible`
    : count === 0
      ? `Abrir Gestor documental de ${patientName}; sin archivos`
      : `Abrir Gestor documental de ${patientName}; ${count} ${count === 1 ? 'archivo' : 'archivos'}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        'relative inline-flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600',
        count !== null && count > 0
          ? 'border-teal-200 bg-teal-50 text-teal-700 hover:border-teal-300 hover:bg-teal-100'
          : count === 0
            ? 'border-slate-200 bg-slate-50 text-slate-400 opacity-30 hover:opacity-60'
            : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
      )}
      title={title}
      aria-label={title}
    >
      <svg viewBox="0 0 20 20" className="size-[15px]" fill="none" aria-hidden="true">
        <path d="M2.5 5.5h5l1.7 2h8.3v8h-15z" stroke="currentColor" strokeWidth="1.7" />
      </svg>
      {count !== null && count > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-teal-700 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white"
          aria-hidden="true"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
};
