vi.mock('@/hooks/useStabilityRules', () => ({
  useStabilityRules: () => ({ canPerformActions: true }),
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TransfersSection } from '@/features/census/components/TransfersSection';
import { useCensusActionCommands } from '@/features/census/context/censusActionContexts';
import { useDailyRecordStaff, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useCensusMovementActions } from '@/features/census/context/CensusMovementActionsContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { DataFactory, asStoredDailyRecordShape } from '../../factories/DataFactory';
import {
  buildMockCensusActionCommands,
  buildMockDailyRecordMovements,
  buildMockDailyRecordStaff,
  buildMockMovementActions,
  buildMockUIContext,
} from '@/tests/factories/censusContextMocks';

vi.mock('@/features/census/context/censusActionContexts', () => ({
  useCensusActionCommands: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStaff: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

vi.mock('@/features/census/context/CensusMovementActionsContext', () => ({
  useCensusMovementActions: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
  useNotification: vi.fn(),
}));

describe('TransfersSection', () => {
  type MovementsValue = ReturnType<typeof useDailyRecordMovements>;

  const mockOnUndo = vi.fn();
  const mockOnDelete = vi.fn();
  const mockConvertTransferToHomeDischarge = vi.fn();
  const mockConvertTransferToCma = vi.fn();
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
    vi.mocked(useCensusActionCommands).mockReturnValue(
      buildMockCensusActionCommands({ handleEditTransfer: mockHandleEdit })
    );
    const uiContext = buildMockUIContext({ confirm: mockConfirm, error: mockNotifyError });
    vi.mocked(useConfirmDialog).mockReturnValue(uiContext);
    vi.mocked(useNotification).mockReturnValue(uiContext);
    mockConfirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      buildMockDailyRecordStaff({ date: '2024-12-11' })
    );
    vi.mocked(useCensusMovementActions).mockReturnValue(
      buildMockMovementActions({
        undoTransfer: mockOnUndo,
        deleteTransfer: mockOnDelete,
        convertTransferToHomeDischarge: mockConvertTransferToHomeDischarge,
        convertTransferToCma: mockConvertTransferToCma,
      })
    );
    vi.mocked(useDailyRecordMovements).mockReturnValue(buildMockDailyRecordMovements());
  });

  it('renders empty message when no transfers', () => {
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      buildMockDailyRecordStaff({ date: '2024-12-11' })
    );

    render(<TransfersSection />);
    expect(screen.getByText('Sin registros para el día seleccionado.')).toBeInTheDocument();
  });

  it('renders transfer list and triggers actions', async () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ transfers: mockTransfers })
    );

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
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ transfers: customTransfers })
    );

    render(<TransfersSection />);

    expect(screen.getByText('Custom Clinic')).toBeInTheDocument();
    expect(screen.getByText('Hospital B')).toBeInTheDocument();

    // Escort should show for t2 (Ambulancia) but NOT for t3 (Aerocardal)
    expect(screen.getByText(/Acompaña: Medic Y/)).toBeInTheDocument();
    expect(screen.queryByText(/Acompaña: Medic Z/)).not.toBeInTheDocument();
  });

  it('offers both classification corrections for a transfer', async () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ transfers: mockTransfers })
    );
    render(<TransfersSection />);

    clickTransferAction(/convertir a alta domicilio/i);
    await waitFor(() => expect(mockConvertTransferToHomeDischarge).toHaveBeenCalledWith('t1'));

    clickTransferAction(/convertir a cma/i);
    await waitFor(() => expect(mockConvertTransferToCma).toHaveBeenCalledWith('t1'));
  });

  it('returns null if transfers is null', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      asStoredDailyRecordShape<MovementsValue>({
        transfers: null,
        discharges: [],
        cma: [],
      })
    );
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
