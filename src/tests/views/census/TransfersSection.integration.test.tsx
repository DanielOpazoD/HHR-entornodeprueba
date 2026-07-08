import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { TransfersSection } from '@/features/census/components/TransfersSection';
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

describe('TransfersSection integration', () => {
  const asHookValue = <T,>(value: Partial<T>): T => value as T;
  const undoTransfer = vi.fn().mockResolvedValue(undefined);
  const deleteTransfer = vi.fn().mockResolvedValue(undefined);
  const handleEditTransfer = vi.fn();
  const transferItem = DataFactory.createMockTransfer({
    id: 't-int-1',
    patientName: 'Paciente Integración Traslado',
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
        undoTransfer,
        deleteTransfer,
      })
    );
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordMovements>>({
        discharges: [],
        transfers: [transferItem],
        cma: [],
      })
    );
    vi.mocked(useCensusActionCommands).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusActionCommands>>({
        handleEditTransfer,
      })
    );
  });

  const clickTransferMenuAction = (name: string) => {
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name }));
  };

  it('executes undo/edit/delete through real confirm dialog flow', async () => {
    render(
      <UIProvider>
        <TransfersSection />
      </UIProvider>
    );

    clickTransferMenuAction('Deshacer (Restaurar a Cama)');
    expect(await screen.findByText('Deshacer traslado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => {
      expect(undoTransfer).toHaveBeenCalledWith('t-int-1');
    });

    clickTransferMenuAction('Editar');
    expect(handleEditTransfer).toHaveBeenCalledWith(transferItem);

    clickTransferMenuAction('Eliminar Registro');
    expect(await screen.findByText('Eliminar traslado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(screen.queryByText('Eliminar traslado')).not.toBeInTheDocument();
    });
    expect(deleteTransfer).not.toHaveBeenCalled();

    clickTransferMenuAction('Eliminar Registro');
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => {
      expect(deleteTransfer).toHaveBeenCalledWith('t-int-1');
    });
  });
});
