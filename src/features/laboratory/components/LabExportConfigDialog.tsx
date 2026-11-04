/**
 * @module LabExportConfigDialog
 * @description Configuration dialog for selecting dates and variables before Excel export.
 */

import React from 'react';
import clsx from 'clsx';
import type { ExportConfig } from '../types/labViewerTypes';
import { formatLabExamColumnLabel } from '../controllers/labDateDisplayController';

interface LabExportConfigDialogProps {
  dates: string[];
  variables: string[];
  includeTimeInColumns: boolean;
  onExport: (config: ExportConfig) => void;
  onCancel: () => void;
}

export const LabExportConfigDialog: React.FC<LabExportConfigDialogProps> = ({
  dates,
  variables,
  includeTimeInColumns,
  onExport,
  onCancel,
}) => {
  const [selectedDates, setSelectedDates] = React.useState<Set<string>>(new Set(dates));
  const [selectedVars, setSelectedVars] = React.useState<Set<string>>(new Set(variables));

  const toggleDate = (d: string) =>
    setSelectedDates(prev => {
      const n = new Set(prev);
      if (n.has(d)) {
        n.delete(d);
      } else {
        n.add(d);
      }
      return n;
    });
  const toggleVar = (v: string) =>
    setSelectedVars(prev => {
      const n = new Set(prev);
      if (n.has(v)) {
        n.delete(v);
      } else {
        n.add(v);
      }
      return n;
    });

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
      <h4 className="text-[12px] font-bold text-slate-700">Configurar exportacion Excel</h4>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
          Fechas ({selectedDates.size}/{dates.length})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {dates.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDate(d)}
              className={clsx(
                'rounded-lg px-2 py-1 text-[10px] font-medium border transition-colors',
                selectedDates.has(d)
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                  : 'bg-white text-slate-400 border-slate-200'
              )}
              title={d}
            >
              {formatLabExamColumnLabel(d, includeTimeInColumns)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
          Variables ({selectedVars.size}/{variables.length})
        </p>
        <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1.5">
          {variables.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => toggleVar(v)}
              className={clsx(
                'rounded-lg px-2 py-1 text-[10px] font-medium border transition-colors',
                selectedVars.has(v)
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                  : 'bg-white text-slate-400 border-slate-200'
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700"
        >
          Cancelar
        </button>
        <button
          onClick={() => onExport({ selectedDates, selectedVars, includeTimeInColumns })}
          disabled={selectedDates.size === 0 || selectedVars.size === 0}
          className="rounded-lg bg-teal-600 px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          Exportar Excel
        </button>
      </div>
    </div>
  );
};
