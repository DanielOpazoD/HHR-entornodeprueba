import React from 'react';
import { Sun, Moon } from 'lucide-react';
import clsx from 'clsx';

interface HandoffShiftSwitcherProps {
  selectedShift: 'day' | 'night';
  setSelectedShift: (shift: 'day' | 'night') => void;
}

export const HandoffShiftSwitcher: React.FC<HandoffShiftSwitcherProps> = ({
  selectedShift,
  setSelectedShift,
}) => (
  <div className="handoff-shifts inline-flex min-w-0 shrink-0 bg-slate-100/80 p-0.5 rounded-lg border border-slate-200/70">
    <button
      type="button"
      onClick={() => setSelectedShift('day')}
      data-testid="handoff-shift-day-button"
      className={clsx(
        'flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 px-2.5 rounded-md text-xs font-semibold transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        selectedShift === 'day'
          ? 'bg-white text-teal-700 shadow-sm ring-1 ring-black/[0.04]'
          : 'text-slate-500 hover:text-slate-700'
      )}
      aria-pressed={selectedShift === 'day'}
    >
      <Sun size={13} className="shrink-0" aria-hidden="true" />
      Turno Largo
    </button>
    <button
      type="button"
      onClick={() => setSelectedShift('night')}
      data-testid="handoff-shift-night-button"
      className={clsx(
        'flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 px-2.5 rounded-md text-xs font-semibold transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        selectedShift === 'night'
          ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-black/[0.04]'
          : 'text-slate-500 hover:text-slate-700'
      )}
      aria-pressed={selectedShift === 'night'}
    >
      <Moon size={13} className="shrink-0" aria-hidden="true" />
      Turno Noche
    </button>
  </div>
);
