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
      'census-movement-section mt-4 rounded-xl border border-slate-200/80 bg-white animate-fade-in print:p-2 print:border-t-2 print:border-slate-800 print:shadow-none',
      rootClassName
    )}
  >
    <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
      <div className="flex items-center gap-2">
        <div className={clsx('p-1.5 rounded-md', iconClassName)}>{icon}</div>
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

    <div className="p-2">
      {isEmpty ? (
        <p className="text-slate-500 text-xs text-center py-3">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={clsx('w-full text-left text-sm print:text-xs', tableClassName)}>
            <thead className="bg-slate-50/50 text-slate-500 font-semibold border-b border-slate-200 uppercase text-[10px] tracking-[0.04em]">
              <tr>
                {headers.map(header => (
                  <th key={header.label} className={clsx('px-2 py-2', header.className)}>
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
