import { render, screen } from '@testing-library/react';
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
});
