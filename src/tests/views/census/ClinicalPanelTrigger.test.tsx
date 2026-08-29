import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveNavigation: vi.fn() }));

vi.mock('@/features/census/controllers/clinicalPanelNavigationController', () => ({
  resolveClinicalPanelNavigation: (...args: unknown[]) => mocks.resolveNavigation(...args),
}));

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
  ClinicalPanelDrawer: ({
    patientName,
    encounterRouteHint,
    onNavigateNext,
  }: {
    patientName: string;
    encounterRouteHint?: 'medical' | 'nurse';
    onNavigateNext: () => void;
  }) => (
    <div role="dialog">
      Panel de {patientName}
      <span data-testid="drawer-route">{encounterRouteHint || 'sin ruta'}</span>
      <button type="button" onClick={onNavigateNext}>
        Siguiente paciente
      </button>
    </div>
  ),
}));

vi.mock('@/features/census/components/PatientHospitalizationReportsDialog', () => ({
  PatientHospitalizationReportsDialog: ({
    isOpen,
    patientName,
  }: {
    isOpen: boolean;
    patientName: string;
  }) => (isOpen ? <div data-testid="reports-dialog">Informes de {patientName}</div> : null),
}));

import { ClinicalPanelTrigger } from '@/features/census/components/patient-row/ClinicalPanelTrigger';

describe('ClinicalPanelTrigger', () => {
  beforeEach(() => {
    mocks.resolveNavigation.mockReset();
    mocks.resolveNavigation.mockReturnValue({ previous: null, next: null });
  });

  it('preserves the live clinical panel action', () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141336"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir panel clínico de Paciente de prueba' })
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Panel de Paciente de prueba');
  });

  it('resolves the next patient again when the navigation arrow is pressed', () => {
    const staleTarget = document.createElement('button');
    const activeTarget = document.createElement('button');
    const staleClick = vi.fn();
    const activeClick = vi.fn();
    staleTarget.addEventListener('click', staleClick);
    activeTarget.addEventListener('click', activeClick);
    mocks.resolveNavigation
      .mockReturnValueOnce({ previous: null, next: staleTarget })
      .mockReturnValue({ previous: null, next: activeTarget });

    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141336"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir panel clínico de Paciente de prueba' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente paciente' }));

    expect(mocks.resolveNavigation.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(staleClick).not.toHaveBeenCalled();
    expect(activeClick).toHaveBeenCalledTimes(1);
  });

  it('opens the adjacent patient with that patient route hint', () => {
    mocks.resolveNavigation.mockImplementation((_root: ParentNode, currentKey: string) => {
      const triggers = [
        ...document.querySelectorAll<HTMLButtonElement>('[data-clinical-panel-key]'),
      ];
      const currentIndex = triggers.findIndex(
        trigger => trigger.dataset.clinicalPanelKey === currentKey
      );
      return {
        previous: currentIndex > 0 ? triggers[currentIndex - 1] : null,
        next:
          currentIndex >= 0 && currentIndex < triggers.length - 1
            ? triggers[currentIndex + 1]
            : null,
      };
    });
    render(
      <>
        <ClinicalPanelTrigger
          bedId="R1"
          patientName="Paciente manual"
          patientRun="17.752.753-1"
          clinicalEpisodeId="141336"
          encounterRouteHint="nurse"
        />
        <ClinicalPanelTrigger
          bedId="R2"
          patientName="Paciente sincronizado"
          patientRun="16.914.348-1"
          clinicalEpisodeId="141337"
          encounterRouteHint="medical"
        />
      </>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir panel clínico de Paciente manual' }));
    expect(screen.getByTestId('drawer-route')).toHaveTextContent('nurse');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente paciente' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Panel de Paciente sincronizado');
    expect(screen.getByTestId('drawer-route')).toHaveTextContent('medical');
  });

  it('opens the episode-aware reports menu', () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141336"
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Abrir informes de hospitalización de Paciente de prueba',
      })
    );
    expect(screen.getByTestId('reports-dialog')).toHaveTextContent(
      'Informes de Paciente de prueba'
    );
    expect(screen.queryByRole('button', { name: /abrir a .* en eloísa/i })).not.toBeInTheDocument();
  });

  it('does not render bridge actions without a synced episode', () => {
    const { container } = render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId=""
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps clinical panel and episode reports available for a newborn without RUN', () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente sin RUN"
        patientRun="ID temporal"
        clinicalEpisodeId="141336"
      />
    );
    expect(
      screen.getByRole('button', { name: 'Abrir panel clínico de Paciente sin RUN' })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /informes de hospitalización/i })).toBeVisible();
  });
});
