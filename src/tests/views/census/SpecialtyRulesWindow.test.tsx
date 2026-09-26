import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), history: vi.fn(), current: vi.fn() }));
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => ({ R1: { patientName: 'Paciente sintético',
    cie10Code: 'F23', cie10Description: 'Trastornos psicóticos agudos y transitorios',
    specialty: 'Psiquiatría' } }),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordsRangeFromFirestore: service.history,
  getRecordFromFirestoreDetailed: service.current,
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
        aiMode: 'consultative', rules: [], memory: [] },
    });
    service.save.mockResolvedValue(undefined);
    service.history.mockResolvedValue([]);
    service.current.mockResolvedValue({ status: 'missing', record: null });
  });

  it('publishes a current three-character CIE-10 association under revision CAS', async () => {
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Código CIE-10' }),
      { target: { value: 'F23' } });
    expect(screen.getAllByText('Trastornos psicóticos agudos y transitorios').length)
      .toBeGreaterThan(0);
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
        aiMode: 'off', rules: [], memory: [] } });
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Configurar piloto Jev' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Configurar piloto Jev' }));
    await waitFor(() => expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 0, aiMode: 'off' }), [], false, true, []
    ));
  });

  it('allows an exact-code rule when a valid CIE-10 code has no catalog description', async () => {
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Código CIE-10' }),
      { target: { value: 'Z99.9' } });
    expect(screen.getByText(/Código válido sin descripción en el catálogo/)).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Especialidad de la nueva regla' }),
      { target: { value: 'Med Interna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
    await waitFor(() => expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4 }),
      [expect.objectContaining({ cie10Code: 'Z99.9', specialty: 'Med Interna' })],
      false, false, []
    ));
  });

  it('lists current occupied-bed diagnoses and stages an editable rule without publishing', async () => {
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    expect(await screen.findByRole('region', { name: 'Diagnósticos de pacientes hospitalizados' }))
      .toHaveTextContent('F23');
    fireEvent.click(screen.getByRole('button', { name: 'Añadir regla' }));
    expect(service.save).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Regla para F23' })).toHaveValue('Psiquiatría');
    fireEvent.change(screen.getByRole('combobox', { name: 'Regla para F23' }),
      { target: { value: 'Med Interna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
    await waitFor(() => expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4 }),
      [expect.objectContaining({ cie10Code: 'F23', specialty: 'Med Interna', revision: 2 })],
      false, false, []
    ));
  });

  it('loads one historical census month on demand and offers observed pairings as staged rules',
    async () => {
      service.history.mockResolvedValue([{
        date: '2026-09-10', beds: {
          R1: { patientName: 'Paciente sintético', cie10Code: 'J18.9',
            specialty: 'Med Interna', isBlocked: false },
        },
      }]);
      render(<SpecialtyRulesWindow onClose={vi.fn()} />);
      await screen.findByRole('textbox', { name: 'Código CIE-10' });
      fireEvent.change(screen.getByLabelText('Mes del censo'), { target: { value: '2026-09' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ver diagnósticos históricos' }));
      expect(await screen.findByText(/1 observación/)).toBeVisible();
      expect(service.history).toHaveBeenCalledWith(expect.any(String), expect.any(String),
        { requireServer: true });
      fireEvent.click(screen.getByRole('button', { name: 'Usar como regla' }));
      expect(service.save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
      await waitFor(() => expect(service.save).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 4 }),
        [expect.objectContaining({ cie10Code: 'J18.9', specialty: 'Med Interna' })],
        false, false, []
      ));
    });

  it('shows remembered associations and saves an explicit edit under the same policy revision',
    async () => {
      service.load.mockResolvedValue({ labels: { 'J18.9': 'Neumonía' },
        policy: { revision: 4, autoEnabled: false, memoryEnabled: true,
          aiMode: 'consultative', rules: [], memory: [{ id: 'memory_J18_9',
            kind: 'assign', cie10Code: 'J18.9', specialty: 'Med Interna',
            scope: 'all', revision: 1 }] } });
      render(<SpecialtyRulesWindow onClose={vi.fn()} />);
      fireEvent.change(await screen.findByRole('combobox', {
        name: 'Asociación recordada para J18.9',
      }), { target: { value: 'Pediatría' } });
      fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
      await waitFor(() => expect(service.save).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 4 }), [], false, false,
        [expect.objectContaining({ cie10Code: 'J18.9', specialty: 'Pediatría', revision: 2 })]
      ));
    });

  it('uses the live-day server record when the panel opens from an earlier census', async () => {
    service.current.mockResolvedValue({ status: 'resolved', record: { beds: {
      R2: { patientName: 'Paciente vigente', cie10Code: 'J18.9', specialty: 'Med Interna' },
    } } });
    render(<SpecialtyRulesWindow date="2026-09-01" onClose={vi.fn()} />);
    const current = await screen.findByRole('region', {
      name: 'Diagnósticos de pacientes hospitalizados',
    });
    await waitFor(() => expect(current).toHaveTextContent('J18.9'));
    expect(current).not.toHaveTextContent('F23');
    expect(service.current).toHaveBeenCalledWith(expect.any(String), { source: 'server' });
  });

  it('blocks publishing while active memory is unavailable from an older callable', async () => {
    service.load.mockResolvedValue({ labels: {}, policy: { revision: 4, autoEnabled: false,
      memoryEnabled: true, memoryAvailable: false, aiMode: 'consultative', rules: [], memory: [] } });
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    expect(await screen.findByText(/El servidor aún no entrega asociaciones recordadas/))
      .toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir regla' }));
    expect(screen.getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
    expect(service.save).not.toHaveBeenCalled();
  });

  it('removes contradictory active memory when an existing rule is edited directly', async () => {
    service.load.mockResolvedValue({ labels: { F23: 'Trastorno psicótico' },
      policy: { revision: 4, autoEnabled: true, memoryEnabled: true,
        aiMode: 'consultative', rules: [{ id: 'clinical_F23', kind: 'assign',
          cie10Code: 'F23', specialty: 'Psiquiatría', scope: 'all', revision: 1 }],
        memory: [{ id: 'memory_F23', kind: 'assign', cie10Code: 'F23',
          specialty: 'Psiquiatría', scope: 'all', revision: 1 }] } });
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Regla para F23' }),
      { target: { value: 'Med Interna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
    await waitFor(() => expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4 }),
      [expect.objectContaining({ cie10Code: 'F23', specialty: 'Med Interna' })],
      true, false, []
    ));
  });

  it('omits the specialty key when a remembered association becomes manual review', async () => {
    service.load.mockResolvedValue({ labels: { F23: 'Trastorno psicótico' },
      policy: { revision: 4, autoEnabled: true, memoryEnabled: true,
        aiMode: 'consultative', rules: [], memory: [{ id: 'memory_F23', kind: 'assign',
          cie10Code: 'F23', specialty: 'Psiquiatría', scope: 'all', revision: 1 }] } });
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    fireEvent.change(await screen.findByRole('combobox', {
      name: 'Asociación recordada para F23',
    }), { target: { value: 'review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
    await waitFor(() => expect(service.save).toHaveBeenCalledOnce());
    expect(service.save.mock.calls[0][4]).toEqual([{
      id: 'memory_F23', kind: 'review', cie10Code: 'F23', scope: 'all', revision: 2,
    }]);
  });

  it('refuses a remembered edit that would contradict an explicit rule', async () => {
    service.load.mockResolvedValue({ labels: { F23: 'Trastorno psicótico' },
      policy: { revision: 4, autoEnabled: true, memoryEnabled: true,
        aiMode: 'consultative', rules: [{ id: 'clinical_F23', kind: 'assign',
          cie10Code: 'F23', specialty: 'Med Interna', scope: 'all', revision: 1 }],
        memory: [{ id: 'memory_F23', kind: 'assign', cie10Code: 'F23',
          specialty: 'Med Interna', scope: 'all', revision: 1 }] } });
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    const select = await screen.findByRole('combobox', {
      name: 'Asociación recordada para F23',
    });
    fireEvent.change(select, { target: { value: 'Pediatría' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Edítala primero');
    expect(select).toHaveValue('Med Interna');
    expect(screen.getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
    expect(service.save).not.toHaveBeenCalled();
  });
});
