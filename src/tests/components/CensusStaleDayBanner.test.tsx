import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CensusStaleDayBanner } from '@/components/layout/app-content/CensusStaleDayBanner';

describe('CensusStaleDayBanner', () => {
  it('renders nothing when the viewed day is the clinical today', () => {
    const { container } = render(
      <CensusStaleDayBanner
        currentDateString="2026-06-29"
        clinicalToday="2026-06-29"
        onGoToToday={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('warns and jumps to today when viewing a previous day', () => {
    const onGoToToday = vi.fn();
    render(
      <CensusStaleDayBanner
        currentDateString="2026-06-28"
        clinicalToday="2026-06-29"
        onGoToToday={onGoToToday}
      />
    );

    expect(screen.getByRole('alert')).toHaveClass('bg-slate-50', 'text-slate-600');
    fireEvent.click(screen.getByRole('button', { name: /ir a hoy/i }));
    expect(onGoToToday).toHaveBeenCalledTimes(1);
  });
});
