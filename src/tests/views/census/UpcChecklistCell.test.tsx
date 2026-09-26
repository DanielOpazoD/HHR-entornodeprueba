import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UpcChecklistCell } from '@/features/census/components/patient-row/UpcChecklistCell';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('UpcChecklistCell', () => {
  it('shows only the review icon while keeping the reason available to assistive technology', () => {
    render(
      <table>
        <tbody>
          <tr>
            <UpcChecklistCell
              data={DataFactory.createMockPatient('R1', { patientName: 'Paciente de prueba' })}
              currentDateString="2026-09-25"
              checklist={undefined}
            />
          </tr>
        </tbody>
      </table>
    );

    const button = screen.getByRole('button', { name: 'Evaluación UPC pendiente' });
    expect(button).toHaveAttribute('title', 'Evaluación UPC pendiente');
    expect(button.querySelector('svg')).toBeInTheDocument();
    expect(button).not.toHaveTextContent('Evaluar');
    expect(button).toHaveClass('min-w-8');
  });
});
