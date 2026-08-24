import React from 'react';
import { AlertTriangle, Check, CircleHelp, Clock3 } from 'lucide-react';
import type { LabTrendFocusResult } from '../controllers/labTrendFilterController';
import { formatLabTrendValue } from './LabTrendChartHelpers';

interface LabTrendFocusStripProps {
  activeDate: string | null;
  results: LabTrendFocusResult[];
}

const resolvePointStatus = ({
  point,
}: LabTrendFocusResult): 'Alto' | 'Bajo' | 'Normal' | 'Sin referencia' => {
  if (point.refMin != null && point.value < point.refMin) return 'Bajo';
  if (point.refMax != null && point.value > point.refMax) return 'Alto';
  if (point.refMin == null && point.refMax == null) return 'Sin referencia';
  return 'Normal';
};

export const LabTrendFocusStrip: React.FC<LabTrendFocusStripProps> = ({ activeDate, results }) => {
  if (!activeDate || results.length === 0) return null;

  return (
    <div
      role="status"
      aria-label={`Resultados graficados del ${activeDate}`}
      className="mb-3 rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-3 py-2"
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-900">
          <Clock3 size={13} aria-hidden="true" />
          {activeDate}
        </span>
        <span className="text-[10px] font-medium text-emerald-700/80">
          {results.length} resultados graficados
        </span>
      </div>
      <div className="flex max-w-full gap-1.5 overflow-x-auto pb-0.5">
        {results.map(result => {
          const status = resolvePointStatus(result);
          return (
            <span
              key={result.analysis}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/90 bg-white px-2 py-1 shadow-sm"
            >
              {result.isAbnormal ? (
                <AlertTriangle size={11} aria-hidden="true" className="text-amber-600" />
              ) : status === 'Sin referencia' ? (
                <CircleHelp size={11} aria-hidden="true" className="text-slate-400" />
              ) : (
                <Check size={11} aria-hidden="true" className="text-emerald-600" />
              )}
              <span className="text-[10px] font-semibold text-slate-600">{result.analysis}</span>
              <span className="text-[11px] font-bold tabular-nums text-slate-900">
                {formatLabTrendValue(result.point.value)}
              </span>
              <span className="text-[9px] text-slate-500">{result.point.unit}</span>
              <span
                className={
                  result.isAbnormal
                    ? 'text-[9px] font-bold text-amber-700'
                    : status === 'Sin referencia'
                      ? 'text-[9px] font-semibold text-slate-500'
                      : 'text-[9px] font-semibold text-emerald-700'
                }
              >
                {status}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
