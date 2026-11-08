import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveNavigation: vi.fn(), reportMount: vi.fn() }));

vi.mock(
  '@/features/census/controllers/clinicalPanelNavigationController',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('@/features/census/controllers/clinicalPanelNavigationController')
    >()),
    resolveClinicalPanelNavigation: (...args: unknown[]) => mocks.resolveNavigation(...args),
  })
);

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
  ClinicalPanelDrawer: ({
    patientName,
    encounterRouteHint,
    admissionDate,
    censusDate,
    onNavigateNext,
    onOpenHospitalizationReports,
    onClose,
  }: {
    patientName: string;
    encounterRouteHint?: 'medical' | 'nurse';
    admissionDate?: string;
    censusDate?: string;
    onNavigateNext: () => void;
    onOpenHospitalizationReports: () => void;
    onClose: () => void;
  }) => (
    <div role="dialog">
      Panel de {patientName}
      <span data-testid="drawer-route">{encounterRouteHint || 'sin ruta'}</span>
      <span data-testid="drawer-date-range">{`${admissionDate || ''}|${censusDate || ''}`}</span>
      <button type="button" onClick={onNavigateNext}>
        Siguiente paciente
      </button>
      <button type="button" onClick={onClose}>
        Cerrar panel clínico
      </button>
      <button type="button" onClick={onOpenHospitalizationReports}>
        Abrir informes de hospitalización de {patientName}
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
  }) => {
    mocks.reportMount();
    return isOpen ? <div data-testid="reports-dialog">Informes de {patientName}</div> : null;
  },
}));

import { ClinicalPanelTrigger } from '@/features/census/components/patient-row/ClinicalPanelTrigger';
import { openClinicalPanel } from '@/features/census/components/patient-row/useActiveClinicalPanel';
import { FichaAccess } from '@/tests/views/census/clinicalPanelFichaAccess';

/** The «Ficha clínica» access opens a panel by its bed and episode. */
const openPanelOf = (key: string): void => {
  act(() => {
    expect(openClinicalPanel(key)).toBe(true);
  });
};

describe('ClinicalPanelTrigger', () => {
  beforeEach(() => {
    mocks.resolveNavigation.mockReset();
    mocks.reportMount.mockClear();
    mocks.resolveNavigation.mockReturnValue({ previous: null, next: null });
  });

  it('preserves the live clinical panel action', async () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141336"
        admissionDate="2026-07-13"
        censusDate="2026-07-18"
      />
    );
    openPanelOf('R2:141336');
    expect(await screen.findByText('Panel de Paciente de prueba')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-date-range')).toHaveTextContent('2026-07-13|2026-07-18');
  });

  it('resolves the next patient again when the navigation arrow is pressed', async () => {
    mocks.resolveNavigation
      .mockReturnValueOnce({ previous: null, next: 'R9:999' })
      .mockReturnValue({ previous: null, next: 'R3:141338' });

    render(
      <>
        <ClinicalPanelTrigger
          bedId="R2"
          patientName="Paciente de prueba"
          patientRun="17.752.753-1"
          clinicalEpisodeId="141336"
        />
        <ClinicalPanelTrigger
          bedId="R3"
          patientName="Paciente siguiente"
          patientRun="16.914.348-1"
          clinicalEpisodeId="141338"
        />
      </>
    );
    openPanelOf('R2:141336');
    await screen.findByText('Panel de Paciente de prueba');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente paciente' }));

    expect(mocks.resolveNavigation.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Panel de Paciente siguiente');
  });

  it('opens the adjacent patient with that patient route hint', async () => {
    mocks.resolveNavigation.mockImplementation((_root: ParentNode, currentKey: string) => {
      const keys = [...document.querySelectorAll<HTMLElement>('[data-clinical-panel-key]')].map(
        entry => entry.dataset.clinicalPanelKey
      );
      const currentIndex = keys.indexOf(currentKey);
      return {
        previous: currentIndex > 0 ? keys[currentIndex - 1] : null,
        next: currentIndex >= 0 && currentIndex < keys.length - 1 ? keys[currentIndex + 1] : null,
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

    openPanelOf('R1:141336');
    expect(await screen.findByTestId('drawer-route')).toHaveTextContent('nurse');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente paciente' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Panel de Paciente sincronizado');
    expect(screen.getByTestId('drawer-route')).toHaveTextContent('medical');
  });

  it('opens a main-row panel by key and walks on to its crib', async () => {
    mocks.resolveNavigation.mockImplementation((_root: ParentNode, currentKey: string) => ({
      previous: null,
      next: currentKey === 'R1:141336' ? 'R1:141399' : null,
    }));
    render(
      <>
        <ClinicalPanelTrigger
          bedId="R1"
          patientName="Madre de prueba"
          patientRun="17.752.753-1"
          clinicalEpisodeId="141336"
        />
        <ClinicalPanelTrigger
          bedId="R1"
          triggerKey="R1-clinical-crib"
          patientName="RN de prueba"
          patientRun=""
          clinicalEpisodeId="141399"
        />
      </>
    );

    expect(screen.queryByRole('button', { name: /abrir panel clínico/i })).toBeNull();
    expect(document.querySelector('[data-clinical-panel-key="R1:141336"]')).not.toBeNull();
    expect(openClinicalPanel('R1:000000')).toBe(false);

    act(() => {
      expect(openClinicalPanel('R1:141336')).toBe(true);
    });
    expect(await screen.findByRole('dialog')).toHaveTextContent('Panel de Madre de prueba');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente paciente' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Panel de RN de prueba');
  });

  it('gives the focus back to the «Ficha clínica» access when the panel closes', async () => {
    render(
      <FichaAccess patientName="Paciente de prueba" panelKey="R2:141336">
        <ClinicalPanelTrigger
          bedId="R2"
          patientName="Paciente de prueba"
          patientRun="17.752.753-1"
          clinicalEpisodeId="141336"
        />
      </FichaAccess>
    );
    const ficha = screen.getByRole('button', { name: 'Abrir panel clínico de Paciente de prueba' });
    fireEvent.click(ficha);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar panel clínico' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ficha).toHaveFocus();
  });

  it('moves the episode-aware reports action into the clinical panel', async () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141336"
      />
    );
    expect(screen.queryByRole('button', { name: /informes de hospitalización/i })).toBeNull();
    openPanelOf('R2:141336');
    await screen.findByText('Panel de Paciente de prueba');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Abrir informes de hospitalización de Paciente de prueba',
      })
    );
    expect(await screen.findByTestId('reports-dialog')).toHaveTextContent(
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

  it('keeps report controllers unmounted across a census of 23 occupied beds', async () => {
    render(
      <>
        {Array.from({ length: 23 }, (_, index) => (
          <ClinicalPanelTrigger
            key={index}
            bedId={`bed-${index}`}
            patientName={`Synthetic ${index}`}
            patientRun=""
            clinicalEpisodeId={`episode-${index}`}
          />
        ))}
      </>
    );
    expect(mocks.reportMount).not.toHaveBeenCalled();
    openPanelOf('bed-0:episode-0');
    await screen.findByText('Panel de Synthetic 0');
    expect(mocks.reportMount).not.toHaveBeenCalled();
  });

  it('keeps only one panel mounted and mounts reports only on demand', async () => {
    render(
      <>
        <ClinicalPanelTrigger
          bedId="R1"
          patientName="Paciente A"
          patientRun=""
          clinicalEpisodeId="a"
        />
        <ClinicalPanelTrigger
          bedId="R2"
          patientName="Paciente B"
          patientRun=""
          clinicalEpisodeId="b"
        />
      </>
    );
    expect(mocks.reportMount).not.toHaveBeenCalled();
    openPanelOf('R1:a');
    await screen.findByText('Panel de Paciente A');
    expect(mocks.reportMount).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir informes de hospitalización de Paciente A' })
    );
    await screen.findByTestId('reports-dialog');
    openPanelOf('R2:b');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveTextContent('Panel de Paciente B');
    expect(screen.queryByTestId('reports-dialog')).toBeNull();
    openPanelOf('R1:a');
    expect(screen.queryByTestId('reports-dialog')).toBeNull();
  });

  it.each(['episode', 'date', 'run'])(
    'closes the panel when its %s identity changes',
    async field => {
      const props = {
        bedId: 'R1',
        patientName: 'Paciente A',
        patientRun: 'ID-A',
        clinicalEpisodeId: 'a',
        censusDate: '2026-09-05',
      };
      const { rerender } = render(<ClinicalPanelTrigger {...props} />);
      openPanelOf('R1:a');
      await screen.findByRole('dialog');
      rerender(
        <ClinicalPanelTrigger
          {...props}
          clinicalEpisodeId={field === 'episode' ? 'b' : props.clinicalEpisodeId}
          censusDate={field === 'date' ? '2026-09-06' : props.censusDate}
          patientRun={field === 'run' ? 'ID-B' : props.patientRun}
        />
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  );

  it('keeps clinical panel and episode reports available for a newborn without RUN', async () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente sin RUN"
        patientRun="ID temporal"
        clinicalEpisodeId="141336"
      />
    );
    expect(document.querySelector('[data-clinical-panel-key="R2:141336"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /informes de hospitalización/i })).toBeNull();
    openPanelOf('R2:141336');
    expect(
      await screen.findByRole('button', { name: /informes de hospitalización/i })
    ).toBeVisible();
  });
});
