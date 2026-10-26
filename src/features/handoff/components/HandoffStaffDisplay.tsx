import React from 'react';
import { UserRound, UserRoundCheck } from 'lucide-react';

interface HandoffStaffDisplayProps {
  label: string;
  type: 'delivers' | 'receives';
  nurses: string[];
  /** Compact mode: horizontal inline layout */
  compact?: boolean;
}

/**
 * Read-only display for nurse names inherited from the daily census.
 * This differs from HandoffStaffSelector in that it does NOT render dropdowns,
 * avoiding user confusion when values are not editable from this view.
 */
export const HandoffStaffDisplay: React.FC<HandoffStaffDisplayProps> = ({
  label,
  type,
  nurses = [],
  compact = false,
}) => {
  const Icon = type === 'delivers' ? UserRound : UserRoundCheck;
  const iconColor = type === 'delivers' ? 'text-slate-500' : 'text-teal-600';

  const nurse1 = nurses[0] || '—';
  const nurse2 = nurses[1] || '';

  if (compact) {
    return (
      <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
        <div className={`flex items-center gap-1.5 ${iconColor}`}>
          <Icon size={14} className="shrink-0" aria-hidden="true" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
            {label}
          </span>
        </div>
        <span className="min-w-0 text-xs leading-5 text-slate-700 font-medium break-words">
          {nurse1}
          {nurse2 && `, ${nurse2}`}
        </span>
      </div>
    );
  }

  // Original vertical layout (non-compact)
  return (
    <div className="p-3 rounded-lg border border-slate-200 bg-white">
      <h4 className="text-xs font-bold uppercase text-slate-500 mb-2 flex items-center gap-2">
        <Icon size={14} aria-hidden="true" />
        {label}
      </h4>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-slate-700">{nurse1}</span>
        {nurse2 && <span className="text-sm text-slate-700">{nurse2}</span>}
      </div>
    </div>
  );
};
