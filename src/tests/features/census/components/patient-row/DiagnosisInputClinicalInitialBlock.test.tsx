import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosisInput } from '@/features/census/components/patient-row/DiagnosisInput';
import { DataFactory } from '@/tests/factories/DataFactory';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

describe('DiagnosisInput clinical initial block editor', () => {
  it('saves diagnosis and specialty as one patch (status is decoupled into its own column)', () => {
    const onMultipleUpdate = vi.fn();
    render(
      <table>
        <tbody>
          <tr>
            <DiagnosisInput
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Test',
                pathology: '',
                specialty: Specialty.EMPTY,
                status: PatientStatus.EMPTY,
              })}
              diagnosisMode="free"
              onChange={() => vi.fn()}
              onMultipleUpdate={onMultipleUpdate}
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByLabelText('Editar bloque clínico'));
    fireEvent.change(screen.getByLabelText('Diagnóstico'), {
      target: { value: 'Neumonia' },
    });
    fireEvent.change(screen.getByLabelText('Especialidad'), {
      target: { value: 'Med Interna' },
    });
    // The clinical block editor no longer has an "Estado" field.
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Guardar'));

    expect(onMultipleUpdate).toHaveBeenCalledWith({
      pathology: 'Neumonia',
      specialty: 'Med Interna',
    });
  });

  it('reserves space for CIE-10, delivery route, and the clinical editor together', () => {
    render(
      <table>
        <tbody>
          <tr>
            <DiagnosisInput
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Test',
                pathology: 'Embarazo de término',
                specialty: Specialty.GINECOBSTETRICIA,
                ginecobstetriciaType: 'Obstétrica',
                cie10Code: 'Z34.9',
                cie10Description: 'Supervisión de embarazo normal',
              })}
              diagnosisMode="free"
              onChange={() => vi.fn()}
              onMultipleUpdate={vi.fn()}
              onDeliveryRouteChange={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByPlaceholderText('Diagnóstico (texto libre)')).toHaveClass('pr-32');
  });
});
