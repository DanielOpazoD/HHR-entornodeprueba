import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const moduleGate = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  return { pending, release };
});

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', async () => {
  await moduleGate.pending;
  return {
    ClinicalPanelDrawer: () => <aside role="dialog">Ficha clínica cargada</aside>,
  };
});

import { ClinicalPanelTrigger } from '@/features/census/components/patient-row/ClinicalPanelTrigger';

describe('clinical panel deferred import', () => {
  it('shows a usable drawer immediately and replaces it when the module arrives', async () => {
    render(
      <ClinicalPanelTrigger
        bedId="R2"
        patientName="Paciente de prueba"
        patientRun="17.752.753-1"
        clinicalEpisodeId="141336"
      />
    );
    const trigger = screen.getByRole('button', {
      name: 'Abrir panel clínico de Paciente de prueba',
    });

    fireEvent.click(trigger);
    const loadingDrawer = screen.getByTestId('clinical-panel-module-loading');
    expect(loadingDrawer).toHaveAttribute('aria-busy', 'true');
    expect(loadingDrawer).toHaveTextContent('Abriendo ficha clínica…');
    expect(loadingDrawer).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('clinical-panel-module-loading')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByTestId('clinical-panel-module-loading')).toBeInTheDocument();
    moduleGate.release();
    expect(await screen.findByText('Ficha clínica cargada')).toBeInTheDocument();
    expect(screen.queryByTestId('clinical-panel-module-loading')).not.toBeInTheDocument();
  });
});
