import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import type { SpecialtyGroupingMode } from '@/types/minsalTypes';
import type { AnalyticsMovementReclassificationRow } from '@/features/analytics/controllers/analyticsSpecialtyReclassificationController';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

interface SpecialtyReportingControlsProps {
  groupingMode: SpecialtyGroupingMode;
  rows: AnalyticsMovementReclassificationRow[];
  canEdit?: boolean;
  isSaving?: boolean;
  onGroupingModeChange: (mode: SpecialtyGroupingMode) => void;
  onReclassificationChange: (
    row: AnalyticsMovementReclassificationRow,
    specialty: string
  ) => void | Promise<void>;
}

const MOVEMENT_LABELS: Record<AnalyticsMovementReclassificationRow['movementKind'], string> = {
  discharge: 'Alta',
  transfer: 'Traslado',
  cma: 'CMA',
};

const buttonClass = (active: boolean): string =>
  [
    'px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors',
    active ? 'bg-sky-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
  ].join(' ');

export const SpecialtyReportingControls: React.FC<SpecialtyReportingControlsProps> = ({
  groupingMode,
  rows,
  canEdit = false,
  isSaving = false,
  onGroupingModeChange,
  onReclassificationChange,
}) => (
  <section className="bg-white p-5 rounded-lg shadow-sm border border-slate-200">
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
      <div className="space-y-3">
        <h3 className="font-bold text-slate-700 flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-sky-600" />
          Especialidades estadísticas
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass(groupingMode === 'detailed')}
            aria-pressed={groupingMode === 'detailed'}
            onClick={() => onGroupingModeChange('detailed')}
          >
            Detalle
          </button>
          <button
            type="button"
            className={buttonClass(groupingMode === 'group-other')}
            aria-pressed={groupingMode === 'group-other'}
            onClick={() => onGroupingModeChange('group-other')}
          >
            Agrupar otras
          </button>
        </div>
      </div>

      <div className="w-full lg:max-w-3xl">
        <h4 className="text-sm font-bold text-slate-700 mb-2">Reclasificación estadística</h4>
        {rows.length > 0 ? (
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Fecha</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Tipo</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Paciente</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Original</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Estadística</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(row => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                      {formatDateDDMMYYYY(row.date)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {MOVEMENT_LABELS[row.movementKind]}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{row.patientName}</td>
                    <td className="px-3 py-2 text-slate-600">{row.originalSpecialty}</td>
                    <td className="px-3 py-2">
                      <select
                        className="w-full min-w-40 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                        value={
                          row.reportingSpecialtySource === 'manual' ? row.reportingSpecialty : ''
                        }
                        onChange={event => onReclassificationChange(row, event.target.value)}
                        disabled={!canEdit || isSaving}
                        aria-label={`Reclasificar ${row.patientName}`}
                      >
                        <option value="">Sin cambio</option>
                        {SPECIALTY_OPTIONS.map(option => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
            Sin movimientos para reclasificar en el período seleccionado.
          </div>
        )}
      </div>
    </div>
  </section>
);

export default SpecialtyReportingControls;
