import React from 'react';
import clsx from 'clsx';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';

interface CensusMovementSectionLayoutProps {
  title: string;
  emptyMessage: string;
  icon: React.ReactNode;
  iconClassName: string;
  isEmpty: boolean;
  headers: readonly CensusMovementTableHeader[];
  children: React.ReactNode;
  subtitle?: string;
  rootClassName?: string;
  tableClassName?: string;
  bodyClassName?: string;
}

export const CensusMovementSectionLayout: React.FC<CensusMovementSectionLayoutProps> = ({
  title,
  emptyMessage,
  icon,
  iconClassName,
  isEmpty,
  headers,
  children,
  subtitle,
  rootClassName,
  tableClassName,
  bodyClassName,
}) => (
  <div
    className={clsx(
      'census-movement-section mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white animate-fade-in print:overflow-visible print:shadow-none',
      rootClassName
    )}
  >
    <div className="census-movement-heading flex min-h-9 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <div className={clsx('rounded-md p-1', iconClassName)}>{icon}</div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800 leading-tight">{title}</h2>
          {subtitle ? (
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
    </div>

    <div>
      {isEmpty ? (
        <p className="py-2.5 text-center text-xs text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="census-movement-table-scroll overflow-x-auto">
          <table className={clsx('w-full text-left text-sm print:text-xs', tableClassName)}>
            <thead className="border-b border-slate-200 bg-slate-50/50 text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-500">
              <tr>
                {headers.map(header => (
                  <th key={header.label} className={clsx('px-3 py-2', header.className)}>
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={bodyClassName}>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  </div>
);
