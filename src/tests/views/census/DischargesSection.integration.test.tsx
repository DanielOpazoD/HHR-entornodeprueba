import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { DischargesSection } from '@/features/census/components/DischargesSection';
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

describe('DischargesSection integration', () => {
  const undoDischarge = vi.fn().mockResolvedValue(undefined);
  const deleteDischarge = vi.fn().mockResolvedValue(undefined);
  const handleEditDischarge = vi.fn();
  const dischargeItem = DataFactory.createMockDischarge({
    id: 'd-int-1',
    patientName: 'Paciente Integración Alta',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDailyRecordData).mockReturnValue({
      record: { date: '2026-02-14' },
    } as any);
    vi.mocked(useDailyRecordMovementActions).mockReturnValue({
      undoDischarge,
      deleteDischarge,
    } as any);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [dischargeItem],
      transfers: [],
      cma: [],
    } as any);
    vi.mocked(useCensusActionCommands).mockReturnValue({
      handleEditDischarge,
    } as any);
  });

  it('executes undo/edit/delete through real confirm dialog flow', async () => {
    render(
      <UIProvider>
        <DischargesSection />
      </UIProvider>
    );

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
    expect(await screen.findByText('Deshacer alta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => {
      expect(undoDischarge).toHaveBeenCalledWith('d-int-1');
    });

    fireEvent.click(screen.getByTitle('Editar'));
    expect(handleEditDischarge).toHaveBeenCalledWith(dischargeItem);

    fireEvent.click(screen.getByTitle('Eliminar Registro'));
    expect(await screen.findByText('Eliminar alta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(screen.queryByText('Eliminar alta')).not.toBeInTheDocument();
    });
    expect(deleteDischarge).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Eliminar Registro'));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => {
      expect(deleteDischarge).toHaveBeenCalledWith('d-int-1');
    });
  });
});
