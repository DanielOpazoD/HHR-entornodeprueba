import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClinicalInitialBlockCells } from '@/features/census/components/patient-row/ClinicalInitialBlockCells';
import { DataFactory } from '@/tests/factories/DataFactory';
import { Specialty } from '@/types/domain/patientClassification';

describe('ClinicalInitialBlockCells', () => {
  it('uses one deterministic padding class when all diagnosis controls are visible', () => {
    render(
      <table>
        <tbody>
          <tr>
            <ClinicalInitialBlockCells
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Test',
                pathology: 'Embarazo de término',
                specialty: Specialty.GINECOBSTETRICIA,
                ginecobstetriciaType: 'Obstétrica',
                cie10Code: 'Z34.9',
                cie10Description: 'Supervisión de embarazo normal',
              })}
              onChange={() => vi.fn()}
              onMultipleUpdate={vi.fn()}
              onDeliveryRouteChange={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    );

    const diagnosis = screen.getByText('Embarazo de término');
    expect(diagnosis).toHaveClass('pr-32');
    expect(diagnosis).not.toHaveClass('pr-28', 'pr-14', 'pr-8');
  });
});
