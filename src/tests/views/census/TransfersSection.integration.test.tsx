import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { TransfersSection } from '@/features/census/components/TransfersSection';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  useDailyRecordData,
  useDailyRecordMovementActions,
  useDailyRecordMovements,
} from '@/context/DailyRecordContext';
import { useCensusActionCommands } from '@/features/census/components/CensusActionsContext';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: vi.fn(),
  useDailyRecordMovementActions: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

vi.mock('@/features/census/components/CensusActionsContext', () => ({
  useCensusActionCommands: vi.fn(),
}));

vi.mock('@/hooks/useScrollLock', () => ({
  useScrollLock: () => {},
  default: () => {},
}));

describe('TransfersSection integration', () => {
  const undoTransfer = vi.fn().mockResolvedValue(undefined);
  const deleteTransfer = vi.fn().mockResolvedValue(undefined);
  const handleEditTransfer = vi.fn();
  const transferItem = DataFactory.createMockTransfer({
    id: 't-int-1',
    patientName: 'Paciente Integración Traslado',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDailyRecordData).mockReturnValue({
      record: { date: '2026-02-14' },
    } as any);
    vi.mocked(useDailyRecordMovementActions).mockReturnValue({
      undoTransfer,
      deleteTransfer,
    } as any);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [transferItem],
      cma: [],
    } as any);
    vi.mocked(useCensusActionCommands).mockReturnValue({
      handleEditTransfer,
    } as any);
  });

  it('executes undo/edit/delete through real confirm dialog flow', async () => {
    render(
      <UIProvider>
        <TransfersSection />
      </UIProvider>
    );

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
    expect(await screen.findByText('Deshacer traslado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => {
      expect(undoTransfer).toHaveBeenCalledWith('t-int-1');
    });

    fireEvent.click(screen.getByTitle('Editar'));
    expect(handleEditTransfer).toHaveBeenCalledWith(transferItem);

    fireEvent.click(screen.getByTitle('Eliminar Registro'));
    expect(await screen.findByText('Eliminar traslado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(screen.queryByText('Eliminar traslado')).not.toBeInTheDocument();
    });
    expect(deleteTransfer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Eliminar Registro'));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => {
      expect(deleteTransfer).toHaveBeenCalledWith('t-int-1');
    });
  });
});
