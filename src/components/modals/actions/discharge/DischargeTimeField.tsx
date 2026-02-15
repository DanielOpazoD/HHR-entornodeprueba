import React from 'react';
import clsx from 'clsx';

interface DischargeTimeFieldProps {
  showDateInput?: boolean;
  dateValue: string;
  value: string;
  minDate: string;
  maxDate: string;
  nextDay: string;
  nextDayMaxTime: string;
  timeError?: string;
  dateTimeError?: string;
  onDateChange: (value: string) => void;
  onChange: (value: string) => void;
}

export const DischargeTimeField: React.FC<DischargeTimeFieldProps> = ({
  showDateInput = true,
  dateValue,
  value,
  minDate,
  maxDate,
  nextDay,
  nextDayMaxTime,
  timeError,
  dateTimeError,
  onDateChange,
  onChange,
}) => (
  <div className="space-y-1.5 pt-2">
    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
      {showDateInput ? 'Fecha y Hora de Alta' : 'Hora de Alta'}
    </label>
    <div
      className={clsx('max-w-[280px] gap-2', showDateInput ? 'grid grid-cols-2' : 'max-w-[120px]')}
    >
      {showDateInput && (
        <input
          type="date"
          min={minDate}
          max={maxDate}
          className={clsx(
            'w-full p-2 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all',
            dateTimeError
              ? 'border-red-300 focus:ring-red-100'
              : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
          )}
          value={dateValue}
          onChange={event => onDateChange(event.target.value)}
        />
      )}
      <input
        type="time"
        className={clsx(
          'w-full p-2 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all',
          timeError || dateTimeError
            ? 'border-red-300 focus:ring-red-100'
            : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
        )}
        step={300}
        max={dateValue === nextDay ? nextDayMaxTime : undefined}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
    {timeError && <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{timeError}</p>}
    {dateTimeError && (
      <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{dateTimeError}</p>
    )}
  </div>
);
