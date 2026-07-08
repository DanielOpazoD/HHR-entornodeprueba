import React from 'react';

import type { SpecialtyBreakdownSortKey } from '@/features/analytics/controllers/specialtyBreakdownTableController';

interface SpecialtyBreakdownSortHeaderProps {
  label: string;
  column: SpecialtyBreakdownSortKey;
  sortKey: SpecialtyBreakdownSortKey;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SpecialtyBreakdownSortKey) => void;
  className?: string;
  ariaLabel?: string;
}

export const SpecialtyBreakdownSortHeader: React.FC<SpecialtyBreakdownSortHeaderProps> = ({
  label,
  column,
  sortKey,
  sortDirection,
  onSort,
  className = '',
  ariaLabel,
}) => (
  <button
    type="button"
    className={`inline-flex items-center justify-center gap-1 text-inherit font-semibold hover:text-sky-700 ${className}`}
    onClick={() => onSort(column)}
    aria-label={`Ordenar por ${(ariaLabel || label).toLowerCase()}`}
  >
    {label}
    <span className="text-[10px] text-slate-400">
      {sortKey === column ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
    </span>
  </button>
);
