import { describe, expect, it } from 'vitest';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import { buildMovementsSummaryViewModel } from '@/features/handoff/controllers/movementsSummaryController';

const buildRecord = (): HandoffDailyRecordContract =>
  ({
    date: '2026-03-29',
    beds: {},
    discharges: [
      {
        id: 'd1',
        bedName: 'H1C1',
        patientName: 'Paciente Día',
        rut: '1-9',
        diagnosis: 'Dx 1',
        dischargeType: 'Domicilio',
        status: 'Vivo',
        time: '10:00',
      },
      {
        id: 'd2',
        bedName: 'H1C2',
        patientName: 'Paciente Noche',
        rut: '2-7',
        diagnosis: 'Dx 2',
        dischargeType: 'Domicilio',
        status: 'Vivo',
        time: '22:00',
      },
    ],
    transfers: [
      {
        id: 't1',
        bedName: 'H2C1',
        patientName: 'Traslado Día',
        rut: '3-5',
        diagnosis: 'Dx 3',
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital',
        transferEscort: 'TENS',
        time: '11:30',
      },
    ],
    cma: [
      {
        id: 'c1',
        bedName: 'CMA1',
        patientName: 'Paciente CMA',
        rut: '4-4',
        diagnosis: 'Dx CMA',
        interventionType: 'Control',
      },
    ],
  }) as unknown as HandoffDailyRecordContract;

describe('movementsSummaryController', () => {
  it('builds a day-shift view model with filtered items and empty messages', () => {
    const viewModel = buildMovementsSummaryViewModel({
      record: buildRecord(),
      selectedShift: 'day',
    });

    expect(viewModel.discharges.items).toHaveLength(1);
    expect(viewModel.discharges.items[0]?.patientName).toBe('Paciente Día');
    expect(viewModel.transfers.items).toHaveLength(1);
    expect(viewModel.cma.items).toHaveLength(1);
    expect(viewModel.cma.emptyMessage).toBe('No hay pacientes de CMA hoy.');
  });

  it('builds a night-shift view model that hides CMA and filters movements by time', () => {
    const viewModel = buildMovementsSummaryViewModel({
      record: buildRecord(),
      selectedShift: 'night',
    });

    expect(viewModel.discharges.items).toHaveLength(1);
    expect(viewModel.discharges.items[0]?.patientName).toBe('Paciente Noche');
    expect(viewModel.transfers.items).toHaveLength(0);
    expect(viewModel.cma.items).toEqual([]);
    expect(viewModel.cma.emptyMessage).toBe('CMA solo aplica para turno de día.');
  });
});
