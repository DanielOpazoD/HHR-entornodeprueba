import React from 'react';
import { Baby, User, Users } from 'lucide-react';
import clsx from 'clsx';
import type { DischargeTarget } from '@/features/census/types/censusActionTypes';

interface DischargeTargetSelectorProps {
  target: DischargeTarget;
  onChange: (target: DischargeTarget) => void;
}

export const DischargeTargetSelector: React.FC<DischargeTargetSelectorProps> = ({
  target,
  onChange,
}) => (
  <div className="space-y-2">
    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
      ¿A quién dar de alta?
    </label>
    <div className="grid grid-cols-3 gap-2">
      <button
        type="button"
        onClick={() => onChange('mother')}
        className={clsx(
          'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all',
          target === 'mother'
            ? 'border-pink-400 bg-pink-50 text-pink-700'
            : 'border-slate-200 hover:border-slate-300 text-slate-500'
        )}
      >
        <User size={20} />
        <span className="text-[10px] font-bold">Solo Madre</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('baby')}
        className={clsx(
          'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all',
          target === 'baby'
            ? 'border-purple-400 bg-purple-50 text-purple-700'
            : 'border-slate-200 hover:border-slate-300 text-slate-500'
        )}
      >
        <Baby size={20} />
        <span className="text-[10px] font-bold">Solo RN</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('both')}
        className={clsx(
          'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all',
          target === 'both'
            ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
            : 'border-slate-200 hover:border-slate-300 text-slate-500'
        )}
      >
        <Users size={20} />
        <span className="text-[10px] font-bold">Ambos</span>
      </button>
    </div>
    {target === 'mother' && (
      <p className="text-[10px] text-pink-600 bg-pink-50 px-2 py-1 rounded-lg">
        El RN pasará a ser el paciente principal de esta cama.
      </p>
    )}
    {target === 'baby' && (
      <p className="text-[10px] text-purple-600 bg-purple-50 px-2 py-1 rounded-lg">
        La madre permanecerá en la cama. La cuna clínica se eliminará.
      </p>
    )}
  </div>
);
