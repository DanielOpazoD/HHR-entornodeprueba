import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { DischargesSection } from '@/features/census/components/DischargesSection';
import { DataFactory } from '@/tests/factories/DataFactory';
import { useDailyRecordStaff, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useDailyRecordMovementActions } from '@/context/useDailyRecordScopedActions';
import { useCensusActionCommands } from '@/features/census/context/censusActionContexts';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStaff: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordMovementActions: vi.fn(),
}));

vi.mock('@/features/census/context/censusActionContexts', () => ({
  useCensusActionCommands: vi.fn(),
}));

const access = vi.hoisted(() => ({ role: 'nurse_hospital', canPerformActions: true }));
vi.mock('@/context/AuthContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/context/AuthContext')>()),
  useAuth: () => ({ role: access.role }),
}));
vi.mock('@/hooks/useStabilityRules', () => ({
  useStabilityRules: () => ({ canPerformActions: access.canPerformActions }),
}));

const markClinicalEpisodeInvalid = vi.hoisted(() => vi.fn());
const cleanAndDescribePreviousDay = vi.hoisted(() => vi.fn());
vi.mock('@/features/census/controllers/invalidEpisodePreviousDayCleanup', () => ({
  cleanAndDescribePreviousDay,
}));
vi.mock('@/services/census/invalidClinicalEpisodeService', () => ({
  markClinicalEpisodeInvalid,
}));

vi.mock('@/hooks/useScrollLock', () => ({
  useScrollLock: () => {},
  default: () => {},
}));

describe('DischargesSection integration', () => {
  const asHookValue = <T,>(value: Partial<T>): T => value as T;
  const undoDischarge = vi.fn().mockResolvedValue(undefined);
  const deleteDischarge = vi.fn().mockResolvedValue(undefined);
  const handleEditDischarge = vi.fn();
  const dischargeItem = DataFactory.createMockDischarge({
    id: 'd-int-1',
    patientName: 'Paciente Integración Alta',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordStaff>>({
        date: '2026-02-14',
      })
    );
    vi.mocked(useDailyRecordMovementActions).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordMovementActions>>({
        undoDischarge,
        deleteDischarge,
      })
    );
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordMovements>>({
        discharges: [dischargeItem],
        transfers: [],
        cma: [],
      })
    );
    vi.mocked(useCensusActionCommands).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusActionCommands>>({
        handleEditDischarge,
      })
    );
  });

  it('executes undo/edit/delete through real confirm dialog flow', async () => {
    render(
      <UIProvider>
        <DischargesSection />
      </UIProvider>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deshacer (Restaurar a Cama)' }));
    expect(await screen.findByText('Deshacer alta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => {
      expect(undoDischarge).toHaveBeenCalledWith('d-int-1');
    });

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    expect(handleEditDischarge).toHaveBeenCalledWith(dischargeItem);

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eliminar Registro' }));
    expect(await screen.findByText('Eliminar alta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(screen.queryByText('Eliminar alta')).not.toBeInTheDocument();
    });
    expect(deleteDischarge).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eliminar Registro' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => {
      expect(deleteDischarge).toHaveBeenCalledWith('d-int-1');
    });
  });

  describe('paciente no válido', () => {
    const duplicate = DataFactory.createMockDischarge({
      id: 'd-dup',
      bedId: 'NEO1',
      patientName: 'Paciente Duplicada',
      clinicalEpisodeId: '900200',
    });

    beforeEach(() => {
      access.role = 'nurse_hospital';
      access.canPerformActions = true;
      vi.mocked(useDailyRecordMovements).mockReturnValue(
        asHookValue<ReturnType<typeof useDailyRecordMovements>>({
          discharges: [duplicate],
          transfers: [],
          cma: [],
        })
      );
    });

    const markFromMenu = async () => {
      render(
        <UIProvider>
          <DischargesSection />
        </UIProvider>
      );
      fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Paciente no válido' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Sí, eliminar' }));
    };

    it('marks the episode and then removes its alta', async () => {
      markClinicalEpisodeInvalid.mockResolvedValue(undefined);
      cleanAndDescribePreviousDay.mockResolvedValue(null);

      await markFromMenu();

      await waitFor(() => expect(deleteDischarge).toHaveBeenCalledWith('d-dup'));
      expect(markClinicalEpisodeInvalid).toHaveBeenCalledWith({
        clinicalEpisodeId: '900200',
        censusDate: '2026-02-14',
        bedId: 'NEO1',
      });
    });

    it('also cleans the previous day and tells what is left to review', async () => {
      markClinicalEpisodeInvalid.mockResolvedValue(undefined);
      cleanAndDescribePreviousDay.mockResolvedValue('El 13-02-2026 está firmado y no se modificó.');

      await markFromMenu();

      await waitFor(() =>
        expect(cleanAndDescribePreviousDay).toHaveBeenCalledWith(
          expect.objectContaining({ censusDate: '2026-02-14', clinicalEpisodeId: '900200' })
        )
      );
      expect(
        await screen.findByText('El 13-02-2026 está firmado y no se modificó.')
      ).toBeInTheDocument();
    });

    it('keeps the alta when the mark cannot be saved', async () => {
      markClinicalEpisodeInvalid.mockRejectedValue(new Error('offline'));

      await markFromMenu();

      expect(await screen.findByText(/No se eliminó nada/)).toBeInTheDocument();
      expect(deleteDischarge).not.toHaveBeenCalled();
    });

    it.each([
      ['a role that cannot edit the census', () => (access.role = 'viewer')],
      ['a day closed to actions', () => (access.canPerformActions = false)],
    ])('is not offered on %s', async (_case, restrict) => {
      restrict();
      render(
        <UIProvider>
          <DischargesSection />
        </UIProvider>
      );
      fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
      await screen.findByRole('menuitem', { name: 'Editar' });

      expect(screen.queryByRole('menuitem', { name: 'Paciente no válido' })).toBeNull();
      expect(markClinicalEpisodeInvalid).not.toHaveBeenCalled();
    });

    it('is not offered for an alta without an Eloísa episode', async () => {
      vi.mocked(useDailyRecordMovements).mockReturnValue(
        asHookValue<ReturnType<typeof useDailyRecordMovements>>({
          discharges: [dischargeItem],
          transfers: [],
          cma: [],
        })
      );
      render(
        <UIProvider>
          <DischargesSection />
        </UIProvider>
      );
      fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
      await screen.findByRole('menuitem', { name: 'Editar' });

      expect(screen.queryByRole('menuitem', { name: 'Paciente no válido' })).toBeNull();
    });
  });
});
