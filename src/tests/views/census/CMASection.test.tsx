import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { CMASection } from '@/features/census/components/CMASection';
import {
  useDailyRecordBedActions,
  useDailyRecordData,
  useDailyRecordMovementActions,
  useDailyRecordMovements,
} from '@/context/DailyRecordContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBedActions: vi.fn(),
  useDailyRecordData: vi.fn(),
  useDailyRecordMovementActions: vi.fn(),
  useDailyRecordMovements: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
  useNotification: vi.fn(),
}));

describe('CMASection', () => {
  const deleteCMA = vi.fn();
  const updateCMA = vi.fn();
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
    } as any);

    vi.mocked(useDailyRecordBedActions).mockReturnValue({
      updatePatientMultiple,
    } as any);

    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [],
    } as any);
    vi.mocked(useDailyRecordData).mockReturnValue({
      record: { date: '2024-12-11' },
    } as any);

    vi.mocked(useConfirmDialog).mockReturnValue({ confirm } as any);
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
    } as any);
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
    } as any);

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

  it('restores and deletes CMA entry when undo is confirmed', async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [cmaItem],
    } as any);

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Deshacer: Restaurar paciente a la cama'));

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
    } as any);

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Deshacer (sin datos originales)'));

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'No se puede deshacer',
      })
    );
    expect(updatePatientMultiple).not.toHaveBeenCalled();
    expect(deleteCMA).not.toHaveBeenCalled();
  });

  it('notifies error when undo confirmation fails and supports direct deletion', async () => {
    confirm.mockRejectedValue(new Error('dialog failed'));
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: [cmaItem],
    } as any);

    render(<CMASection />);
    fireEvent.click(screen.getByTitle('Deshacer: Restaurar paciente a la cama'));

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        'No se pudo deshacer',
        expect.stringContaining('No se pudo confirmar el deshacer CMA')
      );
    });

    fireEvent.click(screen.getByTitle('Eliminar registro'));
    expect(deleteCMA).toHaveBeenCalledWith('cma-1');
  });

  it('returns null when cma list is null', () => {
    vi.mocked(useDailyRecordMovements).mockReturnValue({
      discharges: [],
      transfers: [],
      cma: null,
    } as any);

    const { container } = render(<CMASection />);
    expect(container.firstChild).toBeNull();
  });
});
