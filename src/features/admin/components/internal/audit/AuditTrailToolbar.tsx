import React from 'react';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';
import type { AuditTrailArea, AuditTrailGrouping } from '@/types/auditTrailTypes';
import {
  AUDIT_TRAIL_AREA_LABELS,
  AUDIT_TRAIL_AREA_ORDER,
  AUDIT_TRAIL_GROUPING_LABELS,
  AUDIT_TRAIL_GROUPING_ORDER,
} from '@/services/admin/auditTrail/auditTrailCatalog';
import type { AuditTrailActorOption } from '@/services/admin/auditTrail/auditTrailFilters';
import type { AuditTrailViewPreferences } from '@/services/admin/auditTrail/auditTrailPreferences';
import type { AuditTrailScope } from '@/features/admin/hooks/useAuditTrail';
import { AuditTrailViewSettings } from './AuditTrailViewSettings';
import { FOCUS_RING } from './auditTrailDisplay';

interface AuditTrailToolbarProps {
  scope: AuditTrailScope;
  onScopeChange: (patch: Partial<AuditTrailScope>) => void;
  actorOptions: AuditTrailActorOption[];
  preferences: AuditTrailViewPreferences;
  onPreferencesChange: (patch: Partial<AuditTrailViewPreferences>) => void;
}

const selectClassName = clsx(
  'h-8 max-w-[220px] rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700',
  FOCUS_RING
);

export const AuditTrailToolbar: React.FC<AuditTrailToolbarProps> = ({
  scope,
  onScopeChange,
  actorOptions,
  preferences,
  onPreferencesChange,
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
      role="group"
      aria-label="Agrupar por"
    >
      {AUDIT_TRAIL_GROUPING_ORDER.map(grouping => (
        <button
          key={grouping}
          type="button"
          aria-pressed={preferences.grouping === grouping}
          onClick={() => onPreferencesChange({ grouping: grouping as AuditTrailGrouping })}
          className={clsx(
            'rounded-md px-2.5 py-1 text-xs font-medium transition',
            FOCUS_RING,
            preferences.grouping === grouping
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {AUDIT_TRAIL_GROUPING_LABELS[grouping]}
        </button>
      ))}
    </div>

    <label className="relative min-w-[220px] flex-1">
      <span className="sr-only">Buscar</span>
      <Search
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        type="search"
        value={scope.search}
        onChange={event => onScopeChange({ search: event.target.value })}
        placeholder="Paciente, RUT, cama o funcionario"
        className={clsx(
          'h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-xs text-slate-800 placeholder:text-slate-400',
          FOCUS_RING
        )}
      />
      {scope.search && (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          onClick={() => onScopeChange({ search: '' })}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
        >
          <X size={14} />
        </button>
      )}
    </label>

    <select
      aria-label="Funcionario"
      value={scope.actorKey ?? ''}
      onChange={event => onScopeChange({ actorKey: event.target.value || undefined })}
      className={selectClassName}
    >
      <option value="">Todos los funcionarios</option>
      {actorOptions.map(option => (
        <option key={option.key} value={option.key}>
          {option.name} ({option.count})
        </option>
      ))}
    </select>

    <select
      aria-label="Área"
      value={scope.area ?? ''}
      onChange={event =>
        onScopeChange({ area: (event.target.value || undefined) as AuditTrailArea | undefined })
      }
      className={selectClassName}
    >
      <option value="">Todas las áreas</option>
      {AUDIT_TRAIL_AREA_ORDER.map(area => (
        <option key={area} value={area}>
          {AUDIT_TRAIL_AREA_LABELS[area]}
        </option>
      ))}
    </select>

    <AuditTrailViewSettings preferences={preferences} onChange={onPreferencesChange} />
  </div>
);
