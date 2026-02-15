import React from 'react';
import clsx from 'clsx';
import type { DischargeStatus } from '@/constants';

interface DischargeStatusRadioGroupProps {
  inputName: string;
  label: string;
  status: DischargeStatus | undefined;
  onChange: (status: DischargeStatus) => void;
}

export const DischargeStatusRadioGroup: React.FC<DischargeStatusRadioGroupProps> = ({
  inputName,
  label,
  status,
  onChange,
}) => (
  <div className="space-y-1.5">
    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
      {label}
    </label>
    <div className="flex gap-6 pl-1">
      <label className="flex items-center gap-2 cursor-pointer group">
        <input
          type="radio"
          name={inputName}
          value="Vivo"
          checked={status === 'Vivo'}
          onChange={() => onChange('Vivo')}
          className="w-4 h-4 text-emerald-600 focus:ring-emerald-500/20"
        />
        <span
          className={clsx(
            'text-sm transition-colors',
            status === 'Vivo'
              ? 'font-bold text-slate-900'
              : 'text-slate-500 group-hover:text-slate-700'
          )}
        >
          Vivo
        </span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer group">
        <input
          type="radio"
          name={inputName}
          value="Fallecido"
          checked={status === 'Fallecido'}
          onChange={() => onChange('Fallecido')}
          className="w-4 h-4 text-red-600 focus:ring-red-500/20"
        />
        <span
          className={clsx(
            'text-sm transition-colors',
            status === 'Fallecido'
              ? 'font-bold text-slate-900'
              : 'text-slate-500 group-hover:text-slate-700'
          )}
        >
          Fallecido
        </span>
      </label>
    </div>
  </div>
);
