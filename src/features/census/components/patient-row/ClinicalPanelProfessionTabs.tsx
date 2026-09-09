import React from 'react';
import clsx from 'clsx';
import type { EvolutionProfession } from '@/features/rayen-import';

export const ClinicalPanelProfessionTabs: React.FC<{
  selected: EvolutionProfession | 'antecedents';
  onSelect: (value: EvolutionProfession | 'antecedents') => void;
  count: (value: EvolutionProfession) => number;
  children: React.ReactNode;
}> = ({ selected, onSelect, count, children }) => (
  <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
    {(['medical', 'antecedents', 'nursing', 'other'] as const).map(key => (
      <button
        key={key}
        type="button"
        onClick={() => onSelect(key)}
        aria-label={`${{ medical: 'Médico', antecedents: 'Antecedentes', nursing: 'Enfermería', other: 'Otros' }[key]}${key === 'antecedents' ? '' : ` (${count(key)})`}`}
        aria-pressed={selected === key}
        className={clsx(
          'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700',
          selected === key
            ? 'bg-medical-100 text-medical-700 ring-1 ring-medical-200'
            : 'text-slate-500 hover:bg-slate-100'
        )}
      >
        {
          { medical: 'Médico', antecedents: 'Antecedentes', nursing: 'Enfermería', other: 'Otros' }[
            key
          ]
        }
        {key !== 'antecedents' && (
          <span className="ml-1 text-[9px] font-bold opacity-60">{count(key)}</span>
        )}
      </button>
    ))}
    {children}
  </div>
);
