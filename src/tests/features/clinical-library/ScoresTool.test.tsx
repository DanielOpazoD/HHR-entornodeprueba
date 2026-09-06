import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScoresTool } from '@/features/clinical-library/components/tools/ScoresTool';

describe('ScoresTool', () => {
  it('scores qSOFA, keeps answers per score and evaluates Glasgow once complete', () => {
    render(<ScoresTool onBack={vi.fn()} onClose={vi.fn()} />);
    const result = screen.getByTestId('score-result');
    expect(screen.getByRole('button', { name: 'qSOFA' })).toHaveAttribute('aria-pressed', 'true');
    expect(result).toHaveTextContent('0 / 3');
    expect(result).toHaveAttribute('data-band', 'Bajo riesgo');

    fireEvent.click(screen.getByLabelText(/Frecuencia respiratoria ≥ 22/));
    fireEvent.click(screen.getByLabelText(/Presión arterial sistólica ≤ 100/));
    expect(result).toHaveTextContent('2 / 3');
    expect(result).toHaveAttribute('data-band', 'Alto riesgo');
    expect(result).toHaveTextContent(/SOFA/);

    fireEvent.click(screen.getByRole('button', { name: 'Glasgow' }));
    expect(result).toHaveTextContent('3 ítems pendientes');
    expect(result).toHaveAttribute('data-band', '');
    fireEvent.click(screen.getByLabelText(/^Espontánea/));
    fireEvent.click(screen.getByLabelText(/^Orientado/));
    expect(result).toHaveTextContent('1 ítem pendiente');
    fireEvent.click(screen.getByLabelText(/^Obedece órdenes/));
    expect(result).toHaveTextContent('15 / 15');
    expect(result).toHaveAttribute('data-band', 'Leve');
    expect(screen.getByRole('link', { name: 'Ver fuente' })).toHaveAttribute(
      'href',
      'https://doi.org/10.1016/S0140-6736(74)91639-0'
    );

    fireEvent.click(screen.getByRole('button', { name: 'qSOFA' }));
    expect(result).toHaveTextContent('2 / 3');
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(result).toHaveTextContent('0 / 3');
  });

  it('shows half-point totals for Wells', () => {
    render(<ScoresTool onBack={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wells TEP' }));
    fireEvent.click(screen.getByLabelText(/Frecuencia cardíaca > 100/));
    expect(screen.getByTestId('score-result')).toHaveTextContent('1,5 / 12,5');
    expect(screen.getByTestId('score-result')).toHaveAttribute('data-band', 'Probabilidad baja');
  });
});
