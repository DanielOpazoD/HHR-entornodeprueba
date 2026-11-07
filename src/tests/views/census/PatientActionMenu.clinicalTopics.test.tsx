import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataFactory } from '@/tests/factories/DataFactory';
import { mockMatchMedia } from '@/tests/views/census/patientRowOrbitalQuickActionsTestSupport';

const mocks = vi.hoisted(() => ({ openExplorer: vi.fn() }));

vi.mock('@/features/census/components/clinical-explorer/clinicalExplorerStore', () => ({
  openClinicalExplorer: mocks.openExplorer,
}));

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

import { PatientActionMenu } from '@/features/census/components/patient-row/PatientActionMenu';

const patient = DataFactory.createMockPatient('R2', {
  patientName: 'Paciente de prueba',
  rut: '12.345.678-5',
  clinicalEpisodeId: '141336',
});

const renderMenu = (props: Partial<React.ComponentProps<typeof PatientActionMenu>> = {}) =>
  render(
    <table>
      <tbody>
        <tr data-testid="patient-row" data-bed-id="R2">
          <td className="relative">
            <PatientActionMenu
              isBlocked={false}
              onAction={vi.fn()}
              onViewDemographics={vi.fn()}
              clinicalPatient={patient}
              censusDate="2026-09-03"
              {...props}
            />
          </td>
        </tr>
      </tbody>
    </table>
  );

const openTopic = async (name: RegExp) => {
  fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));
  fireEvent.click(await screen.findByRole('button', { name }));
};

describe('PatientActionMenu clinical topics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchMedia(false);
  });

  it('opens ficha, laboratory, imaging and the integrated view on a read-only census', async () => {
    renderMenu({ readOnly: true, onViewExamRequest: vi.fn(), onViewImagingRequest: vi.fn() });

    await openTopic(/laboratorio: resultados/i);
    expect(
      await screen.findByRole('dialog', { name: 'Visualizador de laboratorio' })
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Solicitar exámenes' })).toBeNull();

    await openTopic(/imágenes: estudios/i);
    expect(await screen.findByRole('dialog', { name: 'Visualizador MMRAD' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Solicitar imagen' })).toBeNull();

    await openTopic(/ficha clínica/i);
    expect(await screen.findByRole('dialog', { name: 'Ficha clínica' })).toHaveTextContent(
      'Panel de Paciente de prueba'
    );

    await openTopic(/vista integrada/i);
    expect(mocks.openExplorer).toHaveBeenCalledWith({ censusDate: '2026-09-03', bedId: 'R2' });
  });

  it('passes laboratory and imaging requests to the row when the census is editable', async () => {
    const onViewExamRequest = vi.fn();
    const onViewImagingRequest = vi.fn();
    renderMenu({ onViewExamRequest, onViewImagingRequest });

    await openTopic(/laboratorio: resultados/i);
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar exámenes' }));
    expect(onViewExamRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();

    await openTopic(/imágenes: estudios/i);
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar imagen' }));
    expect(onViewImagingRequest).toHaveBeenCalledTimes(1);
  });

  it('still lets an editable row request when nothing can be read yet', async () => {
    const onViewExamRequest = vi.fn();
    const onViewImagingRequest = vi.fn();
    renderMenu({
      clinicalPatient: DataFactory.createMockPatient('R2', {
        patientName: 'Paciente con pasaporte',
        rut: 'AB123456',
        documentType: 'Pasaporte',
        clinicalEpisodeId: '',
      }),
      onViewExamRequest,
      onViewImagingRequest,
    });

    await openTopic(/laboratorio: resultados/i);
    expect(onViewExamRequest).toHaveBeenCalledTimes(1);
    await openTopic(/imágenes: estudios/i);
    expect(onViewImagingRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));
    expect(screen.queryByRole('button', { name: /ficha clínica/i })).toBeNull();
  });

  it('offers no clinical topic for a blocked bed', () => {
    renderMenu({ isBlocked: true, clinicalPatient: undefined });

    expect(screen.queryByRole('button', { name: /acciones clínicas rápidas/i })).toBeNull();
  });
});
