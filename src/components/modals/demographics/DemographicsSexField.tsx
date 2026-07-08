import React from 'react';
import clsx from 'clsx';
import { BiologicalSex, LocalDemographicsState } from './types';

interface DemographicsSexFieldProps {
  localData: LocalDemographicsState;
  setLocalData: React.Dispatch<React.SetStateAction<LocalDemographicsState>>;
  isMissingRequired: boolean;
}

export const DemographicsSexField: React.FC<DemographicsSexFieldProps> = ({
  localData,
  setLocalData,
  isMissingRequired,
}) => (
  <div className="space-y-1">
    <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
      Sexo Biológico
    </label>
    <div
      role="group"
      aria-label="Sexo biológico"
      aria-invalid={isMissingRequired || undefined}
      className={clsx(
        'flex gap-2 rounded-lg border p-0.5 transition-colors',
        isMissingRequired ? 'border-amber-300 bg-amber-50/60' : 'border-transparent'
      )}
    >
      {(['Masculino', 'Femenino', 'Indeterminado'] as const).map(sex => (
        <label
          key={sex}
          className={clsx(
            'cursor-pointer px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all border select-none flex-1 text-center',
            localData.biologicalSex === sex
              ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm'
              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
          )}
        >
          <input
            type="radio"
            name="biologicalSex"
            className="sr-only"
            checked={localData.biologicalSex === sex}
            onChange={() =>
              setLocalData(current => ({ ...current, biologicalSex: sex as BiologicalSex }))
            }
          />
          {sex === 'Masculino' ? 'M' : sex === 'Femenino' ? 'F' : '?'}
          <span className="hidden sm:inline sm:ml-1 text-[9px] font-normal opacity-80">
            {sex === 'Indeterminado' ? '' : sex.slice(1)}
          </span>
        </label>
      ))}
    </div>
  </div>
);
