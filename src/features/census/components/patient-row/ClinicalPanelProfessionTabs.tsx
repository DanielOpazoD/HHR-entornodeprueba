import React from 'react';
import clsx from 'clsx';
import type { EvolutionProfession } from '@/features/rayen-import';

export const ClinicalPanelProfessionTabs: React.FC<{
  selected: EvolutionProfession;
  onSelect: (value: EvolutionProfession) => void;
  count: (value: EvolutionProfession) => number;
  view: 'notes' | 'handoffs';
  onViewChange: (view: 'notes' | 'handoffs') => void;
  notesCount: number;
  handoffsCount: number;
  children: React.ReactNode;
}> = ({ selected, onSelect, count, view, onViewChange, notesCount, handoffsCount, children }) => (
  <div
    className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1"
    role="group"
    aria-label="Filtrar evoluciones"
  >
    {(['medical', 'nursing', 'other'] as const).map(key => (
      <button
        key={key}
        type="button"
        onClick={() => onSelect(key)}
        aria-label={`${{ medical: 'Médico', nursing: 'Enfermería', other: 'Otros' }[key]} (${count(key)})`}
        aria-pressed={selected === key}
        className={clsx(
          'shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700',
          selected === key ? 'bg-medical-50 text-medical-800' : 'text-slate-500 hover:bg-slate-100'
        )}
      >
        {{ medical: 'Médico', nursing: 'Enfermería', other: 'Otros' }[key]}
        <span className="ml-1 hidden text-[9px] font-bold opacity-60 min-[400px]:inline">
          {count(key)}
        </span>
      </button>
    ))}
    {selected !== 'other' && (
      <div
        className="ml-1 flex shrink-0 items-center gap-0.5 border-l border-slate-200 pl-2"
        role="group"
        aria-label="Tipo de evolución"
      >
        {[
          { key: 'notes' as const, label: 'Notas', count: notesCount },
          { key: 'handoffs' as const, label: 'Entregas', count: handoffsCount },
        ].map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => onViewChange(item.key)}
            aria-label={`${item.label} (${item.count})`}
            aria-pressed={view === item.key}
            className={clsx(
              'shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700',
              view === item.key
                ? 'bg-slate-100 text-slate-800'
                : 'text-slate-500 hover:bg-slate-100'
            )}
          >
            {item.label}
            <span className="ml-1 hidden text-[9px] opacity-60 min-[400px]:inline">
              {item.count}
            </span>
          </button>
        ))}
      </div>
    )}
    {children}
  </div>
);
