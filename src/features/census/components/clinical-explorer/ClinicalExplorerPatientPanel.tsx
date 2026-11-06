import React, { useState } from 'react';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import {
  filterClinicalExplorerPatients,
  type ClinicalExplorerPatient,
} from '@/features/census/controllers/clinicalExplorerController';
import { StatusDot } from './clinicalExplorerUi';

interface ClinicalExplorerPatientPanelProps {
  patients: ClinicalExplorerPatient[];
  selectedBedId: string;
  onSelect: (bedId: string) => void;
}

/** Patients of the census day in bed order. The bed is where the patient is, not who they are. */
export const ClinicalExplorerPatientPanel: React.FC<ClinicalExplorerPatientPanelProps> = ({
  patients,
  selectedBedId,
  onSelect,
}) => {
  const [query, setQuery] = useState('');
  const visible = filterClinicalExplorerPatients(patients, query);
  return (
    <aside
      aria-label="Pacientes del censo"
      className="flex w-full self-start lg:row-start-2 max-h-[calc(100vh-var(--hhr-chrome-height)-5.5rem)] min-h-0 flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white lg:sticky lg:top-[calc(var(--hhr-chrome-height)+4rem)]"
    >
      <div className="flex flex-col gap-2 border-b border-slate-100 px-3 pb-2 pt-2.5">
        <div className="flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-700">
          Pacientes
          <span className="ml-auto rounded bg-slate-50 px-1.5 text-[10px] font-semibold normal-case text-slate-500">
            {query ? `${visible.length} de ${patients.length}` : patients.length}
          </span>
        </div>
        <label className="relative block">
          <Search
            size={13}
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Nombre, RUT o cama"
            aria-label="Buscar paciente del censo"
            className="h-8 w-full rounded-md border border-slate-200 bg-slate-50/60 pl-7 pr-2 text-[12px] text-slate-800 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
          />
        </label>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Lista de pacientes">
        {visible.map(patient => {
          const selected = patient.bedId === selectedBedId;
          return (
            <li key={patient.bedId}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(patient.bedId)}
                className={clsx(
                  'grid w-full grid-cols-[48px_minmax(0,1fr)] items-center gap-x-2 border-l-2 px-2.5 py-1 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-700',
                  selected ? 'border-l-medical-600 bg-medical-50' : 'border-l-transparent'
                )}
              >
                <span className="flex items-center gap-1 whitespace-nowrap font-display text-[13px] font-bold text-slate-800">
                  <StatusDot status={patient.data.status} className="size-2" />
                  {patient.bedId}
                </span>
                <span className="truncate text-[11.5px] font-semibold uppercase text-slate-700">
                  {patient.data.patientName.trim()}
                </span>
                <span className="col-start-2 whitespace-nowrap text-[10px] tabular-nums text-slate-500">
                  {patient.data.rut.trim()}
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-3 py-4 text-[11px] italic text-slate-500">
            Ningún paciente del censo coincide con la búsqueda.
          </li>
        )}
      </ul>
    </aside>
  );
};
