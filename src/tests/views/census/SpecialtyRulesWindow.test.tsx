import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => ({ R1: { patientName: 'Paciente sintético',
    cie10Code: 'F23', cie10Description: 'Trastornos psicóticos agudos y transitorios' } }),
}));
vi.mock('@/services/specialty/specialtyJevClient', () => ({
  loadSpecialtyRoundSetup: service.load,
  saveSpecialtyRules: service.save,
  describeSpecialtySetupError: (error: unknown) => String(error),
}));

import { SpecialtyRulesWindow } from '@/features/census/components/specialty-round/SpecialtyRulesWindow';

describe('admin specialty rules panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.load.mockResolvedValue({
      labels: { 'J18.9': 'Neumonía, no especificada' },
      policy: { revision: 4, autoEnabled: false, memoryEnabled: false,
        aiMode: 'consultative', rules: [] },
    });
    service.save.mockResolvedValue(undefined);
  });

  it('publishes a current three-character CIE-10 association under revision CAS', async () => {
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Código CIE-10' }),
      { target: { value: 'F23' } });
    expect(screen.getByText('Trastornos psicóticos agudos y transitorios')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Especialidad de la nueva regla' }),
      { target: { value: 'Psiquiatría' } });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Activar asociación automática/ }));
    expect(service.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
    await waitFor(() => expect(service.save).toHaveBeenCalledOnce());
    expect(service.save.mock.calls[0][0]).toMatchObject({ revision: 4, aiMode: 'consultative' });
    expect(service.save.mock.calls[0][1]).toEqual([{
      id: 'clinical_F23', kind: 'assign', cie10Code: 'F23', specialty: 'Psiquiatría',
      scope: 'all', revision: 1,
    }]);
    expect(service.save.mock.calls[0][2]).toBe(true);
  });

  it('offers explicit pilot setup when the catalog has not been published', async () => {
    service.load.mockResolvedValue({ labels: { 'J18.9': 'Neumonía' },
      policy: { revision: 0, autoEnabled: false, memoryEnabled: false,
        aiMode: 'off', rules: [] } });
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Configurar piloto Jev' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Configurar piloto Jev' }));
    await waitFor(() => expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 0, aiMode: 'off' }), [], false, true
    ));
  });
});
