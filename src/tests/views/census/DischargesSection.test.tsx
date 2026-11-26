import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DischargesSection } from '@/features/census/components/DischargesSection';
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

describe('DischargesSection', () => {
  type MovementsValue = ReturnType<typeof useDailyRecordMovements>;

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
    vi.mocked(useCensusActionCommands).mockReturnValue(
      buildMockCensusActionCommands({ handleEditDischarge: mockHandleEdit })
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
        undoDischarge: mockOnUndo,
        deleteDischarge: mockOnDelete,
        convertDischargeToCma: mockConvertDischargeToCma,
        convertDischargeToTransfer: mockConvertDischargeToTransfer,
      })
    );
    // Default empty movements
    vi.mocked(useDailyRecordMovements).mockReturnValue(buildMockDailyRecordMovements());
  });

  it('renders empty message when no discharges', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue(buildMockDailyRecordMovements());

    render(<DischargesSection />);
    expect(screen.getByText('Sin registros para el día seleccionado.')).toBeInTheDocument();
  });

  it('renders discharge list and triggers actions', async () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ discharges: mockDischarges })
    );

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
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ discharges: mockDischarges })
    );

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
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ discharges: mockDischarges })
    );

    render(<DischargesSection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /convertir a traslado/i }));

    await waitFor(() => {
      expect(mockConvertDischargeToTransfer).toHaveBeenCalledWith('1');
    });
  });

  it('does not execute undo/delete when confirmation is rejected and ignores re-entrant click', async () => {
    mockConfirm.mockResolvedValue(false);
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ discharges: mockDischarges })
    );

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
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ discharges: mockDischarges })
    );

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
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      asStoredDailyRecordShape<MovementsValue>({
        discharges: null,
        transfers: [],
        cma: [],
      })
    );

    const { container } = render(<DischargesSection />);
    expect(container.firstChild).toBeNull();
  });
});
