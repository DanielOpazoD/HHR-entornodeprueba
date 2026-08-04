import { fireEvent, render, screen } from '@testing-library/react';
import { Bandage } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { ScaleChip } from '@/features/census/components/patient-row/ScaleChip';

const note = { title: 'Escala', recordedDate: '2026-07-15' };

describe('ScaleChip', () => {
  it('keeps identity, value and countdown on the same fixed axes for every score', () => {
    const { container, rerender } = render(
      <ScaleChip hue="violet" icon={Bandage} label="Braden" value="12" countdown="2d" note={note} />
    );

    expect(container.firstElementChild).toHaveClass('grid-cols-[70px_minmax(0,1fr)_34px]');
    expect(screen.getByText('2d')).toBeInTheDocument();

    rerender(<ScaleChip hue="teal" icon={Bandage} label="CUDYR" value="C3" note={note} />);
    expect(container.firstElementChild).toHaveClass('grid-cols-[70px_minmax(0,1fr)_34px]');
    expect(container.querySelector('[aria-hidden="true"].border-l')).toBeInTheDocument();
  });

  it('renders a Rayen local stamp as day-month-year without ambiguous Date parsing', () => {
    render(
      <ScaleChip
        hue="violet"
        icon={Bandage}
        label="Braden"
        value="16"
        note={{
          ...note,
          recordedDate: '2026-08-02',
          recordedAt: '02-08-2026 01:23:00 -06:00',
        }}
      />
    );

    fireEvent.mouseEnter(screen.getByText('Braden').closest('.grid') as HTMLElement);

    expect(screen.getByRole('tooltip')).toHaveTextContent('Registrado: 02-08-2026, 01:23');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('08-02-2026');
  });

  it('converts an absolute timestamp to Rapa Nui time while preserving the census day format', () => {
    render(
      <ScaleChip
        hue="violet"
        icon={Bandage}
        label="Braden"
        value="16"
        note={{
          ...note,
          recordedDate: '2026-08-02',
          recordedAt: '2026-08-02T07:23:00Z',
        }}
      />
    );

    fireEvent.focus(screen.getByText('Braden').closest('.grid') as HTMLElement);

    expect(screen.getByRole('tooltip')).toHaveTextContent('Registrado: 02-08-2026, 01:23');
  });

  it('converts both date and time when an absolute timestamp crosses midnight in Rapa Nui', () => {
    render(
      <ScaleChip
        hue="violet"
        icon={Bandage}
        label="Braden"
        value="16"
        note={{
          ...note,
          recordedDate: '2026-08-02',
          recordedAt: '2026-08-02T03:00:00Z',
        }}
      />
    );

    fireEvent.focus(screen.getByText('Braden').closest('.grid') as HTMLElement);

    expect(screen.getByRole('tooltip')).toHaveTextContent('Registrado: 01-08-2026, 21:00');
  });
});
