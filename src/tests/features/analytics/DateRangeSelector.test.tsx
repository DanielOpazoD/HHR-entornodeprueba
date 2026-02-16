import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateRangeSelector } from '@/features/analytics/components/components/DateRangeSelector';

describe('DateRangeSelector', () => {
  it('shows month selector when currentMonth preset is active', () => {
    render(
      <DateRangeSelector
        currentPreset="currentMonth"
        currentYearMonth={2}
        onPresetChange={vi.fn()}
        onCustomRangeChange={vi.fn()}
        onCurrentYearMonthChange={vi.fn()}
      />
    );

    expect(screen.getByText(/Mes \(\d{4}\):/)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('notifies month change from current year selector', () => {
    const onCurrentYearMonthChange = vi.fn();

    render(
      <DateRangeSelector
        currentPreset="currentMonth"
        currentYearMonth={1}
        onPresetChange={vi.fn()}
        onCustomRangeChange={vi.fn()}
        onCurrentYearMonthChange={onCurrentYearMonthChange}
      />
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });

    expect(onCurrentYearMonthChange).toHaveBeenCalledWith(1);
  });
});
