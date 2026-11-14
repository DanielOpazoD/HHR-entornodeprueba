import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DateStrip } from '@/components/layout/DateStrip';
import { DateStripMonthNavigator } from '@/components/layout/date-strip/DateStripMonthNavigator';
import { DateStripYearNavigator } from '@/components/layout/date-strip/DateStripYearNavigator';

// 22:30 on 31 December 2026 in Rapa Nui; mainland Chile and UTC already read 1 January 2027.
const HOSPITAL_NEW_YEARS_EVE = '2027-01-01T03:30:00Z';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(HOSPITAL_NEW_YEARS_EVE));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderHandoffStrip = (selectedYear: number, selectedMonth: number, selectedDay: number) =>
  render(
    <DateStrip
      selectedYear={selectedYear}
      setSelectedYear={vi.fn()}
      selectedMonth={selectedMonth}
      setSelectedMonth={vi.fn()}
      selectedDay={selectedDay}
      setSelectedDay={vi.fn()}
      currentDateString={`${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`}
      daysInMonth={31}
      existingDaysInMonth={[]}
      currentModule="NURSING_HANDOFF"
      navigateDays={vi.fn()}
      role="viewer"
      emailStatus="idle"
      isBackingUp={false}
    />
  );

describe('date strip uses the hospital day, not the device calendar', () => {
  it('marks the hospital today in a handoff without a clinical day', () => {
    renderHandoffStrip(2026, 11, 31);

    expect(screen.getByRole('button', { name: /31 de diciembre de 2026 \(hoy\)/i })).toBeEnabled();
  });

  it('lets a handoff open only up to the hospital tomorrow', () => {
    renderHandoffStrip(2027, 0, 1);

    expect(screen.getByRole('button', { name: /1 de enero de 2027$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /2 de enero de 2027$/i })).toBeDisabled();
  });

  it('centers the year menu on the hospital year', () => {
    render(<DateStripYearNavigator selectedYear={2026} setSelectedYear={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Seleccionar año'));

    expect(screen.getByRole('button', { name: '2021' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2032' })).not.toBeInTheDocument();
  });

  it('highlights the hospital month in the month menu', () => {
    render(<DateStripMonthNavigator selectedMonth={5} onChangeMonth={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Seleccionar mes'));

    expect(screen.getByRole('button', { name: 'Dic' })).toHaveClass('font-semibold');
    expect(screen.getByRole('button', { name: 'Ene' })).not.toHaveClass('font-semibold');
  });
});
