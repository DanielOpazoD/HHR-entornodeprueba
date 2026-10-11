import React from 'react';
import { DateStripPeriodControl } from './DateStripPeriodControl';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';

interface DateStripYearNavigatorProps {
  selectedYear: number;
  setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
}

const YEAR_RANGE = 5;

export const DateStripYearNavigator: React.FC<DateStripYearNavigatorProps> = ({
  selectedYear,
  setSelectedYear,
}) => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: YEAR_RANGE * 2 + 1 }, (_, i) => currentYear - YEAR_RANGE + i);

  return (
    <DateStripPeriodControl
      kind="year"
      label={selectedYear}
      onPrevious={() => setSelectedYear(year => year - 1)}
      onNext={() => setSelectedYear(year => year + 1)}
      onToggle={toggle}
      containerRef={menuRef}
    >
      {isOpen && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-24 bg-white rounded-xl shadow-xl border border-slate-200 ring-1 ring-black/[0.04] z-50 overflow-hidden py-1 max-h-[200px] overflow-y-auto">
          {years.map(year => (
            <button
              key={year}
              onClick={() => {
                setSelectedYear(year);
                close();
              }}
              className={`w-full px-3 py-1.5 text-[12px] font-medium tabular-nums text-center transition-colors ${
                year === selectedYear
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : year === currentYear
                    ? 'text-slate-700 hover:bg-slate-50 font-semibold'
                    : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {year}
            </button>
          ))}
        </div>
      )}
    </DateStripPeriodControl>
  );
};
