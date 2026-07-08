import React from 'react';
import clsx from 'clsx';
import {
  resolveDateStripDayWindow,
  resolveIsFutureDayBlocked,
} from '@/components/layout/date-strip/dateStripDayWindowController';
import { classifyDateStripDay } from '@/components/layout/date-strip/dateStripDayClassification';
import type { ModuleType } from '@/constants/navigationConfig';

interface DateStripDayButtonsProps {
  selectedDay: number;
  setSelectedDay: React.Dispatch<React.SetStateAction<number>>;
  daysInMonth: number;
  existingDaysInMonth: number[];
  selectedYear: number;
  selectedMonth: number;
  isCurrentMonth: boolean;
  today: Date;
  /**
   * Active clinical day (YYYY-MM-DD, 08:00/09:00 shift rollover). When present, the
   * HOY marker tracks it instead of the calendar date — before the rollover the
   * night shift's clinical "today" is still the previous calendar day. Falls back to
   * the calendar date when absent (e.g. handoff modules).
   */
  clinicalToday?: string;
  currentModule?: ModuleType;
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
  clinicalToday,
  currentModule,
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
    currentModule,
  });

  // Census gates future days against the clinical "today" (consistent with the HOY
  // marker), so a calendar day that is still a future clinical day before the 08:00/
  // 09:00 rollover is not selectable. Handoff (no clinical day) keeps the calendar
  // reference.
  const futureBlockReferenceDate =
    currentModule === 'CENSUS' && clinicalToday
      ? new Date(
          Number(clinicalToday.slice(0, 4)),
          Number(clinicalToday.slice(5, 7)) - 1,
          Number(clinicalToday.slice(8, 10))
        )
      : today;

  const dayButtons = Array.from(
    { length: Math.max(0, endDay - startDay + 1) },
    (_, index): React.ReactNode => {
      const day = startDay + index;
      const hasData = existingDaysSet.has(day);
      const isSelected = day === selectedDay;
      const classification = clinicalToday
        ? classifyDateStripDay({
            year: selectedYear,
            monthZeroBased: selectedMonth,
            day,
            clinicalToday,
          })
        : null;
      // Clinical today drives the HOY marker; fall back to the calendar date when no
      // clinical day was provided (handoff modules).
      const isClinicalToday = classification
        ? classification.isClinicalToday
        : isCurrentMonth && today.getDate() === day;
      // A selected day that sits before the clinical today is the dangerous "you are
      // editing a previous day" state — mark it amber.
      const isSelectedPast = isSelected && Boolean(classification?.isBeforeClinicalToday);
      const isFutureBlocked = resolveIsFutureDayBlocked({
        selectedYear,
        selectedMonth,
        day,
        referenceDate: futureBlockReferenceDate,
      });

      return (
        <button
          key={day}
          onClick={() => !isFutureBlocked && setSelectedDay(day)}
          disabled={isFutureBlocked}
          aria-label={isClinicalToday ? `Día ${day} (hoy)` : `Día ${day}`}
          className={clsx(
            'flex items-center justify-center w-8 h-[30px] rounded-lg text-[11px] font-semibold transition-all shrink-0 relative border',
            isFutureBlocked
              ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
              : isSelected
                ? isClinicalToday
                  ? 'bg-gradient-to-br from-blue-500 to-cyan-500 text-white font-bold border-transparent shadow-lg shadow-blue-500/30 scale-105 ring-2 ring-blue-400/30'
                  : isSelectedPast
                    ? 'bg-amber-100 text-amber-800 font-bold border-amber-400 shadow-sm ring-2 ring-amber-300/60 scale-[1.03]'
                    : 'bg-slate-500 text-white font-bold border-slate-500 shadow-sm scale-[1.03]'
                : [
                    isClinicalToday
                      ? 'bg-blue-50 border-blue-400 text-blue-600 font-bold ring-1 ring-blue-300/50 hover:bg-blue-100'
                      : 'bg-white border-slate-200/80 text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                  ]
          )}
        >
          {isClinicalToday ? (
            <span className="flex flex-col items-center justify-center leading-none">
              <span>{day}</span>
              <span className="text-[8px] font-bold tracking-wider mt-px">HOY</span>
            </span>
          ) : (
            <span>{day}</span>
          )}
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
  );

  return <>{dayButtons}</>;
};
