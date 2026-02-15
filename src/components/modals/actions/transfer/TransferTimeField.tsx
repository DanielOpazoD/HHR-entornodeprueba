import React from 'react';
import { MovementDateTimeField } from '@/components/modals/actions/shared/MovementDateTimeField';

interface TransferTimeFieldProps {
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

export const TransferTimeField: React.FC<TransferTimeFieldProps> = ({
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
    label={showDateInput ? 'Fecha y Hora de Traslado' : 'Hora de Traslado'}
    showDateInput={showDateInput}
    dateValue={dateValue}
    timeValue={value}
    minDate={minDate}
    maxDate={maxDate}
    nextDay={nextDay}
    nextDayMaxTime={nextDayMaxTime}
    timeError={timeError}
    dateTimeError={dateTimeError}
    tone="blue"
    onDateChange={onDateChange}
    onTimeChange={onChange}
  />
);
