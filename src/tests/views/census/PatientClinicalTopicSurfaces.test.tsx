import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';

vi.mock('@/features/laboratory', () => ({
  LabResultsViewerModal: ({
    patients,
    initialPatientRut,
    autoSearchInitialPatient,
    onRequestExams,
  }: {
    patients: Array<{ patientName: string; rut: string; clinicalEpisodeId: string }>;
    initialPatientRut?: string;
    autoSearchInitialPatient?: boolean;
    onRequestExams?: () => void;
  }) => (
    <div role="dialog" aria-label="Visualizador de laboratorio">
      <span>{`${patients[0]?.patientName}|${initialPatientRut}|${patients[0]?.clinicalEpisodeId}`}</span>
      <span>{autoSearchInitialPatient ? 'búsqueda automática' : 'búsqueda manual'}</span>
      {onRequestExams && (
        <button type="button" onClick={onRequestExams}>
          Solicitar exámenes
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/modals/RadiologyViewerModal', () => ({
  RadiologyViewerModal: ({
    patients,
    initialPatientRut,
    autoSearchInitialPatient,
    onRequestImaging,
  }: {
    patients: Array<{ patientName: string; rut: string }>;
    initialPatientRut?: string;
    autoSearchInitialPatient?: boolean;
    onRequestImaging?: () => void;
  }) => (
    <div role="dialog" aria-label="Visualizador MMRAD">
      <span>{`${patients[0]?.patientName}|${initialPatientRut}`}</span>
      <span>{autoSearchInitialPatient ? 'búsqueda automática' : 'búsqueda manual'}</span>
      {onRequestImaging && (
        <button type="button" onClick={onRequestImaging}>
          Solicitar imagen
        </button>
      )}
    </div>
  ),
}));

import {
  PatientClinicalTopicSurfaces,
  usePatientClinicalTopicSurface,
} from '@/features/census/components/patient-row/PatientClinicalTopicSurfaces';

const Harness: React.FC<{
  patient: PatientData;
  onRequestExams?: () => void;
  onRequestImaging?: () => void;
}> = ({ patient, onRequestExams, onRequestImaging }) => {
  const { surface, open, close } = usePatientClinicalTopicSurface(patient);
  return (
    <>
      <button type="button" onClick={() => open('laboratory')}>
        Tortuga: laboratorio
      </button>
      <button type="button" onClick={() => open('imaging')}>
        Tortuga: imágenes
      </button>
      <PatientClinicalTopicSurfaces
        patient={patient}
        censusDate="2026-09-03"
        surface={surface}
        onClose={close}
        onRequestExams={onRequestExams}
        onRequestImaging={onRequestImaging}
      />
    </>
  );
};

const patient = DataFactory.createMockPatient('R2', {
  patientName: 'Paciente de prueba',
  rut: '17.752.753-1',
  clinicalEpisodeId: '141336',
});

describe('PatientClinicalTopicSurfaces', () => {
  it('opens the laboratory viewer scoped to the row patient with one initial search', async () => {
    render(<Harness patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tortuga: laboratorio' }));

    expect(
      await screen.findByRole('dialog', { name: 'Visualizador de laboratorio' })
    ).toHaveTextContent('Paciente de prueba|17.752.753-1|141336búsqueda automática');
  });

  it('hands the laboratory request to the row and closes the viewer', async () => {
    const onRequestExams = vi.fn();
    render(<Harness patient={patient} onRequestExams={onRequestExams} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tortuga: laboratorio' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar exámenes' }));

    expect(onRequestExams).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();
  });

  it('opens MMRAD scoped to the row patient and hands the imaging request to the row', async () => {
    const onRequestImaging = vi.fn();
    render(<Harness patient={patient} onRequestImaging={onRequestImaging} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tortuga: imágenes' }));

    expect(await screen.findByRole('dialog', { name: 'Visualizador MMRAD' })).toHaveTextContent(
      'Paciente de prueba|17.752.753-1búsqueda automática'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar imagen' }));

    expect(onRequestImaging).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Visualizador MMRAD' })).toBeNull();
  });

  it('offers no request when the row cannot take it', async () => {
    render(<Harness patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tortuga: laboratorio' }));
    await screen.findByRole('dialog', { name: 'Visualizador de laboratorio' });
    expect(screen.queryByRole('button', { name: 'Solicitar exámenes' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tortuga: imágenes' }));
    await screen.findByRole('dialog', { name: 'Visualizador MMRAD' });
    expect(screen.queryByRole('button', { name: 'Solicitar imagen' })).toBeNull();
  });

  it('closes an open viewer when the bed changes patient, and does not reopen it', async () => {
    const nextPatient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente siguiente',
      rut: '12.345.678-5',
      clinicalEpisodeId: '141337',
    });
    const { rerender } = render(<Harness patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tortuga: laboratorio' }));
    expect(
      await screen.findByRole('dialog', { name: 'Visualizador de laboratorio' })
    ).toBeVisible();

    rerender(<Harness patient={nextPatient} />);
    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();

    rerender(<Harness patient={patient} />);
    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();
  });

  it('keeps a navigation marker for the headless clinical panel', () => {
    render(<Harness patient={patient} />);

    expect(document.querySelector('[data-clinical-panel-key="R2:141336"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /abrir panel clínico/i })).toBeNull();
  });
});
