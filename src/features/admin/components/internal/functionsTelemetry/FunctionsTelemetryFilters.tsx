import React from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type {
  FunctionsTelemetryFilters as FiltersShape,
  TelemetryStatus,
} from '@/features/admin/types/functionsTelemetry';

interface Props {
  filters: FiltersShape;
  availableServices: string[];
  onChange: (next: FiltersShape) => void;
  onRefresh: () => void;
  loading: boolean;
}

const STATUS_OPTIONS: Array<{ value: TelemetryStatus; label: string }> = [
  { value: 'success', label: 'Éxito' },
  { value: 'failure', label: 'Falla' },
  { value: 'timeout', label: 'Timeout' },
];

const SINCE_PRESETS: Array<{ value: string; label: string; hours: number }> = [
  { value: '1h', label: 'Última hora', hours: 1 },
  { value: '24h', label: 'Últimas 24h', hours: 24 },
  { value: '7d', label: 'Últimos 7 días', hours: 24 * 7 },
];

const sinceFromHours = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

export const FunctionsTelemetryFilters: React.FC<Props> = ({
  filters,
  availableServices,
  onChange,
  onRefresh,
  loading,
}) => {
  const activeSincePreset = SINCE_PRESETS.find(
    preset => filters.since === sinceFromHours(preset.hours)
  )?.value;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-slate-400" />
          <input
            type="text"
            placeholder="Buscar operación o error…"
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 focus:outline-none w-64"
            value={filters.search ?? ''}
            onChange={e => onChange({ ...filters, search: e.target.value || undefined })}
          />
        </div>

        <select
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white"
          value={filters.service ?? ''}
          onChange={e => onChange({ ...filters, service: e.target.value || undefined })}
        >
          <option value="">Todos los servicios</option>
          {availableServices.map(service => (
            <option key={service} value={service}>
              {service}
            </option>
          ))}
        </select>

        <select
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white"
          value={filters.status ?? ''}
          onChange={e =>
            onChange({
              ...filters,
              status: (e.target.value || undefined) as TelemetryStatus | undefined,
            })
          }
        >
          <option value="">Todos los estados</option>
          {STATUS_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          {SINCE_PRESETS.map(preset => (
            <button
              key={preset.value}
              type="button"
              onClick={() =>
                onChange({
                  ...filters,
                  since:
                    activeSincePreset === preset.value ? undefined : sinceFromHours(preset.hours),
                })
              }
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                activeSincePreset === preset.value
                  ? 'bg-medical-500 text-white border-medical-500'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>
    </div>
  );
};
