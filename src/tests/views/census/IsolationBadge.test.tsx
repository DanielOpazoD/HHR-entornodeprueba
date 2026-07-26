import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  IsolationBadge,
  resolveIsolationDescription,
} from '@/features/census/components/patient-row/IsolationBadge';

describe('IsolationBadge', () => {
  it('exposes the synchronized isolation type accessibly and on hover', () => {
    render(<IsolationBadge isolationType="Gotas" microorganism="Virus Influenza B" />);

    const badge = screen.getByLabelText('Aislamiento: Gotas · Virus Influenza B');
    expect(badge).toHaveAttribute('title', 'Aislamiento: Gotas · Virus Influenza B');
    expect(badge).toHaveTextContent('Aisl.');
  });

  it('uses an honest fallback when Eloísa only reports the isolation flag', () => {
    expect(resolveIsolationDescription()).toBe('Aislamiento activo · tipo no informado por Eloísa');
  });

  it('keeps the microorganism visible when the isolation type is absent', () => {
    expect(resolveIsolationDescription(undefined, 'Virus Influenza B')).toBe(
      'Aislamiento activo · Virus Influenza B'
    );
  });
});
