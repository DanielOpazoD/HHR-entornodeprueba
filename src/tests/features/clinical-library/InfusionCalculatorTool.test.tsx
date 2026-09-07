import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InfusionCalculatorTool } from '@/features/clinical-library/components/tools/InfusionCalculatorTool';

const typeInto = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('InfusionCalculatorTool', () => {
  it('walks from an empty form to a pump rate with range feedback', () => {
    render(<InfusionCalculatorTool onBack={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Fármaco')).toHaveValue('noradrenalina');
    expect(screen.getByLabelText('Unidad de dosis')).toHaveValue('mcg/kg/min');
    expect(screen.getByTestId('infusion-result')).toHaveTextContent(
      'Ingresa la dosis para calcular la velocidad de la bomba.'
    );

    typeInto('Dosis indicada', '0,1');
    expect(screen.getByTestId('infusion-result')).toHaveTextContent(/peso/);

    typeInto('Peso', '70');
    const result = screen.getByTestId('infusion-result');
    expect(result).toHaveTextContent('26,3');
    expect(result).toHaveTextContent('mL/h');
    expect(result).toHaveTextContent('16 mcg/mL · 4 mg en 250 mL');
    expect(screen.getByTestId('infusion-range')).toHaveAttribute('data-assessment', 'within');
    expect(result).toHaveTextContent('Preferir vía venosa central.');

    typeInto('Dosis indicada', '1');
    expect(screen.getByTestId('infusion-range')).toHaveAttribute('data-assessment', 'above');
  });

  it('inverts a pump rate into a dose', () => {
    render(<InfusionCalculatorTool onBack={vi.fn()} onClose={vi.fn()} />);
    typeInto('Peso', '70');
    fireEvent.click(screen.getByRole('button', { name: 'mL/h → Dosis' }));
    typeInto('Velocidad de la bomba', '26,25');
    const result = screen.getByTestId('infusion-result');
    expect(result).toHaveTextContent('Dosis equivalente');
    expect(result).toHaveTextContent('0,1');
    expect(result).toHaveTextContent('mcg/kg/min');
  });

  it('switches presets, keeps units compatible and supports custom dilutions', () => {
    render(<InfusionCalculatorTool onBack={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Fármaco'), { target: { value: 'heparina' } });
    expect(screen.getByLabelText('Unidad de dosis')).toHaveValue('UI/kg/h');
    expect(screen.getByLabelText('Dilución')).toHaveValue('0');

    fireEvent.change(screen.getByLabelText('Fármaco'), { target: { value: 'custom' } });
    expect(screen.queryByLabelText('Dilución')).not.toBeInTheDocument();
    typeInto('Cantidad', '100');
    typeInto('Volumen', '100');
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'UI' } });
    expect(screen.getByLabelText('Unidad de dosis')).toHaveValue('UI/h');

    typeInto('Dosis indicada', '5');
    expect(screen.getByTestId('infusion-primary-value')).toHaveTextContent(/^5\s*mL\/h$/);
    expect(screen.getByTestId('infusion-result')).toHaveTextContent('1 UI/mL · 100 UI en 100 mL');
    expect(screen.queryByTestId('infusion-range')).not.toBeInTheDocument();
  });

  it('rejects an implausible weight instead of computing a negative dose', () => {
    render(<InfusionCalculatorTool onBack={vi.fn()} onClose={vi.fn()} />);
    typeInto('Dosis indicada', '0,1');
    typeInto('Peso', '-70');
    expect(screen.getByLabelText('Peso')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Fuera del rango plausible \(0,5–400 kg\)/)).toBeInTheDocument();
    expect(screen.getByTestId('infusion-result')).toHaveTextContent(/peso/);
    expect(screen.queryByTestId('infusion-primary-value')).not.toBeInTheDocument();
  });

  it('returns to the library through the back button', () => {
    const onBack = vi.fn();
    render(<InfusionCalculatorTool onBack={onBack} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la biblioteca' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
