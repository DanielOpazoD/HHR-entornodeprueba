import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientClinicalAccessProps } from '@/features/census/components/patient-row/patientRowInputViewContracts';

vi.mock('@/features/laboratory', () => ({
  LabResultsViewerModal: ({ onRequestExams }: { onRequestExams?: () => void }) => (
    <div role="dialog" aria-label="Visualizador de laboratorio">
      {onRequestExams && (
        <button type="button" onClick={onRequestExams}>
          Solicitar exámenes
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/modals/RadiologyViewerModal', () => ({
  RadiologyViewerModal: ({ onRequestImaging }: { onRequestImaging?: () => void }) => (
    <div role="dialog" aria-label="Visualizador MMRAD">
      {onRequestImaging && (
        <button type="button" onClick={onRequestImaging}>
          Solicitar imagen
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
  ClinicalPanelDrawer: ({ patientName }: { patientName: string }) => (
    <div role="dialog" aria-label="Ficha clínica">
      Panel de {patientName}
    </div>
  ),
}));

import { PatientClinicalAccess } from '@/features/census/components/patient-row/PatientClinicalAccess';

const patient = DataFactory.createMockPatient('R2', {
  patientName: 'Paciente de prueba',
  rut: '12.345.678-5',
  clinicalEpisodeId: '141336',
});

const renderAccess = (props: Partial<PatientClinicalAccessProps> = {}) =>
  render(
    <table>
      <tbody>
        <tr>
          <td>
            <PatientClinicalAccess patient={patient} censusDate="2026-09-03" {...props} />
          </td>
        </tr>
      </tbody>
    </table>
  );

const access = (topic: string) =>
  screen.getByRole('button', { name: `${topic} de Paciente de prueba` });

describe('PatientClinicalAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens ficha, laboratory and imaging with one click and offers no request when reading', async () => {
    renderAccess();

    fireEvent.click(access('Laboratorio'));
    expect(
      await screen.findByRole('dialog', { name: 'Visualizador de laboratorio' })
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Solicitar exámenes' })).toBeNull();

    fireEvent.click(access('Imágenes'));
    expect(await screen.findByRole('dialog', { name: 'Visualizador MMRAD' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Solicitar imagen' })).toBeNull();

    fireEvent.click(access('Ficha clínica'));
    expect(await screen.findByRole('dialog', { name: 'Ficha clínica' })).toHaveTextContent(
      'Panel de Paciente de prueba'
    );
  });

  it('hands laboratory and imaging requests to the row from their viewers', async () => {
    const onRequestExams = vi.fn();
    const onRequestImaging = vi.fn();
    renderAccess({ onRequestExams, onRequestImaging });

    fireEvent.click(access('Laboratorio'));
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar exámenes' }));
    expect(onRequestExams).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();

    fireEvent.click(access('Imágenes'));
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar imagen' }));
    expect(onRequestImaging).toHaveBeenCalledTimes(1);
  });

  it('opens documents with their count', () => {
    const onViewClinicalDocuments = vi.fn();
    renderAccess({ onViewClinicalDocuments, clinicalDocumentCount: 2 });

    const documents = access('Documentos');
    expect(documents).toHaveTextContent('2');
    fireEvent.click(documents);
    expect(onViewClinicalDocuments).toHaveBeenCalledTimes(1);
  });

  it('keeps a four-slot grid and leaves topics the patient cannot use empty', () => {
    renderAccess({
      patient: DataFactory.createMockPatient('R2', {
        patientName: 'Paciente de prueba',
        rut: 'AB123456',
        documentType: 'Pasaporte',
        clinicalEpisodeId: '',
      }),
    });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('[data-clinical-access], span.size-7')).toHaveLength(4);
  });

  it('still requests directly when nothing can be read yet but the row can edit', () => {
    const onRequestExams = vi.fn();
    const onRequestImaging = vi.fn();
    renderAccess({
      patient: DataFactory.createMockPatient('R2', {
        patientName: 'Paciente de prueba',
        rut: 'AB123456',
        documentType: 'Pasaporte',
        clinicalEpisodeId: '',
      }),
      onRequestExams,
      onRequestImaging,
    });

    fireEvent.click(access('Laboratorio'));
    fireEvent.click(access('Imágenes'));

    expect(onRequestExams).toHaveBeenCalledTimes(1);
    expect(onRequestImaging).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives a crib only its own ficha', async () => {
    const crib = DataFactory.createMockPatient('R2', {
      patientName: 'RN de prueba',
      rut: '',
      clinicalEpisodeId: '141399',
    });
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <PatientClinicalAccess
                patient={crib}
                isSubRow
                onRequestExams={vi.fn()}
                onViewClinicalDocuments={vi.fn()}
              />
            </td>
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ficha clínica de RN de prueba' }));
    expect(await screen.findByRole('dialog', { name: 'Ficha clínica' })).toHaveTextContent(
      'Panel de RN de prueba'
    );
  });
});
