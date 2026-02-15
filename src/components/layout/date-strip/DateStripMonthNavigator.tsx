import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTH_NAMES } from '@/constants';

interface DateStripMonthNavigatorProps {
  selectedMonth: number;
  onChangeMonth: (delta: number) => void;
}

export const DateStripMonthNavigator: React.FC<DateStripMonthNavigatorProps> = ({
  selectedMonth,
  onChangeMonth,
}) => (
  <div className="flex items-center text-slate-700 font-bold shrink-0">
    <button onClick={() => onChangeMonth(-1)} className="p-1 hover:bg-slate-100 rounded">
      <ChevronLeft size={14} />
    </button>
    <span className="mx-1 uppercase text-xs tracking-wide min-w-[80px] text-center">
      {MONTH_NAMES[selectedMonth]}
    </span>
    <button onClick={() => onChangeMonth(1)} className="p-1 hover:bg-slate-100 rounded">
      <ChevronRight size={14} />
    </button>
  </div>
);
