import React from 'react';
import { Search } from 'lucide-react';

import { AuditSkeleton } from '@/components/shared/Skeleton';

interface AuditWindowStatusProps {
  fetchLimit: number;
}

interface AuditTableLoadingStateProps {
  colSpan: number;
}

interface AuditTableEmptyStateProps {
  colSpan: number;
  title: string;
  detail: string;
}

export const AuditWindowStatus: React.FC<AuditWindowStatusProps> = ({ fetchLimit }) => (
  <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500">
    Ventana cargada: {fetchLimit} registros
  </span>
);

export const AuditTableLoadingState: React.FC<AuditTableLoadingStateProps> = ({ colSpan }) => (
  <tr>
    <td colSpan={colSpan} className="p-4">
      <p className="mb-3 text-xs font-semibold text-slate-500" aria-live="polite">
        Cargando registros de auditoría...
      </p>
      <AuditSkeleton entries={10} />
    </td>
  </tr>
);

export const AuditTableEmptyState: React.FC<AuditTableEmptyStateProps> = ({
  colSpan,
  title,
  detail,
}) => (
  <tr>
    <td colSpan={colSpan} className="px-4 py-20 text-center">
      <div className="flex flex-col items-center gap-3 opacity-30">
        <Search size={48} className="text-slate-300" />
        <p className="text-slate-500 font-bold">{title}</p>
        <p className="max-w-md text-xs font-semibold text-slate-500">{detail}</p>
      </div>
    </td>
  </tr>
);
