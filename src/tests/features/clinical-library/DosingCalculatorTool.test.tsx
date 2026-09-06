import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DosingCalculatorTool } from '@/features/clinical-library/components/tools/DosingCalculatorTool';

const typeInto = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('DosingCalculatorTool', () => {
  it('derives anthropometry, renal function and weight-based doses from one patient form', () => {
    render(<DosingCalculatorTool onBack={vi.fn()} />);
    expect(screen.getByTestId('dosing-bmi')).toHaveTextContent('—');

    typeInto('Edad', '60');
    typeInto('Peso real', '70');
    typeInto('Talla', '170');
    typeInto('Creatinina', '1');

    expect(screen.getByTestId('dosing-bmi')).toHaveTextContent('24,2');
    expect(screen.getByTestId('dosing-bmi')).toHaveTextContent('Normal');
    expect(screen.getByTestId('dosing-ideal')).toHaveTextContent('65,9');
    // 70 kg no supera al ideal en 20 %: el peso ajustado no aplica en normopeso.
    expect(screen.getByTestId('dosing-adjusted')).toHaveTextContent('—');
    expect(screen.getByTestId('dosing-bsa')).toHaveTextContent('1,82');
    expect(screen.getByTestId('dosing-clearance')).toHaveTextContent('78');

    typeInto('Dosis por kilo', '1,5');
    expect(screen.getByTestId('dosing-total')).toHaveTextContent('105');
    expect(screen.getByTestId('dosing-total')).toHaveTextContent('real');

    fireEvent.click(screen.getByRole('button', { name: /^Ideal/ }));
    expect(screen.getByTestId('dosing-total')).toHaveTextContent('98,9');

    typeInto('Presentación (opcional)', '40');
    typeInto('en volumen', '2');
    expect(screen.getByTestId('dosing-volume')).toHaveTextContent('4,95');

    fireEvent.click(screen.getByRole('button', { name: 'Mujer' }));
    expect(screen.getByTestId('dosing-ideal')).toHaveTextContent('61,4');
    expect(screen.getByTestId('dosing-clearance')).toHaveTextContent('66');
  });

  it('offers the adjusted weight only in obesity and falls back to real weight when a basis vanishes', () => {
    render(<DosingCalculatorTool onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Ideal/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Ajustado/ })).toBeDisabled();
    typeInto('Talla', '170');
    expect(screen.getByRole('button', { name: /^Ideal/ })).toBeEnabled();
    typeInto('Peso real', '75');
    expect(screen.getByRole('button', { name: /^Ajustado/ })).toBeDisabled();
    typeInto('Peso real', '90');
    expect(screen.getByRole('button', { name: /^Ajustado/ })).toBeEnabled();
    expect(screen.getByTestId('dosing-adjusted')).toHaveTextContent('75,6');

    typeInto('Dosis por kilo', '1');
    fireEvent.click(screen.getByRole('button', { name: /^Ajustado/ }));
    expect(screen.getByTestId('dosing-total')).toHaveTextContent('75,6');
    typeInto('Talla', '');
    expect(screen.getByRole('button', { name: /^Real/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('dosing-total')).toHaveTextContent('90');
    expect(screen.getByTestId('dosing-total')).toHaveTextContent('real');
  });

  it('flags implausible inputs instead of computing with them', () => {
    render(<DosingCalculatorTool onBack={vi.fn()} />);
    typeInto('Peso real', '70');
    typeInto('Talla', '1,70');
    expect(screen.getByLabelText('Talla')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Fuera del rango plausible \(30–250 cm\)/)).toBeInTheDocument();
    expect(screen.getByTestId('dosing-bmi')).toHaveTextContent('—');
    typeInto('Talla', '170');
    expect(screen.getByLabelText('Talla')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByTestId('dosing-bmi')).toHaveTextContent('24,2');
  });
});
