import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/components/modals/RadiologyViewerModal', () => ({
  RadiologyViewerModal: ({
    isOpen,
    patients,
    initialPatientRut,
    autoSearchInitialPatient,
    onRequestImaging,
  }: {
    isOpen: boolean;
    patients: Array<{ patientName: string; rut: string }>;
    initialPatientRut?: string;
    autoSearchInitialPatient?: boolean;
    onRequestImaging?: () => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Visualizador MMRAD">
        <span>{`${patients[0]?.patientName}|${initialPatientRut}`}</span>
        <span>{autoSearchInitialPatient ? 'búsqueda automática' : 'búsqueda manual'}</span>
        <button type="button" onClick={onRequestImaging}>
          Solicitar imagen
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/modals/ImagingRequestDialog', () => ({
  ImagingRequestDialog: ({
    isOpen,
    patient,
  }: {
    isOpen: boolean;
    patient: { patientName: string; rut: string };
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Solicitud de imágenes">
        {`${patient.patientName}|${patient.rut}`}
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

  it('opens the imaging request for the same patient from the viewer', async () => {
    const patient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente de prueba',
      rut: '12.345.678-5',
    });

    render(<PatientRadiologyTrigger patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: /abrir mmrad/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar imagen' }));

    expect(screen.queryByRole('dialog', { name: 'Visualizador MMRAD' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Solicitud de imágenes' })).toHaveTextContent(
      'Paciente de prueba|12.345.678-5'
    );
  });

  it('closes the imaging request when the bed changes patient identity', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar imagen' }));
    expect(await screen.findByRole('dialog', { name: 'Solicitud de imágenes' })).toBeVisible();

    rerender(<PatientRadiologyTrigger patient={nextPatient} />);

    expect(screen.queryByRole('dialog', { name: 'Solicitud de imágenes' })).toBeNull();
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
