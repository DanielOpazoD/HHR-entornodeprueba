import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosisInput } from '@/features/census/components/patient-row/DiagnosisInput';
import { DataFactory } from '@/tests/factories/DataFactory';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const PausedDiagnosisInput = ({ onChange }: { onChange: (value: string) => void }) => {
  const [paused, setPaused] = useState(true);
  return (
    <table>
      <tbody>
        <tr>
          <DiagnosisInput
            data={DataFactory.createMockPatient('R1', {
              patientName: 'Paciente Test',
              pathology: 'Diagnóstico actualizado',
            })}
            diagnosisMode="free"
            onChange={() => value => onChange(value)}
            clinicalPause={{
              isPaused: paused,
              message: 'Actualizado recién. Intente nuevamente para editar.',
              onAcknowledge: () => setPaused(false),
            }}
          />
        </tr>
      </tbody>
    </table>
  );
};

describe('DiagnosisInput freshness pause', () => {
  it('uses the first interaction as a quiet acknowledgement and allows the second edit', () => {
    const onChange = vi.fn();
    render(<PausedDiagnosisInput onChange={onChange} />);

    const input = screen.getByPlaceholderText('Diagnóstico (texto libre)');
    fireEvent.mouseDown(input);

    expect(screen.getByText(/actualizado recién/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Nuevo diagnóstico' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith('Nuevo diagnóstico');
  });
});

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
});
