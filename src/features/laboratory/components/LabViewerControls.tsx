/**
 * LabViewerControls
 *
 * Patient selector and search controls for the laboratory results viewer.
 *
 * Two search modes:
 *  1. **Bed selector** (default) — dropdown of patients currently in census beds,
 *     deduplicated by RUT. Selecting a patient sets the RUT for the search.
 *  2. **Manual RUT** — toggled via "Buscar por RUT externo". Free-text input
 *     for searching lab results of patients not in census (discharged, external).
 *     Supports Enter key and a dedicated "Buscar RUT" button.
 *
 * Selecting from the bed dropdown automatically exits manual mode.
 */

import React, { useCallback, useState } from 'react';
import { Loader2, Search, UserSearch } from 'lucide-react';
import type { LabPatient } from '@/types/domain/labExamTypes';

interface LabViewerControlsProps {
  uniquePatients: LabPatient[];
  selectedRut: string;
  isLoading: boolean;
  onPatientChange: (rut: string) => void;
  onSearch: () => void;
}

export const LabViewerControls: React.FC<LabViewerControlsProps> = ({
  uniquePatients,
  selectedRut,
  isLoading,
  onPatientChange,
  onSearch,
}) => {
  const [manualRut, setManualRut] = useState('');
  const [isManualMode, setIsManualMode] = useState(false);

  const handleManualSearch = useCallback(() => {
    const trimmed = manualRut.trim();
    if (!trimmed) return;
    onPatientChange(trimmed);
    // Trigger search after setting the RUT
    setTimeout(() => onSearch(), 50);
  }, [manualRut, onPatientChange, onSearch]);

  const handleManualKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleManualSearch();
      }
    },
    [handleManualSearch]
  );

  return (
    <div className="mb-2 space-y-1.5">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <select
            aria-label="Paciente"
            value={selectedRut}
            onChange={e => {
              setIsManualMode(false);
              onPatientChange(e.target.value);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-700 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
          >
            {uniquePatients.map(patient => (
              <option key={patient.bedId} value={patient.rut}>
                {patient.label} ({patient.rut})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={onSearch}
          disabled={!selectedRut || isLoading}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm shadow-teal-600/20 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Buscar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIsManualMode(prev => !prev)}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 transition-colors hover:text-slate-600"
        >
          <UserSearch size={12} />
          {isManualMode ? 'Ocultar búsqueda manual' : 'Buscar por RUT externo'}
        </button>
      </div>

      {isManualMode ? (
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="relative min-w-0">
            <UserSearch
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              aria-label="RUT externo"
              type="text"
              value={manualRut}
              onChange={e => setManualRut(e.target.value)}
              onKeyDown={handleManualKeyDown}
              placeholder="Ej: 12.345.678-9"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[12px] text-slate-700 placeholder:text-slate-400 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
            />
          </div>
          <button
            onClick={handleManualSearch}
            disabled={!manualRut.trim() || isLoading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 transition-all hover:bg-emerald-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Buscar RUT
          </button>
        </div>
      ) : null}
    </div>
  );
};
