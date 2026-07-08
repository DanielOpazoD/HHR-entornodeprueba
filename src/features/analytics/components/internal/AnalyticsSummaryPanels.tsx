import React from 'react';

import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import type {
  AnalyticsDataQualityIssue,
  MinsalComparisonMetric,
  MinsalComparisonSummary,
  SpecialtyReclassification,
} from '@/types/minsalTypes';

const formatDelta = (value: number | null): string =>
  value === null ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

export const AnalyticsComparisonPanel: React.FC<{
  comparison: MinsalComparisonSummary | null;
}> = ({ comparison }) => (
  <div className="bg-white p-5 rounded-lg shadow-sm border border-slate-200">
    <h3 className="font-bold text-slate-700 mb-3">Comparación con período anterior</h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {comparison
        ? (
            [
              ['Ocupación', comparison.tasaOcupacion],
              ['Egresos', comparison.egresosTotal],
              ['Estada', comparison.promedioDiasEstada],
              ['CMA/PMA', comparison.cmaTotal],
              ['Mortalidad', comparison.mortalidadHospitalaria],
            ] as Array<[string, MinsalComparisonMetric]>
          ).map(([label, metric]) => (
            <div key={label} className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
              <div className="mt-1 text-xl font-bold text-slate-800">
                {formatDelta(metric.absoluteDelta)}
              </div>
              <div className="text-xs text-slate-500">
                {metric.previous === null
                  ? 'Sin período comparable'
                  : `${formatDelta(metric.relativeDelta)}%`}
              </div>
            </div>
          ))
        : null}
    </div>
  </div>
);

export const AnalyticsTraceabilityPanel: React.FC<{
  dataQualityIssues: AnalyticsDataQualityIssue[];
  reclassifications: SpecialtyReclassification[];
  onOpenCensusDate?: (date: string) => void;
}> = ({ dataQualityIssues, reclassifications, onOpenCensusDate }) => (
  <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
      <h3 className="font-bold text-slate-700 mb-3">Calidad de datos</h3>
      {dataQualityIssues.length > 0 ? (
        <div className="space-y-2">
          {dataQualityIssues.map(issue => (
            <button
              key={issue.id}
              type="button"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => issue.date && onOpenCensusDate?.(issue.date)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-800">{issue.title}</span>
                <span className="text-xs uppercase text-slate-500">{issue.severity}</span>
              </div>
              <div className="text-sm text-slate-500">{issue.description}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Sin alertas de calidad para el período.
        </div>
      )}
    </div>

    <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
      <h3 className="font-bold text-slate-700 mb-3">Reclasificaciones vigentes</h3>
      {reclassifications.length > 0 ? (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {reclassifications.map(item => (
            <div
              key={`${item.date}-${item.movementKind}-${item.movementId}`}
              className="px-3 py-2 text-sm"
            >
              <div className="font-semibold text-slate-800">{String(item.specialty)}</div>
              <div className="text-slate-500">
                {formatDateDDMMYYYY(item.date || '')} · {item.movementKind} · {item.movementId}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          Sin reclasificaciones vigentes.
        </div>
      )}
    </div>
  </section>
);
