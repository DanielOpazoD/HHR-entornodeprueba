import React from 'react';
import clsx from 'clsx';
import { resolveMovementTimeInputMax } from '@/features/census/controllers/clinicalShiftCalendarController';

export type MovementDateTimeFieldTone = 'emerald' | 'blue';

export interface MovementDateTimeFieldProps {
  containerClassName?: string;
  label: string;
  showDateInput?: boolean;
  dateValue: string;
  timeValue: string;
  minDate: string;
  maxDate: string;
  nextDay: string;
  nextDayMaxTime: string;
  timeError?: string;
  dateTimeError?: string;
  tone: MovementDateTimeFieldTone;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}

const resolveToneClassName = (tone: MovementDateTimeFieldTone, hasError: boolean): string => {
  if (hasError) {
    return 'border-red-300 focus:ring-red-100';
  }

  if (tone === 'blue') {
    return 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500';
  }

  return 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500';
};

export const MovementDateTimeField: React.FC<MovementDateTimeFieldProps> = ({
  containerClassName,
  label,
  showDateInput = true,
  dateValue,
  timeValue,
  minDate,
  maxDate,
  nextDay,
  nextDayMaxTime,
  timeError,
  dateTimeError,
  tone,
  onDateChange,
  onTimeChange,
}) => {
  const hasError = Boolean(timeError || dateTimeError);
  const toneClassName = resolveToneClassName(tone, hasError);

  return (
    <div className={clsx('space-y-1.5', containerClassName)}>
      <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
        {label}
      </label>
      <div
        className={clsx(
          'max-w-[280px] gap-2',
          showDateInput ? 'grid grid-cols-2' : 'max-w-[120px]'
        )}
      >
        {showDateInput && (
          <input
            type="date"
            min={minDate}
            max={maxDate}
            className={clsx(
              'w-full p-2 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all',
              resolveToneClassName(tone, Boolean(dateTimeError))
            )}
            value={dateValue}
            onChange={event => onDateChange(event.target.value)}
          />
        )}
        <input
          type="time"
          className={clsx(
            'w-full p-2 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all',
            toneClassName
          )}
          step={300}
          max={resolveMovementTimeInputMax({ dateValue, nextDay, nextDayMaxTime })}
          value={timeValue}
          onChange={event => onTimeChange(event.target.value)}
        />
      </div>
      {timeError && <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{timeError}</p>}
      {dateTimeError && (
        <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{dateTimeError}</p>
      )}
    </div>
  );
};
