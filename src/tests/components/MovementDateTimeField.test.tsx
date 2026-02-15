import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MovementDateTimeField } from '@/components/modals/actions/shared/MovementDateTimeField';

describe('MovementDateTimeField', () => {
  it('renders date + time inputs when showDateInput is true', () => {
    render(
      <MovementDateTimeField
        label="Fecha y Hora"
        showDateInput={true}
        dateValue="2026-02-14"
        timeValue="08:00"
        minDate="2026-02-14"
        maxDate="2026-02-15"
        nextDay="2026-02-15"
        nextDayMaxTime="08:59"
        tone="emerald"
        onDateChange={vi.fn()}
        onTimeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Fecha y Hora')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-02-14')).toBeInTheDocument();
    expect(screen.getByDisplayValue('08:00')).toBeInTheDocument();
  });

  it('hides date input when showDateInput is false and keeps time interaction', () => {
    const onTimeChange = vi.fn();

    render(
      <MovementDateTimeField
        label="Hora"
        showDateInput={false}
        dateValue="2026-02-14"
        timeValue="08:00"
        minDate="2026-02-14"
        maxDate="2026-02-15"
        nextDay="2026-02-15"
        nextDayMaxTime="08:59"
        tone="blue"
        onDateChange={vi.fn()}
        onTimeChange={onTimeChange}
      />
    );

    expect(screen.queryByDisplayValue('2026-02-14')).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('08:00'), { target: { value: '09:30' } });
    expect(onTimeChange).toHaveBeenCalledWith('09:30');
  });

  it('applies next-day max time constraint only when selected date is next day', () => {
    const { rerender } = render(
      <MovementDateTimeField
        label="Fecha y Hora"
        showDateInput={true}
        dateValue="2026-02-15"
        timeValue="08:00"
        minDate="2026-02-14"
        maxDate="2026-02-15"
        nextDay="2026-02-15"
        nextDayMaxTime="08:59"
        tone="emerald"
        onDateChange={vi.fn()}
        onTimeChange={vi.fn()}
      />
    );

    const timeInput = screen.getByDisplayValue('08:00') as HTMLInputElement;
    expect(timeInput.max).toBe('08:59');

    rerender(
      <MovementDateTimeField
        label="Fecha y Hora"
        showDateInput={true}
        dateValue="2026-02-14"
        timeValue="08:00"
        minDate="2026-02-14"
        maxDate="2026-02-15"
        nextDay="2026-02-15"
        nextDayMaxTime="08:59"
        tone="emerald"
        onDateChange={vi.fn()}
        onTimeChange={vi.fn()}
      />
    );

    expect((screen.getByDisplayValue('08:00') as HTMLInputElement).max).toBe('');
  });
});
