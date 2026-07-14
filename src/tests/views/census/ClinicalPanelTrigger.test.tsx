import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/features/rayen-import', () => ({
  requestRayenEncounterNavigation: (...args: unknown[]) => mocks.navigate(...args),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mocks.success, error: mocks.error }),
}));

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
  ClinicalPanelDrawer: ({ patientName }: { patientName: string }) => (
    <div role="dialog">Panel de {patientName}</div>
  ),
}));

import { ClinicalPanelTrigger } from '@/features/census/components/patient-row/ClinicalPanelTrigger';

describe('ClinicalPanelTrigger', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
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
