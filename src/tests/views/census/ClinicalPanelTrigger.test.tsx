import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveNavigation: vi.fn(), reportMount: vi.fn() }));

vi.mock('@/features/census/controllers/clinicalPanelNavigationController', () => ({
  resolveClinicalPanelNavigation: (...args: unknown[]) => mocks.resolveNavigation(...args),
}));

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
  ClinicalPanelDrawer: ({
    patientName,
    encounterRouteHint,
    admissionDate,
    censusDate,
    onNavigateNext,
    onOpenHospitalizationReports,
  }: {
    patientName: string;
    encounterRouteHint?: 'medical' | 'nurse';
    admissionDate?: string;
    censusDate?: string;
    onNavigateNext: () => void;
    onOpenHospitalizationReports: () => void;
  }) => (
    <div role="dialog">
      Panel de {patientName}
      <span data-testid="drawer-route">{encounterRouteHint || 'sin ruta'}</span>
      <span data-testid="drawer-date-range">{`${admissionDate || ''}|${censusDate || ''}`}</span>
      <button type="button" onClick={onNavigateNext}>
        Siguiente paciente
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
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir panel clínico de Paciente de prueba' })
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent('Panel de Paciente de prueba');
    expect(screen.getByTestId('drawer-date-range')).toHaveTextContent('2026-07-13|2026-07-18');
  });

  it('resolves the next patient again when the navigation arrow is pressed', async () => {
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
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente paciente' }));

    expect(mocks.resolveNavigation.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(staleClick).not.toHaveBeenCalled();
    expect(activeClick).toHaveBeenCalledTimes(1);
  });

  it('opens the adjacent patient with that patient route hint', async () => {
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
    expect(await screen.findByTestId('drawer-route')).toHaveTextContent('nurse');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente paciente' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Panel de Paciente sincronizado');
    expect(screen.getByTestId('drawer-route')).toHaveTextContent('medical');
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
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir panel clínico de Paciente de prueba' })
    );
    await screen.findByRole('dialog');
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
    fireEvent.click(screen.getByRole('button', { name: 'Abrir panel clínico de Synthetic 0' }));
    await screen.findByRole('dialog');
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
    fireEvent.click(screen.getByRole('button', { name: 'Abrir panel clínico de Paciente A' }));
    await screen.findByRole('dialog');
    expect(mocks.reportMount).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir informes de hospitalización de Paciente A' })
    );
    await screen.findByTestId('reports-dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir panel clínico de Paciente B' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveTextContent('Panel de Paciente B');
    expect(screen.queryByTestId('reports-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir panel clínico de Paciente A' }));
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
      fireEvent.click(screen.getByRole('button', { name: 'Abrir panel clínico de Paciente A' }));
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
    expect(
      screen.getByRole('button', { name: 'Abrir panel clínico de Paciente sin RUN' })
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /informes de hospitalización/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /abrir panel clínico/i }));
    expect(
      await screen.findByRole('button', { name: /informes de hospitalización/i })
    ).toBeVisible();
  });
});
