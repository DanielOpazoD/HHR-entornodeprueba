import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DischargesSection } from '@/features/census/components/DischargesSection';
import { useCensusActionCommands } from '@/features/census/components/CensusActionsContext';
import {
  useDailyRecordData,
  useDailyRecordMovementActions,
  useDailyRecordMovements,
} from '@/context/DailyRecordContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { DataFactory } from '../../factories/DataFactory';

vi.mock('@/features/census/components/CensusActionsContext', () => ({
  useCensusActionCommands: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: vi.fn(),
  useDailyRecordMovementActions: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
  useNotification: vi.fn(),
}));

describe('DischargesSection', () => {
  const mockOnUndo = vi.fn();
  const mockOnDelete = vi.fn();
  const mockHandleEdit = vi.fn();
  const mockConfirm = vi.fn();
  const mockNotifyError = vi.fn();

  const mockDischarges = [
    DataFactory.createMockDischarge({
      id: '1',
      bedName: 'R1',
      patientName: 'John Doe',
      dischargeType: 'Domicilio (Habitual)',
    }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCensusActionCommands).mockReturnValue({
      handleEditDischarge: mockHandleEdit,
    } as any);
    vi.mocked(useConfirmDialog).mockReturnValue({ confirm: mockConfirm } as any);
    vi.mocked(useNotification).mockReturnValue({ error: mockNotifyError } as any);
    mockConfirm.mockResolvedValue(true);
    (useDailyRecordData as any).mockReturnValue({
      record: { date: '2024-12-11' },
    });
    (useDailyRecordMovementActions as any).mockReturnValue({
      undoDischarge: mockOnUndo,
      deleteDischarge: mockOnDelete,
    });
    // Default empty movements
    (useDailyRecordMovements as any).mockReturnValue({ discharges: [] });
  });

  it('renders empty message when no discharges', () => {
    (useDailyRecordMovements as any).mockReturnValue({
      discharges: [],
    });

    render(<DischargesSection />);
    expect(screen.getByText(/No hay altas registradas/)).toBeInTheDocument();
  });

  it('renders discharge list and triggers actions', async () => {
    (useDailyRecordMovements as any).mockReturnValue({
      discharges: mockDischarges,
    });

    render(<DischargesSection />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('(11-12-2024)')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
    await waitFor(() => {
      expect(mockOnUndo).toHaveBeenCalledWith('1');
    });

    fireEvent.click(screen.getByTitle('Editar'));
    expect(mockHandleEdit).toHaveBeenCalledWith(mockDischarges[0]);

    fireEvent.click(screen.getByTitle('Eliminar Registro'));
    await waitFor(() => {
      expect(mockOnDelete).toHaveBeenCalledWith('1');
    });
  });

  it('does not execute undo/delete when confirmation is rejected and ignores re-entrant click', async () => {
    mockConfirm.mockResolvedValue(false);
    (useDailyRecordMovements as any).mockReturnValue({
      discharges: mockDischarges,
    });

    render(<DischargesSection />);

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
    fireEvent.click(screen.getByTitle('Eliminar Registro'));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(1);
    });
    expect(mockOnUndo).not.toHaveBeenCalled();
    expect(mockOnDelete).not.toHaveBeenCalled();
  });

  it('shows error notification when confirm dialog fails', async () => {
    mockConfirm.mockRejectedValue(new Error('dialog failed'));
    (useDailyRecordMovements as any).mockReturnValue({
      discharges: mockDischarges,
    });

    render(<DischargesSection />);

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith(
        'No se pudo deshacer alta',
        expect.stringContaining('dialog failed')
      );
    });
    expect(mockOnUndo).not.toHaveBeenCalled();
  });

  it('returns null when discharges is null', () => {
    (useDailyRecordMovements as any).mockReturnValue({
      discharges: null,
    });

    const { container } = render(<DischargesSection />);
    expect(container.firstChild).toBeNull();
  });
});
