import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpecialtyChip } from '@/features/census/components/patient-row/SpecialtyChip';
import { useDailyRecordWriteStatus } from '@/hooks/useDailyRecordWriteStatus';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';

const fixture = vi.hoisted(() => ({
  date: '2026-09-24',
  beds: {
    R1: {
      bedId: 'R1',
      bedName: 'R1',
      patientName: 'Paciente sintético',
      clinicalEpisodeId: 'synthetic-episode',
      cie10Code: 'F23',
      specialty: '',
    },
  },
  load: vi.fn(),
  assign: vi.fn(),
  saveRules: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => fixture.beds,
  useDailyRecordData: () => ({ record: { date: fixture.date, beds: fixture.beds } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ role: 'admin' }) }));
vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name !== 'SPECIALTY_RULES_MEMORY',
}));
vi.mock('@/hooks/useDailyRecordFreshnessUi', () => ({
  useDailyRecordFreshnessUi: () => ({ isClinicalEditingBlocked: false }),
}));
vi.mock('@/utils/clinicalTimeZone', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/clinicalTimeZone')>()),
  getClinicalCalendarDateISO: () => fixture.date,
}));
vi.mock('@/services/specialty/specialtyJevClient', () => ({
  loadSpecialtyRoundSetup: fixture.load,
  assignSpecialtyManually: fixture.assign,
  saveSpecialtyRules: fixture.saveRules,
  resolveSpecialtyJevLabel: () => 'Trastorno sintético',
  describeSpecialtySetupError: (error: unknown) => String(error),
}));

// Reproduce the register's transient readOnly prop while mounting the real chip, entry and windows.
const CensusChip = ({ readOnly = false }: { readOnly?: boolean }) => {
  const { isSyncCommit } = useDailyRecordWriteStatus(fixture.date);
  return (
    <SpecialtyChip
      specialty=""
      censusDate={fixture.date}
      scope={{ date: fixture.date, bedId: 'R1', target: 'bed', episodeId: 'synthetic-episode' }}
      readOnly={readOnly || isSyncCommit}
      onAssign={fixture.assign}
    />
  );
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const openTool = async (name: string) => {
  fireEvent.click(screen.getByTitle('Asignar especialidad'));
  fireEvent.click(
    await screen.findByTitle('Opciones de especialidades del censo', {}, { timeout: 10000 })
  );
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('specialty windows opened from a census chip during sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.load.mockResolvedValue({
      labels: { F23: 'Trastorno sintético' },
      policy: {
        revision: 1,
        autoEnabled: false,
        memoryEnabled: false,
        aiMode: 'consultative',
        rules: [],
        memory: [],
      },
    });
    fixture.assign.mockResolvedValue(undefined);
    fixture.saveRules.mockResolvedValue(undefined);
  });

  it.each(['clinical_sync', 'structural_sync'] as const)(
    'keeps a pending round choice mounted through a %s turn',
    async kind => {
      render(<CensusChip />);
      await openTool('Asignar especialidades');
      const choice = await screen.findByRole(
        'combobox',
        { name: 'Especialidad de R1' },
        { timeout: 10000 }
      );
      fireEvent.change(choice, { target: { value: 'Psiquiatría' } });
      const gate = deferred();
      let write!: Promise<void>;
      try {
        await act(async () => {
          write = runExclusiveDailyRecordWrite(fixture.date, () => gate.promise, { kind });
        });
        expect(screen.getByRole('combobox', { name: 'Especialidad de R1' })).toBe(choice);
        expect(choice).toHaveValue('Psiquiatría');
        expect(choice).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar 1 asignación' }));
        expect(fixture.assign).not.toHaveBeenCalled();
        await act(async () => {
          gate.resolve();
          await write;
        });
        expect(choice).toBeEnabled();
        expect(choice).toHaveValue('Psiquiatría');
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar 1 asignación' }));
        await waitFor(() => expect(fixture.assign).toHaveBeenCalledOnce());
      } finally {
        gate.resolve();
        await write;
      }
    }
  );

  it('keeps a rules draft while pausing publication and retains permanent restrictions afterward', async () => {
    const view = render(<CensusChip />);
    await openTool('Reglas automáticas');
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Código CIE-10' }, { timeout: 10000 }),
      {
        target: { value: 'F23' },
      }
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Especialidad de la nueva regla' }), {
      target: { value: 'Psiquiatría' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    const rule = screen.getByRole('combobox', { name: 'Regla para F23' });
    const gate = deferred();
    let write!: Promise<void>;
    try {
      await act(async () => {
        write = runExclusiveDailyRecordWrite(fixture.date, () => gate.promise, {
          kind: 'clinical_sync',
        });
      });
      expect(screen.getByRole('combobox', { name: 'Regla para F23' })).toBe(rule);
      expect(rule).toHaveValue('Psiquiatría');
      expect(rule).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cerrar' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
      expect(fixture.saveRules).not.toHaveBeenCalled();
      view.rerender(<CensusChip readOnly />);
      await act(async () => {
        gate.resolve();
        await write;
      });
      expect(rule).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
      view.rerender(<CensusChip />);
      expect(rule).toBeEnabled();
      expect(rule).toHaveValue('Psiquiatría');
      fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }));
      await waitFor(() => expect(fixture.saveRules).toHaveBeenCalledOnce());
      expect(fixture.saveRules.mock.calls[0][1]).toEqual([
        expect.objectContaining({ cie10Code: 'F23', specialty: 'Psiquiatría' }),
      ]);
    } finally {
      gate.resolve();
      await write;
    }
  });
});
