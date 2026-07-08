import React, { useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

interface PrescriptionDateStripProps {
  /** ISO yyyy-mm-dd of the currently selected day, or null for "all days". */
  selectedDate: string | null;
  onSelectDate: (isoDate: string | null) => void;
  /** Records used to flag days that have backups (green dot). */
  records: PrescriptionRecord[];
  /** How many days back from today to render. Defaults to the monthly backup review window. */
  daysBack?: number;
}

const MONTH_LABELS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

const WEEKDAY_LABELS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const toIsoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const PrescriptionDateStrip: React.FC<PrescriptionDateStripProps> = ({
  selectedDate,
  onSelectDate,
  records,
  daysBack = 30,
}) => {
  const today = useMemo(() => new Date(), []);
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const days = useMemo(() => {
    const out: Array<{ iso: string; date: Date; isToday: boolean }> = [];
    for (let offset = daysBack - 1; offset >= 0; offset -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      out.push({
        iso: toIsoDay(d),
        date: d,
        isToday: offset === 0,
      });
    }
    return out;
  }, [today, daysBack]);

  const daysWithData = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) {
      const d = new Date(record.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      set.add(toIsoDay(d));
    }
    return set;
  }, [records]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
      <div className="mb-1 flex items-center justify-between px-0.5">
        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">
          Últimos {daysBack} días
        </p>
        <button
          type="button"
          onClick={() => onSelectDate(null)}
          className={clsx(
            'rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors',
            selectedDate === null
              ? 'bg-slate-800 text-white'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
          )}
        >
          Todos
        </button>
      </div>

      <div
        ref={stripRef}
        className="flex snap-x gap-1 overflow-x-auto pb-1 pt-0.5"
        style={{ scrollbarWidth: 'thin' }}
      >
        {days.map(({ iso, date, isToday }) => {
          const isSelected = selectedDate === iso;
          const hasData = daysWithData.has(iso);
          const day = date.getDate();
          const monthLabel = MONTH_LABELS[date.getMonth()];
          const weekdayLabel = WEEKDAY_LABELS[date.getDay()];

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(isSelected ? null : iso)}
              className={clsx(
                'relative flex shrink-0 snap-start flex-col items-center justify-center rounded-md border px-1 py-1 text-[10px] font-semibold transition-colors',
                'w-[34px] min-w-[34px]',
                isSelected
                  ? isToday
                    ? 'border-transparent bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-sm'
                    : 'border-slate-700 bg-slate-700 text-white shadow-sm'
                  : isToday
                    ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              )}
              aria-pressed={isSelected}
              aria-label={`${weekdayLabel} ${day} ${monthLabel}${hasData ? ' · con respaldos' : ''}`}
            >
              <span className="text-[8px] uppercase leading-none tracking-wide opacity-80">
                {weekdayLabel}
              </span>
              <span className="text-[13px] leading-tight">{day}</span>
              <span className="text-[8px] uppercase leading-none opacity-80">{monthLabel}</span>
              {hasData && (
                <span
                  className={clsx(
                    'absolute -bottom-0.5 h-1 w-1 rounded-full',
                    isSelected ? 'bg-emerald-300' : 'bg-emerald-500'
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
