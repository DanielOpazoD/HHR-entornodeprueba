import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DateStripYearNavigatorProps {
  selectedYear: number;
  setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
}

export const DateStripYearNavigator: React.FC<DateStripYearNavigatorProps> = ({
  selectedYear,
  setSelectedYear,
}) => (
  <div className="flex items-center text-slate-700 font-bold shrink-0">
    <button
      onClick={() => setSelectedYear(year => year - 1)}
      className="p-1 hover:bg-slate-100 rounded"
    >
      <ChevronLeft size={14} />
    </button>
    <span className="mx-1 text-sm font-bold">{selectedYear}</span>
    <button
      onClick={() => setSelectedYear(year => year + 1)}
      className="p-1 hover:bg-slate-100 rounded"
    >
      <ChevronRight size={14} />
    </button>
  </div>
);
