import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { DischargesSection } from '@/features/census/components/DischargesSection';
import { DataFactory } from '@/tests/factories/DataFactory';
import { useDailyRecordData, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useDailyRecordMovementActions } from '@/context/useDailyRecordScopedActions';
import { useCensusActionCommands } from '@/features/census/context/censusActionContexts';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordMovementActions: vi.fn(),
}));

vi.mock('@/features/census/context/censusActionContexts', () => ({
  useCensusActionCommands: vi.fn(),
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
    vi.mocked(useDailyRecordData).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordData>>({
        record: DataFactory.createMockDailyRecord('2026-02-14'),
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
});
