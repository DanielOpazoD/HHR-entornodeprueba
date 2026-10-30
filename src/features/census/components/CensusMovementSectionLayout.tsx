import React from 'react';
import clsx from 'clsx';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';

interface CensusMovementSectionLayoutProps {
  title: string;
  emptyMessage: string;
  icon: React.ReactNode;
  iconClassName: string;
  itemCount: number;
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
  itemCount,
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
    <div
      className={clsx(
        'census-movement-heading flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-slate-50 px-3 py-1.5',
        itemCount > 0 && 'border-b border-slate-200'
      )}
    >
      <div className="flex items-center gap-2">
        <div className={clsx('rounded-md p-1', iconClassName)}>{icon}</div>
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <h2 className="text-sm font-semibold text-slate-800 leading-tight">{title}</h2>
          <span
            className="text-xs tabular-nums text-slate-500"
            aria-label={`${itemCount} ${itemCount === 1 ? 'registro' : 'registros'} en esta sección`}
            title="Cantidad de registros mostrados"
          >
            · {itemCount}
          </span>
          {subtitle ? (
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>
      {itemCount === 0 && <p className="text-xs text-slate-500">{emptyMessage}</p>}
    </div>

    <div>
      {itemCount > 0 && (
        <div
          className="census-movement-table-scroll overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label={title}
        >
          <table
            className={clsx(
              'w-full text-left text-sm [&_td]:px-3 [&_td]:align-middle [&_td]:break-words print:text-xs',
              tableClassName
            )}
          >
            <thead className="border-b border-slate-200 bg-slate-50/50 text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-500">
              <tr>
                {headers.map(header => (
                  <th
                    key={header.label}
                    scope="col"
                    className={clsx('px-3 py-2', header.className)}
                  >
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
