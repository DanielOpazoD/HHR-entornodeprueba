import React from 'react';
import clsx from 'clsx';
import {
  resolveDateStripDayWindow,
  resolveIsFutureDayBlocked,
} from '@/components/layout/date-strip/dateStripDayWindowController';

interface DateStripDayButtonsProps {
  selectedDay: number;
  setSelectedDay: React.Dispatch<React.SetStateAction<number>>;
  daysInMonth: number;
  existingDaysInMonth: number[];
  selectedYear: number;
  selectedMonth: number;
  isCurrentMonth: boolean;
  today: Date;
}

export const DateStripDayButtons: React.FC<DateStripDayButtonsProps> = ({
  selectedDay,
  setSelectedDay,
  daysInMonth,
  existingDaysInMonth,
  selectedYear,
  selectedMonth,
  isCurrentMonth,
  today,
}) => {
  const [windowWidth, setWindowWidth] = React.useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  const existingDaysSet = React.useMemo(() => new Set(existingDaysInMonth), [existingDaysInMonth]);

  React.useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { startDay, endDay } = resolveDateStripDayWindow({
    selectedDay,
    daysInMonth,
    windowWidth,
  });

  const dayButtons: React.ReactNode[] = [];

  for (let day = startDay; day <= endDay; day += 1) {
    const hasData = existingDaysSet.has(day);
    const isSelected = day === selectedDay;
    const isTodayReal = isCurrentMonth && today.getDate() === day;
    const isFutureBlocked = resolveIsFutureDayBlocked({
      selectedYear,
      selectedMonth,
      day,
      referenceDate: today,
    });

    dayButtons.push(
      <button
        key={day}
        onClick={() => !isFutureBlocked && setSelectedDay(day)}
        disabled={isFutureBlocked}
        className={clsx(
          'flex items-center justify-center w-8 h-8 rounded-lg text-xs font-semibold transition-all shrink-0 relative border',
          isFutureBlocked
            ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
            : isSelected
              ? isTodayReal
                ? 'bg-gradient-to-br from-cyan-500 to-teal-500 text-white border-cyan-600 shadow-lg shadow-cyan-200 scale-110'
                : 'bg-slate-700 text-white border-slate-700 shadow-md scale-105'
              : [
                  'hover:bg-slate-100',
                  isTodayReal
                    ? 'bg-cyan-50 border-cyan-300 text-cyan-700 font-bold'
                    : 'bg-white border-slate-100 text-slate-500',
                ]
        )}
      >
        <span>{day}</span>
        {hasData && (
          <span
            className={clsx(
              'absolute -bottom-0.5 w-1 h-1 rounded-full',
              isFutureBlocked ? 'bg-slate-300' : isSelected ? 'bg-green-400' : 'bg-green-500'
            )}
          />
        )}
      </button>
    );
  }

  return <>{dayButtons}</>;
};
