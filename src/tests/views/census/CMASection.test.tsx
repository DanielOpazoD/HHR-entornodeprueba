import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { CMASection } from '@/features/census/components/CMASection';
import { useDailyRecordData, useDailyRecordMovements } from '@/context/DailyRecordContext';
import {
  useDailyRecordBedActions,
  useDailyRecordMovementActions,
} from '@/context/useDailyRecordScopedActions';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: vi.fn(),
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
  type MovementActionsValue = ReturnType<typeof useDailyRecordMovementActions>;
  type BedActionsValue = ReturnType<typeof useDailyRecordBedActions>;
  type MovementsValue = ReturnType<typeof useDailyRecordMovements>;
  type DataValue = ReturnType<typeof useDailyRecordData>;
  type ConfirmDialogValue = ReturnType<typeof useConfirmDialog>;
  type NotificationValue = ReturnType<typeof useNotification>;

  const deleteCMA = vi.fn();
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

    vi.mocked(useDailyRecordMovementActions).mockReturnValue({
      deleteCMA,
      updateCMA,
      convertCmaToHomeDischarge,
      convertCmaToTransfer,
    } as unknown as MovementActionsValue);

    vi.mocked(useDailyRecordBedActions).mockReturnValue({
      updatePatientMultiple,
    } as unknown as BedActionsValue);

    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [],
    } as unknown as MovementsValue);
    vi.mocked(useDailyRecordData).mockReturnValue({
      record: { date: '2024-12-11' },
    } as unknown as DataValue);

    vi.mocked(useConfirmDialog).mockReturnValue({ confirm } as unknown as ConfirmDialogValue);
    vi.mocked(useNotification).mockReturnValue({
      error: notifyError,
      warning: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
      notifications: [],
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      notify: vi.fn(),
      alert: vi.fn(),
      confirm: vi.fn(),
    } as unknown as NotificationValue);
  });

  it('renders empty state when there are no CMA records', () => {
    render(<CMASection />);
    expect(
      screen.getByText(/No hay registros de Hospitalización Diurna para hoy/)
    ).toBeInTheDocument();
  });

  it('updates intervention type and discharge time fields', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [cmaItem],
    } as unknown as MovementsValue);

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
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [
        {
          ...cmaItem,
          diagnosis: 'Diagnóstico original',
          interventionType: 'Cirugía Mayor Ambulatoria',
          dischargeTime: '12:00',
        },
      ],
    } as unknown as MovementsValue);

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
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [cmaItem],
    } as unknown as MovementsValue);

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /deshacer/i }));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Deshacer Egreso CMA',
        })
      );
      expect(updatePatientMultiple).toHaveBeenCalledWith('R1', cmaItem.originalData);
      expect(deleteCMA).toHaveBeenCalledWith('cma-1');
    });
  });

  it('shows informational dialog and skips restore when original data is missing', async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [
        {
          ...cmaItem,
          originalBedId: undefined,
          originalData: undefined,
        },
      ],
    } as unknown as MovementsValue);

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
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [cmaItem],
    } as unknown as MovementsValue);

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
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [cmaItem],
    } as unknown as MovementsValue);

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
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: null,
    } as unknown as MovementsValue);

    const { container } = render(<CMASection />);
    expect(container.firstChild).toBeNull();
  });

  it('converts CMA into transfer from the shared actions menu', async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [cmaItem],
    } as unknown as MovementsValue);

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /convertir a traslado/i }));

    await waitFor(() => expect(convertCmaToTransfer).toHaveBeenCalledWith('cma-1'));
  });
});
