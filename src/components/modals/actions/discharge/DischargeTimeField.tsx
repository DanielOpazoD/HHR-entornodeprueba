import React from 'react';
import { MovementDateTimeField } from '@/components/modals/actions/shared/MovementDateTimeField';

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
  <MovementDateTimeField
    containerClassName="pt-2"
    label={showDateInput ? 'Fecha y Hora de Alta' : 'Hora de Alta'}
    showDateInput={showDateInput}
    dateValue={dateValue}
    timeValue={value}
    minDate={minDate}
    maxDate={maxDate}
    nextDay={nextDay}
    nextDayMaxTime={nextDayMaxTime}
    timeError={timeError}
    dateTimeError={dateTimeError}
    tone="emerald"
    onDateChange={onDateChange}
    onTimeChange={onChange}
  />
);
