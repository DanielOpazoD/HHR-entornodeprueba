import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { TransfersSection } from '@/features/census/components/TransfersSection';
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

describe('TransfersSection', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCensusActionCommands).mockReturnValue({
      handleEditTransfer: mockHandleEdit,
    } as any);
    vi.mocked(useConfirmDialog).mockReturnValue({ confirm: mockConfirm } as any);
    vi.mocked(useNotification).mockReturnValue({ error: mockNotifyError } as any);
    mockConfirm.mockResolvedValue(true);
    (useDailyRecordData as any).mockReturnValue({
      record: { date: '2024-12-11' },
    });
    (useDailyRecordMovementActions as any).mockReturnValue({
      undoTransfer: mockOnUndo,
      deleteTransfer: mockOnDelete,
    });
    (useDailyRecordMovements as any).mockReturnValue({
      transfers: [],
    });
  });

  it('renders empty message when no transfers', () => {
    (useDailyRecordData as any).mockReturnValue({
      record: { transfers: [] },
    });

    render(<TransfersSection />);
    expect(screen.getByText(/No hay traslados registrados/)).toBeInTheDocument();
  });

  it('renders transfer list and triggers actions', async () => {
    (useDailyRecordMovements as any).mockReturnValue({
      transfers: mockTransfers,
    });

    render(<TransfersSection />);

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
    expect(screen.getByText(content => content.includes('Nurse X'))).toBeInTheDocument();
    expect(screen.getByText('(11-12-2024)')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
    await waitFor(() => {
      expect(mockOnUndo).toHaveBeenCalledWith('t1');
    });

    fireEvent.click(screen.getByTitle('Editar'));
    expect(mockHandleEdit).toHaveBeenCalledWith(mockTransfers[0]);

    fireEvent.click(screen.getByTitle('Eliminar Registro'));
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
      transfers: null as any,
      discharges: [],
      cma: [],
    });
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

  it('does not execute undo/delete when confirmation is rejected and ignores re-entrant click', async () => {
    mockConfirm.mockResolvedValue(false);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: mockTransfers,
      discharges: [],
      cma: [],
    });

    render(<TransfersSection />);

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
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      transfers: mockTransfers,
      discharges: [],
      cma: [],
    });

    render(<TransfersSection />);

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith(
        'No se pudo deshacer traslado',
        expect.stringContaining('dialog failed')
      );
    });
    expect(mockOnUndo).not.toHaveBeenCalled();
  });
});
