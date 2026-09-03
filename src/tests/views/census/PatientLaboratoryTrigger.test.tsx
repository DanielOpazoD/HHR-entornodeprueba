import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/laboratory', () => ({
  LabResultsViewerModal: ({
    isOpen,
    patients,
    initialPatientRut,
    autoSearchInitialPatient,
    onRequestExams,
  }: {
    isOpen: boolean;
    patients: Array<{ patientName: string; rut: string }>;
    initialPatientRut?: string;
    autoSearchInitialPatient?: boolean;
    onRequestExams?: () => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Visualizador de laboratorio">
        <span>{`${patients[0]?.patientName}|${initialPatientRut}`}</span>
        <span>{autoSearchInitialPatient ? 'búsqueda automática' : 'búsqueda manual'}</span>
        <button type="button" onClick={onRequestExams}>
          Solicitar exámenes
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/modals/ExamRequestModal', () => ({
  ExamRequestModal: ({
    isOpen,
    patient,
    recordDate,
  }: {
    isOpen: boolean;
    patient: { patientName: string; rut: string };
    recordDate?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Solicitud de laboratorio">
        {`${patient.patientName}|${patient.rut}|${recordDate}`}
      </div>
    ) : null,
}));

import { PatientLaboratoryTrigger } from '@/features/census/components/patient-row/PatientLaboratoryTrigger';

describe('PatientLaboratoryTrigger', () => {
  it('opens the existing laboratory viewer already scoped to the row patient', async () => {
    const patient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente de prueba',
      rut: '17.752.753-1',
      clinicalEpisodeId: '141336',
    });

    render(<PatientLaboratoryTrigger patient={patient} censusDate="2026-09-03" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir laboratorio de Paciente de prueba' })
    );

    expect(
      await screen.findByRole('dialog', { name: 'Visualizador de laboratorio' })
    ).toHaveTextContent('Paciente de prueba|17.752.753-1búsqueda automática');
  });

  it('opens the same patient laboratory request flow from the viewer', async () => {
    const patient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente de prueba',
      rut: '17.752.753-1',
      clinicalEpisodeId: '141336',
    });

    render(<PatientLaboratoryTrigger patient={patient} censusDate="2026-09-03" />);
    fireEvent.click(screen.getByRole('button', { name: /abrir laboratorio/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar exámenes' }));

    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();
    expect(
      await screen.findByRole('dialog', { name: 'Solicitud de laboratorio' })
    ).toHaveTextContent('Paciente de prueba|17.752.753-1|2026-09-03');
  });

  it('closes an open laboratory surface when the bed changes patient identity', async () => {
    const firstPatient = DataFactory.createMockPatient('R2', {
      patientName: 'Primer paciente',
      rut: '17.752.753-1',
      clinicalEpisodeId: '141336',
    });
    const nextPatient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente siguiente',
      rut: '12.345.678-5',
      clinicalEpisodeId: '141337',
    });

    const { rerender } = render(
      <PatientLaboratoryTrigger patient={firstPatient} censusDate="2026-09-03" />
    );
    fireEvent.click(screen.getByRole('button', { name: /abrir laboratorio/i }));
    expect(
      await screen.findByRole('dialog', { name: 'Visualizador de laboratorio' })
    ).toBeVisible();

    rerender(<PatientLaboratoryTrigger patient={nextPatient} censusDate="2026-09-03" />);

    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();

    rerender(<PatientLaboratoryTrigger patient={firstPatient} censusDate="2026-09-03" />);

    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();
  });

  it('does not offer Syslab without a synced episode and RUT identity', () => {
    const patient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente de prueba',
      rut: '',
      clinicalEpisodeId: '',
    });

    const { container } = render(<PatientLaboratoryTrigger patient={patient} />);

    expect(container).toBeEmptyDOMElement();
  });
});
