import React from 'react';
import clsx from 'clsx';
import { DISCHARGE_TYPES, DISCHARGE_TYPE_OTHER, type DischargeType } from '@/constants';

interface DischargeTypeSelectorProps {
  selectedType: DischargeType;
  otherDetails: string;
  otherError?: string;
  onTypeChange: (type: DischargeType) => void;
  onOtherDetailsChange: (value: string) => void;
}

export const DischargeTypeSelector: React.FC<DischargeTypeSelectorProps> = ({
  selectedType,
  otherDetails,
  otherError,
  onTypeChange,
  onOtherDetailsChange,
}) => (
  <div className="space-y-2.5 pt-2 border-l-2 border-emerald-50 pl-4 animate-fade-in">
    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
      Tipo de Alta
    </label>
    <div className="space-y-2">
      {DISCHARGE_TYPES.map(item => (
        <label key={item} className="flex items-center gap-2 cursor-pointer group">
          <input
            type="radio"
            name="dischargeType"
            checked={selectedType === item}
            onChange={() => onTypeChange(item)}
            className="w-4 h-4 text-emerald-600 focus:ring-emerald-500/20"
          />
          <span
            className={clsx(
              'text-sm transition-colors',
              selectedType === item
                ? 'font-medium text-slate-900'
                : 'text-slate-500 group-hover:text-slate-700'
            )}
          >
            {item === 'Domicilio (Habitual)' ? 'Alta a domicilio (Habitual)' : item}
          </span>
        </label>
      ))}
    </div>

    {selectedType === DISCHARGE_TYPE_OTHER && (
      <div className="pt-1 animate-fade-in">
        <input
          type="text"
          placeholder="Especifique motivo..."
          value={otherDetails}
          onChange={event => onOtherDetailsChange(event.target.value)}
          className={clsx(
            'w-full text-sm p-2 bg-slate-50 border rounded-lg focus:ring-2 focus:outline-none transition-all',
            otherError
              ? 'border-red-300 focus:ring-red-100'
              : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
          )}
          autoFocus
        />
        {otherError && (
          <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{otherError}</p>
        )}
      </div>
    )}
  </div>
);
