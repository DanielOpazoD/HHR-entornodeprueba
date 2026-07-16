import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  resolveNavigation: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/features/rayen-import', () => ({
  requestRayenEncounterNavigation: (...args: unknown[]) => mocks.navigate(...args),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mocks.success, error: mocks.error }),
}));

vi.mock('@/features/census/controllers/clinicalPanelNavigationController', () => ({
  resolveClinicalPanelNavigation: (...args: unknown[]) => mocks.resolveNavigation(...args),
}));

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
  ClinicalPanelDrawer: ({
    patientName,
    onNavigateNext,
  }: {
    patientName: string;
    onNavigateNext: () => void;
  }) => (
    <div role="dialog">
      Panel de {patientName}
      <button type="button" onClick={onNavigateNext}>
        Siguiente paciente
      </button>
    </div>
  ),
}));

import { ClinicalPanelTrigger } from '@/features/census/components/patient-row/ClinicalPanelTrigger';

describe('ClinicalPanelTrigger', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.resolveNavigation.mockReset();
    mocks.resolveNavigation.mockReturnValue({ previous: null, next: null });
    mocks.success.mockReset();
    mocks.error.mockReset();
  });

  it('preserves the live clinical panel action', () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
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

  it('opens the exact synced encounter and reports a reused tab', async () => {
    mocks.navigate.mockResolvedValue({ ok: true, reused: true });
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141336"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir a Paciente de prueba en Eloísa' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('141336'));
    expect(mocks.success).toHaveBeenCalledWith(
      'Eloísa abierta',
      'Se activó la pestaña de Ficha Médico en el episodio seleccionado.'
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('shows the extension error without opening the clinical drawer', async () => {
    mocks.navigate.mockResolvedValue({
      ok: false,
      reused: false,
      error: 'No hay una pestaña disponible.',
    });
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        clinicalEpisodeId="141336"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir a Paciente de prueba en Eloísa' }));

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        'No se pudo abrir Eloísa',
        'No hay una pestaña disponible.'
      )
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render bridge actions without a synced episode', () => {
    const { container } = render(
      <ClinicalPanelTrigger bedId="R2" patientName="Paciente de prueba" clinicalEpisodeId="" />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
