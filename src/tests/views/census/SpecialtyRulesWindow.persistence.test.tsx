import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), current: vi.fn() }));
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => ({
    R1: {
      patientName: 'Paciente sintético',
      cie10Code: 'F23',
      specialty: 'Psiquiatría',
    },
  }),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestoreDetailed: mocks.current,
}));
vi.mock('@/services/specialty/specialtyJevClient', () => ({
  loadSpecialtyRoundSetup: mocks.load,
  saveSpecialtyRules: mocks.save,
  describeSpecialtySetupError: () => 'Error sintético',
}));
import { SpecialtyRulesWindow } from '@/features/census/components/specialty-round/SpecialtyRulesWindow';
const setup = {
  labels: { F23: 'Diagnóstico sintético' },
  policy: {
    revision: 1,
    autoEnabled: true,
    memoryEnabled: false,
    memory: [],
    rules: [],
    aiMode: 'consultative',
  },
};
describe('specialty associations survive publication and reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(setup);
    mocks.current.mockResolvedValue({ status: 'missing', record: null });
  });
  it('deduplicates repeated staging, applies on save and reloads the persisted policy', async () => {
    mocks.save.mockImplementation(async (_policy, rules, autoEnabled) => {
      mocks.load.mockResolvedValue({
        ...setup,
        policy: { ...setup.policy, rules, autoEnabled, revision: 2 },
      });
      return { appliedDecisions: 1, applicationStatus: 'applied' };
    });
    const view = render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
    fireEvent.click(screen.getByRole('tab', { name: 'Hospitalizados' }));
    const add = screen.getByRole('button', { name: 'Añadir regla' });
    act(() => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 especialidad asignada');
    expect(mocks.save.mock.calls[0][1]).toHaveLength(1);
    expect(mocks.save.mock.calls[0][5]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    view.unmount();
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    expect(await screen.findByRole('combobox', { name: 'Regla para F23' })).toHaveValue(
      'Psiquiatría'
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
  });
  it('persists cancellation without applying a rule to the current census', async () => {
    mocks.save.mockImplementation(async () => {
      mocks.load.mockResolvedValue({
        ...setup,
        policy: { ...setup.policy, autoEnabled: false, revision: 2 },
      });
      return { appliedDecisions: 0, applicationStatus: 'not_requested' };
    });
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'asociación automática desactivada'
    );
    expect(mocks.save.mock.calls[0][2]).toBe(false);
    expect(mocks.save.mock.calls[0][5]).toBeUndefined();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it('supports keyboard navigation between internal tabs', async () => {
    render(<SpecialtyRulesWindow onClose={vi.fn()} />);
    const rules = screen.getByRole('tab', { name: 'Reglas' });
    rules.focus();
    fireEvent.keyDown(rules, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Hospitalizados' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Hospitalizados');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Hospitalizados' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveFocus();
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
  });
});
