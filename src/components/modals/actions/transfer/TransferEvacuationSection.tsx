import React from 'react';
import clsx from 'clsx';
import {
  EVACUATION_METHODS,
  EVACUATION_METHOD_COMMERCIAL,
  EVACUATION_METHOD_OTHER,
  TRANSFER_ESCORT_OPTIONS,
  type EvacuationMethod,
} from '@/constants';

interface TransferEvacuationSectionProps {
  evacuationMethod: EvacuationMethod;
  evacuationMethodOther: string;
  transferEscort: string;
  isPredefinedEscort: boolean;
  evacuationOtherError?: string;
  escortError?: string;
  onEvacuationMethodChange: (value: string) => void;
  onEvacuationMethodOtherChange: (value: string) => void;
  onEscortSelectChange: (value: string) => void;
  onEscortValueChange: (value: string) => void;
}

export const TransferEvacuationSection: React.FC<TransferEvacuationSectionProps> = ({
  evacuationMethod,
  evacuationMethodOther,
  transferEscort,
  isPredefinedEscort,
  evacuationOtherError,
  escortError,
  onEvacuationMethodChange,
  onEvacuationMethodOtherChange,
  onEscortSelectChange,
  onEscortValueChange,
}) => (
  <div className="grid grid-cols-1 gap-4">
    <div className="space-y-1.5">
      <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
        Medio de Evacuación
      </label>
      <select
        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
        value={evacuationMethod}
        onChange={event => onEvacuationMethodChange(event.target.value)}
      >
        {EVACUATION_METHODS.map(method => (
          <option key={method} value={method}>
            {method}
          </option>
        ))}
      </select>
    </div>

    {evacuationMethod === EVACUATION_METHOD_COMMERCIAL && (
      <div className="space-y-1.5 pt-1 animate-fade-in border-l-2 border-blue-50 pl-4">
        <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
          Acompañante Vuelo Comercial
        </label>
        <div className="space-y-2">
          <select
            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all cursor-pointer"
            value={isPredefinedEscort ? transferEscort : 'Otro'}
            onChange={event => onEscortSelectChange(event.target.value)}
          >
            {TRANSFER_ESCORT_OPTIONS.map(escort => (
              <option key={escort} value={escort}>
                {escort}
              </option>
            ))}
            <option value="Otro">Otro / Mixto</option>
          </select>
          {!isPredefinedEscort && (
            <input
              type="text"
              className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all shadow-sm h-9"
              placeholder="Especifique..."
              value={transferEscort}
              onChange={event => onEscortValueChange(event.target.value)}
              autoFocus
            />
          )}
          {escortError && (
            <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{escortError}</p>
          )}
        </div>
      </div>
    )}

    {evacuationMethod === EVACUATION_METHOD_OTHER && (
      <div className="animate-fade-in space-y-1.5 border-l-2 border-blue-50 pl-4">
        <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
          Especifique Método
        </label>
        <input
          type="text"
          className={clsx(
            'w-full p-2 bg-white border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all',
            evacuationOtherError
              ? 'border-red-300 focus:ring-red-100'
              : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'
          )}
          value={evacuationMethodOther}
          onChange={event => onEvacuationMethodOtherChange(event.target.value)}
          placeholder="Nombre del método..."
          autoFocus
        />
        {evacuationOtherError && (
          <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{evacuationOtherError}</p>
        )}
      </div>
    )}
  </div>
);
