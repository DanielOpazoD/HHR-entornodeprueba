import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CMASection } from '@/features/census/components/CMASection';
import { useDailyRecordStaff, useDailyRecordMovements } from '@/context/DailyRecordContext';
import {
  useDailyRecordBedActions,
  useDailyRecordMovementActions,
} from '@/context/useDailyRecordScopedActions';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { DataFactory, asStoredDailyRecordShape } from '@/tests/factories/DataFactory';
import {
  buildMockBedActions,
  buildMockDailyRecordMovements,
  buildMockDailyRecordStaff,
  buildMockMovementActions,
  buildMockUIContext,
} from '@/tests/factories/censusContextMocks';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStaff: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordBedActions: vi.fn(),
  useDailyRecordMovementActions: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
  useNotification: vi.fn(),
}));

describe('CMASection', () => {
  type MovementsValue = ReturnType<typeof useDailyRecordMovements>;

  const deleteCMA = vi.fn();
  const undoCMA = vi.fn();
  const updateCMA = vi.fn();
  const convertCmaToHomeDischarge = vi.fn();
  const convertCmaToTransfer = vi.fn();
  const updatePatientMultiple = vi.fn();
  const confirm = vi.fn();
  const notifyError = vi.fn();

  const cmaItem = DataFactory.createMockCMA({
    id: 'cma-1',
    bedName: 'R1',
    patientName: 'Paciente CMA',
    dischargeTime: '12:00',
    originalBedId: 'R1',
    originalData: DataFactory.createMockPatient('R1', { patientName: 'Paciente CMA' }),
  });

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDailyRecordMovementActions).mockReturnValue(
      buildMockMovementActions({
        deleteCMA,
        undoCMA,
        updateCMA,
        convertCmaToHomeDischarge,
        convertCmaToTransfer,
      })
    );

    vi.mocked(useDailyRecordBedActions).mockReturnValue(
      buildMockBedActions({ updatePatientMultiple })
    );

    vi.mocked(useDailyRecordMovements).mockReturnValue(buildMockDailyRecordMovements());
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      buildMockDailyRecordStaff({ date: '2024-12-11' })
    );

    const uiContext = buildMockUIContext({ confirm, error: notifyError });
    vi.mocked(useConfirmDialog).mockReturnValue(uiContext);
    vi.mocked(useNotification).mockReturnValue(uiContext);
  });

  it('renders empty state when there are no CMA records', () => {
    render(<CMASection />);
    expect(screen.getByText('Sin registros para el día seleccionado.')).toBeInTheDocument();
  });

  it('updates intervention type and discharge time fields', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ cma: [cmaItem] })
    );

    render(<CMASection />);

    fireEvent.change(screen.getByDisplayValue('Cirugía Mayor Ambulatoria'), {
      target: { value: 'Procedimiento Médico Ambulatorio' },
    });
    expect(updateCMA).toHaveBeenCalledWith('cma-1', {
      interventionType: 'Procedimiento Médico Ambulatorio',
    });

    fireEvent.change(screen.getByDisplayValue('12:00'), {
      target: { value: '13:10' },
    });
    expect(updateCMA).toHaveBeenCalledWith('cma-1', {
      dischargeTime: '13:10',
    });
  });

  it('saves CMA edit dialog changes in one atomic update', async () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({
        cma: [
          {
            ...cmaItem,
            diagnosis: 'Diagnóstico original',
            interventionType: 'Cirugía Mayor Ambulatoria',
            dischargeTime: '12:00',
          },
        ],
      })
    );

    render(<CMASection />);

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /editar datos cma/i }));
    fireEvent.change(screen.getByLabelText(/Diagnóstico de egreso/i), {
      target: { value: 'Diagnóstico actualizado CMA' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => {
      expect(updateCMA).toHaveBeenCalledTimes(1);
      expect(updateCMA).toHaveBeenCalledWith('cma-1', {
        interventionType: 'Cirugía Mayor Ambulatoria',
        dischargeTime: '12:00',
        diagnosis: 'Diagnóstico actualizado CMA',
      });
    });
  });

  it('restores and deletes CMA entry when undo is confirmed', async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ cma: [cmaItem] })
    );

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /deshacer/i }));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Deshacer Egreso CMA',
        })
      );
      expect(undoCMA).toHaveBeenCalledWith(cmaItem);
    });
  });

  it('shows informational dialog and skips restore when original data is missing', async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({
        cma: [
          {
            ...cmaItem,
            originalBedId: undefined,
            originalData: undefined,
          },
        ],
      })
    );

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /deshacer/i }));

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'No se puede deshacer',
      })
    );
    expect(updatePatientMultiple).not.toHaveBeenCalled();
    expect(deleteCMA).not.toHaveBeenCalled();
  });

  it('notifies error when undo confirmation fails and deletes only after confirmation', async () => {
    confirm.mockRejectedValueOnce(new Error('dialog failed')).mockResolvedValueOnce(true);
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ cma: [cmaItem] })
    );

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /deshacer/i }));

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        'No se pudo deshacer',
        expect.stringContaining('No se pudo confirmar el deshacer CMA')
      );
    });

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /eliminar/i }));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Eliminar registro CMA',
          confirmText: 'Eliminar',
          variant: 'danger',
        })
      );
      expect(deleteCMA).toHaveBeenCalledWith('cma-1');
    });
  });

  it('converts CMA into home discharge from the shared actions menu', async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ cma: [cmaItem] })
    );

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /convertir a alta domicilio/i }));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Convertir CMA a alta domicilio',
        })
      );
      expect(convertCmaToHomeDischarge).toHaveBeenCalledWith('cma-1');
    });
  });

  it('returns null when cma list is null', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      asStoredDailyRecordShape<MovementsValue>({
        discharges: [],
        transfers: [],
        cma: null,
      })
    );

    const { container } = render(<CMASection />);
    expect(container.firstChild).toBeNull();
  });

  it('converts CMA into transfer from the shared actions menu', async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordMovements).mockReturnValue(
      buildMockDailyRecordMovements({ cma: [cmaItem] })
    );

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /convertir a traslado/i }));

    await waitFor(() => expect(convertCmaToTransfer).toHaveBeenCalledWith('cma-1'));
  });
});
