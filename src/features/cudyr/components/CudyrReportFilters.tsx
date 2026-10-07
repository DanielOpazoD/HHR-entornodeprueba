import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import {
  CUDYR_GROUP_LABELS,
  CUDYR_MODALITY_LABELS,
  CUDYR_ELIGIBILITY_LABELS,
  CUDYR_STATUS_LABELS,
  EMPTY_CUDYR_REPORT_FILTERS,
  type CudyrReportFilters as Filters,
} from '@/services/cudyr/cudyrReportPresentation';

export const CudyrReportFilters = ({
  rows,
  filters,
  onChange,
}: {
  rows: CudyrReportRow[];
  filters: Filters;
  onChange: (next: Filters) => void;
}) => {
  const set = (field: keyof Filters, value: string) => onChange({ ...filters, [field]: value });
  const options: Array<[keyof Filters, string, Record<string, string>]> = [
    [
      'bed',
      'Cama',
      Object.fromEntries(
        [...new Set(rows.map(row => row.bedId).filter(Boolean))].sort().map(id => [id, id])
      ),
    ],
    [
      'service',
      'Servicio',
      Object.fromEntries(
        [...new Set(rows.map(row => row.service).filter(Boolean))].sort().map(id => [id, id])
      ),
    ],
    ['group', 'Grupo de camas', CUDYR_GROUP_LABELS],
    ['modality', 'Modalidad', CUDYR_MODALITY_LABELS],
    ['eligibility', 'Elegibilidad', CUDYR_ELIGIBILITY_LABELS],
    ['status', 'Estado CUDYR', CUDYR_STATUS_LABELS],
  ];
  return (
    <div
      role="search"
      aria-label="Filtrar reporte CUDYR"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-52 flex-1 text-sm font-medium text-slate-700">
          Buscar paciente, RUT, diagnóstico o episodio
          <input
            type="search"
            value={filters.search}
            onChange={e => set('search', e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Nombre o RUT"
          />
        </label>
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_CUDYR_REPORT_FILTERS })}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          Limpiar filtros
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {options.map(([field, label, values]) => (
          <label key={field} className="text-xs font-medium text-slate-600">
            {label}
            <select
              value={filters[field]}
              onChange={e => set(field, e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
            >
              <option value="">Todos</option>
              {Object.entries(values).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
};
