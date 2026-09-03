import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/components/modals/RadiologyViewerModal', () => ({
  RadiologyViewerModal: ({
    isOpen,
    patients,
    initialPatientRut,
    autoSearchInitialPatient,
  }: {
    isOpen: boolean;
    patients: Array<{ patientName: string; rut: string }>;
    initialPatientRut?: string;
    autoSearchInitialPatient?: boolean;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Visualizador MMRAD">
        <span>{`${patients[0]?.patientName}|${initialPatientRut}`}</span>
        <span>{autoSearchInitialPatient ? 'búsqueda automática' : 'búsqueda manual'}</span>
      </div>
    ) : null,
}));

import { PatientRadiologyTrigger } from '@/features/census/components/patient-row/PatientRadiologyTrigger';

describe('PatientRadiologyTrigger', () => {
  it('opens MMRAD scoped to the row patient and requests one initial search', async () => {
    const patient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente de prueba',
      rut: '12.345.678-5',
    });

    render(<PatientRadiologyTrigger patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir MMRAD de Paciente de prueba' }));

    expect(await screen.findByRole('dialog', { name: 'Visualizador MMRAD' })).toHaveTextContent(
      'Paciente de prueba|12.345.678-5búsqueda automática'
    );
  });

  it('closes the viewer when the bed changes patient identity', async () => {
    const firstPatient = DataFactory.createMockPatient('R2', {
      patientName: 'Primer paciente',
      rut: '12.345.678-5',
    });
    const nextPatient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente siguiente',
      rut: '5.844.865-6',
    });

    const { rerender } = render(<PatientRadiologyTrigger patient={firstPatient} />);
    fireEvent.click(screen.getByRole('button', { name: /abrir mmrad/i }));
    expect(await screen.findByRole('dialog', { name: 'Visualizador MMRAD' })).toBeVisible();

    rerender(<PatientRadiologyTrigger patient={nextPatient} />);

    expect(screen.queryByRole('dialog', { name: 'Visualizador MMRAD' })).toBeNull();
  });

  it('does not offer MMRAD without a valid Chilean RUT', () => {
    const invalidPatient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente sin RUT válido',
      rut: 'AB123456',
      documentType: 'Pasaporte',
    });

    const { container } = render(<PatientRadiologyTrigger patient={invalidPatient} />);

    expect(container).toBeEmptyDOMElement();
  });
});
