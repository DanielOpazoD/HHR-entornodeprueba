import { fireEvent, render, screen } from '@testing-library/react';
import { Bandage } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { ScaleChip } from '@/features/census/components/patient-row/ScaleChip';

const note = { title: 'Escala', recordedDate: '2026-07-15' };

describe('ScaleChip', () => {
  it('shows a light provenance card with room for the scale title', () => {
    render(
      <ScaleChip
        hue="indigo"
        icon={Bandage}
        label="Downton"
        value="2"
        note={{
          ...note,
          title: 'Downton',
          detail: 'Riesgo medio',
          author: 'Profesional de prueba',
        }}
      />
    );
    const chip = screen.getByText('Downton').closest('.grid') as HTMLElement;
    fireEvent.mouseEnter(chip);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveStyle({ width: '280px' });
    expect(tooltip.firstElementChild).toHaveClass('bg-white', 'rounded-lg');
    expect(tooltip).toHaveTextContent('Riesgo medio');
    expect(tooltip).toHaveTextContent('Profesional de prueba');
    fireEvent.mouseLeave(chip);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('distinguishes risk from reapplication without coloring the whole chip', () => {
    const { container } = render(
      <ScaleChip
        hue="violet"
        icon={Bandage}
        label="Braden"
        value="12"
        severity="alto"
        countdown="hoy"
        countdownUrgent
        note={note}
      />
    );
    expect(screen.getByText(/Riesgo alto/)).toBeInTheDocument();
    expect(screen.getByLabelText('Próxima aplicación: hoy')).toHaveClass('text-red-700');
    expect(container.firstElementChild).not.toHaveClass('border-red-300');
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
  it('keeps identity, value and countdown on the same fixed axes for every score', () => {
    const { container, rerender } = render(
      <ScaleChip hue="violet" icon={Bandage} label="Braden" value="12" countdown="2d" note={note} />
    );

    expect(container.firstElementChild).toHaveClass('grid-cols-[70px_minmax(0,1fr)_34px]');
    expect(screen.getByText('2d')).toBeInTheDocument();

    rerender(<ScaleChip hue="teal" icon={Bandage} label="CUDYR" value="C3" note={note} />);
    expect(container.firstElementChild).toHaveClass('grid-cols-[70px_minmax(0,1fr)_34px]');
    expect(container.querySelector('.border-l')).not.toBeInTheDocument();
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

  it('falls back to the census day and local clock for a calendar-invalid ISO timestamp', () => {
    render(
      <ScaleChip
        hue="violet"
        icon={Bandage}
        label="Braden"
        value="16"
        note={{
          ...note,
          recordedDate: '2026-08-02',
          recordedAt: '2026-02-30T07:23:00Z',
        }}
      />
    );

    fireEvent.focus(screen.getByText('Braden').closest('.grid') as HTMLElement);

    expect(screen.getByRole('tooltip')).toHaveTextContent('Registrado: 02-08-2026, 07:23');
  });
});
