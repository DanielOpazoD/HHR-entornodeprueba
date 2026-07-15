import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DischargesSection } from '@/features/census/components/DischargesSection';
import { useCensusActionCommands } from '@/features/census/context/censusActionContexts';
import { useDailyRecordData, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useDailyRecordMovementActions } from '@/context/useDailyRecordScopedActions';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { DataFactory } from '../../factories/DataFactory';

vi.mock('@/features/census/context/censusActionContexts', () => ({
  useCensusActionCommands: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordMovementActions: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
  useNotification: vi.fn(),
}));

describe('DischargesSection', () => {
  type CensusActionCommandsValue = ReturnType<typeof useCensusActionCommands>;
  type DataValue = ReturnType<typeof useDailyRecordData>;
  type MovementActionsValue = ReturnType<typeof useDailyRecordMovementActions>;
  type MovementsValue = ReturnType<typeof useDailyRecordMovements>;
  type ConfirmDialogValue = ReturnType<typeof useConfirmDialog>;
  type NotificationValue = ReturnType<typeof useNotification>;

  const mockOnUndo = vi.fn();
  const mockOnDelete = vi.fn();
  const mockConvertDischargeToCma = vi.fn();
  const mockConvertDischargeToTransfer = vi.fn();
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
    } as unknown as CensusActionCommandsValue);
    vi.mocked(useConfirmDialog).mockReturnValue({
      confirm: mockConfirm,
    } as unknown as ConfirmDialogValue);
    vi.mocked(useNotification).mockReturnValue({
      error: mockNotifyError,
    } as unknown as NotificationValue);
    mockConfirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordData).mockReturnValue({
      record: { date: '2024-12-11' },
    } as unknown as DataValue);
    vi.mocked(useDailyRecordMovementActions).mockReturnValue({
      undoDischarge: mockOnUndo,
      deleteDischarge: mockOnDelete,
      convertDischargeToCma: mockConvertDischargeToCma,
      convertDischargeToTransfer: mockConvertDischargeToTransfer,
    } as unknown as MovementActionsValue);
    // Default empty movements
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
    } as unknown as MovementsValue);
  });

  it('renders empty message when no discharges', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
    } as unknown as MovementsValue);

    render(<DischargesSection />);
    expect(screen.getByText(/No hay altas registradas/)).toBeInTheDocument();
  });

  it('renders discharge list and triggers actions', async () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: mockDischarges,
    } as unknown as MovementsValue);

    render(<DischargesSection />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('(11-12-2024)')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /deshacer/i }));
    await waitFor(() => {
      expect(mockOnUndo).toHaveBeenCalledWith('1');
    });

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^editar$/i }));
    expect(mockHandleEdit).toHaveBeenCalledWith(mockDischarges[0]);

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /eliminar/i }));
    await waitFor(() => {
      expect(mockOnDelete).toHaveBeenCalledWith('1');
    });
  });

  it('converts a discharge into CMA from the shared actions menu', async () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: mockDischarges,
    } as unknown as MovementsValue);

    render(<DischargesSection />);

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /convertir a cma/i }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Convertir alta domicilio a CMA',
        })
      );
      expect(mockConvertDischargeToCma).toHaveBeenCalledWith('1');
    });
  });

  it('converts a home discharge into a transfer from the shared actions menu', async () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: mockDischarges,
    } as unknown as MovementsValue);

    render(<DischargesSection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /convertir a traslado/i }));

    await waitFor(() => {
      expect(mockConvertDischargeToTransfer).toHaveBeenCalledWith('1');
    });
  });

  it('does not execute undo/delete when confirmation is rejected and ignores re-entrant click', async () => {
    mockConfirm.mockResolvedValue(false);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: mockDischarges,
    } as unknown as MovementsValue);

    render(<DischargesSection />);

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /deshacer/i }));
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /eliminar/i }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(1);
    });
    expect(mockOnUndo).not.toHaveBeenCalled();
    expect(mockOnDelete).not.toHaveBeenCalled();
  });

  it('shows error notification when confirm dialog fails', async () => {
    mockConfirm.mockRejectedValue(new Error('dialog failed'));
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: mockDischarges,
    } as unknown as MovementsValue);

    render(<DischargesSection />);

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /deshacer/i }));

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith(
        'No se pudo deshacer alta',
        expect.stringContaining('dialog failed')
      );
    });
    expect(mockOnUndo).not.toHaveBeenCalled();
  });

  it('returns null when discharges is null', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: null,
    } as unknown as MovementsValue);

    const { container } = render(<DischargesSection />);
    expect(container.firstChild).toBeNull();
  });
});
