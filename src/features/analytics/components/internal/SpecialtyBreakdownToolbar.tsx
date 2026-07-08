import React from 'react';

interface SpecialtyBreakdownToolbarProps {
  onlyRowsWithEvents: boolean;
  onToggleRowsWithEvents: () => void;
}

export const SpecialtyBreakdownToolbar: React.FC<SpecialtyBreakdownToolbarProps> = ({
  onlyRowsWithEvents,
  onToggleRowsWithEvents,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <button
      type="button"
      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
        onlyRowsWithEvents
          ? 'border-sky-200 bg-sky-50 text-sky-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
      onClick={onToggleRowsWithEvents}
      aria-pressed={onlyRowsWithEvents}
    >
      Solo filas con eventos
    </button>
  </div>
);
