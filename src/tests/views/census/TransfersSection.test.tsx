import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { TransfersSection } from '@/features/census/components/TransfersSection';
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

describe('TransfersSection', () => {
  type CensusActionCommandsValue = ReturnType<typeof useCensusActionCommands>;
  type DataValue = ReturnType<typeof useDailyRecordData>;
  type MovementActionsValue = ReturnType<typeof useDailyRecordMovementActions>;
  type MovementsValue = ReturnType<typeof useDailyRecordMovements>;
  type ConfirmDialogValue = ReturnType<typeof useConfirmDialog>;
  type NotificationValue = ReturnType<typeof useNotification>;

  const mockOnUndo = vi.fn();
  const mockOnDelete = vi.fn();
  const mockHandleEdit = vi.fn();
  const mockConfirm = vi.fn();
  const mockNotifyError = vi.fn();

  const mockTransfers = [
    DataFactory.createMockTransfer({
      id: 't1',
      bedName: 'R2',
      patientName: 'Jane Smith',
      receivingCenter: 'Hospital A',
      transferEscort: 'Nurse X',
    }),
  ];

  const clickTransferAction = (name: RegExp | string) => {
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCensusActionCommands).mockReturnValue({
      handleEditTransfer: mockHandleEdit,
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
      undoTransfer: mockOnUndo,
      deleteTransfer: mockOnDelete,
    } as unknown as MovementActionsValue);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: [],
    } as unknown as MovementsValue);
  });

  it('renders empty message when no transfers', () => {
    vi.mocked(useDailyRecordData).mockReturnValue({
      record: { transfers: [] },
    } as unknown as DataValue);

    render(<TransfersSection />);
    expect(screen.getByText(/No hay traslados registrados/)).toBeInTheDocument();
  });

  it('renders transfer list and triggers actions', async () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: mockTransfers,
    } as unknown as MovementsValue);

    render(<TransfersSection />);

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
    expect(screen.getByText(content => content.includes('Nurse X'))).toBeInTheDocument();
    expect(screen.getByText('(11-12-2024)')).toBeInTheDocument();

    clickTransferAction(/deshacer/i);
    await waitFor(() => {
      expect(mockOnUndo).toHaveBeenCalledWith('t1');
    });

    clickTransferAction(/editar/i);
    expect(mockHandleEdit).toHaveBeenCalledWith(mockTransfers[0]);

    clickTransferAction(/eliminar registro/i);
    await waitFor(() => {
      expect(mockOnDelete).toHaveBeenCalledWith('t1');
    });
  });

  it('renders "Otro" receiving center and escort logic', () => {
    const customTransfers = [
      DataFactory.createMockTransfer({
        id: 't2',
        receivingCenter: 'Otro',
        receivingCenterOther: 'Custom Clinic',
        transferEscort: 'Medic Y',
        evacuationMethod: 'Ambulancia',
      }),
      DataFactory.createMockTransfer({
        id: 't3',
        receivingCenter: 'Hospital B',
        transferEscort: 'Medic Z',
        evacuationMethod: 'Aerocardal',
      }),
    ];
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: customTransfers,
      discharges: [],
      cma: [],
    });

    render(<TransfersSection />);

    expect(screen.getByText('Custom Clinic')).toBeInTheDocument();
    expect(screen.getByText('Hospital B')).toBeInTheDocument();

    // Escort should show for t2 (Ambulancia) but NOT for t3 (Aerocardal)
    expect(screen.getByText(/Acompaña: Medic Y/)).toBeInTheDocument();
    expect(screen.queryByText(/Acompaña: Medic Z/)).not.toBeInTheDocument();
  });

  it('returns null if transfers is null', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: null,
      discharges: [],
      cma: [],
    } as unknown as MovementsValue);
    const { container } = render(<TransfersSection />);
    expect(container.firstChild).toBeNull();
  });

  it('displays next-day date for madrugada transfer times', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: [
        DataFactory.createMockTransfer({
          id: 't-night',
          time: '02:00',
          patientName: 'Night Transfer',
        }),
      ],
      discharges: [],
      cma: [],
    });

    render(<TransfersSection />);
    expect(screen.getByText('(12-12-2024)')).toBeInTheDocument();
  });

  it('does not execute undo/delete when confirmation is rejected', async () => {
    mockConfirm.mockResolvedValue(false);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: mockTransfers,
      discharges: [],
      cma: [],
    });

    render(<TransfersSection />);

    clickTransferAction(/deshacer/i);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(1);
    });

    clickTransferAction(/eliminar registro/i);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(2);
    });
    expect(mockOnUndo).not.toHaveBeenCalled();
    expect(mockOnDelete).not.toHaveBeenCalled();
  });

  it('shows error notification when confirm dialog fails', async () => {
    mockConfirm.mockRejectedValue(new Error('dialog failed'));
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: mockTransfers,
      discharges: [],
      cma: [],
    });

    render(<TransfersSection />);

    clickTransferAction(/deshacer/i);

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith(
        'No se pudo deshacer traslado',
        expect.stringContaining('dialog failed')
      );
    });
    expect(mockOnUndo).not.toHaveBeenCalled();
  });
});
