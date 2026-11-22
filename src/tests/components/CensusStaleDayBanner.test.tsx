import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusStaleDayBanner } from '@/components/layout/app-content/CensusStaleDayBanner';

describe('CensusStaleDayBanner', () => {
  it('renders nothing when the viewed day is the clinical today', () => {
    const { container } = render(
      <CensusStaleDayBanner currentDateString="2026-06-29" clinicalToday="2026-06-29" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('warns without duplicating the toolbar "Ir a hoy" button when viewing a previous day', () => {
    render(<CensusStaleDayBanner currentDateString="2026-06-28" clinicalToday="2026-06-29" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-slate-50', 'text-slate-600');
    expect(alert).toHaveTextContent(/estás viendo el/i);
    expect(screen.queryByRole('button', { name: /ir a hoy/i })).not.toBeInTheDocument();
  });
});
