import React from 'react';
import { UserRound, UserRoundCheck } from 'lucide-react';

interface HandoffStaffSelectorProps {
  label: string;
  type: 'delivers' | 'receives';
  bgClass?: string;
  selectedNurses: string[];
  availableNurses: string[];
  onUpdate: (updatedList: string[]) => void;
  readOnly?: boolean;
  /** Compact mode: horizontal inline layout */
  compact?: boolean;
}

export const HandoffStaffSelector: React.FC<HandoffStaffSelectorProps> = ({
  label,
  type,
  bgClass = 'bg-white',
  selectedNurses = [],
  availableNurses = [],
  onUpdate,
  readOnly = false,
  compact = false,
}) => {
  // Ensure we always have at least 2 slots
  const nurse1 = selectedNurses[0] || '';
  const nurse2 = selectedNurses[1] || '';
  // Historical signatures remain visible even after their catalog entry changes.
  const nurseOptions = (selected: string) => [
    ...new Set([...availableNurses, selected].filter(Boolean)),
  ];

  const handleChange = (index: number, value: string) => {
    const newList = [...selectedNurses];
    if (!newList[0]) newList[0] = '';
    if (!newList[1]) newList[1] = '';

    newList[index] = value;
    onUpdate(newList);
  };

  const Icon = type === 'delivers' ? UserRound : UserRoundCheck;
  const iconColor = type === 'delivers' ? 'text-slate-500' : 'text-teal-600';

  if (compact) {
    // Compact horizontal layout - single row
    return (
      <div
        className={`grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 ${bgClass}`}
      >
        <div className={`flex items-center gap-1.5 ${iconColor}`}>
          <Icon size={14} className="shrink-0" aria-hidden="true" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
            {label}
          </span>
        </div>
        <select
          className="h-8 w-full min-w-0 text-xs px-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:outline-none bg-white disabled:bg-slate-50 disabled:text-slate-500"
          aria-label={`${label}: enfermería 1`}
          value={nurse1}
          onChange={e => handleChange(0, e.target.value)}
          disabled={readOnly}
        >
          <option value="">--</option>
          {nurseOptions(nurse1).map(n => (
            <option key={`n1-${n}`} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select
          className="h-8 w-full min-w-0 text-xs px-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:outline-none bg-white disabled:bg-slate-50 disabled:text-slate-500"
          aria-label={`${label}: enfermería 2`}
          value={nurse2}
          onChange={e => handleChange(1, e.target.value)}
          disabled={readOnly}
        >
          <option value="">--</option>
          {nurseOptions(nurse2).map(n => (
            <option key={`n2-${n}`} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Original vertical layout
  return (
    <div className={`p-3 rounded-lg border border-slate-200 ${bgClass}`}>
      <h4 className="text-xs font-bold uppercase text-slate-500 mb-2 flex items-center gap-2">
        <Icon size={14} aria-hidden="true" />
        {label}
      </h4>
      <div className="flex flex-col gap-2">
        <select
          className="h-8 w-full min-w-0 text-xs px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:outline-none bg-white disabled:bg-slate-50 disabled:text-slate-500"
          aria-label={`${label}: enfermería 1`}
          value={nurse1}
          onChange={e => handleChange(0, e.target.value)}
          disabled={readOnly}
        >
          <option value="">-- Seleccionar --</option>
          {nurseOptions(nurse1).map(n => (
            <option key={`n1-${n}`} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select
          className="h-8 w-full min-w-0 text-xs px-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:outline-none bg-white disabled:bg-slate-50 disabled:text-slate-500"
          aria-label={`${label}: enfermería 2`}
          value={nurse2}
          onChange={e => handleChange(1, e.target.value)}
          disabled={readOnly}
        >
          <option value="">-- Seleccionar --</option>
          {nurseOptions(nurse2).map(n => (
            <option key={`n2-${n}`} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
