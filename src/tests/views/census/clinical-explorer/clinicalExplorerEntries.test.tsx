import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/features/rayen-import/clinical-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/rayen-import/clinical-panel')>();
  return { ...actual, requestClinicalPanel: (...args: unknown[]) => mocks.request(...args) };
});
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { panelResult } from '../clinicalPanelDrawer.fixture';
import { BEDS } from '@/constants/beds';
import { ClinicalExplorerMenuEntry } from '@/features/census/components/clinical-explorer/ClinicalExplorerMenuEntry';
import { ClinicalExplorerBar } from '@/features/census/components/clinical-explorer/ClinicalExplorerBar';
import {
  closeClinicalExplorer,
  openClinicalExplorer,
  useClinicalExplorerSelection,
} from '@/features/census/components/clinical-explorer/clinicalExplorerStore';
import { ClinicalPanelDrawer } from '@/features/census/components/patient-row/ClinicalPanelDrawer';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { CensusToolbarMenuTargetContext } from '@/shared/ui/CensusToolbarMenuTargetContext';
import { DataFactory } from '@/tests/factories/DataFactory';

const DATE = '2026-11-04';
const Probe = () => {
  const selection = useClinicalExplorerSelection(DATE);
  return <output>{selection ? selection.bedId : 'censo'}</output>;
};
const eligible = DataFactory.createMockPatient('H3C1', {
  patientName: 'Paciente de prueba',
  rut: '12.345.678-5',
  clinicalEpisodeId: 'ep-1',
});

describe('clinical explorer entries', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockResolvedValue(panelResult);
  });
  afterEach(() => act(() => closeClinicalExplorer()));

  it('the clinical drawer offers the explorer for the patient only when the census wires it', async () => {
    const onOpen = vi.fn();
    const view = render(
      <ClinicalPanelDrawer
        bedId="H3C1"
        patientName="Paciente de prueba"
        clinicalEpisodeId="ep-1"
        censusDate={DATE}
        onOpenHospitalizationReports={vi.fn()}
        onOpenClinicalExplorer={onOpen}
        onClose={vi.fn()}
      />
    );
    await screen.findByText('Evolución médica estable.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir explorador clínico de Paciente de prueba' })
    );
    expect(onOpen).toHaveBeenCalledTimes(1);

    view.rerender(
      <ClinicalPanelDrawer
        bedId="H3C1"
        patientName="Paciente de prueba"
        clinicalEpisodeId="ep-1"
        censusDate={DATE}
        onOpenHospitalizationReports={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /explorador clínico/i })).toBeNull();
  });

  it('the «⋯» menu entry renders in the toolbar target and opens on the first patient', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const patients = listClinicalExplorerPatients({
      visibleBeds: BEDS.filter(bed => !bed.isExtra),
      beds: { H3C1: eligible, R1: { ...eligible, bedId: 'R1', patientName: 'Primero' } },
    });
    render(
      <CensusToolbarMenuTargetContext.Provider value={target}>
        <ClinicalExplorerMenuEntry censusDate={DATE} patients={patients} />
        <Probe />
      </CensusToolbarMenuTargetContext.Provider>
    );
    const entry = screen.getByTestId('clinical-explorer-menu-entry');
    expect(target.contains(entry)).toBe(true);
    fireEvent.click(entry);
    expect(screen.getByRole('status')).toHaveTextContent('R1');
    target.remove();
  });

  it('the bar outside the lazy body brings the census back with a click or Escape', () => {
    act(() => openClinicalExplorer({ censusDate: DATE, bedId: 'H3C1' }));
    render(
      <>
        <ClinicalExplorerBar bedId="H3C1" />
        <Probe />
      </>
    );
    expect(screen.queryByText('Censo del miércoles, 4 de noviembre de 2026')).toBeNull();
    expect(screen.getByRole('button', { name: 'Volver al censo' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('censo')).toBeVisible();

    act(() => openClinicalExplorer({ censusDate: DATE, bedId: 'H3C1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver al censo' }));
    expect(screen.getByText('censo')).toBeVisible();
  });

  it('the menu entry is disabled when no patient of the day can be explored', () => {
    const target = document.createElement('div');
    render(
      <CensusToolbarMenuTargetContext.Provider value={target}>
        <ClinicalExplorerMenuEntry censusDate={DATE} patients={[]} />
      </CensusToolbarMenuTargetContext.Provider>
    );
    expect(target.querySelector('button')).toBeDisabled();
  });
});
