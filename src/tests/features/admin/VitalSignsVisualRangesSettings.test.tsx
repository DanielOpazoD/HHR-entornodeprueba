import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VitalSignsVisualRangesSettings } from '@/features/admin/components/VitalSignsVisualRangesSettings';

describe('VitalSignsVisualRangesSettings', () => {
  it('documents every age profile without suggesting that a bed selects it', () => {
    render(<VitalSignsVisualRangesSettings />);
    fireEvent.click(screen.getByText('Alarmas visuales de signos vitales'));

    expect(screen.getByText('Sin edad suficiente')).toBeInTheDocument();
    expect(screen.getByText('RN · 0–27 días')).toBeInTheDocument();
    expect(screen.getByText('<1 año · desde 28 días')).toBeInTheDocument();
    expect(screen.getByText('1–4 años')).toBeInTheDocument();
    expect(screen.getByText('5–11 años')).toBeInTheDocument();
    expect(screen.getByText('12–17 años')).toBeInTheDocument();
    expect(screen.getByText('Adulto · ≥18 años')).toBeInTheDocument();
    expect(screen.getByText(/la cama no lo modifica/i)).toBeInTheDocument();
    expect(screen.getByText(/Queensland Health CEWT/i)).toBeInTheDocument();
  });
});
